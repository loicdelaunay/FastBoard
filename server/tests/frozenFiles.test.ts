import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { extractDocImages, rewriteDocImages } from '../../shared/docLinks.ts';
import type { DocNodeDTO, DocVersionDTO, DocVersionFileDTO } from '../../shared/docs.ts';
import { Db } from '../db/database.ts';
import { migrate } from '../db/migrations.ts';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

const HEADER = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
/** Une image PNG reconnaissable : l'en-tête, puis un octet qui la distingue des autres. */
const png = (mark: number): Buffer => Buffer.concat([HEADER, Buffer.from([mark])]);
const pause = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('pièces jointes figées des versions étiquetées', () => {
  let app: Booted;
  let admin: TestClient;
  let bob: TestClient;
  let vera: TestClient;
  let eve: TestClient;

  before(async () => {
    app = await bootServer();
    admin = app.client();
    await admin.login('admin@admin.com', 'admin1234');
    const roles = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
    const member = roles.find((role) => role.key === 'member' && role.scope === 'global')!.id;
    const ids: Record<string, number> = {};
    for (const name of ['bob', 'vera', 'eve']) ids[name] = (await admin.post('/api/admin/users', { email: `${name}@t.fr`, name, password: 'motdepasse1', roleId: member })).body.user.id;
    await admin.request('PUT', '/api/admin/documentation', { enabled: true });
    bob = app.client();
    await bob.login('bob@t.fr', 'motdepasse1');
    vera = app.client();
    await vera.login('vera@t.fr', 'motdepasse1');
    eve = app.client();
    await eve.login('eve@t.fr', 'motdepasse1');
    (app as Booted & { ids: Record<string, number> }).ids = ids;
  });

  after(async () => {
    await app.running.close();
  });

  const ids = () => (app as Booted & { ids: Record<string, number> }).ids;

  it('répare une base passée par l’ancienne migration 32 des pièces jointes figées : les groupes sont créés', () => {
    const version = (db: Db) => db.get<{ user_version: number }>('PRAGMA user_version')!.user_version;
    const has = (db: Db, name: string) => Boolean(db.get('SELECT 1 AS found FROM sqlite_master WHERE name = ?', name));
    const old = new Db(':memory:');
    migrate(old, 31);
    // La version de développement : ses tables sous le numéro 32, à la place des groupes de la 2.27.0.
    old.exec(`
      CREATE TABLE frozen_files (hash TEXT PRIMARY KEY, mime TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE doc_version_files (id INTEGER PRIMARY KEY AUTOINCREMENT, version_id INTEGER NOT NULL REFERENCES doc_versions(id) ON DELETE CASCADE, path TEXT NOT NULL, hash TEXT NOT NULL REFERENCES frozen_files(hash), UNIQUE (version_id, path));
      CREATE TABLE board_version_files (version_id INTEGER NOT NULL REFERENCES board_versions(id) ON DELETE CASCADE, ref TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', hash TEXT NOT NULL REFERENCES frozen_files(hash), PRIMARY KEY (version_id, ref));
      CREATE INDEX idx_board_version_files_ref ON board_version_files (ref);
      PRAGMA user_version = 32;
    `);
    old.run("INSERT INTO frozen_files (hash, mime, size, created_at) VALUES ('abc', 'image/png', 3, '2026-11-24T00:00:00.000Z')");
    migrate(old);
    assert.equal(version(old), 37);
    for (const name of ['user_groups', 'user_group_members', 'project_groups', 'doc_space_groups', 'board_space_groups', 'project_access', 'doc_access', 'board_access']) assert.ok(has(old, name), name);
    assert.equal(old.get<{ n: number }>('SELECT COUNT(*) AS n FROM doc_access')!.n, 0, 'la vue se lit');
    assert.equal(old.get<{ n: number }>('SELECT COUNT(*) AS n FROM frozen_files')!.n, 1, 'les copies figées restent');
    migrate(old);
    assert.equal(version(old), 37, 'rien de plus au démarrage suivant');
    old.close();

    // Une base publiée (groupes en 32) reçoit simplement les tables des pièces jointes.
    const published = new Db(':memory:');
    migrate(published, 32);
    migrate(published);
    assert.equal(version(published), 37);
    assert.ok(has(published, 'frozen_files') && has(published, 'doc_access'));
    published.close();
  });

  it('repère et réécrit les images d’une note, hors du code', () => {
    const text = '![[schema.png|300]] ![Logo](Pictures/logo%20bleu.png "Titre") `![[code.png]]` ![](https://x.fr/a.png) <img src="Pictures/b.png"> ![[Autre note]]';
    assert.deepEqual(extractDocImages(text), ['schema.png', 'Pictures/logo%20bleu.png', 'Autre%20note', 'Pictures/b.png']);
    const moved = rewriteDocImages(text, 'Guides/Note.md', (target) => (target === 'schema.png' ? 'Guides/Pictures/schema (v1).png' : target === 'Pictures/logo bleu.png' ? 'Pictures/logo bleu (v1).png' : null));
    assert.equal(moved, '![[Pictures/schema (v1).png|300]] ![Logo](Pictures/logo%20bleu%20(v1).png "Titre") `![[code.png]]` ![](https://x.fr/a.png) <img src="Pictures/b.png"> ![[Autre note]]');
  });

  it('notes : l’étiquette fige les images, qui survivent à un remplacement et à une suppression', async () => {
    const space = (await bob.post('/api/documentation/spaces', { name: 'Produit' })).body.space.id as number;
    await bob.post(`/api/documentation/spaces/${space}/members`, { userId: ids().vera, role: 'reader' });
    const upload = async (name: string, data: Buffer) =>
      (await bob.raw('POST', `/api/documentation/spaces/${space}/images`, data, { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name), 'X-Requested-With': 'fetch' })).json.node as DocNodeDTO;
    const schema = await upload('schema.png', png(1));
    const logo = await upload('logo.png', png(2));
    assert.equal(schema.path, 'Pictures/schema.png');
    const note = (await bob.post(`/api/documentation/spaces/${space}/nodes`, { path: 'Guide', content: '# Guide\n\n![[schema.png]]\n\n![Logo](Pictures/logo.png)\n\n![[absente.png]]' })).body.node as DocNodeDTO;

    const tagged = (await bob.post(`/api/documentation/nodes/${note.id}/tags`, { name: 'v1' })).body.version as DocVersionDTO;
    const read = async (client: TestClient) => (await client.get(`/api/documentation/versions/${tagged.id}`)).body as { files: DocVersionFileDTO[] };
    const files = (await read(vera)).files;
    assert.deepEqual(files.map((file) => file.path), ['Pictures/logo.png', 'Pictures/schema.png'], 'les images montrées, pas celle qui manque');
    const bytes = async (client: TestClient, url: string) => {
      const response = await client.raw('GET', url);
      return response.status === 200 ? response.bytes : response.status;
    };
    const urlOf = (path: string) => files.find((file) => file.path === path)!.url;
    assert.deepEqual(await bytes(vera, urlOf('Pictures/schema.png')), png(1), 'une lectrice de l’espace les voit');
    assert.equal(await bytes(eve, urlOf('Pictures/schema.png')), 404, 'hors de l’espace : rien');

    // L'image change, une autre disparaît : la version étiquetée garde les siennes.
    await bob.raw('PUT', `/api/documentation/nodes/${schema.id}/raw`, png(3), { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'fetch' });
    await bob.request('DELETE', `/api/documentation/nodes/${logo.id}`);
    assert.deepEqual(await bytes(bob, `/api/documentation/nodes/${schema.id}/raw`), png(3), 'la note, elle, montre la nouvelle');
    assert.deepEqual(await bytes(bob, urlOf('Pictures/schema.png')), png(1));
    assert.deepEqual(await bytes(bob, urlOf('Pictures/logo.png')), png(2));
    assert.equal((await bob.request('PUT', `/api/documentation/versions/${tagged.id}/tag`, { name: 'Version 1' })).body.version.tag, 'Version 1');
    assert.deepEqual((await read(bob)).files, files, 'renommer l’étiquette ne refige rien');

    // Copier pour modifier : l'image supprimée revient à sa place, celle qui a changé revient à côté, et les liens suivent.
    const fork = (await bob.post(`/api/documentation/versions/${tagged.id}/fork`, {})).body.node as DocNodeDTO;
    const forked = (await bob.get(`/api/documentation/nodes/${fork.id}`)).body.content as string;
    assert.equal(forked, '# Guide\n\n![[Pictures/schema (Version 1).png]]\n\n![Logo](Pictures/logo.png)\n\n![[absente.png]]');
    const tree = async () => (await bob.get(`/api/documentation/spaces/${space}`)).body.nodes as DocNodeDTO[];
    const byPath = async (path: string) => (await tree()).find((node) => node.path === path)!;
    assert.deepEqual(await bytes(bob, `/api/documentation/nodes/${(await byPath('Pictures/schema (Version 1).png')).id}/raw`), png(1));
    assert.deepEqual(await bytes(bob, `/api/documentation/nodes/${(await byPath('Pictures/logo.png')).id}/raw`), png(2));

    // Restaurer la version dans la note : les mêmes images, sans nouvelle copie.
    await bob.post(`/api/documentation/versions/${tagged.id}/restore`, {});
    assert.equal((await bob.get(`/api/documentation/nodes/${note.id}`)).body.content, forked);
    assert.equal((await tree()).filter((node) => node.kind === 'image').length, 3, 'schema, sa version figée et le logo revenu');

    // Sans étiquette, la version rend ses images figées (celles que plus rien ne garde partent).
    await bob.request('PUT', `/api/documentation/versions/${tagged.id}/tag`, { name: null });
    assert.deepEqual((await read(bob)).files, []);
    assert.equal(await bytes(bob, urlOf('Pictures/schema.png')), 404);
    const frozen = app.running.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM frozen_files')!.n;
    assert.equal(frozen, 0, 'plus aucune copie');
  });

  it('notes : une ancienne version étiquetée fige les images d’alors', async () => {
    const space = (await bob.post('/api/documentation/spaces', { name: 'Plans' })).body.space.id as number;
    const plan = (await bob.raw('POST', `/api/documentation/spaces/${space}/images`, png(10), { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'plan.png', 'X-Requested-With': 'fetch' })).json.node as DocNodeDTO;
    await pause();
    const note = (await bob.post(`/api/documentation/spaces/${space}/nodes`, { path: 'Étage', content: '![[plan.png]]' })).body.node as DocNodeDTO;
    await pause();
    await bob.request('PUT', `/api/documentation/nodes/${note.id}/content`, { content: '![[plan.png]]\n\nMis à jour.' });
    await pause();
    await bob.raw('PUT', `/api/documentation/nodes/${plan.id}/raw`, png(11), { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'fetch' });
    const versions = (await bob.get(`/api/documentation/nodes/${note.id}/versions`)).body.versions as DocVersionDTO[];
    const first = versions.reduce((oldest, entry) => (entry.id < oldest.id ? entry : oldest));
    await bob.post(`/api/documentation/nodes/${note.id}/tags`, { name: 'Avant', versionId: first.id });
    const files = (await bob.get(`/api/documentation/versions/${first.id}`)).body.files as DocVersionFileDTO[];
    assert.deepEqual((await bob.raw('GET', files[0]!.url)).bytes, png(10), 'l’image d’avant son remplacement, reprise de la corbeille');
    await bob.post(`/api/documentation/nodes/${note.id}/tags`, { name: 'Maintenant' });
    const now = ((await bob.get(`/api/documentation/nodes/${note.id}/versions`)).body.versions as DocVersionDTO[]).find((entry) => entry.tag === 'Maintenant')!;
    const current = (await bob.get(`/api/documentation/versions/${now.id}`)).body.files as DocVersionFileDTO[];
    assert.deepEqual((await bob.raw('GET', current[0]!.url)).bytes, png(11), 'l’état actuel : l’image d’aujourd’hui');
  });

  it('tableaux : l’étiquette fige les images et les icônes ajoutées, revenues à la restauration', async () => {
    const space = (await bob.post('/api/boards/spaces', { name: 'Schémas' })).body.space.id as number;
    const asset = (await bob.raw('POST', `/api/boards/spaces/${space}/assets`, png(20), { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'logo.png', 'X-Requested-With': 'fetch' })).json.asset as { id: number; key: string };
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="10" height="10"/></svg>';
    const icon = (await admin.post('/api/admin/board-icons', { name: 'Carré', svg })).body.icon as { id: number };
    const elements = [
      { id: 'p', type: 'image', z: 1, x: 0, y: 0, w: 120, h: 80, asset: asset.key, name: 'logo.png' },
      { id: 'i', type: 'icon', z: 2, x: 200, y: 0, w: 48, h: 48, icon: `custom:${icon.id}`, color: 'default', stroke: 2 },
    ];
    const board = (await bob.post(`/api/boards/spaces/${space}/nodes`, { path: 'Architecture', elements })).body.node as { id: number };
    const tagged = (await bob.post(`/api/boards/nodes/${board.id}/tags`, { name: 'v2' })).body.version as { id: number };

    // Image supprimée de l'espace, icône supprimée par l'administrateur : la version étiquetée les montre encore.
    await bob.request('DELETE', `/api/boards/assets/${asset.id}`);
    await bob.request('PUT', `/api/boards/nodes/${board.id}/elements`, { elements: [] });
    assert.equal((await admin.request('DELETE', `/api/admin/board-icons/${icon.id}`)).status, 200);
    const anyone = app.client();
    const image = await anyone.raw('GET', `/api/board-assets/${asset.key}`);
    assert.equal(image.status, 200);
    assert.deepEqual(image.bytes, png(20));
    assert.equal((await anyone.raw('GET', `/api/board-icons/${icon.id}`)).bytes.toString('utf8'), svg);
    const preview = (await bob.raw('GET', `/api/boards/nodes/${board.id}/preview?version=${tagged.id}`)).bytes.toString('utf8');
    assert.ok(preview.includes(`data:image/png;base64,${png(20).toString('base64')}`), 'l’aperçu de la version dessine l’image figée');

    // Restaurer la version : l'image revient dans l'espace, sous la même clé.
    await bob.post(`/api/boards/nodes/${board.id}/versions/${tagged.id}/restore`, {});
    const assets = (await bob.get(`/api/boards/spaces/${space}/assets`)).body.assets as Array<{ key: string; name: string }>;
    assert.deepEqual(assets.map((entry) => [entry.key, entry.name]), [[asset.key, 'logo.png']]);

    // Sans étiquette, l'icône supprimée n'est plus gardée.
    await bob.request('PUT', `/api/boards/nodes/${board.id}/versions/${tagged.id}/tag`, { name: null });
    assert.equal((await anyone.raw('GET', `/api/board-icons/${icon.id}`)).status, 404);
    assert.equal((await anyone.raw('GET', `/api/board-assets/${asset.key}`)).status, 200, 'l’image, revenue dans l’espace, reste');
  });
});
