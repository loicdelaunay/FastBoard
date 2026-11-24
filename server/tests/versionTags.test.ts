import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { BoardElement, BoardVersionDTO } from '../../shared/boards.ts';
import { citedVersionOf, versionFromQuery } from '../../shared/citations.ts';
import { extractDocLinks } from '../../shared/docLinks.ts';
import type { DocVersionDTO } from '../../shared/docs.ts';
import type { VersionTagHitDTO } from '../../shared/versionTags.ts';
import { recordBoardVersion } from '../boards/versions.ts';
import { purgeDocs } from '../docs/store.ts';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

const shape = (id: string, x: number, text = id): BoardElement => ({ id, type: 'shape', z: 1, x, y: 0, w: 160, h: 80, shape: 'rect', text, color: 'default', fill: 'solid', size: 'm' }) as BoardElement;

describe('étiquettes de versions', () => {
  let app: Booted;
  let admin: TestClient;
  let bob: TestClient;
  let vera: TestClient;
  let eve: TestClient;
  const ids: Record<string, number> = {};

  before(async () => {
    app = await bootServer();
    admin = app.client();
    await admin.login('admin@admin.com', 'admin1234');
    const roles = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
    const member = roles.find((role) => role.key === 'member' && role.scope === 'global')!.id;
    for (const name of ['bob', 'vera', 'eve']) ids[name] = (await admin.post('/api/admin/users', { email: `${name}@t.fr`, name, password: 'motdepasse1', roleId: member })).body.user.id;
    bob = app.client();
    await bob.login('bob@t.fr', 'motdepasse1');
    vera = app.client();
    await vera.login('vera@t.fr', 'motdepasse1');
    eve = app.client();
    await eve.login('eve@t.fr', 'motdepasse1');
    await admin.request('PUT', '/api/admin/documentation', { enabled: true });
  });

  after(async () => {
    await app.running.close();
  });

  it('lit la version citée dans une mention et dans une adresse', () => {
    assert.equal(citedVersionOf('v:345'), 345);
    assert.equal(citedVersionOf('L12'), null);
    assert.equal(citedVersionOf('v:'), null);
    assert.equal(versionFromQuery('88'), 88);
    assert.equal(versionFromQuery('0'), null);
    assert.equal(versionFromQuery('abc'), null);
    assert.deepEqual(extractDocLinks('Voir @[Guide · v1.0](doc:12#v:345) et @[Archi · v2](board:7#v:9).').docs, [12], 'une version citée reste un lien vers la note');
  });

  it('notes : étiquette la version actuelle ou une ancienne, unique, renommable, retirable, par les éditeurs', async () => {
    const space = (await bob.post('/api/documentation/spaces', { name: 'Guide' })).body.space.id as number;
    await bob.post(`/api/documentation/spaces/${space}/members`, { userId: ids.vera, role: 'reader' });
    const note = (await bob.post(`/api/documentation/spaces/${space}/nodes`, { path: 'Produit/Guide', content: 'Première version' })).body.node.id as number;
    ids.note = note;
    await bob.request('PUT', `/api/documentation/nodes/${note}/content`, { content: 'Deuxième version' });

    const tagged = await bob.post(`/api/documentation/nodes/${note}/tags`, { name: '  v1.0  ' });
    assert.equal(tagged.status, 201, JSON.stringify(tagged.body));
    const version = tagged.body.version as DocVersionDTO;
    assert.equal(version.tag, 'v1.0', 'nom nettoyé');
    const content = (await vera.get(`/api/documentation/versions/${version.id}`)).body;
    assert.equal(content.content, 'Deuxième version', 'la version actuelle');
    assert.equal(content.version.tag, 'v1.0');
    assert.equal(content.node.id, note);

    const versions = (await bob.get(`/api/documentation/nodes/${note}/versions`)).body.versions as DocVersionDTO[];
    const older = versions.find((entry) => entry.id !== version.id)!;
    assert.equal((await bob.post(`/api/documentation/nodes/${note}/tags`, { name: 'V1.0', versionId: older.id })).status, 409, 'unique pour la note (sans tenir compte de la casse)');
    assert.equal((await bob.post(`/api/documentation/nodes/${note}/tags`, { name: 'Brouillon', versionId: older.id })).body.version.tag, 'Brouillon');
    assert.equal((await bob.post(`/api/documentation/nodes/${note}/tags`, { name: 'v1.0' })).body.version.id, version.id, 'rien n’a changé : la même version');

    assert.equal((await vera.post(`/api/documentation/nodes/${note}/tags`, { name: 'Lectrice' })).status, 403, 'une lectrice n’étiquette pas');
    assert.equal((await vera.request('PUT', `/api/documentation/versions/${older.id}/tag`, { name: null })).status, 403);
    assert.equal((await eve.get(`/api/documentation/versions/${version.id}`)).status, 404, 'hors de l’espace : rien');

    assert.equal((await bob.request('PUT', `/api/documentation/versions/${older.id}/tag`, { name: 'Ébauche' })).body.version.tag, 'Ébauche');
    assert.equal((await bob.request('PUT', `/api/documentation/versions/${older.id}/tag`, { name: null })).body.version.tag, null, 'retirée');
    assert.equal((await bob.request('PUT', `/api/documentation/versions/${older.id}/tag`, { name: '' })).status, 400);
    await bob.request('PUT', `/api/documentation/versions/${older.id}/tag`, { name: 'Brouillon' });
  });

  it('notes : une version étiquetée n’est jamais purgée', async () => {
    const db = app.running.ctx.db;
    db.run("UPDATE doc_versions SET created_at = '2001-01-01T00:00:00.000Z' WHERE node_id = ?", ids.note);
    purgeDocs(app.running.ctx);
    const left = (await bob.get(`/api/documentation/nodes/${ids.note}/versions`)).body.versions as DocVersionDTO[];
    assert.deepEqual(left.map((entry) => entry.tag).sort(), ['Brouillon', 'v1.0'], 'seules les versions étiquetées restent');
  });

  it('notes : copie une version dans une nouvelle note pour l’écrire, et retrouve les étiquettes avec @', async () => {
    const versions = (await bob.get(`/api/documentation/nodes/${ids.note}/versions`)).body.versions as DocVersionDTO[];
    const v1 = versions.find((entry) => entry.tag === 'v1.0')!;
    const fork = (await bob.post(`/api/documentation/versions/${v1.id}/fork`, {})).body.node;
    assert.equal(fork.path, 'Produit/Guide (v1.0).md');
    assert.equal((await bob.get(`/api/documentation/nodes/${fork.id}`)).body.content, 'Deuxième version');
    assert.equal((await bob.post(`/api/documentation/versions/${v1.id}/fork`, {})).body.node.path, 'Produit/Guide (v1.0) 2.md', 'jamais par-dessus une note');
    assert.equal((await vera.post(`/api/documentation/versions/${v1.id}/fork`, {})).status, 403, 'copier, c’est écrire');

    const search = async (client: TestClient, q: string) => (await client.get(`/api/documentation/tags?q=${encodeURIComponent(q)}`)).body.tags as VersionTagHitDTO[];
    const hits = await search(vera, 'guide v1');
    assert.deepEqual(hits.map((hit) => [hit.kind, hit.id, hit.versionId, hit.tag, hit.title, hit.spaceName]), [['doc', ids.note, v1.id, 'v1.0', 'Guide', 'Guide']]);
    assert.equal((await search(vera, 'brouillon')).length, 1);
    assert.deepEqual(await search(eve, 'v1'), [], 'jamais hors de ses espaces');
  });

  it('tableaux : étiquette, ne fusionne plus la version étiquetée, la garde au-delà de la limite et la dessine', async () => {
    const space = (await bob.post('/api/boards/spaces', { name: 'Schémas' })).body.space.id as number;
    const board = (await bob.post(`/api/boards/spaces/${space}/nodes`, { path: 'Architecture', elements: [shape('a', 0, 'Serveur')] })).body.node.id as number;
    const put = (elements: BoardElement[]) => bob.request('PUT', `/api/boards/nodes/${board}/elements`, { elements });
    await put([shape('a', 0, 'Serveur'), shape('b', 300, 'Base')]);
    const tagged = (await bob.post(`/api/boards/nodes/${board}/tags`, { name: 'v2' })).body.version as BoardVersionDTO;
    assert.equal(tagged.tag, 'v2');
    assert.equal(tagged.elementCount, 2);

    // La même personne continue aussitôt : sans étiquette, sa version aurait été complétée ; ici, une nouvelle naît.
    await put([shape('a', 0, 'Serveur'), shape('b', 300, 'Base'), shape('c', 600, 'Cache')]);
    const history = async () => (await bob.get(`/api/boards/nodes/${board}/versions`)).body.versions as BoardVersionDTO[];
    const versions = await history();
    assert.equal(versions.find((entry) => entry.id === tagged.id)!.elementCount, 2, 'la version étiquetée ne change plus');
    assert.equal(versions.at(-1)!.elementCount, 3);
    assert.equal((await bob.post(`/api/boards/nodes/${board}/tags`, { name: 'V2' })).status, 409);
    assert.equal((await bob.request('PUT', `/api/boards/nodes/${board}/versions/${tagged.id}/tag`, { name: 'Version 2' })).body.version.tag, 'Version 2');

    // Au-delà de la limite de l'historique, les versions les plus anciennes partent, sauf l'étiquetée.
    const db = app.running.ctx.db;
    for (let index = 0; index < 305; index += 1) recordBoardVersion(db, board, JSON.stringify([shape('x', index)]), 1, ids.bob, 'restore');
    const kept = await history();
    assert.ok(kept.some((entry) => entry.id === tagged.id && entry.tag === 'Version 2'), 'l’étiquetée reste');
    assert.equal(kept.filter((entry) => !entry.tag).length, 300);

    // L'aperçu d'une version citée dessine cette version, pas l'état actuel.
    const now = await bob.raw('GET', `/api/boards/nodes/${board}/preview`);
    const then = await bob.raw('GET', `/api/boards/nodes/${board}/preview?version=${tagged.id}`);
    assert.ok(now.bytes.toString().includes('x') && !then.bytes.toString().includes('Cache'));
    assert.ok(then.bytes.toString().includes('Base'));
    assert.equal((await bob.raw('GET', `/api/boards/nodes/${board}/preview?version=999999`)).status, 404);

    const hits = (await bob.get('/api/boards/tags?q=archi')).body.tags as VersionTagHitDTO[];
    assert.deepEqual(hits.map((hit) => [hit.kind, hit.id, hit.versionId, hit.tag]), [['board', board, tagged.id, 'Version 2']]);
    assert.deepEqual((await eve.get('/api/boards/tags?q=archi')).body.tags, []);
    await bob.post(`/api/boards/spaces/${space}/members`, { userId: ids.vera, role: 'reader' });
    assert.equal((await vera.post(`/api/boards/nodes/${board}/tags`, { name: 'Lectrice' })).status, 403);
  });
});
