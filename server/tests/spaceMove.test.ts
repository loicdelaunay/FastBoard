import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import * as Y from 'yjs';
import { base64ToBytes, bytesToBase64, type DocNodeDTO } from '../../shared/docs.ts';
import type { BoardNodeDTO } from '../../shared/boards.ts';
import type { ServerMessage } from '../../shared/realtime.ts';
import { runRagIndex } from '../rag/index.ts';
import { startFakeProvider } from './fakeAi.ts';
import { bootServer, type SocketProbe, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/**
 * « Déplacer vers » un autre espace (documentation et tableaux blancs) : il faut être éditeur des deux côtés ; un
 * élément garde son identifiant, son contenu, son historique et ses commentaires ; il quitte aussitôt l'espace de départ
 * pour ceux qui n'ont pas accès à celui d'arrivée — API, recherche, édition ouverte, assistant IA et RAG compris.
 */
describe('déplacer vers un autre espace', () => {
  let app: Booted;
  let provider: Awaited<ReturnType<typeof startFakeProvider>>;
  const clients: Record<string, TestClient> = {};
  const ids: Record<string, number> = {};
  const sockets: SocketProbe[] = [];

  const ctx = () => app.running.ctx;
  const chat = (name: string, content: string) => clients[name]!.request('POST', '/api/ai/chat', { messages: [{ role: 'user', content }], context: {}, allowWrite: true });
  const toolOutput = () => JSON.parse(String(provider.chats.at(-1)!.messages.at(-1)!.content)) as Record<string, any>;
  const knowledge = async (name: string, query = 'procédure de sauvegarde nocturne') => {
    await chat(name, `outil:search_knowledge ${JSON.stringify({ query, limit: 20 })}`);
    return ((toolOutput().results ?? []) as Array<{ kind: string; id: number }>).map((hit) => `${hit.kind}:${hit.id}`);
  };
  const socketOf = async (name: string) => {
    const socket = await clients[name]!.connect();
    sockets.push(socket);
    return socket;
  };
  const tree = async (name: string, spaceId: number) => (await clients[name]!.get(`/api/documentation/spaces/${spaceId}`)).body.nodes as DocNodeDTO[];
  const boardTree = async (name: string, spaceId: number) => (await clients[name]!.get(`/api/boards/spaces/${spaceId}`)).body.nodes as BoardNodeDTO[];

  before(async () => {
    provider = await startFakeProvider();
    app = await bootServer();
    const admin = app.client();
    await admin.login('admin@admin.com', 'admin1234');
    const roles = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
    const member = roles.find((role) => role.scope === 'global' && role.key === 'member')!.id;
    // Olga possède les deux espaces ; Hana n'est que dans le premier ; Ivan n'est que dans le second.
    for (const name of ['olga', 'hana', 'ivan']) {
      ids[name] = (await admin.post('/api/admin/users', { email: `${name}@m.fr`, name, password: 'motdepasse1', roleId: member })).body.user.id;
      clients[name] = app.client();
      await clients[name]!.login(`${name}@m.fr`, 'motdepasse1');
    }
    await admin.request('PUT', '/api/admin/documentation', { enabled: true });
    await admin.request('PUT', '/api/admin/ai', {
      enabled: true,
      maxSteps: 6,
      maxTurns: 10,
      providers: [{ name: 'Test', baseUrl: provider.url, timeoutSeconds: 30, models: [{ id: 'modele-test', vision: false, contextWindow: 128000, reasoning: false }] }],
      defaultModel: 'new0:modele-test',
    });
    await admin.request('PUT', '/api/admin/rag', { enabled: true, baseUrl: provider.url, model: 'embeddinggemma', format: 'auto', intervalHours: 6 });

    const olga = clients.olga!;
    ids.from = (await olga.post('/api/documentation/spaces', { name: 'Équipe' })).body.space.id;
    ids.to = (await olga.post('/api/documentation/spaces', { name: 'Archives' })).body.space.id;
    await olga.post(`/api/documentation/spaces/${ids.from}/members`, { userId: ids.hana, role: 'editor' });
    await olga.post(`/api/documentation/spaces/${ids.to}/members`, { userId: ids.ivan, role: 'reader' });
    ids.note = (await olga.post(`/api/documentation/spaces/${ids.from}/nodes`, { path: 'Guides/Sauvegarde', content: '# Sauvegarde\n\nLa procédure de sauvegarde nocturne démarre à 2 h.' })).body.node.id;
    await olga.request('PUT', `/api/documentation/nodes/${ids.note}/content`, { content: '# Sauvegarde\n\nLa procédure de sauvegarde nocturne démarre à 3 h.' });
    ids.image = (await olga.raw('POST', `/api/documentation/spaces/${ids.from}/images?folder=Guides`, PNG, { 'Content-Type': 'image/png', 'X-File-Name': 'schema.png' })).json.node.id;
    ids.memo = (await olga.post(`/api/documentation/spaces/${ids.from}/nodes`, { path: 'Mémo', content: 'Mémo de l’équipe.' })).body.node.id;
    ids.template = (await olga.post(`/api/documentation/spaces/${ids.from}/nodes`, { path: 'Compte rendu', kind: 'template', content: '# {{title}}' })).body.node.id;
    // À l'arrivée, un « Mémo » existe déjà : celui qui arrive s'appellera « Mémo (2) ».
    await olga.post(`/api/documentation/spaces/${ids.to}/nodes`, { path: 'Mémo', content: 'Déjà là.' });
    ids.comment = (await olga.post(`/api/documentation/nodes/${ids.note}/comments`, { body: 'À vérifier', quote: 'sauvegarde nocturne' })).body.comment.id;
    for (const spaceId of [ids.from, ids.to]) await olga.patch(`/api/documentation/spaces/${spaceId}`, { rag: true });
    await runRagIndex(ctx());
  });

  after(async () => {
    for (const socket of sockets) socket.close();
    await app.running.close();
    await provider.close();
  });

  it('documentation : éditeur des deux espaces requis, et rien d’autre n’est accepté', async () => {
    const move = (name: string, body: Record<string, unknown>) => clients[name]!.post('/api/documentation/nodes/move', body);
    assert.equal((await move('hana', { nodeIds: [ids.note], spaceId: ids.to })).status, 404, 'Hana ne voit pas l’espace d’arrivée');
    assert.equal((await move('ivan', { nodeIds: [ids.note], spaceId: ids.to })).status, 404, 'Ivan ne voit pas l’espace de départ');
    await clients.olga!.post(`/api/documentation/spaces/${ids.to}/members`, { userId: ids.hana, role: 'reader' });
    assert.equal((await move('hana', { nodeIds: [ids.note], spaceId: ids.to })).status, 403, 'lectrice à l’arrivée');
    await clients.olga!.del(`/api/documentation/spaces/${ids.to}/members/${ids.hana}`);
    assert.equal((await move('olga', { nodeIds: [ids.note], spaceId: ids.from })).status, 400, 'même espace');
    assert.equal((await move('olga', { nodeIds: [], spaceId: ids.to })).status, 400);
    const other = (await clients.olga!.post(`/api/documentation/spaces/${ids.to}/nodes`, { path: 'Ailleurs', content: 'x' })).body.node.id;
    assert.equal((await move('olga', { nodeIds: [ids.note, other], spaceId: ids.to })).status, 400, 'deux espaces de départ');
    assert.equal((await move('olga', { nodeIds: [ids.note], spaceId: ids.to, folder: '../x' })).status, 400, 'dossier invalide');
    assert.ok((await tree('olga', ids.from)).some((node) => node.id === ids.note), 'rien n’a bougé');
  });

  it('documentation : le dossier part avec son contenu, ses versions, ses commentaires, et ferme l’édition en cours', async () => {
    assert.ok((await knowledge('hana')).includes(`doc:${ids.note}`), 'avant : Hana la trouve par le RAG');
    const folderId = (await tree('olga', ids.from)).find((node) => node.path === 'Guides')!.id;
    const versionsBefore = (await clients.olga!.get(`/api/documentation/nodes/${ids.note}/versions`)).body.versions.length as number;

    // Hana a la note ouverte ; Ivan regarde l'arbre de l'espace d'arrivée.
    const hanaSocket = await socketOf('hana');
    const doc = new Y.Doc();
    hanaSocket.ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as ServerMessage;
      if ((message.t === 'doc.sync' || message.t === 'doc.update') && message.nodeId === ids.note) Y.applyUpdate(doc, base64ToBytes(message.update), 'remote');
    });
    hanaSocket.send({ t: 'docs.watch', spaceId: ids.from });
    hanaSocket.send({ t: 'doc.join', nodeId: ids.note, stateVector: bytesToBase64(Y.encodeStateVector(doc)) });
    await hanaSocket.waitFor((message) => message.t === 'doc.sync' && message.nodeId === ids.note);
    doc.getText('content').insert(doc.getText('content').length, '\n\nAjout de Hana.');
    hanaSocket.send({ t: 'doc.update', nodeId: ids.note, update: bytesToBase64(Y.encodeStateAsUpdate(doc)) });
    await hanaSocket.waitFor((message) => message.t === 'doc.update' || message.t === 'doc.saved', 500).catch(() => undefined);
    const ivanSocket = await socketOf('ivan');
    ivanSocket.send({ t: 'docs.watch', spaceId: ids.to });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const moved = await clients.olga!.post('/api/documentation/nodes/move', { nodeIds: [folderId, ids.note, ids.memo, ids.template], spaceId: ids.to, folder: 'Rangement/2026' });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    const roots = moved.body.nodes as DocNodeDTO[];
    assert.deepEqual(roots.map((node) => [node.id, node.spaceId, node.path]), [
      [folderId, ids.to, 'Rangement/2026/Guides'],
      [ids.memo, ids.to, 'Rangement/2026/Mémo.md'],
      [ids.template, ids.to, 'Compte rendu.md'],
    ], 'la note du dossier n’est pas comptée deux fois ; un modèle reste parmi les modèles');

    // Hana est sortie de la note avec la raison « déplacée » ; ce qu'elle avait écrit est gardé.
    const closed = (await hanaSocket.waitFor((message) => message.t === 'doc.closed' && message.nodeId === ids.note)) as Extract<ServerMessage, { t: 'doc.closed' }>;
    assert.equal(closed.reason, 'moved');
    assert.equal(closed.spaceId, ids.to);
    const fromTree = (await hanaSocket.waitFor((message) => message.t === 'docs.tree' && message.spaceId === ids.from && !message.nodes.some((node) => node.id === ids.note))) as Extract<ServerMessage, { t: 'docs.tree' }>;
    assert.ok(!fromTree.nodes.some((node) => node.id === ids.image || node.id === folderId));
    await ivanSocket.waitFor((message) => message.t === 'docs.tree' && message.spaceId === ids.to && message.nodes.some((node) => node.id === ids.note));
    doc.getText('content').insert(0, 'Trop tard. ');
    hanaSocket.send({ t: 'doc.update', nodeId: ids.note, update: bytesToBase64(Y.encodeStateAsUpdate(doc)) });

    // À l'arrivée : même identifiant, contenu (avec l'ajout de Hana), image, versions et commentaires.
    const target = await tree('olga', ids.to);
    const paths = new Map(target.map((node) => [node.id, node.path]));
    assert.equal(paths.get(ids.note), 'Rangement/2026/Guides/Sauvegarde.md');
    assert.ok(String(paths.get(ids.image)).startsWith('Rangement/2026/Guides/'));
    assert.ok(target.some((node) => node.path === 'Mémo.md') && target.some((node) => node.path === 'Rangement' && node.kind === 'folder'));
    const note = (await clients.olga!.get(`/api/documentation/nodes/${ids.note}`)).body;
    assert.match(note.content, /3 h\.\n\nAjout de Hana\./);
    assert.ok(!String(note.content).includes('Trop tard'), 'l’ancienne salle n’écrit plus');
    const raw = await clients.olga!.raw('GET', `/api/documentation/nodes/${ids.image}/raw`);
    assert.equal(raw.status, 200);
    assert.deepEqual(raw.bytes, PNG);
    assert.ok((await clients.olga!.get(`/api/documentation/nodes/${ids.note}/versions`)).body.versions.length >= versionsBefore);
    assert.ok(((await clients.olga!.get(`/api/documentation/nodes/${ids.note}/comments`)).body.comments as Array<{ id: number }>).some((comment) => comment.id === ids.comment));
    assert.ok(((await clients.olga!.get(`/api/documentation/spaces/${ids.to}`)).body.templates as DocNodeDTO[]).some((node) => node.id === ids.template));

    // Hana (pas dans « Archives ») n'y a plus accès, par aucun chemin ; Ivan (lecteur d'« Archives ») y accède.
    assert.ok(!(await tree('hana', ids.from)).some((node) => node.id === ids.note || node.id === ids.memo));
    assert.equal((await clients.hana!.get(`/api/documentation/nodes/${ids.note}`)).status, 404);
    assert.equal((await clients.hana!.get(`/api/documentation/nodes/${ids.image}/raw`)).status, 404);
    assert.equal(((await clients.hana!.get('/api/documentation/search?q=Sauvegarde')).body.files as unknown[]).length, 0);
    assert.equal((await clients.ivan!.get(`/api/documentation/nodes/${ids.note}`)).status, 200);
    await chat('hana', `outil:read_doc ${JSON.stringify({ note: ids.note })}`);
    assert.ok(toolOutput().error, 'l’assistant ne la lit plus pour Hana');

    // RAG : dès le déplacement, plus rien pour Hana ; après l'indexation, Ivan la trouve dans « Archives ».
    assert.ok(!(await knowledge('hana')).includes(`doc:${ids.note}`), 'aussitôt sortie de l’index de l’ancien espace');
    await runRagIndex(ctx());
    assert.ok(!(await knowledge('hana')).includes(`doc:${ids.note}`));
    assert.ok((await knowledge('ivan')).includes(`doc:${ids.note}`), 'réindexée là où elle est');
  });

  it('tableaux blancs : le tableau garde son contenu et son partage, ses images sont copiées, l’accès suit l’espace', async () => {
    const olga = clients.olga!;
    const from = (await olga.post('/api/boards/spaces', { name: 'Ateliers' })).body.space.id as number;
    const to = (await olga.post('/api/boards/spaces', { name: 'Clos' })).body.space.id as number;
    await olga.post(`/api/boards/spaces/${from}/members`, { userId: ids.hana, role: 'editor' });
    await olga.post(`/api/boards/spaces/${to}/members`, { userId: ids.ivan, role: 'editor' });
    const asset = (await olga.raw('POST', `/api/boards/spaces/${from}/assets`, PNG, { 'Content-Type': 'image/png', 'X-File-Name': 'logo.png', 'X-Requested-With': 'fetch' })).json.asset as { key: string };
    const template = (await olga.post(`/api/boards/spaces/${from}/nodes`, { path: 'Carte', kind: 'template', elements: [{ id: 'modele00001', type: 'shape', shape: 'rect', x: 0, y: 0, w: 100, h: 50, z: 1, text: 'Carte', color: 'blue', fill: 'tint' }] })).body.node.id as number;
    const elements = [
      { id: 'image000001', type: 'image', x: 0, y: 0, w: 64, h: 64, z: 1, asset: asset.key, name: 'logo.png' },
      { id: 'carte000001', type: 'shape', shape: 'rect', x: 100, y: 0, w: 100, h: 50, z: 2, text: 'Procédure de sauvegarde nocturne', color: 'blue', fill: 'tint', tpl: { id: template, inst: 'inst0001', key: 'modele00001', v: 'v1' } },
    ];
    const board = (await olga.post(`/api/boards/spaces/${from}/nodes`, { path: 'Plans/Flux', elements })).body.node.id as number;
    const folder = (await boardTree('olga', from)).find((node) => node.path === 'Plans')!.id;
    await olga.request('PUT', `/api/boards/nodes/${board}/share`, { audience: 'users', role: 'reader' });

    const hanaSocket = await socketOf('hana');
    hanaSocket.send({ t: 'boards.watch', spaceId: from });
    hanaSocket.send({ t: 'board.join', boardId: board, stateVector: bytesToBase64(Y.encodeStateVector(new Y.Doc())) });
    await hanaSocket.waitFor((message) => message.t === 'board.sync' && message.boardId === board);

    assert.equal((await clients.hana!.post('/api/boards/nodes/move', { nodeIds: [folder], spaceId: to })).status, 404, 'Hana ne voit pas l’espace d’arrivée');
    const moved = await olga.post('/api/boards/nodes/move', { nodeIds: [folder], spaceId: to });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.deepEqual((moved.body.nodes as BoardNodeDTO[]).map((node) => [node.id, node.spaceId, node.path]), [[folder, to, 'Plans']]);
    const closed = (await hanaSocket.waitFor((message) => message.t === 'board.closed' && message.boardId === board)) as Extract<ServerMessage, { t: 'board.closed' }>;
    assert.equal(closed.reason, 'moved');
    assert.equal(closed.spaceId, to);
    await hanaSocket.waitFor((message) => message.t === 'boards.tree' && message.spaceId === from && !message.nodes.some((node) => node.id === board));

    const read = (await olga.get(`/api/boards/nodes/${board}`)).body;
    assert.equal(read.node.path, 'Plans/Flux');
    assert.equal(read.space.id, to);
    assert.equal(read.node.share, 'users', 'le partage suit le tableau');
    const image = read.elements.find((element: { id: string }) => element.id === 'image000001');
    assert.notEqual(image.asset, asset.key, 'l’image est copiée dans le nouvel espace');
    assert.ok(((await olga.get(`/api/boards/spaces/${to}/assets`)).body.assets as Array<{ key: string }>).some((entry) => entry.key === image.asset));
    assert.equal((await olga.raw('GET', `/api/board-assets/${image.asset}`)).status, 200);
    assert.equal(read.elements.find((element: { id: string }) => element.id === 'carte000001').tpl, undefined, 'le lien vers un modèle resté dans l’ancien espace est retiré');
    assert.ok(((await olga.get(`/api/boards/nodes/${board}/versions`)).body.versions as unknown[]).length >= 1);

    assert.equal((await clients.hana!.get(`/api/boards/nodes/${board}`)).status, 404, 'Hana n’y a plus accès');
    assert.ok(!(await boardTree('hana', from)).some((node) => node.id === board || node.id === folder));
    assert.equal((await clients.ivan!.get(`/api/boards/nodes/${board}`)).status, 200);
    assert.equal((await clients.ivan!.request('PUT', `/api/boards/nodes/${board}/elements`, { elements: read.elements })).status, 200, 'éditeur à l’arrivée');
  });
});
