import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import type { DocNodeDTO } from '../../shared/docs.ts';
import type { BoardSnapshotContent, DocSnapshotContent, ProjectSnapshotContent, SpaceSnapshotDTO } from '../../shared/snapshots.ts';
import { Db } from '../db/database.ts';
import { migrate } from '../db/migrations.ts';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

const HEADER = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
/** Une image PNG reconnaissable : l'en-tête, puis un octet qui la distingue des autres. */
const png = (mark: number): Buffer => Buffer.concat([HEADER, Buffer.from([mark])]);
const FETCH = { 'X-Requested-With': 'fetch' };

describe('étiquettes d’espace', () => {
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
    await admin.request('PUT', '/api/admin/documentation', { enabled: true });
    bob = app.client();
    await bob.login('bob@t.fr', 'motdepasse1');
    vera = app.client();
    await vera.login('vera@t.fr', 'motdepasse1');
    eve = app.client();
    await eve.login('eve@t.fr', 'motdepasse1');
  });

  after(async () => {
    await app.running.close();
  });

  const file = async (client: TestClient, snapshot: number, hash: string | null) => client.raw('GET', `/api/snapshots/${snapshot}/files/${hash}`);
  const frozenCount = (): number => app.running.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM frozen_files')!.n;

  it('migration 34 : les tables des étiquettes d’espace s’ajoutent à une base existante, une seule fois', () => {
    const db = new Db(':memory:');
    migrate(db, 33);
    db.run("INSERT INTO frozen_files (hash, mime, size, created_at) VALUES ('abc', 'image/png', 3, '2026-11-24T00:00:00.000Z')");
    migrate(db);
    assert.equal(db.get<{ user_version: number }>('PRAGMA user_version')!.user_version, 34);
    db.run("INSERT INTO space_snapshots (kind, space_id, name, space_name, manifest, created_at) VALUES ('docs', 1, 'v1', 'Produit', 'abc', '2026-11-26T00:00:00.000Z')");
    db.run("INSERT INTO space_snapshot_files (snapshot_id, hash) VALUES (1, 'abc')");
    assert.throws(() => db.run("INSERT INTO space_snapshots (kind, space_id, name, space_name, manifest, created_at) VALUES ('docs', 1, 'V1', 'Produit', 'abc', '2026-11-26T00:00:00.000Z')"), /UNIQUE/, 'un nom par espace, sans tenir compte de la casse');
    assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM frozen_files')!.n, 1, 'les copies figées restent');
    migrate(db);
    assert.equal(db.get<{ user_version: number }>('PRAGMA user_version')!.user_version, 34, 'rien de plus au démarrage suivant');
    db.close();
  });

  it('documentation : l’étiquette fige tout l’espace, qui peut ensuite changer, et redonne un espace', async () => {
    const space = (await bob.post('/api/documentation/spaces', { name: 'Produit', obsidian: true })).body.space.id as number;
    await bob.post(`/api/documentation/spaces/${space}/members`, { userId: ids.vera, role: 'reader' });
    const image = (await bob.raw('POST', `/api/documentation/spaces/${space}/images`, png(1), { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'schema.png', ...FETCH })).json.node as DocNodeDTO;
    const folder = (await bob.post(`/api/documentation/spaces/${space}/nodes`, { path: 'Guides', kind: 'folder' })).body.node as DocNodeDTO;
    await bob.request('PUT', `/api/documentation/nodes/${folder.id}/style`, { icon: 'pi pi-book', color: '#10B981' });
    const note = (await bob.post(`/api/documentation/spaces/${space}/nodes`, { path: 'Guides/Installer', content: '# Installer\n\n![[schema.png]]' })).body.node as DocNodeDTO;
    await bob.post(`/api/documentation/spaces/${space}/nodes`, { path: 'Réunion', kind: 'template', content: '# {{title}}' });

    // Lecteur : voit les étiquettes, n'en pose pas ; hors de l'espace : rien.
    assert.equal((await vera.post('/api/snapshots', { kind: 'docs', spaceId: space, name: 'v0' })).status, 403);
    assert.equal((await eve.get(`/api/snapshots?kind=docs&spaceId=${space}`)).status, 404);
    const created = await bob.post('/api/snapshots', { kind: 'docs', spaceId: space, name: 'v1.0', description: 'Livré au client' });
    assert.equal(created.status, 201);
    const snapshot = created.body.snapshot as SpaceSnapshotDTO;
    assert.equal(snapshot.spaceName, 'Produit');
    assert.equal(snapshot.items, 1, 'une note');
    assert.equal(snapshot.files, 3, 'la note, le modèle et l’image');
    assert.equal(snapshot.createdByName, 'bob');
    assert.equal((await bob.post('/api/snapshots', { kind: 'docs', spaceId: space, name: 'V1.0' })).status, 409, 'un nom par espace');
    assert.deepEqual(((await vera.get(`/api/snapshots?kind=docs&spaceId=${space}`)).body.snapshots as SpaceSnapshotDTO[]).map((entry) => entry.name), ['v1.0']);

    // L'espace change : texte réécrit, image remplacée, note supprimée.
    await bob.request('PUT', `/api/documentation/nodes/${note.id}/content`, { content: '# Autre chose' });
    await bob.raw('PUT', `/api/documentation/nodes/${image.id}/raw`, png(2), { 'Content-Type': 'application/octet-stream', ...FETCH });
    await bob.request('DELETE', `/api/documentation/nodes/${note.id}`);

    const read = (await vera.get(`/api/snapshots/${snapshot.id}`)).body as { content: DocSnapshotContent };
    assert.equal(read.content.kind, 'docs');
    assert.equal(read.content.space.obsidian, true);
    const byPath = new Map(read.content.nodes.map((node) => [node.path, node]));
    assert.deepEqual([...byPath.keys()].sort(), ['Guides', 'Guides/Installer.md', 'Pictures', 'Pictures/schema.png', 'Réunion.md']);
    assert.equal(byPath.get('Guides')!.icon, 'pi pi-book');
    assert.equal((await file(vera, snapshot.id, byPath.get('Guides/Installer.md')!.file)).bytes.toString('utf8'), '# Installer\n\n![[schema.png]]', 'le texte d’alors');
    const frozenImage = await file(vera, snapshot.id, byPath.get('Pictures/schema.png')!.file);
    assert.deepEqual(frozenImage.bytes, png(1), 'l’image d’alors');
    assert.equal(frozenImage.headers.get('content-type'), 'image/png');
    assert.equal((await file(vera, snapshot.id, 'a'.repeat(64))).status, 404, 'une autre empreinte ne se lit pas par l’étiquette');
    assert.equal((await file(eve, snapshot.id, byPath.get('Pictures/schema.png')!.file)).status, 404);

    // Archive : l'arbre d'alors, les modèles à part, et la description.
    const zip = await vera.raw('GET', `/api/snapshots/${snapshot.id}/download`);
    assert.equal(zip.status, 200);
    assert.match(zip.headers.get('content-disposition') ?? '', /produit-v1\.0\.zip/);
    const entries = unzipSync(new Uint8Array(zip.bytes));
    assert.equal(strFromU8(entries['Guides/Installer.md']!), '# Installer\n\n![[schema.png]]');
    assert.deepEqual(Buffer.from(entries['Pictures/schema.png']!), png(1));
    assert.equal(strFromU8(entries['_modeles/Réunion.md']!), '# {{title}}');
    assert.equal(JSON.parse(strFromU8(entries['etiquette.json']!)).tag, 'v1.0');

    // Nouvel espace depuis l'étiquette : son contenu d'alors, ses dossiers stylés, ses réglages.
    const restored = await bob.post(`/api/snapshots/${snapshot.id}/restore`, {});
    assert.equal(restored.status, 201);
    const copy = (await bob.get(`/api/documentation/spaces/${restored.body.spaceId}`)).body as { space: { name: string; obsidian: boolean }; nodes: DocNodeDTO[]; templates: DocNodeDTO[] };
    assert.equal(copy.space.name, 'Produit (v1.0)');
    assert.equal(copy.space.obsidian, true);
    const restoredNote = copy.nodes.find((node) => node.path === 'Guides/Installer.md')!;
    assert.equal((await bob.get(`/api/documentation/nodes/${restoredNote.id}`)).body.content, '# Installer\n\n![[schema.png]]');
    const restoredImage = copy.nodes.find((node) => node.path === 'Pictures/schema.png')!;
    assert.deepEqual((await bob.raw('GET', `/api/documentation/nodes/${restoredImage.id}/raw`)).bytes, png(1));
    assert.equal(copy.nodes.find((node) => node.path === 'Guides')!.color, '#10b981');
    assert.deepEqual(copy.templates.map((node) => node.path), ['Réunion.md']);

    // Retrait : un lecteur ne peut pas ; le propriétaire si. Les copies inutiles partent.
    assert.equal((await vera.request('DELETE', `/api/snapshots/${snapshot.id}`)).status, 403);
    const before = frozenCount();
    assert.equal((await bob.request('DELETE', `/api/snapshots/${snapshot.id}`)).status, 200);
    assert.equal((await vera.get(`/api/snapshots/${snapshot.id}`)).status, 404);
    assert.ok(frozenCount() < before, 'les copies que plus rien ne garde sont effacées');
  });

  it('tableaux blancs : images et icônes figées, restaurées dans un nouvel espace', async () => {
    const space = (await bob.post('/api/boards/spaces', { name: 'Schémas' })).body.space.id as number;
    const asset = (await bob.raw('POST', `/api/boards/spaces/${space}/assets`, png(20), { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'logo.png', ...FETCH })).json.asset as { id: number; key: string };
    const template = (await bob.post(`/api/boards/spaces/${space}/nodes`, { path: 'Carte', kind: 'template', elements: [{ id: 't', type: 'shape', shape: 'rect', z: 1, x: 0, y: 0, w: 100, h: 60, text: 'Modèle' }] })).body.node as { id: number };
    const elements = [
      { id: 'p', type: 'image', z: 1, x: 0, y: 0, w: 120, h: 80, asset: asset.key, name: 'logo.png' },
      { id: 'c', type: 'shape', shape: 'rect', z: 2, x: 200, y: 0, w: 100, h: 60, text: 'Copie', tpl: { id: template.id, inst: 'i1', key: 't', v: 'x' } },
    ];
    await bob.post(`/api/boards/spaces/${space}/nodes`, { path: 'Dossier', kind: 'folder' });
    const board = (await bob.post(`/api/boards/spaces/${space}/nodes`, { path: 'Dossier/Architecture', elements })).body.node as { id: number };
    const snapshot = (await bob.post('/api/snapshots', { kind: 'boards', spaceId: space, name: 'v2' })).body.snapshot as SpaceSnapshotDTO;
    assert.equal(snapshot.items, 1);

    // L'image quitte l'espace, le tableau est vidé : l'étiquette les garde.
    await bob.request('PUT', `/api/boards/nodes/${board.id}/elements`, { elements: [] });
    await bob.request('DELETE', `/api/boards/assets/${asset.id}`);
    assert.deepEqual((await app.client().raw('GET', `/api/board-assets/${asset.key}`)).bytes, png(20), 'l’image se lit encore par sa clé');
    const content = (await bob.get(`/api/snapshots/${snapshot.id}`)).body.content as BoardSnapshotContent;
    const frozenBoard = content.nodes.find((node) => node.path === 'Dossier/Architecture')!;
    const frozenElements = (await file(bob, snapshot.id, frozenBoard.file)).json as Array<{ id: string }>;
    assert.deepEqual(frozenElements.map((element) => element.id), ['p', 'c']);
    assert.deepEqual(content.files.map((entry) => [entry.ref, entry.name]), [[`asset:${asset.key}`, 'logo.png']]);

    const restored = (await bob.post(`/api/snapshots/${snapshot.id}/restore`, { name: 'Schémas d’origine' })).body as { spaceId: number };
    const tree = (await bob.get(`/api/boards/spaces/${restored.spaceId}`)).body as { space: { name: string }; nodes: Array<{ id: number; path: string; kind: string }> };
    assert.equal(tree.space.name, 'Schémas d’origine');
    const copied = tree.nodes.find((node) => node.path === 'Dossier/Architecture')!;
    const copiedTemplate = tree.nodes.find((node) => node.kind === 'template')!;
    const read = (await bob.get(`/api/boards/nodes/${copied.id}`)).body.elements as Array<{ id: string; asset?: string; tpl?: { id: number } }>;
    const assets = (await bob.get(`/api/boards/spaces/${restored.spaceId}/assets`)).body.assets as Array<{ key: string; name: string }>;
    assert.equal(assets.length, 1, 'l’image revient dans le nouvel espace');
    assert.equal(read.find((element) => element.id === 'p')!.asset, assets[0]!.key, 'sous sa nouvelle clé');
    assert.equal(read.find((element) => element.id === 'c')!.tpl?.id, copiedTemplate.id, 'le lien vers le modèle suit sa copie');
  });

  it('projet : l’export complet et les pièces jointes figés ; consulté et téléchargé, pas restauré', async () => {
    const project = (await bob.post('/api/projects', { name: 'Refonte', key: 'RF' })).body.project.id as number;
    const ticket = (await bob.post(`/api/projects/${project}/tickets`, { title: 'Maquette', status: 'todo' })).body.ticket.id as number;
    await bob.post(`/api/tickets/${ticket}/comments`, { body: 'Vu avec le client' });
    const attachment = (await bob.raw('POST', `/api/tickets/${ticket}/attachments`, Buffer.from('cahier des charges'), { 'Content-Type': 'text/plain', 'X-File-Name': 'cdc.txt', ...FETCH })).json.attachment as { id: number };
    assert.equal((await vera.post('/api/snapshots', { kind: 'project', spaceId: project, name: 'v1' })).status, 404, 'hors du projet');
    const snapshot = (await bob.post('/api/snapshots', { kind: 'project', spaceId: project, name: 'Recette' })).body.snapshot as SpaceSnapshotDTO;
    assert.equal(snapshot.spaceName, 'RF — Refonte');
    assert.equal(snapshot.items, 1);

    await bob.request('PATCH', `/api/tickets/${ticket}`, { title: 'Maquette v2' });
    await bob.request('DELETE', `/api/attachments/${attachment.id}`);
    const content = (await bob.get(`/api/snapshots/${snapshot.id}`)).body.content as ProjectSnapshotContent;
    assert.deepEqual(content.project, { key: 'RF', name: 'Refonte' });
    const exported = (await file(bob, snapshot.id, content.file)).json as { tickets: Array<{ title: string; comments: Array<{ body: string }> }>; users: Array<{ name: string }> };
    assert.equal(exported.tickets[0]!.title, 'Maquette', 'le titre d’alors');
    assert.equal(exported.tickets[0]!.comments[0]!.body, 'Vu avec le client');
    assert.ok(exported.users.some((user) => user.name === 'bob'));
    const kept = await bob.raw('GET', `/api/snapshots/${snapshot.id}/files/${content.attachments[0]!.file}?name=cdc.txt`);
    assert.equal(kept.bytes.toString('utf8'), 'cahier des charges', 'la pièce jointe supprimée depuis');
    assert.match(kept.headers.get('content-disposition') ?? '', /^attachment; filename="cdc.txt"/);
    const entries = unzipSync(new Uint8Array((await bob.raw('GET', `/api/snapshots/${snapshot.id}/download`)).bytes));
    assert.ok(entries['projet.json'] && entries[`pieces-jointes/${ticket}/${attachment.id}-cdc.txt`]);
    assert.equal((await bob.post(`/api/snapshots/${snapshot.id}/restore`, {})).status, 400);

    // Le projet supprimé emporte ses étiquettes.
    assert.equal((await admin.request('DELETE', `/api/projects/${project}`)).status, 200);
    assert.equal(app.running.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM space_snapshots WHERE kind = ? AND space_id = ?', 'project', project)!.n, 0);
  });
});
