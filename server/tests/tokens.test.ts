import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startServer } from '../app.ts';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

describe("jetons d'API", () => {
  let app: Booted;
  let admin: TestClient;
  let bob: TestClient;
  let carol: TestClient;
  const ids: Record<string, number> = {};
  let secret = '';
  let readSecret = '';
  let tokenId = 0;

  before(async () => {
    app = await bootServer();
    admin = app.client();
    await admin.login('admin@admin.com', 'admin1234');
    const roles = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
    const role = (key: string, scope = 'global') => roles.find((r) => r.key === key && r.scope === scope)!.id;
    ids.member = role('member');
    ids.guest = role('guest');
    ids.editor = role('editor', 'project');
    ids.viewer = role('viewer', 'project');
    for (const [name, roleId] of [['bob', ids.member], ['carol', ids.guest], ['dave', ids.member]] as const) {
      ids[name] = (await admin.post('/api/admin/users', { email: `${name}@t.fr`, name, password: 'motdepasse1', roleId })).body.user.id;
    }
    bob = app.client();
    await bob.login('bob@t.fr', 'motdepasse1');
    carol = app.client();
    await carol.login('carol@t.fr', 'motdepasse1');

    ids.project = (await bob.post('/api/projects', { name: 'Projet A' })).body.project.id;
    ids.other = (await bob.post('/api/projects', { name: 'Projet B' })).body.project.id;
    await bob.post(`/api/projects/${ids.project}/members`, { userId: ids.dave, roleId: ids.editor });
  });

  after(async () => {
    await app.running.close();
  });

  describe('création et gestion', () => {
    it('un membre crée un jeton ; le secret n\'est affiché qu\'une fois', async () => {
      const created = await bob.post('/api/me/tokens', { name: 'agent-test', scope: 'write', expiresInDays: 30 });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      secret = created.body.secret;
      tokenId = created.body.token.id;
      assert.match(secret, /^fb_[A-Za-z0-9_-]{43}$/);
      assert.equal(created.body.token.prefix, secret.slice(0, 11));
      assert.ok(created.body.token.expiresAt);
      assert.equal(created.body.token.projectIds, null);

      const list = await bob.get('/api/me/tokens');
      assert.equal(list.body.tokens.length, 1);
      assert.ok(!JSON.stringify(list.body).includes(secret), 'le secret ne ressort jamais d\'une liste');
      // Seule l'empreinte est stockée.
      const stored = app.running.ctx.db.get<{ token_hash: string }>('SELECT token_hash FROM api_tokens WHERE id = ?', tokenId)!;
      assert.notEqual(stored.token_hash, secret);
      assert.equal(stored.token_hash.length, 64);
    });

    it("exige la permission tokens.create, un nom, et valide les projets demandés", async () => {
      assert.equal((await carol.post('/api/me/tokens', { name: 'x' })).status, 403, 'un invité ne peut pas créer de jeton');
      assert.equal((await bob.post('/api/me/tokens', { name: '   ' })).status, 400);
      const foreign = await bob.post('/api/me/tokens', { name: 'x', projectIds: [9999] });
      assert.equal(foreign.status, 400);
      const daveClient = app.client();
      await daveClient.login('dave@t.fr', 'motdepasse1');
      const notMine = await daveClient.post('/api/me/tokens', { name: 'x', projectIds: [ids.other] });
      assert.equal(notMine.status, 400, 'on ne peut pas viser un projet auquel on n\'a pas accès');
    });

    it("l'authentification par jeton identifie le compte et décrit le jeton", async () => {
      const me = await app.client().useToken(secret).get('/api/me');
      assert.equal(me.status, 200);
      assert.equal(me.body.user.email, 'bob@t.fr');
      assert.equal(me.body.token.name, 'agent-test');
      assert.equal(me.body.token.scope, 'write');
      const withCookie = await bob.get('/api/me');
      assert.equal(withCookie.body.token, null, 'une session n\'a pas de jeton');
      const stored = app.running.ctx.db.get<{ last_used_at: string | null }>('SELECT last_used_at FROM api_tokens WHERE id = ?', tokenId)!;
      assert.ok(stored.last_used_at, 'dernière utilisation enregistrée');
    });

    it('rejette un jeton inconnu et ne retombe pas sur le cookie', async () => {
      const bad = app.client();
      bad.cookie = bob.cookie;
      bad.defaults = { Authorization: 'Bearer fb_jetoninventequinexistepas000000000000000000000' };
      const response = await bad.get('/api/me');
      assert.equal(response.status, 401);
      assert.equal(response.body.error.code, 'invalid_token');
      const noPrefix = app.client();
      noPrefix.defaults = { Authorization: `Bearer ${secret.slice(3)}` };
      assert.equal((await noPrefix.get('/api/me')).status, 401);
    });
  });

  describe('droits et portées', () => {
    it('un jeton en lecture seule ne peut pas écrire', async () => {
      const created = await bob.post('/api/me/tokens', { name: 'lecteur', scope: 'read' });
      readSecret = created.body.secret;
      const reader = app.client().useToken(readSecret);
      assert.equal((await reader.get(`/api/projects/${ids.project}`)).status, 200);
      const write = await reader.post(`/api/projects/${ids.project}/tickets`, { title: 'Interdit' });
      assert.equal(write.status, 403);
      assert.equal(write.body.error.code, 'token_read_only');
    });

    it("un jeton agit avec les droits de son propriétaire, sans plus", async () => {
      const agent = app.client().useToken(secret);
      const ticket = await agent.post(`/api/projects/${ids.project}/tickets`, { title: 'Créé par un agent', assigneeIds: [ids.bob] });
      assert.equal(ticket.status, 201, JSON.stringify(ticket.body));
      ids.ticket = ticket.body.ticket.id;
      assert.equal((await agent.post(`/api/tickets/${ids.ticket}/move`, { status: 'in_progress', beforeId: null })).status, 200);
      assert.equal((await agent.post(`/api/tickets/${ids.ticket}/comments`, { body: 'Fait par l\'agent' })).status, 201);
      // Un lecteur (rôle de projet) reste lecteur, même avec un jeton en écriture.
      await bob.post(`/api/projects/${ids.project}/members`, { userId: ids.carol, roleId: ids.viewer });
      const carolToken = await admin.post('/api/admin/users', { email: 'erin@t.fr', name: 'erin', password: 'motdepasse1', roleId: ids.member });
      const erin = app.client();
      await erin.login('erin@t.fr', 'motdepasse1');
      await bob.post(`/api/projects/${ids.project}/members`, { userId: carolToken.body.user.id, roleId: ids.viewer });
      const erinSecret = (await erin.post('/api/me/tokens', { name: 'erin', scope: 'write' })).body.secret;
      const forbidden = await app.client().useToken(erinSecret).post(`/api/projects/${ids.project}/tickets`, { title: 'Non' });
      assert.equal(forbidden.status, 403);
    });

    it("un jeton limité à des projets ne voit pas les autres", async () => {
      const limited = (await bob.post('/api/me/tokens', { name: 'projet A seul', scope: 'write', projectIds: [ids.project] })).body.secret;
      const client = app.client().useToken(limited);
      const projects = await client.get('/api/projects');
      assert.deepEqual(projects.body.projects.map((p: { id: number }) => p.id), [ids.project]);
      assert.equal((await client.get(`/api/projects/${ids.other}`)).status, 404);
      assert.equal((await client.post(`/api/projects/${ids.other}/tickets`, { title: 'x' })).status, 404);
      assert.equal((await client.post('/api/projects', { name: 'Nouveau' })).status, 403, 'ne crée pas de projet');
      assert.equal((await client.get(`/api/projects/${ids.project}`)).status, 200);
    });

    it("un jeton ne peut pas administrer, gérer des jetons, changer de mot de passe ni supprimer un projet", async () => {
      const agent = app.client().useToken(secret);
      for (const [method, path, body] of [
        ['GET', '/api/admin/users', undefined],
        ['POST', '/api/me/tokens', { name: 'escalade' }],
        ['GET', '/api/me/tokens', undefined],
        ['DELETE', `/api/me/tokens/${tokenId}`, undefined],
        ['POST', '/api/me/password', { currentPassword: 'motdepasse1', newPassword: 'autrechose12' }],
        ['PATCH', '/api/me', { name: 'Pirate' }],
        ['DELETE', `/api/projects/${ids.other}`, undefined],
      ] as const) {
        const response = await agent.request(method, path, body);
        assert.equal(response.status, 403, `${method} ${path}`);
        assert.equal(response.body.error.code, 'session_required', `${method} ${path}`);
      }
    });

    it("ne demande pas de contrôle d'origine pour un jeton (pas de cookie ambiant)", async () => {
      const agent = app.client().useToken(secret);
      const response = await agent.post(`/api/tickets/${ids.ticket}/comments`, { body: 'Depuis un autre site' }, { Origin: 'https://autre.example' });
      assert.equal(response.status, 201);
    });
  });

  describe('administration des jetons', () => {
    it('un administrateur voit et révoque tous les jetons, pas un simple membre', async () => {
      assert.equal((await bob.get('/api/admin/tokens')).status, 403);
      const all = await admin.get('/api/admin/tokens');
      assert.equal(all.status, 200);
      assert.ok(all.body.tokens.length >= 3);
      assert.ok(all.body.tokens.every((t: { userName?: string }) => typeof t.userName === 'string'));
    });

    it("un utilisateur ne peut révoquer que ses propres jetons", async () => {
      const other = (await bob.post('/api/me/tokens', { name: 'à révoquer par admin' })).body.token.id as number;
      assert.equal((await carol.del(`/api/me/tokens/${other}`)).status, 404);
      assert.equal((await admin.del(`/api/admin/tokens/${other}`)).status, 200);
    });
  });

  describe('cycle de vie', () => {
    it("un jeton expiré ou dont le compte est désactivé est refusé", async () => {
      const temp = (await bob.post('/api/me/tokens', { name: 'court', expiresInDays: 1 })).body;
      const client = app.client().useToken(temp.secret);
      assert.equal((await client.get('/api/me')).status, 200);
      app.running.ctx.db.run('UPDATE api_tokens SET expires_at = ? WHERE id = ?', new Date(Date.now() - 1000).toISOString(), temp.token.id);
      const expired = await client.get('/api/me');
      assert.equal(expired.status, 401);
      assert.equal(expired.body.error.code, 'invalid_token');

      const frank = (await admin.post('/api/admin/users', { email: 'frank@t.fr', name: 'frank', password: 'motdepasse1', roleId: ids.member })).body.user.id as number;
      const frankClient = app.client();
      await frankClient.login('frank@t.fr', 'motdepasse1');
      const frankSecret = (await frankClient.post('/api/me/tokens', { name: 'frank' })).body.secret as string;
      assert.equal((await app.client().useToken(frankSecret).get('/api/me')).status, 200);
      await admin.patch(`/api/admin/users/${frank}`, { isActive: false });
      assert.equal((await app.client().useToken(frankSecret).get('/api/me')).status, 401);
    });

    it("révoquer un jeton le désactive immédiatement et coupe ses connexions WebSocket", async () => {
      const created = (await bob.post('/api/me/tokens', { name: 'jetable' })).body;
      const agent = app.client().useToken(created.secret);
      const socket = await agent.connect();
      socket.send({ t: 'subscribe', projectId: ids.project });
      await socket.waitFor((m) => m.t === 'subscribed');
      const closed = new Promise<number>((resolve) => socket.ws.once('close', (code) => resolve(code)));
      assert.equal((await bob.del(`/api/me/tokens/${created.token.id}`)).status, 200);
      assert.equal(await closed, 4001);
      const after = await agent.get('/api/me');
      assert.equal(after.status, 401);
      assert.equal(after.body.error.code, 'invalid_token');
      await assert.rejects(agent.connect(), 'plus de connexion WebSocket avec un jeton révoqué');
    });
  });

  describe('temps réel avec un jeton', () => {
    it("un agent suit le projet en WebSocket mais respecte la restriction de projets", async () => {
      const limited = (await bob.post('/api/me/tokens', { name: 'ws limité', projectIds: [ids.project] })).body.secret as string;
      const agent = app.client().useToken(limited);
      const socket = await agent.connect();
      socket.send({ t: 'subscribe', projectId: ids.other });
      await socket.waitFor((m) => m.t === 'project.revoked');
      socket.send({ t: 'subscribe', projectId: ids.project });
      await socket.waitFor((m) => m.t === 'subscribed');
      await bob.patch(`/api/tickets/${ids.ticket}`, { title: 'Titre en direct pour l\'agent' });
      await socket.waitFor((m) => m.t === 'event' && m.event.type === 'ticket.updated' && m.event.ticket.title.startsWith('Titre en direct'));
      socket.close();
    });
  });

  describe('limitation de débit', () => {
    it('renvoie 429 avec Retry-After au-delà de la limite, par jeton', async () => {
      const limited = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', loginRateLimit: null, apiRateLimit: { max: 3, windowMs: 60_000 }, logToConsole: false });
      try {
        const base = `http://127.0.0.1:${limited.port}`;
        const session = new TestClient(base);
        await session.login('admin@admin.com', 'admin1234');
        const secretLimited = (await session.post('/api/me/tokens', { name: 'débit' })).body.secret as string;
        const client = new TestClient(base).useToken(secretLimited);
        const statuses: number[] = [];
        for (let i = 0; i < 5; i++) {
          statuses.push((await client.get('/api/me')).status);
        }
        assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
        const response = await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${secretLimited}` } });
        assert.equal(response.status, 429);
        assert.ok(Number(response.headers.get('retry-after')) > 0);
        assert.equal(response.headers.get('x-ratelimit-limit'), '3');
        // Les sessions de l'interface ne sont pas concernées.
        assert.equal((await session.get('/api/me')).status, 200);
      } finally {
        await limited.close();
      }
    });
  });
});
