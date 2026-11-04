import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import * as Y from 'yjs';
import { findQuote, plainText, quoteFromSource, sourceOffset, type DocCommentDTO } from '../../shared/docComments.ts';
import { expandWikiLinks, extractDocLinks, imageMarkdown, resolveDocLink } from '../../shared/docLinks.ts';
import { base64ToBytes, bytesToBase64, normalizeDocPath, type DocImportEntryDTO, type DocImportPreviewDTO, type DocLinksDTO, type DocNodeDTO, type DocVersionDTO } from '../../shared/docs.ts';
import type { SearchResultDTO, TicketPreviewDTO } from '../../shared/types.ts';
import type { ServerMessage } from '../../shared/realtime.ts';
import { markDifferences, mergeThreeWay } from '../docs/merge.ts';
import { purgeDocs, reindexDocs } from '../docs/store.ts';
import { bootServer, type SocketProbe, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/** Attend qu'une condition devienne vraie (écritures différées, messages en route). */
async function until(check: () => boolean | Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Délai dépassé');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Participant à une salle : un document Yjs relié au serveur, comme dans le navigateur. */
async function joinRoom(client: TestClient, nodeId: number): Promise<{ socket: SocketProbe; doc: Y.Doc; text: Y.Text; sync: Extract<ServerMessage, { t: 'doc.sync' }> }> {
  const socket = await client.connect();
  const doc = new Y.Doc();
  socket.ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString()) as ServerMessage;
    if ((message.t === 'doc.sync' || message.t === 'doc.update') && message.nodeId === nodeId) Y.applyUpdate(doc, base64ToBytes(message.update), 'remote');
  });
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') socket.send({ t: 'doc.update', nodeId, update: bytesToBase64(update) });
  });
  socket.send({ t: 'doc.join', nodeId, stateVector: bytesToBase64(Y.encodeStateVector(doc)) });
  const sync = (await socket.waitFor((message) => message.t === 'doc.sync')) as Extract<ServerMessage, { t: 'doc.sync' }>;
  await until(() => doc.getText('content').length >= 0);
  return { socket, doc, text: doc.getText('content'), sync };
}

describe('chemins de la documentation', () => {
  it('n’accepte que des chemins sûrs', () => {
    assert.equal(normalizeDocPath('Guides/Installation.md'), 'Guides/Installation.md');
    assert.equal(normalizeDocPath('/Guides\\Sous dossier/ note.md '), 'Guides/Sous dossier/note.md');
    for (const bad of ['', '/', '..', '../secret.md', 'a/../../b.md', 'a/./b.md', '.obsidian/app.json', 'a/.git/config', 'a:b.md', 'CON', 'con.md', 'nul.txt', 'a|b', 'fin.', 'a//b', `a${String.fromCharCode(0)}b`, 'x/'.repeat(20) + 'y']) {
      assert.equal(normalizeDocPath(bad), null, bad);
    }
  });
});

describe('liens entre les fichiers d’un espace', () => {
  const node = (id: number, path: string, kind: DocNodeDTO['kind'] = 'markdown'): DocNodeDTO => ({ id, spaceId: 1, path, kind, size: 0, updatedAt: '', updatedBy: null, deletedAt: null });
  const nodes = [node(1, 'Guides', 'folder'), node(2, 'Guides/Installation.md'), node(3, 'Guides/images/schéma 1.png', 'image'), node(4, 'Accueil.md'), node(5, 'Autre/Installation.md')];

  it('réécrit les liens wiki, sauf dans le code', () => {
    assert.equal(expandWikiLinks('Voir [[Installation]] et [[Guides/Accueil|le début]]'), 'Voir [Installation](Installation) et [le début](Guides/Accueil)');
    assert.equal(expandWikiLinks('[[Note#Section]] ![[schéma 1.png]]'), '[Note](Note) ![schéma 1.png](sch%C3%A9ma%201.png)');
    assert.equal(expandWikiLinks('`[[code]]` et\n```\n[[bloc]]\n```\n[[vrai]]'), '`[[code]]` et\n```\n[[bloc]]\n```\n[vrai](vrai)');
  });

  it('retrouve un fichier à côté de la note, depuis la racine, ou par son nom', () => {
    assert.equal(resolveDocLink(nodes, 'Guides/Note.md', 'Installation')?.id, 2, 'à côté de la note d’abord');
    assert.equal(resolveDocLink(nodes, 'Autre/Note.md', 'Installation.md')?.id, 5);
    assert.equal(resolveDocLink(nodes, 'Guides/Note.md', '../Accueil.md')?.id, 4);
    assert.equal(resolveDocLink(nodes, 'Autre/Note.md', 'Guides/Installation')?.id, 2, 'depuis la racine');
    assert.equal(resolveDocLink(nodes, 'Note.md', 'accueil')?.id, 4, 'sans tenir compte de la casse');
    assert.equal(resolveDocLink(nodes, 'Note.md', 'sch%C3%A9ma%201.png')?.id, 3, 'par son nom seul');
    assert.equal(resolveDocLink(nodes, 'Note.md', 'absent'), undefined);
    assert.equal(resolveDocLink(nodes, 'Note.md', 'Guides'), undefined, 'un dossier n’est pas une cible');
  });

  it('liste ce qu’une note cite, hors du code et des images', () => {
    const text = 'Voir [[Installation|ici]], [doc](../Accueil.md), [site](https://exemple.fr), [ancre](#titre) et ![img](a.png)\n`[[code]]`\n@[DEM-1](ticket:7) @[Note](doc:9) @[Bob](user:3) @[DEM-1](ticket:7)';
    assert.deepEqual(extractDocLinks(text), { paths: ['Installation', '../Accueil.md'], docs: [9], tickets: [7] });
  });

  it('écrit le lien d’une image relatif à la note', () => {
    assert.equal(imageMarkdown('Guides/Note.md', 'Guides/images/a b.png'), '![a b.png](images/a%20b.png)');
    assert.equal(imageMarkdown('Note.md', 'images/a.png'), '![a.png](images/a.png)');
  });
});

describe('ancres des commentaires', () => {
  const source = '# Titre\n\nUn mot **important** ici, puis un [lien vers](https://a.fr/b) la suite.\n\nUn mot important là-bas.';

  it('retire la syntaxe pour garder ce que la lecture affiche', () => {
    assert.equal(plainText('## Titre\n- [x] **Gras** et `code`\n@[Bob](user:1) [lien](a.md) snake_case _penché_'), 'Titre\nGras et code\nBob lien snake_case penché');
  });

  it('retrouve un passage rendu dans le source, à travers sa mise en forme', () => {
    const found = findQuote(source, { quote: 'mot important ici', before: 'Un', after: ', puis' }, true)!;
    assert.equal(source.slice(found.from, found.to), 'mot **important** ici');
    const link = findQuote(source, { quote: 'un lien vers la suite', before: '', after: '' }, true)!;
    assert.equal(source.slice(link.from, link.to), 'un [lien vers](https://a.fr/b) la suite');
  });

  it('départage deux occurrences par leur entourage', () => {
    const text = 'Un mot juste ici.\n\nPuis un mot juste là.';
    assert.equal(findQuote(text, { quote: 'mot juste', before: 'Puis un', after: 'là.' }, false)!.from, text.lastIndexOf('mot juste'));
    assert.equal(findQuote(text, { quote: 'mot juste', before: '', after: 'ici.' }, false)!.from, text.indexOf('mot juste'));
    assert.equal(findQuote(text, { quote: 'disparu', before: '', after: '' }, false), null);
  });

  it('une sélection du source donne une ancre retrouvée dans le source et dans le rendu', () => {
    const from = source.indexOf('**important** ici');
    const anchor = quoteFromSource(source, from, from + '**important** ici'.length);
    assert.deepEqual(anchor.quote, 'important ici');
    assert.equal(findQuote(source, anchor, true)!.from, from + 2);
    assert.ok(findQuote('Titre\n\nUn mot important ici, puis un lien vers la suite.\n\nUn mot important là-bas.', anchor, false));
  });

  it('place le curseur dans le source d’après le texte rendu qui le précède', () => {
    const block = 'Un mot **important** ici.';
    assert.equal(block.slice(0, sourceOffset(block, 'Un mot important')), 'Un mot **important');
    assert.equal(sourceOffset(block, ''), 0);
  });
});

describe('fusion des fichiers importés', () => {
  it('combine les changements de chaque côté', () => {
    const merged = mergeThreeWay('un\ndeux serveur\ntrois\nquatre\ncinq', 'un\ndeux\ntrois\nquatre\ncinq', 'un\ndeux\ntrois\nquatre import\ncinq');
    assert.deepEqual(merged, { text: 'un\ndeux serveur\ntrois\nquatre import\ncinq', conflict: false });
  });

  it('signale les lignes changées des deux côtés', () => {
    const { text, conflict } = mergeThreeWay('un\nA\ntrois', 'un\ndeux\ntrois', 'un\nB\ntrois');
    assert.equal(conflict, true);
    assert.equal(text, 'un\n<<<<<<< Serveur\nA\n=======\nB\n>>>>>>> Import\ntrois');
  });

  it('sans version d’origine, marque chaque écart', () => {
    assert.equal(markDifferences('un\nA\ntrois', 'un\nB\ntrois\nquatre'), 'un\n<<<<<<< Serveur\nA\n=======\nB\n>>>>>>> Import\ntrois\n<<<<<<< Serveur\n=======\nquatre\n>>>>>>> Import');
  });
});

describe('documentation', () => {
  let app: Booted;
  let admin: TestClient;
  let bob: TestClient;
  let vera: TestClient;
  let eve: TestClient;
  const ids: Record<string, number> = {};

  const note = async (client: TestClient, spaceId: number, notePath: string, content?: string) => (await client.post(`/api/documentation/spaces/${spaceId}/nodes`, { path: notePath, ...(content === undefined ? {} : { content }) })).body.node as DocNodeDTO;
  const newSpace = async (name: string) => (await bob.post('/api/documentation/spaces', { name })).body.space.id as number;
  const disk = (spaceId: number, ...segments: string[]) => path.join(app.running.ctx.docsDir, String(spaceId), ...segments);
  const contentOf = async (client: TestClient, nodeId: number) => (await client.get(`/api/documentation/nodes/${nodeId}`)).body.content as string;

  before(async () => {
    app = await bootServer();
    admin = app.client();
    await admin.login('admin@admin.com', 'admin1234');
    const roles = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
    const member = roles.find((role) => role.key === 'member' && role.scope === 'global')!.id;
    for (const name of ['bob', 'vera', 'eve']) {
      ids[name] = (await admin.post('/api/admin/users', { email: `${name}@t.fr`, name, password: 'motdepasse1', roleId: member })).body.user.id;
    }
    bob = app.client();
    await bob.login('bob@t.fr', 'motdepasse1');
    vera = app.client();
    await vera.login('vera@t.fr', 'motdepasse1');
    eve = app.client();
    await eve.login('eve@t.fr', 'motdepasse1');
    assert.equal((await admin.request('PUT', '/api/admin/documentation', { enabled: true })).status, 200);
  });

  after(async () => {
    await app.running.close();
  });

  it('s’active depuis l’administration, désactivée par défaut', async () => {
    assert.equal((await admin.request('PUT', '/api/admin/documentation', { enabled: false })).status, 200);
    assert.equal((await app.client().get('/api/app')).body.docs, false);
    const refused = await bob.get('/api/documentation/spaces');
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'docs_disabled');
    assert.equal((await bob.request('PUT', '/api/admin/documentation', { enabled: true })).status, 403);
    assert.equal((await bob.get('/api/admin/documentation')).status, 403);

    const enabled = await admin.request('PUT', '/api/admin/documentation', { enabled: true });
    assert.equal(enabled.body.app.docs, true);
    assert.equal((await admin.get('/api/admin/documentation')).body.retentionDays, 15);
    assert.equal((await bob.get('/api/documentation/spaces')).status, 200);
  });

  it('range les notes dans un dossier d’espace, en vraie arborescence', async () => {
    const spaceId = await newSpace('Technique');
    assert.ok(fs.existsSync(disk(spaceId)), 'un dossier par espace, nommé par son identifiant');
    const node = await note(bob, spaceId, 'Guides/Backend/Installation');
    assert.equal(node.path, 'Guides/Backend/Installation.md', 'extension ajoutée');
    await bob.request('PUT', `/api/documentation/nodes/${node.id}/content`, { content: '# Installer' });
    assert.equal(fs.readFileSync(disk(spaceId, 'Guides', 'Backend', 'Installation.md'), 'utf8'), '# Installer');

    const tree = (await bob.get(`/api/documentation/spaces/${spaceId}`)).body.nodes as DocNodeDTO[];
    assert.deepEqual(tree.map((entry) => [entry.path, entry.kind]), [['Guides', 'folder'], ['Guides/Backend', 'folder'], ['Guides/Backend/Installation.md', 'markdown']]);

    assert.equal((await bob.post(`/api/documentation/spaces/${spaceId}/nodes`, { path: '../../evil' })).status, 400);
    assert.equal((await bob.post(`/api/documentation/spaces/${spaceId}/nodes`, { path: 'Guides/Backend/installation' })).status, 409, 'noms insensibles à la casse');
    assert.equal((await bob.post(`/api/documentation/spaces/${spaceId}/nodes`, { path: 'Guides/Backend/Installation.md/x' })).status, 409, 'pas de dossier sous un fichier');
  });

  it('renomme et déplace, le contenu d’un dossier suivant', async () => {
    const spaceId = await newSpace('Déplacements');
    const child = await note(bob, spaceId, 'A/B/note', 'texte');
    const folder = ((await bob.get(`/api/documentation/spaces/${spaceId}`)).body.nodes as DocNodeDTO[]).find((entry) => entry.path === 'A')!;
    assert.equal((await bob.patch(`/api/documentation/nodes/${folder.id}`, { path: 'A/B/C' })).status, 400, 'pas dans lui-même');

    const moved = await bob.patch(`/api/documentation/nodes/${folder.id}`, { path: 'Z' });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal((await bob.get(`/api/documentation/nodes/${child.id}`)).body.node.path, 'Z/B/note.md', 'même identifiant après le déplacement');
    assert.equal(fs.readFileSync(disk(spaceId, 'Z', 'B', 'note.md'), 'utf8'), 'texte');
    assert.equal(fs.existsSync(disk(spaceId, 'A')), false);
    assert.equal((await bob.patch(`/api/documentation/nodes/${child.id}`, { path: 'Z/B/renommée' })).body.node.path, 'Z/B/renommée.md');
  });

  it('applique les rôles de l’espace', async () => {
    const spaceId = await newSpace('Droits');
    const node = await note(bob, spaceId, 'note', 'secret');
    assert.equal((await vera.get(`/api/documentation/spaces/${spaceId}`)).status, 404, 'invisible sans en être membre');
    assert.equal((await vera.get(`/api/documentation/nodes/${node.id}`)).status, 404);
    assert.equal((await admin.get(`/api/documentation/nodes/${node.id}`)).status, 200, 'docs.manage voit tout');

    assert.equal((await bob.post(`/api/documentation/spaces/${spaceId}/members`, { userId: ids.vera, role: 'reader' })).status, 201);
    assert.equal(await contentOf(vera, node.id), 'secret');
    assert.equal((await vera.request('PUT', `/api/documentation/nodes/${node.id}/content`, { content: 'x' })).status, 403);
    assert.equal((await vera.post(`/api/documentation/spaces/${spaceId}/nodes`, { path: 'y' })).status, 403);
    assert.equal((await vera.del(`/api/documentation/nodes/${node.id}`)).status, 403);

    assert.equal((await bob.patch(`/api/documentation/spaces/${spaceId}/members/${ids.vera}`, { role: 'editor' })).status, 200);
    assert.equal((await vera.request('PUT', `/api/documentation/nodes/${node.id}/content`, { content: 'modifié' })).status, 200);
    assert.equal((await vera.post(`/api/documentation/spaces/${spaceId}/members`, { userId: ids.eve, role: 'reader' })).status, 403, 'les membres restent au propriétaire');
    assert.equal((await vera.del(`/api/documentation/spaces/${spaceId}`)).status, 403);

    assert.equal((await bob.del(`/api/documentation/spaces/${spaceId}/members/${ids.bob}`)).status, 409, 'dernier propriétaire');
    assert.equal((await bob.patch(`/api/documentation/spaces/${spaceId}/members/${ids.bob}`, { role: 'reader' })).status, 409);
  });

  it('garde 15 jours d’historique et de corbeille', async () => {
    const spaceId = await newSpace('Historique');
    const node = await note(bob, spaceId, 'journal', 'version 1');
    await bob.request('PUT', `/api/documentation/nodes/${node.id}/content`, { content: 'version 2' });
    await bob.request('PUT', `/api/documentation/nodes/${node.id}/content`, { content: 'version 3' });
    const versions = (await bob.get(`/api/documentation/nodes/${node.id}/versions`)).body.versions as DocVersionDTO[];
    assert.equal(versions.length, 3);
    assert.deepEqual(versions[0]!.authors, ['bob']);
    assert.equal((await bob.get(`/api/documentation/versions/${versions[2]!.id}`)).body.content, 'version 1');
    assert.equal((await vera.get(`/api/documentation/versions/${versions[2]!.id}`)).status, 404, 'même droits que le fichier');

    assert.equal((await bob.post(`/api/documentation/versions/${versions[2]!.id}/restore`, {})).status, 200);
    assert.equal(await contentOf(bob, node.id), 'version 1');

    assert.equal((await bob.del(`/api/documentation/nodes/${node.id}`)).status, 200);
    assert.equal(fs.existsSync(disk(spaceId, 'journal.md')), false);
    assert.deepEqual(((await bob.get(`/api/documentation/spaces/${spaceId}`)).body.nodes as DocNodeDTO[]).map((entry) => entry.path), []);
    assert.deepEqual(((await bob.get(`/api/documentation/spaces/${spaceId}/trash`)).body.nodes as DocNodeDTO[]).map((entry) => entry.path), ['journal.md']);

    await note(bob, spaceId, 'journal', 'nouvelle note au même nom');
    const restored = (await bob.post(`/api/documentation/nodes/${node.id}/restore`, {})).body.node as DocNodeDTO;
    assert.equal(restored.path, 'journal (2).md', 'nom libre si la place est prise');
    assert.equal(await contentOf(bob, node.id), 'version 1');

    const now = Date.now();
    const db = app.running.ctx.db;
    await bob.del(`/api/documentation/nodes/${node.id}`);
    const kept = await note(bob, spaceId, 'récente', 'a');
    purgeDocs(app.running.ctx, now + 14 * 86_400_000);
    assert.equal(((await bob.get(`/api/documentation/spaces/${spaceId}/trash`)).body.nodes as DocNodeDTO[]).length, 1, 'encore là après 14 jours');
    purgeDocs(app.running.ctx, now + 16 * 86_400_000);
    assert.equal(((await bob.get(`/api/documentation/spaces/${spaceId}/trash`)).body.nodes as DocNodeDTO[]).length, 0, 'oublié après 15 jours');
    assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM doc_versions WHERE node_id = ?', kept.id)?.n, 0, 'versions anciennes purgées');
    assert.equal(await contentOf(bob, kept.id), 'a', 'le fichier lui-même reste');
  });

  it('prévient les membres mentionnés, une seule fois', async () => {
    const spaceId = await newSpace('Mentions');
    await bob.post(`/api/documentation/spaces/${spaceId}/members`, { userId: ids.vera, role: 'reader' });
    const node = await note(bob, spaceId, 'réunion');
    const unread = async (client: TestClient) => ((await client.get('/api/me/notifications?unread=true')).body.notifications as Array<{ doc: { nodeId: number; title: string } | null; excerpt: string | null }>).filter((entry) => entry.doc?.nodeId === node.id);

    await bob.request('PUT', `/api/documentation/nodes/${node.id}/content`, { content: `À relire par @[vera](user:${ids.vera}) et @[eve](user:${ids.eve})` });
    const received = await unread(vera);
    assert.equal(received.length, 1);
    assert.equal(received[0]!.doc?.title, 'réunion');
    assert.ok(received[0]!.excerpt?.includes('@vera'));
    assert.equal((await unread(eve)).length, 0, 'sans accès à l’espace, pas de notification');

    await bob.request('PUT', `/api/documentation/nodes/${node.id}/content`, { content: `À relire par @[vera](user:${ids.vera}) demain` });
    assert.equal((await unread(vera)).length, 1, 'mention déjà connue');
  });

  it('accepte les images, sans jamais exécuter leur contenu', async () => {
    const spaceId = await newSpace('Images');
    const upload = (body: Buffer, name: string, folder = 'Guides') => bob.raw('POST', `/api/documentation/spaces/${spaceId}/images?folder=${folder}`, body, { 'Content-Type': 'application/octet-stream', 'X-File-Name': name });
    const stored = await upload(PNG, 'schéma.png');
    assert.equal(stored.status, 201, JSON.stringify(stored.json));
    assert.equal(stored.json.node.path, 'Guides/images/schéma.png');
    assert.equal((await upload(PNG, 'schéma.png')).json.node.path, 'Guides/images/schéma (2).png');
    assert.equal((await upload(Buffer.from('<svg onload="alert(1)"/>'), 'x.png')).status, 400, 'contenu vérifié');
    assert.equal((await upload(PNG, 'x.svg')).status, 400, 'extension vérifiée');
    assert.equal((await upload(PNG, 'x.png', '../..')).status, 400);

    const served = await fetch(`${app.base}/api/documentation/nodes/${stored.json.node.id}/raw`, { headers: { Cookie: bob.cookie } });
    assert.equal(served.headers.get('content-type'), 'image/png');
    assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(Buffer.from(await served.arrayBuffer()).equals(PNG));
  });

  describe('export et import', () => {
    const exportZip = async (spaceId: number) => {
      const response = await fetch(`${app.base}/api/documentation/spaces/${spaceId}/export`, { headers: { Cookie: bob.cookie } });
      assert.equal(response.status, 200);
      return unzipSync(new Uint8Array(await response.arrayBuffer()));
    };
    const send = (spaceId: number, files: Record<string, string | Uint8Array>, client = bob) =>
      client.raw('POST', `/api/documentation/spaces/${spaceId}/import`, Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, typeof value === 'string' ? strToU8(value) : value])))), { 'Content-Type': 'application/zip' });
    const statusOf = (preview: DocImportPreviewDTO, entryPath: string): DocImportEntryDTO | undefined => preview.entries.find((entry) => entry.path === entryPath);

    const raw = async (url: string, client = bob) => {
      const response = await fetch(`${app.base}/api/documentation${url}`, { headers: { Cookie: client.cookie } });
      assert.equal(response.status, 200);
      return { response, bytes: new Uint8Array(await response.arrayBuffer()) };
    };

    it('reproduit exactement l’arbre de l’espace, dossiers vides compris', async () => {
      const spaceId = await newSpace('Export');
      await note(bob, spaceId, 'Dossier/Sous dossier/note', 'contenu');
      await bob.post(`/api/documentation/spaces/${spaceId}/nodes`, { path: 'Vide', kind: 'folder' });
      await bob.raw('POST', `/api/documentation/spaces/${spaceId}/images`, PNG, { 'Content-Type': 'image/png', 'X-File-Name': 'logo.png' });
      const files = await exportZip(spaceId);
      assert.deepEqual(Object.keys(files).sort(), ['Dossier/', 'Dossier/Sous dossier/', 'Dossier/Sous dossier/note.md', 'Vide/', 'images/', 'images/logo.png'], 'rien de plus que l’arbre');
      assert.equal(strFromU8(files['Dossier/Sous dossier/note.md']!), 'contenu');
    });

    it('fusionne à trois au retour de l’archive, et reprend les dossiers vides', async () => {
      const spaceId = await newSpace('Aller-retour');
      const node = await note(bob, spaceId, 'Guides/note', 'un\ndeux\ntrois\nquatre\ncinq');
      await bob.post(`/api/documentation/spaces/${spaceId}/nodes`, { path: 'Guides/Vide', kind: 'folder' });
      const { bytes } = await raw(`/spaces/${spaceId}/export`);
      const untouched = (await bob.raw('POST', `/api/documentation/spaces/${spaceId}/import`, Buffer.from(bytes), { 'Content-Type': 'application/zip' })).json as DocImportPreviewDTO;
      assert.equal(statusOf(untouched, 'Guides/note.md')?.status, 'same', 'le dossier unique de l’espace n’est pas pris pour un dossier englobant');

      await bob.request('PUT', `/api/documentation/nodes/${node.id}/content`, { content: 'un serveur\ndeux\ntrois\nquatre\ncinq' });
      // Archive refaite à la main : son commentaire est perdu, l'export de la personne sert d'origine.
      const edited = (await send(spaceId, { 'Guides/note.md': 'un\ndeux\ntrois\nquatre\ncinq import', 'Neuf/': new Uint8Array(0) })).json as DocImportPreviewDTO;
      assert.equal(statusOf(edited, 'Guides/note.md')?.status, 'merged');
      assert.equal(statusOf(edited, 'Guides/note.md')?.merged, 'un serveur\ndeux\ntrois\nquatre\ncinq import');
      await bob.post(`/api/documentation/spaces/${spaceId}/import/${edited.importId}/apply`, { decisions: [{ path: 'Guides/note.md', action: 'auto' }] });
      assert.equal(await contentOf(bob, node.id), 'un serveur\ndeux\ntrois\nquatre\ncinq import');
      const paths = ((await bob.get(`/api/documentation/spaces/${spaceId}`)).body.nodes as DocNodeDTO[]).map((entry) => entry.path);
      assert.ok(paths.includes('Neuf'), 'un dossier vide de l’archive est repris');
    });

    it('exporte et réimporte un fichier seul, ou un dossier', async () => {
      const spaceId = await newSpace('Par fichier');
      const node = await note(bob, spaceId, 'Guides/é note', 'un\ndeux\ntrois\nquatre\ncinq');
      await note(bob, spaceId, 'Autre/à part', 'x');
      const file = await raw(`/nodes/${node.id}/export`);
      assert.equal(strFromU8(file.bytes), 'un\ndeux\ntrois\nquatre\ncinq');
      assert.match(file.response.headers.get('content-disposition') ?? '', /filename\*=UTF-8''%C3%A9%20note\.md/);
      assert.match(file.response.headers.get('content-type') ?? '', /text\/markdown/);

      await bob.request('PUT', `/api/documentation/nodes/${node.id}/content`, { content: 'un serveur\ndeux\ntrois\nquatre\ncinq' });
      const preview = (await bob.raw('POST', `/api/documentation/nodes/${node.id}/import`, Buffer.from('un\ndeux\ntrois\nquatre\ncinq fichier'), { 'Content-Type': 'text/markdown' })).json as DocImportPreviewDTO;
      assert.equal(preview.entries.length, 1);
      assert.equal(preview.entries[0]!.status, 'merged', 'l’export du fichier sert d’origine');
      assert.equal(preview.entries[0]!.merged, 'un serveur\ndeux\ntrois\nquatre\ncinq fichier');
      await bob.post(`/api/documentation/spaces/${spaceId}/import/${preview.importId}/apply`, { decisions: [{ path: 'Guides/é note.md', action: 'auto' }] });
      assert.equal(await contentOf(bob, node.id), 'un serveur\ndeux\ntrois\nquatre\ncinq fichier');

      const folder = (await bob.get(`/api/documentation/spaces/${spaceId}`)).body.nodes.find((entry: DocNodeDTO) => entry.path === 'Guides') as DocNodeDTO;
      assert.deepEqual(Object.keys(unzipSync((await raw(`/nodes/${folder.id}/export`)).bytes)).sort(), ['Guides/', 'Guides/é note.md'], 'seul le dossier, avec ses chemins dans l’espace');

      const placed = (await bob.raw('POST', `/api/documentation/spaces/${spaceId}/import?folder=Guides`, Buffer.from(zipSync({ 'neuf.md': strToU8('x') })), { 'Content-Type': 'application/zip' })).json as DocImportPreviewDTO;
      assert.deepEqual(placed.entries.map((entry) => entry.path), ['Guides/neuf.md'], 'une archive étrangère se range dans le dossier');
      assert.equal((await bob.raw('POST', `/api/documentation/spaces/${spaceId}/import?folder=Absent`, Buffer.from(zipSync({ 'a.md': strToU8('x') })), { 'Content-Type': 'application/zip' })).status, 404);
      assert.equal((await bob.raw('POST', `/api/documentation/nodes/${folder.id}/import`, Buffer.from('x'), { 'Content-Type': 'text/markdown' })).status, 400, 'un dossier se réimporte par un ZIP');
    });

    it('ne garde pas de texte exporté pour qui ne peut pas réimporter, et oublie les vieux exports', async () => {
      const spaceId = await newSpace('Rétention');
      await bob.post(`/api/documentation/spaces/${spaceId}/members`, { userId: ids.vera, role: 'reader' });
      await note(bob, spaceId, 'note', 'x');
      const count = () => app.running.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM doc_exports WHERE space_id = ?', spaceId)?.n;
      await raw(`/spaces/${spaceId}/export`, vera);
      assert.equal(count(), 0);
      await raw(`/spaces/${spaceId}/export`);
      assert.equal(count(), 1);
      purgeDocs(app.running.ctx, Date.now() + 91 * 86_400_000);
      assert.equal(count(), 0);
    });

    it('classe chaque fichier, fusionne, puis n’écrit qu’après confirmation', async () => {
      const spaceId = await newSpace('Fusion');
      const texts = { same: 'identique', server: 'base', incoming: 'base', both: 'un\ndeux\ntrois\nquatre\ncinq', clash: 'un\ndeux\ntrois', gone: 'à retirer' };
      const nodes = Object.fromEntries(await Promise.all(Object.entries(texts).map(async ([name, content]) => [name, await note(bob, spaceId, name, content)]))) as Record<keyof typeof texts, DocNodeDTO>;
      const archive: Record<string, string | Uint8Array> = { ...(await exportZip(spaceId)) };
      delete archive['gone.md'];
      const write = (nodeId: number, content: string) => bob.request('PUT', `/api/documentation/nodes/${nodeId}/content`, { content });

      await write(nodes.server.id, 'changé sur le serveur');
      await write(nodes.both.id, 'un\ndeux serveur\ntrois\nquatre\ncinq');
      await write(nodes.clash.id, 'un\nserveur\ntrois');
      archive['incoming.md'] = 'changé dans l’import';
      archive['both.md'] = 'un\ndeux\ntrois\nquatre import\ncinq';
      archive['clash.md'] = 'un\nimport\ntrois';
      archive['nouveau/fichier.md'] = 'nouveau';

      const preview = (await send(spaceId, archive)).json as DocImportPreviewDTO;
      assert.equal(statusOf(preview, 'same.md')?.status, 'same');
      assert.equal(statusOf(preview, 'server.md')?.status, 'kept');
      assert.equal(statusOf(preview, 'incoming.md')?.status, 'updated');
      assert.equal(statusOf(preview, 'both.md')?.status, 'merged');
      assert.equal(statusOf(preview, 'both.md')?.merged, 'un\ndeux serveur\ntrois\nquatre import\ncinq');
      assert.equal(statusOf(preview, 'clash.md')?.status, 'conflict');
      assert.ok(statusOf(preview, 'clash.md')?.merged?.includes('<<<<<<< Serveur'));
      assert.equal(statusOf(preview, 'nouveau/fichier.md')?.status, 'new');
      assert.equal(statusOf(preview, 'gone.md')?.status, 'removed');
      assert.equal(await contentOf(bob, nodes.incoming.id), 'base', 'rien n’est écrit avant confirmation');

      const applied = await bob.post(`/api/documentation/spaces/${spaceId}/import/${preview.importId}/apply`, {
        decisions: [
          { path: 'incoming.md', action: 'auto' },
          { path: 'both.md', action: 'auto' },
          { path: 'clash.md', action: 'auto', content: 'un\nrésolu\ntrois' },
          { path: 'nouveau/fichier.md', action: 'auto' },
          { path: 'gone.md', action: 'delete' },
          { path: 'server.md', action: 'keep' },
        ],
      });
      assert.deepEqual(applied.body, { written: 4, deleted: 1 });
      assert.equal(await contentOf(bob, nodes.incoming.id), 'changé dans l’import');
      assert.equal(await contentOf(bob, nodes.both.id), 'un\ndeux serveur\ntrois\nquatre import\ncinq');
      assert.equal(await contentOf(bob, nodes.clash.id), 'un\nrésolu\ntrois');
      assert.equal(await contentOf(bob, nodes.server.id), 'changé sur le serveur');
      assert.equal(fs.readFileSync(disk(spaceId, 'nouveau', 'fichier.md'), 'utf8'), 'nouveau');
      assert.equal(fs.existsSync(disk(spaceId, 'gone.md')), false);
      const history = (await bob.get(`/api/documentation/nodes/${nodes.both.id}/versions`)).body.versions as DocVersionDTO[];
      assert.equal(history[0]!.origin, 'import');
      assert.equal((await bob.post(`/api/documentation/spaces/${spaceId}/import/${preview.importId}/apply`, { decisions: [] })).status, 404, 'un import ne se rejoue pas');
    });

    it('accepte un coffre sans version d’origine, et garde les deux si on le demande', async () => {
      const spaceId = await newSpace('Coffre');
      await note(bob, spaceId, 'note', 'serveur');
      const preview = (await send(spaceId, { 'MonCoffre/note.md': 'obsidian', 'MonCoffre/images/a.png': PNG, 'MonCoffre/.obsidian/app.json': '{}', 'MonCoffre/rapport.pdf': 'x' })).json as DocImportPreviewDTO;
      assert.equal(statusOf(preview, 'note.md')?.status, 'conflict', 'le dossier englobant est retiré');
      assert.ok(statusOf(preview, 'note.md')?.merged?.includes('=======\nobsidian\n>>>>>>> Import'));
      assert.equal(statusOf(preview, 'images/a.png')?.status, 'new');
      assert.deepEqual(preview.ignored, ['rapport.pdf'], 'les réglages d’Obsidian sont sautés sans bruit');
      await bob.post(`/api/documentation/spaces/${spaceId}/import/${preview.importId}/apply`, { decisions: [{ path: 'note.md', action: 'both' }, { path: 'images/a.png', action: 'auto' }] });
      const paths = ((await bob.get(`/api/documentation/spaces/${spaceId}`)).body.nodes as DocNodeDTO[]).map((entry) => entry.path);
      assert.deepEqual(paths, ['images', 'images/a.png', 'note (import).md', 'note.md']);
    });

    it('refuse les archives piégées', async () => {
      const spaceId = await newSpace('Piège');
      const preview = (await send(spaceId, { '../../evil.md': 'x', 'a/../../evil2.md': 'x', 'ok.md': 'x' })).json as DocImportPreviewDTO;
      assert.deepEqual(preview.entries.map((entry) => entry.path), ['ok.md']);
      assert.equal((await bob.raw('POST', `/api/documentation/spaces/${spaceId}/import`, Buffer.from('pas un zip'), { 'Content-Type': 'application/zip' })).status, 400);
      assert.equal((await send(spaceId, { 'a.md': 'x' }, vera)).status, 404, 'non-membre');
      const other = (await send(spaceId, { 'a.md': 'x' })).json as DocImportPreviewDTO;
      await bob.post(`/api/documentation/spaces/${spaceId}/members`, { userId: ids.vera, role: 'editor' });
      assert.equal((await vera.post(`/api/documentation/spaces/${spaceId}/import/${other.importId}/apply`, { decisions: [] })).status, 404, 'un import reste à celui qui l’a lancé');
    });
  });

  describe('commentaires sur un passage', () => {
    const anchor = { quote: 'mot', before: 'Un', after: 'ici' };
    const space = async (name: string) => {
      const spaceId = await newSpace(name);
      await bob.post(`/api/documentation/spaces/${spaceId}/members`, { userId: ids.vera, role: 'reader' });
      return { spaceId, node: await note(bob, spaceId, 'note', 'Un mot ici') };
    };

    it('ouvert aux lecteurs, prévient les personnes mentionnées qui ont accès, et se répond', async () => {
      const { node } = await space('Commentaires');
      const created = await vera.post(`/api/documentation/nodes/${node.id}/comments`, { ...anchor, body: `Vu ? @[Bob](user:${ids.bob}) @[Eve](user:${ids.eve})` });
      assert.equal(created.status, 201, 'un lecteur peut commenter');
      const comment = created.body.comment as DocCommentDTO;
      assert.equal(comment.quote, 'mot');
      const notifications = (await bob.get('/api/me/notifications')).body.notifications as Array<{ doc: { nodeId: number } | null }>;
      assert.equal(notifications.find((entry) => entry.doc?.nodeId === node.id)?.doc?.nodeId, node.id);
      const others = (await eve.get('/api/me/notifications')).body.notifications as Array<{ doc: { nodeId: number } | null }>;
      assert.equal(others.some((entry) => entry.doc?.nodeId === node.id), false, 'pas de notification sans accès à l’espace');

      const reply = (await bob.post(`/api/documentation/nodes/${node.id}/comments`, { body: 'Oui', parentId: comment.id })).body.comment as DocCommentDTO;
      const nested = (await vera.post(`/api/documentation/nodes/${node.id}/comments`, { body: 'Bien', parentId: reply.id })).body.comment as DocCommentDTO;
      assert.equal(reply.parentId, comment.id);
      assert.equal(reply.quote, '');
      assert.equal(nested.parentId, comment.id, 'une réponse à une réponse reste dans le fil');
      assert.equal(((await bob.get(`/api/documentation/nodes/${node.id}/comments`)).body.comments as DocCommentDTO[]).length, 3);
    });

    it('refuse un commentaire sans passage, ou d’une autre note', async () => {
      const { spaceId, node } = await space('Refus');
      assert.equal((await bob.post(`/api/documentation/nodes/${node.id}/comments`, { body: 'x' })).status, 400);
      const other = await note(bob, spaceId, 'autre', 'y');
      const comment = (await bob.post(`/api/documentation/nodes/${node.id}/comments`, { ...anchor, body: 'x' })).body.comment as DocCommentDTO;
      assert.equal((await bob.post(`/api/documentation/nodes/${other.id}/comments`, { body: 'x', parentId: comment.id })).status, 400);
      assert.equal((await eve.post(`/api/documentation/nodes/${node.id}/comments`, { ...anchor, body: 'x' })).status, 404, 'hors de l’espace');
    });

    it('se résout, et ne se supprime que par son auteur ou un propriétaire', async () => {
      const { node } = await space('Suppression');
      const comment = (await vera.post(`/api/documentation/nodes/${node.id}/comments`, { ...anchor, body: 'À voir' })).body.comment as DocCommentDTO;
      const byOwner = (await bob.post(`/api/documentation/nodes/${node.id}/comments`, { ...anchor, body: 'De Bob' })).body.comment as DocCommentDTO;
      const resolved = (await vera.patch(`/api/documentation/comments/${comment.id}`, { resolved: true })).body.comment as DocCommentDTO;
      assert.ok(resolved.resolvedAt);
      assert.equal(resolved.resolvedBy, ids.vera);
      assert.equal(((await vera.patch(`/api/documentation/comments/${comment.id}`, { resolved: false })).body.comment as DocCommentDTO).resolvedAt, null);
      assert.equal((await vera.del(`/api/documentation/comments/${byOwner.id}`)).status, 403);
      assert.equal((await bob.del(`/api/documentation/comments/${comment.id}`)).status, 200, 'le propriétaire peut');
      assert.equal((await vera.del(`/api/documentation/comments/${comment.id}`)).status, 404);
    });

    it('prévient en direct les personnes qui regardent l’espace', async () => {
      const { spaceId, node } = await space('Direct');
      const watcher = await bob.connect();
      watcher.send({ t: 'docs.watch', spaceId });
      await new Promise((resolve) => setTimeout(resolve, 30));
      const message = watcher.waitFor((entry: ServerMessage) => entry.t === 'docs.comments' && entry.nodeId === node.id);
      await vera.post(`/api/documentation/nodes/${node.id}/comments`, { ...anchor, body: 'Coucou' });
      const received = (await message) as Extract<ServerMessage, { t: 'docs.comments' }>;
      assert.equal(received.comments[0]!.body, 'Coucou');
      watcher.close();
    });
  });

  describe('liens et rétroliens', () => {
    it('donne les liens d’une note et ce qui la cite, même renommée', async () => {
      const spaceId = await newSpace('Liens');
      const cible = await note(bob, spaceId, 'Guides/Cible', 'rien');
      const source = await note(bob, spaceId, 'Source', 'Voir [[Cible]] et [[Absente]]');
      const otherSpace = await newSpace('Autre espace');
      const far = await note(bob, otherSpace, 'Loin', `Cf. @[Cible](doc:${cible.id})`);
      const links = async (nodeId: number, client = bob) => (await client.get(`/api/documentation/nodes/${nodeId}/links`)).body as DocLinksDTO;

      const outgoing = await links(source.id);
      assert.deepEqual(outgoing.outgoing.notes.map((entry) => entry.id), [cible.id]);
      assert.deepEqual(outgoing.outgoing.broken, ['Absente']);
      assert.deepEqual((await links(cible.id)).backlinks.notes.map((entry) => entry.id).sort(), [source.id, far.id].sort());

      await bob.patch(`/api/documentation/nodes/${cible.id}`, { path: 'Ailleurs/Cible' });
      assert.ok((await links(cible.id)).backlinks.notes.some((entry) => entry.id === source.id), 'un déplacement ne casse rien');

      await bob.post(`/api/documentation/spaces/${spaceId}/members`, { userId: ids.vera, role: 'reader' });
      assert.deepEqual((await links(cible.id, vera)).backlinks.notes.map((entry) => entry.id), [source.id], 'seulement ce que la personne peut voir');
    });

    it('compte les tickets qui mentionnent une note, et ceux qu’elle mentionne', async () => {
      const spaceId = await newSpace('Tickets');
      const node = await note(bob, spaceId, 'Note', '');
      const project = (await bob.post('/api/projects', { name: 'Liens doc', key: 'LID' })).body.project as { id: number; key: string };
      const inDescription = (await bob.post(`/api/projects/${project.id}/tickets`, { title: 'Par la description', description: `Lire @[Note](doc:${node.id})` })).body.ticket as { id: number; number: number };
      const inComment = (await bob.post(`/api/projects/${project.id}/tickets`, { title: 'Par un commentaire' })).body.ticket as { id: number };
      await bob.post(`/api/tickets/${inComment.id}/comments`, { body: `Voir @[Note](doc:${node.id})` });
      await bob.request('PUT', `/api/documentation/nodes/${node.id}/content`, { content: `Suite de @[LID-1](ticket:${inDescription.id})` });

      const links = (await bob.get(`/api/documentation/nodes/${node.id}/links`)).body as DocLinksDTO;
      assert.deepEqual(links.backlinks.tickets.map((entry) => entry.id).sort(), [inDescription.id, inComment.id].sort());
      assert.deepEqual(links.outgoing.tickets, [{ id: inDescription.id, projectId: project.id, key: `LID-${inDescription.number}`, title: 'Par la description' }]);
      await bob.post(`/api/documentation/spaces/${spaceId}/members`, { userId: ids.vera, role: 'reader' });
      const hidden = (await vera.get(`/api/documentation/nodes/${node.id}/links`)).body as DocLinksDTO;
      assert.deepEqual([hidden.backlinks.tickets, hidden.outgoing.tickets], [[], []], 'projet hors de portée');
    });
  });

  describe('recherche générale', () => {
    it('trouve les notes par leur titre puis leur texte, sans accent ni casse, dans les seuls espaces accessibles', async () => {
      const spaceId = await newSpace('Recherche');
      await note(bob, spaceId, 'Déploiement', 'rien à voir');
      const inText = await note(bob, spaceId, 'Autre', 'Introduction\n\nLe DÉPLOIEMENT se fait la nuit par @[Bob](user:1).');
      const search = async (client: TestClient, q: string) => (await client.get(`/api/search?q=${encodeURIComponent(q)}`)).body as SearchResultDTO;
      const result = await search(bob, 'deploiement');
      assert.deepEqual(result.docs.items.map((entry) => entry.title), ['Déploiement', 'Autre'], 'le titre d’abord');
      assert.equal(result.docs.items[1]!.excerpt, 'Le DÉPLOIEMENT se fait la nuit par Bob.');
      assert.equal(result.docs.items[0]!.excerpt, '');
      assert.equal(result.docs.items[1]!.spaceName, 'Recherche');
      assert.equal((await search(vera, 'deploiement')).docs.total, 0, 'hors de l’espace');
      await bob.del(`/api/documentation/nodes/${inText.id}`);
      assert.equal((await search(bob, 'deploiement')).docs.total, 1, 'pas la corbeille');
      assert.equal(((await bob.get('/api/search?q=deploiement&type=tickets')).body as SearchResultDTO).docs.total, 0);
    });

    it('rattrape l’index des notes écrites avant lui', async () => {
      const spaceId = await newSpace('Index');
      const node = await note(bob, spaceId, 'Ancienne', 'Un texte retrouvable @[Cible](doc:123)');
      app.running.ctx.db.run('UPDATE doc_nodes SET search_text = NULL, links = NULL WHERE id = ?', node.id);
      reindexDocs(app.running.ctx);
      assert.equal(((await bob.get('/api/search?q=retrouvable')).body as SearchResultDTO).docs.total, 1);
      assert.equal(app.running.ctx.db.get<{ links: string }>('SELECT links FROM doc_nodes WHERE id = ?', node.id)?.links, JSON.stringify({ paths: [], docs: [123], tickets: [] }));
    });
  });

  describe('aperçu d’un ticket', () => {
    it('résume un ticket pour qui voit son projet', async () => {
      const project = (await bob.post('/api/projects', { name: 'Aperçu', key: 'APE' })).body.project as { id: number };
      const ticket = (await bob.post(`/api/projects/${project.id}/tickets`, { title: 'Un ticket', description: '**Important** : lire [ceci](a.md)' })).body.ticket as { id: number; number: number };
      const preview = (await bob.get(`/api/tickets/${ticket.id}/preview`)).body.preview as TicketPreviewDTO;
      assert.equal(preview.key, `APE-${ticket.number}`);
      assert.equal(preview.projectName, 'Aperçu');
      assert.equal(preview.excerpt, 'Important : lire ceci');
      assert.ok(preview.statusLabel);
      assert.equal((await vera.get(`/api/tickets/${ticket.id}/preview`)).status, 404, 'hors du projet');
    });
  });

  describe('collaboration en temps réel', () => {
    it('fusionne les écritures simultanées et les écrit sur le disque', async () => {
      const spaceId = await newSpace('Collaboration');
      await bob.post(`/api/documentation/spaces/${spaceId}/members`, { userId: ids.vera, role: 'editor' });
      const node = await note(bob, spaceId, 'partagé', 'Bonjour');
      const first = await joinRoom(bob, node.id);
      const second = await joinRoom(vera, node.id);
      assert.equal(first.text.toString(), 'Bonjour');
      assert.equal(second.text.toString(), 'Bonjour');
      assert.equal(first.sync.canWrite, true);

      // Écritures au même instant, chacun sur sa copie.
      first.text.insert(0, 'A ');
      second.text.insert(second.text.length, ' B');
      await until(() => first.text.toString() === 'A Bonjour B' && second.text.toString() === 'A Bonjour B');
      await until(() => fs.readFileSync(disk(spaceId, 'partagé.md'), 'utf8') === 'A Bonjour B');
      assert.equal(await contentOf(bob, node.id), 'A Bonjour B');

      // L'API passe par la salle : les personnes connectées voient le changement.
      await bob.request('PUT', `/api/documentation/nodes/${node.id}/content`, { content: 'A Bonjour B et API' });
      await until(() => first.text.toString() === 'A Bonjour B et API' && second.text.toString() === 'A Bonjour B et API');

      first.socket.close();
      second.socket.close();
      await until(async () => ((await bob.get(`/api/documentation/nodes/${node.id}/versions`)).body.versions as DocVersionDTO[]).length >= 2);
    });

    it('note les auteurs dans l’historique à la fin de l’édition', async () => {
      const spaceId = await newSpace('Auteurs');
      const node = await note(bob, spaceId, 'texte', '');
      const session = await joinRoom(bob, node.id);
      session.text.insert(0, 'écrit à plusieurs');
      await until(() => fs.readFileSync(disk(spaceId, 'texte.md'), 'utf8') === 'écrit à plusieurs');
      session.socket.close();
      await until(async () => ((await bob.get(`/api/documentation/nodes/${node.id}/versions`)).body.versions as DocVersionDTO[])[0]?.origin === 'edit');
      const [latest] = (await bob.get(`/api/documentation/nodes/${node.id}/versions`)).body.versions as DocVersionDTO[];
      assert.deepEqual(latest!.authors, ['bob']);
    });

    it('un lecteur suit en direct mais ne peut rien écrire', async () => {
      const spaceId = await newSpace('Lecture');
      await bob.post(`/api/documentation/spaces/${spaceId}/members`, { userId: ids.vera, role: 'reader' });
      const node = await note(bob, spaceId, 'public', 'texte');
      const writer = await joinRoom(bob, node.id);
      const reader = await joinRoom(vera, node.id);
      assert.equal(reader.sync.canWrite, false);

      writer.text.insert(0, 'nouveau ');
      await until(() => reader.text.toString() === 'nouveau texte');

      reader.text.insert(0, 'pirate ');
      await reader.socket.waitFor((message) => message.t === 'doc.closed');
      assert.equal(writer.text.toString(), 'nouveau texte', 'le serveur refuse l’écriture');
      writer.socket.close();
      reader.socket.close();
    });

    it('refuse l’accès sans droits, et coupe ceux qui les perdent', async () => {
      const spaceId = await newSpace('Accès');
      const node = await note(bob, spaceId, 'privé', 'secret');
      const outsider = await eve.connect();
      outsider.send({ t: 'doc.join', nodeId: node.id, stateVector: bytesToBase64(new Y.Doc().transact(() => Y.encodeStateVector(new Y.Doc()))) });
      assert.equal(((await outsider.waitFor((message) => message.t === 'doc.closed')) as { reason: string }).reason, 'revoked');
      assert.ok(!outsider.messages.some((message) => message.t === 'doc.sync'), 'aucun contenu envoyé');
      outsider.close();

      await bob.post(`/api/documentation/spaces/${spaceId}/members`, { userId: ids.vera, role: 'editor' });
      const session = await joinRoom(vera, node.id);
      session.socket.send({ t: 'docs.watch', spaceId });
      await bob.del(`/api/documentation/spaces/${spaceId}/members/${ids.vera}`);
      await session.socket.waitFor((message) => message.t === 'docs.revoked');
      session.text.insert(0, 'trop tard ');
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(await contentOf(bob, node.id), 'secret');
      session.socket.close();
    });

    it('prévient quand l’arbre change, et quand un fichier ouvert est supprimé', async () => {
      const spaceId = await newSpace('Arbre');
      const node = await note(bob, spaceId, 'ouverte', 'x');
      const session = await joinRoom(bob, node.id);
      session.socket.send({ t: 'docs.watch', spaceId });
      await new Promise((resolve) => setTimeout(resolve, 30));
      await note(bob, spaceId, 'autre');
      const tree = (await session.socket.waitFor((message) => message.t === 'docs.tree')) as { nodes: DocNodeDTO[] };
      assert.deepEqual(tree.nodes.map((entry) => entry.path), ['autre.md', 'ouverte.md']);
      await bob.del(`/api/documentation/nodes/${node.id}`);
      assert.equal(((await session.socket.waitFor((message) => message.t === 'doc.closed')) as { reason: string }).reason, 'deleted');
      session.socket.close();
    });

    it('un client revenu après une coupure se raccorde sans dupliquer le texte', async () => {
      const spaceId = await newSpace('Reprise');
      const node = await note(bob, spaceId, 'reprise', 'base');
      const session = await joinRoom(bob, node.id);
      session.text.insert(4, ' un');
      await until(() => fs.readFileSync(disk(spaceId, 'reprise.md'), 'utf8') === 'base un');
      session.socket.close();
      await until(() => app.running.ctx.docRooms.currentText(node.id) === null);

      // Hors ligne : le document local garde ses modifications, puis repart avec son vecteur d'état.
      session.text.insert(session.text.length, ' deux');
      const again = await bob.connect();
      const offline = Y.encodeStateAsUpdate(session.doc);
      again.send({ t: 'doc.join', nodeId: node.id, stateVector: bytesToBase64(Y.encodeStateVector(session.doc)) });
      await again.waitFor((message) => message.t === 'doc.sync');
      again.send({ t: 'doc.update', nodeId: node.id, update: bytesToBase64(offline) });
      await until(() => fs.readFileSync(disk(spaceId, 'reprise.md'), 'utf8') === 'base un deux');
      again.close();
    });
  });
});
