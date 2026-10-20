import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { nextScheduledRun, parseRetentionRules, selectRetained } from '../../shared/backup.ts';
import { APP_VERSION, CHANGELOG } from '../../shared/changelog.ts';
import type { ActivityDTO, HistoryEntryDTO, TicketDTO } from '../../shared/types.ts';
import { readZip } from '../backup/zip.ts';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;
const DAY = 86_400_000;

describe('version et journal des modifications', () => {
  it('package.json, APP_VERSION et la dernière entrée du journal concordent', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', '..', 'package.json'), 'utf8')) as { version: string };
    assert.equal(pkg.version, APP_VERSION, 'incrémentez la version dans package.json ET shared/changelog.ts (voir AGENTS.md)');
    assert.equal(CHANGELOG[0]?.version, APP_VERSION, 'ajoutez une entrée en tête du journal pour la nouvelle version');
    for (const release of CHANGELOG) {
      assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(release.changes.length > 0);
    }
  });
});

describe('règles de conservation des sauvegardes', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  /** Une sauvegarde par jour pendant 400 jours (id = âge en jours). */
  const daily = Array.from({ length: 400 }, (_, age) => ({ id: age, at: now - age * DAY }));

  it('analyse la syntaxe des règles personnalisées', () => {
    assert.deepEqual(parseRetentionRules('7D:0s,4W:1D'), [
      { timeframe: 7 * DAY, interval: 0 },
      { timeframe: 28 * DAY, interval: DAY },
    ]);
    assert.equal(parseRetentionRules('7D'), null);
    assert.equal(parseRetentionRules('7X:1D'), null);
    assert.equal(parseRetentionRules(''), null);
    assert.deepEqual(parseRetentionRules('1Y:U'), [{ timeframe: 365 * DAY, interval: null }]);
  });

  it('garde N sauvegardes, ou celles de moins de N jours', () => {
    assert.deepEqual([...selectRetained(daily, { mode: 'count', keep: 3 }, now)].sort((a, b) => a - b), [0, 1, 2]);
    assert.equal(selectRetained(daily, { mode: 'age', days: 10 }, now).size, 11);
    assert.equal(selectRetained(daily, { mode: 'all' }, now).size, 400);
  });

  it('conservation intelligente : une par jour, puis par semaine, puis par mois ; la plus récente toujours', () => {
    const kept = selectRetained(daily, { mode: 'smart' }, now);
    assert.ok(kept.has(0));
    for (let age = 0; age <= 6; age++) assert.ok(kept.has(age), `jour ${age} gardé`);
    const weekly = [...kept].filter((age) => age > 7 && age <= 28);
    assert.ok(weekly.length >= 3 && weekly.length <= 4, `une par semaine sur le mois (${weekly})`);
    const monthly = [...kept].filter((age) => age > 28 && age <= 360);
    assert.ok(monthly.length >= 10 && monthly.length <= 13, `une par mois sur l'année (${monthly.length})`);
    assert.ok(![...kept].some((age) => age > 366), 'au-delà de la dernière règle : supprimées');
  });

  it("une règle invalide ne supprime rien", () => {
    assert.equal(selectRetained(daily, { mode: 'custom', rules: 'n importe quoi' }, now).size, 400);
  });

  it('calcule la prochaine exécution planifiée', () => {
    const base = new Date(2026, 9, 20, 10, 0, 0).getTime();
    assert.equal(nextScheduledRun({ mode: 'manual' }, null, base), null);
    assert.equal(nextScheduledRun({ mode: 'interval', hours: 6 }, base, base), base + 6 * 3_600_000);
    assert.equal(nextScheduledRun({ mode: 'interval', hours: 6 }, null, base), base, 'jamais lancée : tout de suite');
    const next = new Date(nextScheduledRun({ mode: 'daily', time: '02:30', weekdays: [] }, base, base)!);
    assert.deepEqual([next.getDate(), next.getHours(), next.getMinutes()], [21, 2, 30]);
    const missed = nextScheduledRun({ mode: 'daily', time: '02:30', weekdays: [] }, base - 2 * DAY, base)!;
    assert.ok(missed < base, 'un créneau manqué (serveur éteint) est rattrapé');
  });
});

describe('version 1.1 : priorités, composants, sous-tâches, dépendances, jetons, recherche, sauvegardes', () => {
  let app: Booted;
  let admin: TestClient;
  let bob: TestClient;
  let alice: TestClient;
  let agent: TestClient;
  const ids: Record<string, number> = {};
  let agentSecret = '';

  const ticket = async (id: number): Promise<TicketDTO> => (await bob.get(`/api/tickets/${id}`)).body.ticket;

  before(async () => {
    app = await bootServer();
    admin = app.client();
    await admin.login('admin@admin.com', 'admin1234');
    const roles = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
    const role = (key: string, scope = 'global') => roles.find((r) => r.key === key && r.scope === scope)!.id;
    for (const name of ['bob', 'alice']) {
      ids[name] = (await admin.post('/api/admin/users', { email: `${name}@t.fr`, name, password: 'motdepasse1', roleId: role('member') })).body.user.id;
    }
    bob = app.client();
    await bob.login('bob@t.fr', 'motdepasse1');
    alice = app.client();
    await alice.login('alice@t.fr', 'motdepasse1');
    ids.project = (await bob.post('/api/projects', { name: 'Suivi', key: 'SV' })).body.project.id;
    await bob.post(`/api/projects/${ids.project}/members`, { userId: ids.alice, roleId: role('contributor', 'project') });
    const created = await bob.post('/api/me/tokens', { name: 'agent-planning', displayName: 'Claude', scope: 'write' });
    agentSecret = created.body.secret;
    ids.token = created.body.token.id;
    agent = app.client().useToken(agentSecret);
  });

  after(async () => {
    await app.running.close();
  });

  it('crée les priorités par défaut avec le projet et les rend réglables', async () => {
    const snapshot = (await bob.get(`/api/projects/${ids.project}`)).body;
    assert.deepEqual(snapshot.priorities.map((p: { name: string }) => p.name), ['Critique', 'Haute', 'Moyenne', 'Basse']);
    assert.deepEqual(snapshot.components, []);
    ids.high = snapshot.priorities[1].id;
    ids.low = snapshot.priorities[3].id;

    const component = await bob.post(`/api/projects/${ids.project}/components`, { name: 'API', color: '#0ea5e9', icon: 'pi pi-server' });
    assert.equal(component.status, 201);
    ids.api = component.body.component.id;
    ids.web = (await bob.post(`/api/projects/${ids.project}/components`, { name: 'Web', color: '#22c55e', icon: 'pi pi-desktop' })).body.component.id;
    assert.equal((await bob.post(`/api/projects/${ids.project}/components`, { name: 'api', color: '#000000', icon: 'pi pi-server' })).status, 409, 'nom unique (casse ignorée)');
    assert.equal((await bob.post(`/api/projects/${ids.project}/components`, { name: 'X', color: '#000000', icon: 'fa fa-x' })).status, 400, 'icône PrimeIcons uniquement');
    assert.equal((await alice.post(`/api/projects/${ids.project}/components`, { name: 'Y', color: '#000000', icon: 'pi pi-box' })).status, 403);

    const moved = await bob.patch(`/api/projects/${ids.project}/priorities/${ids.low}`, { position: 0 });
    assert.equal(moved.body.priority.position, 0);
    const order = (await bob.get(`/api/projects/${ids.project}`)).body.priorities.map((p: { name: string }) => p.name);
    assert.deepEqual(order, ['Basse', 'Critique', 'Haute', 'Moyenne']);
  });

  it('assigne priorité et composants à un ticket, historisés et filtrables', async () => {
    const created = await bob.post(`/api/projects/${ids.project}/tickets`, { title: 'Paiement', priorityId: ids.high, componentIds: [ids.api], assigneeIds: [ids.alice] });
    assert.equal(created.status, 201);
    ids.ticket = created.body.ticket.id;
    assert.equal(created.body.ticket.priorityId, ids.high);
    assert.deepEqual(created.body.ticket.componentIds, [ids.api]);
    assert.ok(created.body.ticket.statusChangedAt);

    await bob.patch(`/api/tickets/${ids.ticket}`, { priorityId: ids.low, componentIds: [ids.api, ids.web] });
    const history = (await bob.get(`/api/tickets/${ids.ticket}/history`)).body.history as HistoryEntryDTO[];
    const update = history.find((entry) => entry.data.kind === 'updated');
    assert.ok(update && update.data.kind === 'updated');
    assert.deepEqual(update.data.changes.map((change) => change.field).sort(), ['components', 'priority']);

    const filtered = (await bob.get(`/api/projects/${ids.project}/tickets?componentId=${ids.web}`)).body;
    assert.equal(filtered.total, 1);
    assert.equal((await bob.get(`/api/projects/${ids.project}/tickets?priorityId=${ids.high}`)).body.total, 0);

    // Supprimer un composant le retire des tickets.
    await bob.del(`/api/projects/${ids.project}/components/${ids.web}`);
    assert.deepEqual((await ticket(ids.ticket)).componentIds, [ids.api]);
    // Une priorité d'un autre projet est refusée.
    const other = (await bob.post('/api/projects', { name: 'Autre', key: 'AU' })).body.project.id;
    const foreign = (await bob.get(`/api/projects/${other}`)).body.priorities[0].id;
    assert.equal((await bob.patch(`/api/tickets/${ids.ticket}`, { priorityId: foreign })).status, 400);
  });

  it('gère les sous-tâches (ajout, cochage par le responsable, ordre, suppression)', async () => {
    let fresh = (await bob.post(`/api/tickets/${ids.ticket}/subtasks`, { title: 'Écrire les tests', assigneeId: ids.alice })).body.ticket as TicketDTO;
    fresh = (await bob.post(`/api/tickets/${ids.ticket}/subtasks`, { title: 'Corriger les arrondis' })).body.ticket;
    assert.deepEqual(fresh.subtasks.map((s) => s.title), ['Écrire les tests', 'Corriger les arrondis']);
    const [first, second] = fresh.subtasks;

    // Alice (contributrice) coche la sienne, pas celle d'un autre, et ne renomme pas.
    assert.equal((await alice.patch(`/api/subtasks/${first!.id}`, { done: true })).status, 200);
    assert.equal((await alice.patch(`/api/subtasks/${second!.id}`, { done: true })).status, 403);
    assert.equal((await alice.patch(`/api/subtasks/${first!.id}`, { title: 'Autre' })).status, 403);

    fresh = (await bob.patch(`/api/subtasks/${second!.id}`, { position: 0, title: 'Corriger les arrondis (TVA)' })).body.ticket;
    assert.deepEqual(fresh.subtasks.map((s) => s.title), ['Corriger les arrondis (TVA)', 'Écrire les tests']);
    assert.equal(fresh.subtasks[1]!.done, true);
    assert.ok(fresh.subtasks[1]!.doneAt);

    fresh = (await bob.del(`/api/subtasks/${second!.id}`)).body.ticket;
    assert.equal(fresh.subtasks.length, 1);
    const history = (await bob.get(`/api/tickets/${ids.ticket}/history`)).body.history as HistoryEntryDTO[];
    const actions = history.filter((entry) => entry.data.kind === 'subtask').map((entry) => (entry.data.kind === 'subtask' ? entry.data.action : ''));
    assert.deepEqual(actions, ['removed', 'renamed', 'done', 'added', 'added']);
    assert.equal((await bob.post(`/api/tickets/${ids.ticket}/subtasks`, { assigneeId: ids.alice })).status, 400, 'titre obligatoire');
  });

  it('relie des tickets du même projet avec une raison (liste ou texte libre)', async () => {
    ids.other = (await bob.post(`/api/projects/${ids.project}/tickets`, { title: 'API de paiement' })).body.ticket.id;
    const linked = await bob.post(`/api/tickets/${ids.ticket}/links`, { targetId: ids.other, reason: 'Bloqué par' });
    assert.equal(linked.status, 201);
    assert.equal(linked.body.ticket.links[0].targetId, ids.other);
    ids.link = linked.body.ticket.links[0].id;
    assert.equal((await bob.post(`/api/tickets/${ids.ticket}/links`, { targetId: ids.other, reason: 'Bloqué par' })).status, 409);
    assert.equal((await bob.post(`/api/tickets/${ids.ticket}/links`, { targetId: ids.other, reason: 'À valider avec le client' })).status, 201, 'raison libre');
    assert.equal((await bob.post(`/api/tickets/${ids.ticket}/links`, { targetId: ids.ticket, reason: 'Lié à' })).status, 400, 'pas vers lui-même');
    const foreignProject = (await bob.post('/api/projects', { name: 'Tiers', key: 'TI' })).body.project.id;
    const foreignTicket = (await bob.post(`/api/projects/${foreignProject}/tickets`, { title: 'Ailleurs' })).body.ticket.id;
    assert.equal((await bob.post(`/api/tickets/${ids.ticket}/links`, { targetId: foreignTicket, reason: 'Lié à' })).status, 400);
    assert.equal((await alice.post(`/api/tickets/${ids.ticket}/links`, { targetId: ids.other, reason: 'Cause' })).status, 403);

    const removed = await bob.del(`/api/links/${ids.link}`);
    assert.equal(removed.body.ticket.links.length, 1);
    const history = (await bob.get(`/api/tickets/${ids.ticket}/history`)).body.history as HistoryEntryDTO[];
    const link = history.find((entry) => entry.data.kind === 'link');
    assert.ok(link && link.data.kind === 'link');
    assert.equal(link.data.action, 'removed');
    assert.equal(link.data.target.key, 'SV-2');
  });

  it("attribue chaque action d'un jeton à « via <nom d'affichage> », dans l'historique comme dans l'activité", async () => {
    await agent.patch(`/api/tickets/${ids.ticket}`, { title: 'Paiement (agent)' });
    await agent.post(`/api/tickets/${ids.ticket}/move`, { status: 'in_progress', beforeId: null });
    await agent.post(`/api/tickets/${ids.ticket}/comments`, { body: 'Analyse faite.' });
    await agent.post(`/api/tickets/${ids.ticket}/subtasks`, { title: 'Sous-tâche de l\'agent' });
    await agent.post(`/api/tickets/${ids.ticket}/links`, { targetId: ids.other, reason: 'Dépend de' });
    const upload = await agent.raw('POST', `/api/tickets/${ids.ticket}/attachments`, Buffer.from('bonjour'), { 'Content-Type': 'text/plain', 'X-File-Name': 'note.txt' });
    assert.equal(upload.status, 201);
    await agent.patch(`/api/tickets/${ids.ticket}/assignees/${ids.alice}`, { progress: 40 }).then((r) => assert.equal(r.status, 200));
    await agent.post(`/api/projects/${ids.project}/components`, { name: 'Agent', color: '#111111', icon: 'pi pi-box' });

    const history = (await bob.get(`/api/tickets/${ids.ticket}/history`)).body.history as HistoryEntryDTO[];
    const fromAgent = history.filter((entry) => entry.via !== null);
    assert.ok(fromAgent.length >= 6);
    assert.ok(fromAgent.every((entry) => entry.via === 'Claude' && entry.userId === ids.bob));
    assert.ok(history.some((entry) => entry.via === null), 'les actions faites dans l’interface n’ont pas de via');

    const api = (await bob.get(`/api/projects/${ids.project}/activity?source=api&limit=100`)).body.activities as ActivityDTO[];
    const kinds = new Set(api.map((a) => (a.data.kind === 'ticket' ? a.data.entry.kind : a.data.kind)));
    for (const kind of ['updated', 'subtask', 'link', 'attachment', 'part', 'comment', 'component']) {
      assert.ok(kinds.has(kind as never), `action « ${kind} » via le jeton présente dans le filtre API`);
    }
    assert.ok(api.every((a) => a.via === 'Claude'));
    const ui = (await bob.get(`/api/projects/${ids.project}/activity?source=ui&limit=100`)).body.activities as ActivityDTO[];
    assert.ok(ui.length > 0 && ui.every((a) => a.via === null));
    const legacy = (await bob.get(`/api/projects/${ids.project}/activity?viaApi=true&limit=100`)).body.activities as ActivityDTO[];
    assert.equal(legacy.length, api.length, 'viaApi=true reste accepté');
  });

  it("renomme, prolonge et réaffiche un jeton (mot de passe exigé)", async () => {
    const list = (await bob.get('/api/me/tokens')).body.tokens;
    assert.equal(list[0].displayName, 'Claude');
    assert.equal(list[0].revealable, true);

    assert.equal((await bob.post(`/api/me/tokens/${ids.token}/reveal`, { password: 'mauvais' })).status, 400);
    const revealed = await bob.post(`/api/me/tokens/${ids.token}/reveal`, { password: 'motdepasse1' });
    assert.equal(revealed.body.secret, agentSecret);
    assert.equal((await alice.post(`/api/me/tokens/${ids.token}/reveal`, { password: 'motdepasse1' })).status, 404, 'seul le propriétaire');
    assert.equal((await agent.post(`/api/me/tokens/${ids.token}/reveal`, { password: 'motdepasse1' })).status, 403, 'pas avec un jeton');

    const extended = await bob.patch(`/api/me/tokens/${ids.token}`, { displayName: 'Claude (planif)', expiresInDays: 365 });
    assert.equal(extended.body.token.displayName, 'Claude (planif)');
    assert.ok(Date.parse(extended.body.token.expiresAt) > Date.now() + 360 * DAY);
    const never = await admin.patch(`/api/admin/tokens/${ids.token}`, { expiresInDays: null });
    assert.equal(never.body.token.expiresAt, null);

    await agent.post(`/api/tickets/${ids.ticket}/comments`, { body: 'Nouveau nom.' });
    const last = (await bob.get(`/api/projects/${ids.project}/activity?source=api&limit=1`)).body.activities[0];
    assert.equal(last.via, 'Claude (planif)');

    await bob.del(`/api/me/tokens/${ids.token}`);
    assert.equal((await bob.patch(`/api/me/tokens/${ids.token}`, { expiresInDays: 30 })).status, 400, 'révoqué : plus modifiable');
  });

  it('recherche partout et résume l’activité d’un utilisateur', async () => {
    const result = (await alice.get('/api/search?q=paiement')).body;
    assert.ok(result.tickets.items.some((hit: { key: string }) => hit.key === 'SV-1'));
    assert.equal((await alice.get('/api/search?q=SV-2')).body.tickets.items[0].key, 'SV-2', 'clé exacte en tête');
    assert.equal((await alice.get('/api/search?q=Autre')).body.projects.total, 0, 'projets non visibles exclus');
    assert.equal((await bob.get('/api/search?q=Autre')).body.projects.total, 1);
    assert.equal((await alice.get('/api/search?q=alice')).body.users.items[0].id, ids.alice);
    assert.equal((await alice.get('/api/search?q=')).status, 400);

    const summary = (await alice.get(`/api/users/${ids.bob}/summary`)).body.summary;
    assert.equal(summary.user.id, ids.bob);
    assert.deepEqual(summary.projects.map((p: { key: string }) => p.key), ['SV'], 'seulement les projets visibles par alice');
    assert.ok(summary.stats.actionsLast30 > 0);
    assert.ok(summary.stats.viaApiLast30 > 0);
    assert.equal(summary.activityByDay.length, 30);
    const mine = (await alice.get(`/api/users/${ids.alice}/summary`)).body.summary;
    assert.ok(mine.assigned.some((t: { key: string; partProgress: number }) => t.key === 'SV-1' && t.partProgress === 40));
    assert.equal((await alice.get('/api/users/9999/summary')).status, 404);
  });

  it("enregistre le réglage d'inactivité", async () => {
    const updated = await bob.patch(`/api/projects/${ids.project}`, { settings: { staleIndicator: true, staleDays: 5 } });
    assert.equal(updated.body.project.settings.staleIndicator, true);
    assert.equal(updated.body.project.settings.staleDays, 5);
    assert.equal((await bob.patch(`/api/projects/${ids.project}`, { settings: { staleDays: 0 } })).status, 400);
  });

  it('sauvegarde vers un dossier : archive complète puis incrémentale, conservation', async () => {
    assert.equal((await bob.get('/api/admin/backups')).status, 403);
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'fastboard-backup-test-'));
    try {
      const check = (await admin.post('/api/admin/backups/test-folder', { path: folder })).body;
      assert.equal(check.ok, true);
      assert.equal((await admin.put('/api/admin/backups', { enabled: true, destinations: [{ type: 'folder', name: 'Test', enabled: true, path: 'relatif', schedule: { mode: 'manual' }, incremental: true, fullEvery: 3, retention: { mode: 'all' } }] })).status, 400);
      const saved = await admin.put('/api/admin/backups', {
        enabled: true,
        destinations: [{ type: 'folder', name: 'Test', enabled: true, path: folder, schedule: { mode: 'manual' }, incremental: true, fullEvery: 2, retention: { mode: 'count', keep: 2 } }],
      });
      assert.equal(saved.status, 200);
      const destination = saved.body.config.destinations[0].id as string;

      const first = (await admin.post(`/api/admin/backups/${destination}/run`)).body.run;
      assert.equal(first.status, 'success', first.message);
      assert.equal(first.kind, 'full');
      const firstZip = readZip(path.join(folder, first.file));
      assert.ok(firstZip.has('fastboard.sqlite') && firstZip.has('manifest.json') && firstZip.has('README.txt'));
      assert.ok([...firstZip.keys()].some((name) => name.startsWith('uploads/')), 'les pièces jointes sont incluses');
      assert.equal(firstZip.get('fastboard.sqlite')!.subarray(0, 15).toString(), 'SQLite format 3');

      await new Promise((resolve) => setTimeout(resolve, 1100)); // noms d'archive à la seconde
      const second = (await admin.post(`/api/admin/backups/${destination}/run`)).body.run;
      assert.equal(second.kind, 'incremental');
      const secondZip = readZip(path.join(folder, second.file));
      assert.ok(![...secondZip.keys()].some((name) => name.startsWith('uploads/')), 'aucune pièce jointe nouvelle');
      const manifest = JSON.parse(secondZip.get('manifest.json')!.toString());
      assert.deepEqual(manifest.archives, [first.file, second.file]);

      await new Promise((resolve) => setTimeout(resolve, 1100));
      const third = (await admin.post(`/api/admin/backups/${destination}/run`)).body;
      assert.equal(third.run.kind, 'full', 'chaîne pleine (fullEvery = 2) : nouvelle complète');
      // Conservation « 2 dernières » : la complète initiale reste car l'incrémentale gardée en dépend.
      const files = fs.readdirSync(folder).sort();
      assert.deepEqual(files, [first.file, second.file, third.run.file].sort());

      await new Promise((resolve) => setTimeout(resolve, 1100));
      await admin.post(`/api/admin/backups/${destination}/run`);
      const after = fs.readdirSync(folder);
      assert.ok(!after.includes(first.file) && !after.includes(second.file), 'ancienne chaîne supprimée une fois inutile');
      assert.equal(after.length, 2);
      const overview = (await admin.get('/api/admin/backups')).body;
      assert.equal(overview.statuses[0].archives, 2);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });

  it("décrit l'installation en service sans rien exécuter (dryRun)", async () => {
    assert.equal((await bob.get('/api/admin/service')).status, 403);
    const status = (await admin.get('/api/admin/service')).body.status;
    assert.ok(['windows', 'linux', 'macos', 'other'].includes(status.platform));
    if (status.supported) {
      const plan = status.plans.find((p: { scope: string }) => p.scope === 'user');
      assert.ok(plan.install.length > 0 && plan.files.length > 0);
      const dry = (await admin.post('/api/admin/service', { action: 'install', scope: 'user', dryRun: true })).body;
      assert.equal(dry.dryRun, true);
      assert.ok(dry.commands.length > 0);
      assert.equal(dry.output, '');
    }
  });
});
