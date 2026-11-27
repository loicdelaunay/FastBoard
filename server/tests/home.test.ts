import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FavoriteSpaceDTO, HomeDTO } from '../../shared/home.ts';
import { Db } from '../db/database.ts';
import { migrate } from '../db/migrations.ts';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

describe('accueil et espaces favoris', () => {
  let app: Booted;
  let admin: TestClient;
  let bob: TestClient;
  let alice: TestClient;
  let eve: TestClient;
  const ids: Record<string, number> = {};
  const home = async (client: TestClient): Promise<HomeDTO> => (await client.get('/api/me/home')).body.home;

  before(async () => {
    app = await bootServer();
    admin = app.client();
    await admin.login('admin@admin.com', 'admin1234');
    const roles = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
    const role = (key: string, scope = 'global') => roles.find((r) => r.key === key && r.scope === scope)!.id;
    for (const name of ['bob', 'alice', 'eve']) ids[name] = (await admin.post('/api/admin/users', { email: `${name}@h.fr`, name, password: 'motdepasse1', roleId: role('member') })).body.user.id;
    await admin.request('PUT', '/api/admin/documentation', { enabled: true });
    bob = app.client();
    await bob.login('bob@h.fr', 'motdepasse1');
    alice = app.client();
    await alice.login('alice@h.fr', 'motdepasse1');
    eve = app.client();
    await eve.login('eve@h.fr', 'motdepasse1');
    ids.project = (await bob.post('/api/projects', { name: 'Site', key: 'ST' })).body.project.id;
    await bob.post(`/api/projects/${ids.project}/members`, { userId: ids.alice, roleId: role('editor', 'project') });
    ids.docs = (await bob.post('/api/documentation/spaces', { name: 'Guide' })).body.space.id;
    await bob.post(`/api/documentation/spaces/${ids.docs}/members`, { userId: ids.alice, role: 'editor' });
    ids.boards = (await bob.post('/api/boards/spaces', { name: 'Schémas' })).body.space.id;
  });

  after(async () => {
    await app.running.close();
  });

  it('migration 35 : la table des favoris s’ajoute à une base existante, une seule fois', () => {
    const db = new Db(':memory:');
    migrate(db, 34);
    migrate(db);
    assert.equal(db.get<{ user_version: number }>('PRAGMA user_version')!.user_version, 37);
    db.exec('PRAGMA foreign_keys = OFF');
    db.run("INSERT INTO space_favorites (user_id, kind, space_id, created_at) VALUES (1, 'docs', 3, '2026-11-26T00:00:00.000Z')");
    assert.throws(() => db.run("INSERT INTO space_favorites (user_id, kind, space_id, created_at) VALUES (1, 'autre', 3, '2026-11-26T00:00:00.000Z')"), /CHECK/);
    migrate(db);
    assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM space_favorites')!.n, 1);
    db.close();
  });

  it('met des espaces et des projets en favori, seulement ceux que l’on voit', async () => {
    assert.equal((await alice.request('PUT', `/api/me/favorites/docs/${ids.docs}`)).status, 200);
    assert.equal((await alice.request('PUT', `/api/me/favorites/project/${ids.project}`)).status, 200);
    assert.equal((await alice.request('PUT', `/api/me/favorites/boards/${ids.boards}`)).status, 404, 'espace dont elle n’est pas membre');
    assert.equal((await alice.request('PUT', `/api/me/favorites/autre/${ids.boards}`)).status, 400);
    const favorites = (await alice.get('/api/me/favorites')).body.favorites as FavoriteSpaceDTO[];
    assert.deepEqual(favorites.map((entry) => [entry.kind, entry.name, entry.key]), [['docs', 'Guide', null], ['project', 'Site', 'ST']]);
    assert.equal((await eve.get('/api/me/favorites')).body.favorites.length, 0, 'chacun les siens');
    // Retiré : n'apparaît plus ; un espace supprimé non plus.
    assert.equal(((await alice.request('DELETE', `/api/me/favorites/project/${ids.project}`)).body.favorites as FavoriteSpaceDTO[]).length, 1);
    await bob.request('PUT', `/api/me/favorites/boards/${ids.boards}`);
    await bob.request('DELETE', `/api/boards/spaces/${ids.boards}`);
    assert.equal(((await bob.get('/api/me/favorites')).body.favorites as FavoriteSpaceDTO[]).length, 0);
    assert.equal(app.running.ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM space_favorites WHERE kind = 'boards'")!.n, 0, 'la suppression de l’espace retire ses favoris');
  });

  it('accueil : récemment modifié, assigné, favoris, documents favoris et notifications importantes', async () => {
    // Alice écrit une note, met un document en favori ; Bob lui assigne un ticket et la mentionne.
    const note = (await alice.post(`/api/documentation/spaces/${ids.docs}/nodes`, { path: 'Démarrage', content: '# Démarrage' })).body.node as { id: number };
    await alice.request('PUT', `/api/documentation/nodes/${note.id}/bookmark`);
    const ticket = (await bob.post(`/api/projects/${ids.project}/tickets`, { title: 'Page d’accueil', status: 'todo', assigneeIds: [ids.alice], endDate: '2026-12-01' })).body.ticket as { id: number };
    await bob.post(`/api/tickets/${ticket.id}/comments`, { body: `À toi @[alice](user:${ids.alice})` });
    const done = (await bob.post(`/api/projects/${ids.project}/tickets`, { title: 'Déjà fait', status: 'done', assigneeIds: [ids.alice] })).body.ticket as { id: number };
    await alice.patch(`/api/tickets/${ticket.id}`, { title: 'Page d’accueil v2' });

    const view = await home(alice);
    assert.deepEqual(view.recent.map((item) => [item.kind, item.title]).sort(), [['note', 'Démarrage'], ['ticket', 'Page d’accueil v2']]);
    assert.equal(view.recent.find((item) => item.kind === 'ticket')!.key, 'ST-1');
    assert.deepEqual(view.assigned.map((item) => item.key), ['ST-1'], 'pas le ticket terminé');
    assert.ok(!view.assigned.some((item) => item.id === done.id));
    assert.deepEqual(view.favorites.map((item) => item.name), ['Guide']);
    assert.deepEqual(view.bookmarks.map((item) => item.path), ['Démarrage.md']);
    assert.deepEqual(view.notifications.map((item) => item.type).sort(), ['assigned', 'assigned', 'mention'], 'les deux assignations et la mention');

    // Une fois lues, les notifications ne sont plus « importantes » ; un autre compte ne voit rien de tout cela.
    await alice.post('/api/me/notifications/read', {});
    assert.equal((await home(alice)).notifications.length, 0);
    const other = await home(eve);
    assert.deepEqual([other.recent.length, other.assigned.length, other.favorites.length, other.bookmarks.length], [0, 0, 0, 0]);
  });
});
