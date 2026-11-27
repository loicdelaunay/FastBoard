import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { HomeDTO } from '../../shared/home.ts';
import { defaultHomeLayout, normalizeHomeLayout, type HomeLayout } from '../../shared/homeLayout.ts';
import { Db } from '../db/database.ts';
import { migrate } from '../db/migrations.ts';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

describe('disposition de l’accueil', () => {
  let app: Booted;
  let admin: TestClient;
  let bob: TestClient;
  let alice: TestClient;
  const sockets: Array<{ close(): void }> = [];
  const layoutOf = async (client: TestClient): Promise<HomeLayout> => ((await client.get('/api/me/home')).body.home as HomeDTO).layout;

  before(async () => {
    app = await bootServer();
    admin = app.client();
    await admin.login('admin@admin.com', 'admin1234');
    const roles = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
    const member = roles.find((r) => r.key === 'member' && r.scope === 'global')!.id;
    for (const name of ['bob', 'alice']) await admin.post('/api/admin/users', { email: `${name}@l.fr`, name, password: 'motdepasse1', roleId: member });
    bob = app.client();
    await bob.login('bob@l.fr', 'motdepasse1');
    alice = app.client();
    await alice.login('alice@l.fr', 'motdepasse1');
  });

  after(async () => {
    for (const socket of sockets) socket.close();
    await app.running.close();
  });

  it('migration 37 : la colonne de la disposition s’ajoute à une base existante, une seule fois', () => {
    const db = new Db(':memory:');
    migrate(db, 36);
    const columns = (): string[] => db.all<{ name: string }>('PRAGMA table_info(users)').map((column) => column.name);
    assert.ok(!columns().includes('home_layout'));
    migrate(db);
    assert.equal(db.get<{ user_version: number }>('PRAGMA user_version')!.user_version, 37);
    assert.ok(columns().includes('home_layout'));
    migrate(db);
    assert.equal(db.get<{ user_version: number }>('PRAGMA user_version')!.user_version, 37);
    db.close();
  });

  it('sans choix : l’accueil d’origine, ses cinq blocs dans l’ordre', async () => {
    const layout = await layoutOf(bob);
    assert.deepEqual(
      layout.blocks.map((block) => block.type),
      ['favorites', 'assigned', 'notifications', 'recent', 'bookmarks'],
    );
    assert.deepEqual(layout, defaultHomeLayout());
  });

  it('enregistre les blocs, leur taille et leurs réglages, pour soi seulement, et prévient ses autres onglets', async () => {
    const socket = await bob.connect();
    sockets.push(socket);
    const blocks = [
      { id: 'a1', type: 'status', size: 'third', height: 'compact', title: '  Mes statuts  ', options: { projectId: 4, hideDone: true, days: 12 } },
      { id: 'a2', type: 'upcoming', size: 'twoThirds', options: { days: 14, limit: 5 } },
      { id: 'a3', type: 'notifications', options: { limit: 40 } },
      { id: 'a4', type: 'activity', size: 'full', height: 'tall', options: { group: 'comment' } },
    ];
    const changed = socket.waitFor((message) => message.t === 'homeLayout.changed');
    const response = await bob.request('PUT', '/api/me/home-layout', { layout: { blocks } });
    assert.equal(response.status, 200);
    const saved = response.body.layout as HomeLayout;
    assert.deepEqual(saved.blocks[0], { id: 'a1', type: 'status', size: 'third', height: 'compact', title: 'Mes statuts', options: { projectId: 4, hideDone: true } }, 'réglage d’un autre type ignoré');
    assert.deepEqual(saved.blocks[1], { id: 'a2', type: 'upcoming', size: 'twoThirds', height: 'normal', title: '', options: { projectId: null, days: 14, limit: 5 } }, 'le reste complété');
    assert.equal(saved.blocks[2]!.options.limit, 20, 'limite propre au type');
    assert.equal(saved.blocks[3]!.options.group, 'comment');
    const message = await changed;
    assert.ok(message.t === 'homeLayout.changed');
    assert.deepEqual(message.layout, saved);
    assert.deepEqual(await layoutOf(bob), saved, 'relue telle quelle');
    assert.deepEqual(await layoutOf(alice), defaultHomeLayout(), 'la sienne ne change pas');
  });

  it('refuse un bloc inconnu ou trop de blocs, et revient à la disposition par défaut sur demande', async () => {
    assert.equal((await bob.request('PUT', '/api/me/home-layout', { layout: { blocks: [{ id: 'x', type: 'meteo' }] } })).status, 400);
    const many = Array.from({ length: 31 }, (_, index) => ({ id: `b${index}`, type: 'overdue' }));
    assert.equal((await bob.request('PUT', '/api/me/home-layout', { layout: { blocks: many } })).status, 400);
    assert.equal((await bob.request('PUT', '/api/me/home-layout', { layout: { blocks: [] } })).body.layout.blocks.length, 0, 'un accueil vide est permis');
    assert.deepEqual((await bob.request('PUT', '/api/me/home-layout', { layout: null })).body.layout, defaultHomeLayout());
    assert.deepEqual(await layoutOf(bob), defaultHomeLayout());
  });

  it('une disposition relue écarte ce qui est illisible', () => {
    assert.deepEqual(normalizeHomeLayout('n’importe quoi'), defaultHomeLayout());
    const layout = normalizeHomeLayout({
      blocks: [{ id: 'same', type: 'overdue', size: 'géant' }, { id: 'same', type: 'project', options: { projectId: -3 } }, { type: 'inconnu' }, null],
    });
    assert.equal(layout.blocks.length, 2);
    assert.equal(layout.blocks[0]!.size, 'third', 'taille inconnue : celle du type');
    assert.notEqual(layout.blocks[1]!.id, 'same', 'identifiant en double remplacé');
    assert.equal(layout.blocks[1]!.options.projectId, null);
  });
});
