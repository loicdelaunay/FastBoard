import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { LogEntryDTO, MonitoringSnapshotDTO } from '../../shared/monitoring.ts';
import { Db } from '../db/database.ts';
import { migrate } from '../db/migrations.ts';
import { Logger, queryLogs } from '../monitoring/logger.ts';
import { Metrics, percentile } from '../monitoring/metrics.ts';
import { assessHealth } from '../monitoring/snapshot.ts';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

describe('supervision : API', () => {
  let app: Booted;
  let admin: TestClient;
  let bob: TestClient;
  const ids: Record<string, number> = {};
  const flush = () => app.running.ctx.logger.flush();
  const logs = async (query = ''): Promise<{ logs: LogEntryDTO[]; nextBefore: number | null }> => {
    flush();
    return (await admin.get(`/api/admin/logs${query}`)).body;
  };

  before(async () => {
    app = await bootServer();
    admin = app.client();
    await admin.login('admin@admin.com', 'admin1234');
    const roles = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
    ids.member = roles.find((r) => r.key === 'member')!.id;
    ids.admin = roles.find((r) => r.key === 'admin' && r.scope === 'global')!.id;
    ids.bob = (await admin.post('/api/admin/users', { email: 'bob@t.fr', name: 'bob', password: 'motdepasse1', roleId: ids.member })).body.user.id;
    bob = app.client();
    await bob.login('bob@t.fr', 'motdepasse1');
  });

  after(async () => {
    await app.running.close();
  });

  it('réserve les performances et les journaux aux personnes autorisées, et à la session', async () => {
    for (const path of ['/api/admin/monitoring', '/api/admin/logs', '/api/admin/logs/export']) {
      assert.equal((await bob.get(path)).status, 403, path);
      assert.equal((await app.client().get(path)).status, 401, path);
    }
    const secret = (await admin.post('/api/me/tokens', { name: 'agent', scope: 'write' })).body.secret as string;
    const agent = app.client().useToken(secret);
    assert.equal((await agent.get('/api/admin/monitoring')).body.error.code, 'session_required');
    assert.equal((await agent.get('/api/admin/logs')).body.error.code, 'session_required');
  });

  it("donne les droits d'un rôle personnalisé : performances sans journaux", async () => {
    const role = (await admin.post('/api/admin/roles', { scope: 'global', name: 'Supervision', permissions: ['admin.access', 'monitoring.view'] })).body.role;
    const watcher = (await admin.post('/api/admin/users', { email: 'watch@t.fr', name: 'watch', password: 'motdepasse1', roleId: role.id })).body.user;
    const client = app.client();
    await client.login('watch@t.fr', 'motdepasse1');
    assert.equal((await client.get('/api/admin/monitoring')).status, 200);
    assert.equal((await client.get('/api/admin/logs')).status, 403);
    assert.ok(watcher.id);
  });

  it('mesure les requêtes par modèle de route, avec latences et erreurs', async () => {
    const project = (await bob.post('/api/projects', { name: 'Mesures', key: 'MS' })).body.project.id as number;
    for (let i = 0; i < 3; i++) await bob.get(`/api/projects/${project}`);
    await bob.get('/api/projets-inconnus');
    await bob.post(`/api/projects/${project}/tickets`, { title: '' });

    const snapshot = (await admin.get('/api/admin/monitoring?range=15m')).body as MonitoringSnapshotDTO;
    assert.equal(snapshot.range, '15m');
    assert.ok(snapshot.summary.requests >= 6);
    const route = snapshot.routes.find((r) => r.method === 'GET' && r.route === '/api/projects/:id');
    assert.ok(route, `routes : ${snapshot.routes.map((r) => `${r.method} ${r.route}`).join(', ')}`);
    assert.equal(route.count, 3);
    assert.ok(route.avgMs >= 0 && route.p95Ms >= 0 && route.maxMs >= route.avgMs);
    assert.ok(snapshot.routes.some((r) => r.route === '(route inconnue)'));
    assert.ok(snapshot.routes.every((r) => !/\/api\/projects\/\d+/.test(r.route)), 'aucun identifiant dans les clés');
    assert.ok(snapshot.summary.errors4xx >= 2);
    assert.equal(snapshot.summary.errors5xx, 0);
    assert.equal(snapshot.summary.histogram.reduce((a, b) => a + b, 0), snapshot.summary.requests);
    assert.ok(snapshot.series.length >= 1);
    const point = snapshot.series.at(-1)!;
    assert.ok(point.requests >= 6 && point.rssMb > 0);
    assert.equal(snapshot.health.status, 'ok');
  });

  it("fournit l'instantané : processus, base, temps réel, stockage et comptages", async () => {
    app.running.ctx.metrics.sample();
    const { overview } = (await admin.get('/api/admin/monitoring?range=1h')).body as MonitoringSnapshotDTO;
    assert.ok(overview.uptimeSeconds >= 0);
    assert.match(overview.nodeVersion, /^v\d+/);
    assert.ok(overview.process.rssMb > 0 && overview.process.heapUsedMb > 0);
    assert.ok(overview.database.queries > 0);
    assert.ok(overview.database.tables.find((t) => t.name === 'Utilisateurs')!.rows >= 2);
    assert.equal(overview.realtime.clients, 0);
    assert.equal(overview.storage.attachments, 0);
    const socket = await bob.connect();
    assert.equal(((await admin.get('/api/admin/monitoring')).body as MonitoringSnapshotDTO).overview.realtime.clients, 1);
    socket.close();
  });

  it('refuse une fenêtre inconnue', async () => {
    assert.equal((await admin.get('/api/admin/monitoring?range=2y')).status, 400);
  });

  it("journalise les connexions, échecs et actions d'administration", async () => {
    await app.client().login('bob@t.fr', 'mauvais-mot-de-passe');
    const { logs: entries } = await logs('?source=auth');
    const failure = entries.find((entry) => entry.message.startsWith('Échec de connexion pour bob@t.fr'));
    assert.ok(failure);
    assert.equal(failure.level, 'warn');
    assert.equal(failure.userId, ids.bob);
    assert.equal(failure.userName, 'bob');
    assert.ok(failure.requestId);
    assert.ok(entries.some((entry) => entry.level === 'info' && entry.message === 'Connexion de bob@t.fr'));
    assert.ok(!JSON.stringify(entries).includes('mauvais-mot-de-passe'), 'jamais de mot de passe dans les journaux');

    const audit = (await logs('?source=admin')).logs;
    assert.ok(audit.some((entry) => entry.message === 'Compte créé : bob@t.fr' && entry.userName === 'Super Admin'));
    assert.ok((await logs('?source=system')).logs.some((entry) => entry.message === 'Serveur démarré'));
  });

  it('filtre par niveau, texte, requête, et pagine par curseur', async () => {
    const { logger } = app.running.ctx;
    for (let i = 0; i < 5; i++) logger.error('http', `Erreur interne : panne ${i}`, { stack: 'trace' }, null, 'req-fixe');
    logger.debug('http', 'bruit');
    flush();

    const errors = (await logs('?level=error')).logs;
    assert.equal(errors.length, 5);
    assert.ok(errors.every((entry) => entry.level === 'error'));
    assert.equal(errors[0]!.message, 'Erreur interne : panne 4', 'le plus récent en premier');
    assert.deepEqual(errors[0]!.data, { stack: 'trace' });
    assert.equal((await logs('?q=panne 2')).logs.length, 1);
    assert.equal((await logs('?requestId=req-fixe')).logs.length, 5);
    assert.equal((await logs('?level=debug')).logs.length, 0, 'le niveau minimal est info : le debug est ignoré');
    assert.equal((await logs('?q=%25')).logs.length, 0, 'les jokers LIKE sont neutralisés');

    const first = await logs('?level=error&limit=2');
    assert.equal(first.logs.length, 2);
    assert.ok(first.nextBefore);
    const second = await logs(`?level=error&limit=2&before=${first.nextBefore}`);
    assert.deepEqual(second.logs.map((entry) => entry.message), ['Erreur interne : panne 2', 'Erreur interne : panne 1']);
    const lastId = errors[0]!.id;
    logger.error('http', 'Erreur interne : nouvelle', null);
    assert.deepEqual((await logs(`?after=${lastId}`)).logs.map((entry) => entry.message), ['Erreur interne : nouvelle']);
  });

  it("renvoie un identifiant de requête et journalise les refus d'accès", async () => {
    const forbidden = await bob.raw('GET', '/api/admin/logs');
    assert.match(forbidden.headers.get('x-request-id') ?? '', /^[0-9a-f]{8}$/);
    const { logs: entries } = await logs('?source=http&level=warn');
    const entry = entries.find((item) => item.requestId === forbidden.headers.get('x-request-id'));
    assert.ok(entry);
    assert.match(entry.message, /GET \/api\/admin\/logs → 403/);
    assert.equal((entry.data as { route: string }).route, '/api/admin/logs');
  });

  it("exporte les journaux filtrés en lignes JSON", async () => {
    flush();
    const response = await admin.raw('GET', '/api/admin/logs/export?level=error');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /ndjson/);
    const lines = response.bytes.toString().trim().split('\n').map((line) => JSON.parse(line) as LogEntryDTO);
    assert.equal(lines.length, 6);
    assert.ok(lines.every((line) => line.level === 'error'));
  });

  it('compte les erreurs des dernières 24 h dans le tableau de bord', async () => {
    flush();
    const { overview } = (await admin.get('/api/admin/monitoring')).body as MonitoringSnapshotDTO;
    assert.equal(overview.logs.errors24h, 6);
    assert.ok(overview.logs.warnings24h >= 1);
  });
});

describe('supervision : composants', () => {
  it('estime les percentiles depuis un histogramme', () => {
    assert.equal(percentile([0, 0, 0], 0.95, 0), 0);
    // 100 requêtes ≤ 1 ms, 100 requêtes entre 50 et 100 ms.
    const histogram = new Array(13).fill(0) as number[];
    histogram[0] = 100;
    histogram[6] = 100;
    assert.ok(percentile(histogram, 0.5, 90) <= 1);
    const p95 = percentile(histogram, 0.95, 90);
    assert.ok(p95 > 50 && p95 <= 90, `p95 = ${p95}`);
    assert.equal(percentile(histogram, 1, 70), 70, 'jamais au-dessus du maximum observé');
  });

  it("garde les indicateurs d'une minute et les retrouve après un redémarrage", () => {
    const db = new Db(':memory:');
    migrate(db);
    const first = new Metrics(db, { wsClients: () => 2 });
    first.record('GET', '/api/x', 200, 12);
    first.record('GET', '/api/x', 500, 300);
    first.sample();
    first.stop();

    const second = new Metrics(db, { wsClients: () => 0 });
    second.record('GET', '/api/x', 200, 8);
    const { summary, routes, series } = second.window('15m');
    assert.equal(summary.requests, 3);
    assert.equal(summary.errors5xx, 1);
    assert.equal(routes[0]!.count, 3);
    assert.equal(routes[0]!.errors, 1);
    assert.equal(series.at(-1)!.wsClients, 2);
    assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM metrics_minutes')?.n, 1);
    db.close();
  });

  it('regroupe les minutes pour limiter le nombre de points', () => {
    const db = new Db(':memory:');
    migrate(db);
    const metrics = new Metrics(db, { wsClients: () => 0 });
    const { stepMs, series } = metrics.window('3d');
    assert.equal(stepMs, 24 * 60_000, 'un point par 24 min sur 3 jours');
    assert.ok(series.length <= 1);
    db.close();
  });

  it('tamponne les journaux, supprime les plus anciens et respecte le niveau minimal', () => {
    const db = new Db(':memory:');
    migrate(db);
    const logger = new Logger(db, { minLevel: 'warn', toConsole: false });
    logger.info('system', 'ignoré');
    logger.warn('system', 'gardé', { a: 1 });
    assert.equal(queryLogs(db, { limit: 10 }).logs.length, 0, "rien n'est écrit avant le vidage du tampon");
    logger.flush();
    assert.deepEqual(queryLogs(db, { limit: 10 }).logs.map((entry) => entry.message), ['gardé']);

    db.run("INSERT INTO app_logs (ts, level, source, message) VALUES ('2020-01-01T00:00:00.000Z', 'warn', 'system', 'ancien')");
    logger.prune();
    assert.deepEqual(queryLogs(db, { limit: 10 }).logs.map((entry) => entry.message), ['gardé']);
    db.close();
  });

  it('évalue la santé : sain, dégradé, critique', () => {
    const base = { requests: 100, requestsPerMinute: 10, errors4xx: 0, errors5xx: 0, errorRate: 0, avgMs: 20, p50Ms: 10, p95Ms: 50, p99Ms: 90, maxMs: 120, histogram: [] };
    assert.deepEqual(assessHealth(base, 5), { status: 'ok', reasons: [] });
    assert.equal(assessHealth({ ...base, errorRate: 2 }, 5).status, 'degraded');
    assert.equal(assessHealth({ ...base, errorRate: 8 }, 5).status, 'critical');
    assert.equal(assessHealth({ ...base, p95Ms: 800 }, 5).status, 'degraded');
    assert.equal(assessHealth(base, 600).status, 'critical');
    assert.equal(assessHealth({ ...base, requests: 5, errorRate: 50 }, 5).status, 'ok', 'trop peu de requêtes pour conclure');
  });
});
