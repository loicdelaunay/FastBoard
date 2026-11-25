import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import * as Y from 'yjs';
import { base64ToBytes, bytesToBase64 } from '../../shared/docs.ts';
import type { ServerMessage } from '../../shared/realtime.ts';
import { runRagIndex } from '../rag/index.ts';
import { startFakeProvider } from './fakeAi.ts';
import { bootServer, type SocketProbe, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

/**
 * Groupes de personnes : un groupe ajouté à un projet ou à un espace donne son rôle à ses membres ; un rôle direct s'y
 * ajoute (le plus large l'emporte, comme dans Google Drive). L'essentiel est vérifié ici : ajouter ou retirer quelqu'un
 * d'un groupe change ses droits aussitôt, partout — API, listes, recherche, temps réel (pages et éditions ouvertes),
 * assistant IA, recherche sémantique (RAG) et jetons d'API — sans rien ouvrir de plus que ce que le groupe donne.
 */
describe('groupes de personnes', () => {
  let app: Booted;
  let provider: Awaited<ReturnType<typeof startFakeProvider>>;
  let admin: TestClient;
  const clients: Record<string, TestClient> = {};
  const ids: Record<string, number> = {};
  const roles: Record<string, number> = {};
  const sockets: SocketProbe[] = [];

  const ctx = () => app.running.ctx;
  const join = (name: string, groupId = ids.group!, role?: string) => clients.olga!.put(`/api/groups/${groupId}/members/${ids[name]}`, role ? { role } : {});
  const leave = (name: string, groupId = ids.group!) => clients.olga!.del(`/api/groups/${groupId}/members/${ids[name]}`);
  const projectStatus = async (name: string, projectId = ids.project!) => (await clients[name]!.get(`/api/projects/${projectId}`)).status;
  const permissionsOf = async (name: string, projectId = ids.project!) => (await clients[name]!.get(`/api/projects/${projectId}`)).body.permissions as string[];
  const projectList = async (name: string) => ((await clients[name]!.get('/api/projects')).body.projects as Array<{ id: number }>).map((project) => project.id);
  const searchTickets = async (name: string, q: string) => ((await clients[name]!.get(`/api/search?q=${encodeURIComponent(q)}`)).body.tickets.items as Array<{ id: number }>).map((hit) => hit.id);
  const chat = (name: string, content: string) => clients[name]!.request('POST', '/api/ai/chat', { messages: [{ role: 'user', content }], context: {}, allowWrite: true });
  /** Sortie du dernier outil appelé par l'assistant (le faux fournisseur la recopie). */
  const toolOutput = () => JSON.parse(String(provider.chats.at(-1)!.messages.at(-1)!.content)) as Record<string, any>;
  const knowledge = async (name: string, query = 'facturation électronique trimestrielle') => {
    await chat(name, `outil:search_knowledge ${JSON.stringify({ query, limit: 20 })}`);
    return ((toolOutput().results ?? []) as Array<{ kind: string; id: number }>).map((hit) => `${hit.kind}:${hit.id}`);
  };
  const socketOf = async (name: string) => {
    const socket = await clients[name]!.connect();
    sockets.push(socket);
    return socket;
  };

  before(async () => {
    provider = await startFakeProvider();
    app = await bootServer();
    admin = app.client();
    await admin.login('admin@admin.com', 'admin1234');
    const list = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
    for (const role of list) roles[`${role.scope}:${role.key}`] = role.id;
    // Olga partage ; Gus et Hana sont dans son groupe ; Ivan n'y est pas ; Zed est invité (ne crée pas de groupe).
    for (const [name, role] of [['olga', 'member'], ['gus', 'member'], ['hana', 'member'], ['ivan', 'member'], ['zed', 'guest']] as const) {
      ids[name] = (await admin.post('/api/admin/users', { email: `${name}@g.fr`, name, password: 'motdepasse1', roleId: roles[`global:${role}`] })).body.user.id;
      clients[name] = app.client();
      await clients[name]!.login(`${name}@g.fr`, 'motdepasse1');
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
    ids.project = (await olga.post('/api/projects', { name: 'Facturation', key: 'FAC' })).body.project.id;
    ids.ticket = (await olga.post(`/api/projects/${ids.project}/tickets`, { title: 'Facturation électronique trimestrielle', description: 'Émettre la facturation électronique trimestrielle des clients.' })).body.ticket.id;
    // Un autre projet d'Olga, jamais partagé avec le groupe : il ne doit jamais fuiter.
    ids.private = (await olga.post('/api/projects', { name: 'Paie', key: 'PAI' })).body.project.id;
    ids.privateTicket = (await olga.post(`/api/projects/${ids.private}/tickets`, { title: 'Facturation électronique trimestrielle confidentielle', description: 'Facturation électronique trimestrielle des salaires.' })).body.ticket.id;
    ids.space = (await olga.post('/api/documentation/spaces', { name: 'Procédures' })).body.space.id;
    ids.note = (await olga.post(`/api/documentation/spaces/${ids.space}/nodes`, { path: 'Facturation', content: '# Facturation\n\nLa facturation électronique trimestrielle part le premier lundi.' })).body.node.id;
    ids.privateSpace = (await olga.post('/api/documentation/spaces', { name: 'Direction' })).body.space.id;
    ids.privateNote = (await olga.post(`/api/documentation/spaces/${ids.privateSpace}/nodes`, { path: 'Secret', content: 'Facturation électronique trimestrielle : marges confidentielles.' })).body.node.id;
    ids.boards = (await olga.post('/api/boards/spaces', { name: 'Schémas' })).body.space.id;
    ids.board = (await olga.post(`/api/boards/spaces/${ids.boards}/nodes`, { path: 'Flux', elements: [{ id: 'facture00001', type: 'shape', shape: 'rect', x: 0, y: 0, w: 200, h: 80, z: 1, text: 'Facturation électronique trimestrielle', color: 'blue', fill: 'tint' }] })).body.node.id;
    for (const path of [`/api/projects/${ids.project}`, `/api/projects/${ids.private}`]) await olga.patch(path, { rag: true });
    for (const path of [`/api/documentation/spaces/${ids.space}`, `/api/documentation/spaces/${ids.privateSpace}`, `/api/boards/spaces/${ids.boards}`]) await olga.patch(path, { rag: true });
    await runRagIndex(ctx());
  });

  after(async () => {
    for (const socket of sockets) socket.close();
    await app.running.close();
    await provider.close();
  });

  it('se crée par qui en a le droit, et seuls ses gestionnaires le modifient', async () => {
    assert.equal((await clients.zed!.post('/api/groups', { name: 'Invités' })).status, 403, 'un invité ne crée pas de groupe');
    const created = await clients.olga!.post('/api/groups', { name: 'Comptabilité', memberIds: [ids.gus] });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    ids.group = created.body.group.id;
    assert.deepEqual(created.body.group.members.map((member: { userId: number; role: string }) => [member.userId, member.role]), [[ids.olga, 'manager'], [ids.gus, 'member']]);
    assert.equal(created.body.group.canManage, true);

    const seen = (await clients.ivan!.get('/api/groups')).body.groups as Array<{ id: number; canManage: boolean }>;
    assert.equal(seen.find((group) => group.id === ids.group)?.canManage, false, 'tout le monde voit les groupes, sans les gérer');
    assert.equal((await clients.ivan!.patch(`/api/groups/${ids.group}`, { name: 'Pirates' })).status, 403);
    assert.equal((await clients.gus!.patch(`/api/groups/${ids.group}`, { name: 'Pirates' })).status, 403, 'un simple membre ne le gère pas');
    assert.equal((await clients.gus!.put(`/api/groups/${ids.group}/members/${ids.ivan}`, {})).status, 403, 'ni n’y ajoute personne');
    assert.equal((await clients.olga!.post('/api/groups', { name: 'comptabilité' })).status, 409, 'noms uniques, sans tenir compte de la casse');
    assert.equal((await clients.olga!.patch(`/api/groups/${ids.group}`, { name: 'Compta', color: '#14b8a6' })).body.group.name, 'Compta');
    assert.equal((await clients.olga!.put(`/api/groups/${ids.group}/members/${ids.olga}`, { role: 'member' })).status, 409, 'le dernier gestionnaire reste gestionnaire');
    assert.equal((await clients.olga!.del(`/api/groups/${ids.group}/members/${ids.olga}`)).status, 409, '…et ne part pas tant qu’il reste du monde');
    // L'administrateur (groups.manage) gère tous les groupes.
    assert.equal((await admin.patch(`/api/groups/${ids.group}`, { description: 'Équipe comptable' })).status, 200);
  });

  it('donne accès au projet avec le rôle du groupe, et un rôle direct s’y ajoute, comme dans Google Drive', async () => {
    assert.equal(await projectStatus('gus'), 404, 'avant : rien');
    const granted = await clients.olga!.put(`/api/projects/${ids.project}/groups/${ids.group}`, { roleId: roles['project:viewer'] });
    assert.equal(granted.status, 200, JSON.stringify(granted.body));
    assert.deepEqual(granted.body.groups.map((group: { groupId: number; memberIds: number[] }) => [group.groupId, group.memberIds]), [[ids.group, [ids.olga, ids.gus]]]);
    assert.equal((await clients.olga!.put(`/api/projects/${ids.project}/groups/${ids.group}`, { roleId: roles['project:owner'] })).status, 400, 'un groupe n’est jamais propriétaire');

    assert.equal(await projectStatus('gus'), 200, 'le groupe ouvre le projet');
    assert.deepEqual(await permissionsOf('gus'), ['ai.read'], 'avec les seuls droits du rôle du groupe');
    assert.ok((await projectList('gus')).includes(ids.project));
    assert.equal((await clients.gus!.patch(`/api/tickets/${ids.ticket}`, { title: 'Facturation électronique trimestrielle (v2)' })).status, 403, 'lecteur : pas de modification');
    assert.equal(await projectStatus('ivan'), 404, 'hors du groupe : rien');
    assert.equal(await projectStatus('gus', ids.private), 404, 'l’autre projet d’Olga reste fermé');

    // Gus reçoit en plus un rôle direct d'éditeur : ses permissions s'additionnent.
    await clients.olga!.post(`/api/projects/${ids.project}/members`, { userId: ids.gus, roleId: roles['project:editor'] });
    const permissions = await permissionsOf('gus');
    assert.ok(permissions.includes('ticket.edit') && permissions.includes('ai.read'));
    assert.equal((await clients.gus!.patch(`/api/tickets/${ids.ticket}`, { title: 'Facturation électronique trimestrielle' })).status, 200);

    const snapshot = (await clients.olga!.get(`/api/projects/${ids.project}`)).body;
    assert.deepEqual(snapshot.members.map((member: { userId: number }) => member.userId).sort(), [ids.olga, ids.gus].sort(), 'membres directs');
    assert.equal(snapshot.groups.length, 1);
    // Une personne du groupe est une personne du projet : on peut l'assigner (Ivan, non).
    assert.equal((await clients.olga!.patch(`/api/tickets/${ids.ticket}`, { assigneeIds: [ids.ivan] })).status, 400);
  });

  it('ajouter quelqu’un au groupe lui ouvre aussitôt le projet ; l’en retirer le lui reprend, même page ouverte', async () => {
    const hana = await socketOf('hana');
    assert.equal(await projectStatus('hana'), 404);
    assert.deepEqual(await searchTickets('hana', 'Facturation'), []);

    assert.equal((await join('hana')).status, 200);
    await hana.waitFor((message) => message.t === 'projects.refresh');
    assert.equal(await projectStatus('hana'), 200);
    assert.ok((await projectList('hana')).includes(ids.project));
    assert.deepEqual(await searchTickets('hana', 'Facturation'), [ids.ticket], 'la recherche suit, sans l’autre projet');
    const snapshot = (await clients.olga!.get(`/api/projects/${ids.project}`)).body;
    assert.ok(snapshot.users.some((user: { id: number }) => user.id === ids.hana), 'Hana fait partie des personnes du projet');
    assert.equal((await clients.olga!.patch(`/api/tickets/${ids.ticket}`, { assigneeIds: [ids.hana] })).status, 200, 'et peut être assignée');

    // Hana ouvre le projet (abonnement en temps réel), puis Olga la retire du groupe.
    hana.send({ t: 'subscribe', projectId: ids.project });
    await hana.waitFor((message) => message.t === 'subscribed' && message.projectId === ids.project);
    const olga = await socketOf('olga');
    olga.send({ t: 'subscribe', projectId: ids.project });
    await olga.waitFor((message) => message.t === 'subscribed');
    const since = olga.messages.length;
    assert.equal((await leave('hana')).status, 200);
    await hana.waitFor((message) => message.t === 'project.revoked' && message.projectId === ids.project);
    const changed = (await olga.waitFor((message, index = olga.messages.indexOf(message)) => index >= since && message.t === 'event' && message.event.type === 'members.changed')) as Extract<ServerMessage, { t: 'event' }>;
    assert.ok(changed.event.type === 'members.changed' && !changed.event.users.some((user) => user.id === ids.hana), 'les autres voient la liste des personnes à jour');
    assert.equal(await projectStatus('hana'), 404);
    assert.ok(!(await projectList('hana')).includes(ids.project));
    assert.deepEqual(await searchTickets('hana', 'Facturation'), []);
    hana.send({ t: 'subscribe', projectId: ids.project });
    await hana.waitFor((message, index = hana.messages.indexOf(message)) => message.t === 'project.revoked' && index > 0);
    assert.equal((await clients.hana!.patch(`/api/tickets/${ids.ticket}`, { title: 'Intrusion' })).status, 404);

    // Gus garde son rôle direct quand le groupe perd son accès au projet.
    assert.equal((await clients.olga!.del(`/api/projects/${ids.project}/groups/${ids.group}`)).status, 200);
    assert.ok((await permissionsOf('gus')).includes('ticket.edit'));
    await join('hana');
    assert.equal(await projectStatus('hana'), 404, 'le groupe n’a plus accès au projet : Hana non plus');
    await clients.olga!.put(`/api/projects/${ids.project}/groups/${ids.group}`, { roleId: roles['project:viewer'] });
    assert.equal(await projectStatus('hana'), 200);
  });

  it('documentation : le groupe donne son rôle, abaissé ou retiré il s’applique aussitôt, même en pleine écriture', async () => {
    const path = `/api/documentation/spaces/${ids.space}`;
    assert.equal((await clients.hana!.get(path)).status, 404);
    assert.equal((await clients.olga!.put(`${path}/groups/${ids.group}`, { role: 'owner' })).status, 400, 'un groupe n’est pas propriétaire');
    assert.equal((await clients.hana!.put(`${path}/groups/${ids.group}`, { role: 'editor' })).status, 404, 'seule la propriétaire partage');
    const granted = await clients.olga!.put(`${path}/groups/${ids.group}`, { role: 'editor' });
    assert.equal(granted.status, 200, JSON.stringify(granted.body));
    const space = (await clients.hana!.get(path)).body;
    assert.equal(space.space.role, 'editor');
    assert.equal(space.groups[0].groupId, ids.group);
    assert.ok(((await clients.hana!.get('/api/documentation/spaces')).body.spaces as Array<{ id: number }>).some((entry) => entry.id === ids.space));
    assert.equal((await clients.hana!.get(`/api/documentation/spaces/${ids.privateSpace}`)).status, 404, 'l’autre espace reste fermé');
    assert.equal((await clients.hana!.request('PUT', `/api/documentation/nodes/${ids.note}/content`, { content: '# Facturation\n\nÉdité par Hana.' })).status, 200);

    // Hana ouvre la note en direct, puis le groupe redevient lecteur : son écriture suivante est refusée.
    const socket = await socketOf('hana');
    const doc = new Y.Doc();
    socket.ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as ServerMessage;
      if ((message.t === 'doc.sync' || message.t === 'doc.update') && message.nodeId === ids.note) Y.applyUpdate(doc, base64ToBytes(message.update), 'remote');
    });
    socket.send({ t: 'docs.watch', spaceId: ids.space });
    socket.send({ t: 'doc.join', nodeId: ids.note, stateVector: bytesToBase64(Y.encodeStateVector(doc)) });
    const sync = (await socket.waitFor((message) => message.t === 'doc.sync' && message.nodeId === ids.note)) as Extract<ServerMessage, { t: 'doc.sync' }>;
    assert.equal(sync.canWrite, true);
    await clients.olga!.put(`${path}/groups/${ids.group}`, { role: 'reader' });
    await socket.waitFor((message) => message.t === 'docs.access' && message.spaceId === ids.space);
    doc.getText('content').insert(0, 'Interdit. ');
    socket.send({ t: 'doc.update', nodeId: ids.note, update: bytesToBase64(Y.encodeStateAsUpdate(doc)) });
    await socket.waitFor((message) => message.t === 'doc.closed' && message.nodeId === ids.note);
    assert.ok(!String((await clients.olga!.get(`/api/documentation/nodes/${ids.note}`)).body.content).includes('Interdit'), 'rien n’est écrit');
    assert.equal((await clients.hana!.request('PUT', `/api/documentation/nodes/${ids.note}/content`, { content: 'non' })).status, 403);
    assert.equal((await clients.hana!.get(path)).body.space.role, 'reader');

    // Un rôle direct plus large l'emporte ; retirée du groupe, Hana garde seulement lui.
    await clients.olga!.post(`${path}/members`, { userId: ids.gus, role: 'editor' });
    assert.equal((await clients.gus!.get(path)).body.space.role, 'editor', 'éditeur direct, lecteur par le groupe');
    await leave('hana');
    await socket.waitFor((message) => message.t === 'docs.revoked' && message.spaceId === ids.space);
    assert.equal((await clients.hana!.get(path)).status, 404);
    assert.equal((await clients.hana!.get(`/api/documentation/nodes/${ids.note}`)).status, 404);
    assert.ok(!((await clients.hana!.get('/api/documentation/spaces')).body.spaces as Array<{ id: number }>).some((entry) => entry.id === ids.space));
    await join('hana');
  });

  it('tableaux blancs : même chose, lecture seule comprise', async () => {
    const path = `/api/boards/spaces/${ids.boards}`;
    const elements = [{ id: 'facture00001', type: 'shape', shape: 'rect', x: 0, y: 0, w: 200, h: 80, z: 1, text: 'Modifié', color: 'blue', fill: 'tint' }];
    assert.equal((await clients.hana!.get(path)).status, 404);
    assert.equal((await clients.olga!.put(`${path}/groups/${ids.group}`, { role: 'reader' })).status, 200);
    assert.equal((await clients.hana!.get(path)).body.role, 'reader');
    assert.equal((await clients.hana!.get(`/api/boards/nodes/${ids.board}`)).status, 200);
    assert.equal((await clients.hana!.request('PUT', `/api/boards/nodes/${ids.board}/elements`, { elements })).status, 403, 'lecteur');
    await clients.olga!.put(`${path}/groups/${ids.group}`, { role: 'editor' });
    assert.equal((await clients.hana!.request('PUT', `/api/boards/nodes/${ids.board}/elements`, { elements })).status, 200, 'éditeur');
    await clients.olga!.request('PUT', `/api/boards/nodes/${ids.board}/elements`, { elements: [{ ...elements[0], text: 'Facturation électronique trimestrielle' }] });

    const socket = await socketOf('hana');
    socket.send({ t: 'boards.watch', spaceId: ids.boards });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await leave('hana');
    await socket.waitFor((message) => message.t === 'boards.revoked' && message.spaceId === ids.boards);
    assert.equal((await clients.hana!.get(path)).status, 404);
    assert.equal((await clients.hana!.get(`/api/boards/nodes/${ids.board}`)).status, 404);
    await join('hana');
    assert.equal((await clients.hana!.get(path)).body.role, 'editor');
  });

  it('l’assistant IA et la recherche sémantique (RAG) suivent les groupes, sans rien ouvrir de plus', async () => {
    await runRagIndex(ctx());
    // Hana : le projet (lecteur), l'espace de documentation (lecteur) et l'espace de tableaux (éditeur) par le groupe.
    const found = await knowledge('hana');
    assert.ok(found.includes(`ticket:${ids.ticket}`), JSON.stringify(found));
    assert.ok(found.includes(`doc:${ids.note}`));
    assert.ok(found.includes(`board:${ids.board}`));
    assert.ok(!found.includes(`ticket:${ids.privateTicket}`) && !found.includes(`doc:${ids.privateNote}`), 'jamais les projets et espaces hors du groupe');
    assert.deepEqual(await knowledge('ivan'), [], 'hors du groupe : rien');

    await chat('hana', `outil:get_ticket ${JSON.stringify({ ticket: ids.ticket })}`);
    assert.equal(toolOutput().id ?? toolOutput().ticket?.id, ids.ticket, JSON.stringify(toolOutput()));
    await chat('hana', `outil:get_ticket ${JSON.stringify({ ticket: ids.privateTicket })}`);
    assert.ok(toolOutput().error, 'l’assistant ne lit pas un ticket hors du groupe');
    await chat('hana', 'outil:list_projects {}');
    assert.deepEqual((toolOutput() as unknown as Array<{ id: number }>).map((project) => project.id), [ids.project]);
    await chat('hana', `outil:update_ticket ${JSON.stringify({ ticket: ids.ticket, title: 'Par l’IA' })}`);
    assert.ok(toolOutput().error, 'lecteur par le groupe : l’assistant n’écrit pas pour elle');
    await chat('hana', `outil:read_doc ${JSON.stringify({ note: ids.privateNote })}`);
    assert.ok(toolOutput().error, 'ni une note hors du groupe');

    // Retirée du groupe : plus rien, ni par l'assistant, ni par le RAG.
    await leave('hana');
    assert.deepEqual(await knowledge('hana'), []);
    await chat('hana', `outil:get_ticket ${JSON.stringify({ ticket: ids.ticket })}`);
    assert.ok(toolOutput().error);
    await chat('hana', `outil:read_doc ${JSON.stringify({ note: ids.note })}`);
    assert.ok(toolOutput().error);
    await chat('hana', `outil:read_board ${JSON.stringify({ board: ids.board })}`);
    assert.ok(toolOutput().error);
    await join('hana');
  });

  it('un groupe dont le rôle n’a pas « ai.read » ne donne pas le projet à l’assistant ni au RAG', async () => {
    const created = await admin.post('/api/admin/roles', { scope: 'project', name: 'Lecteur sans IA', description: '', permissions: [] });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    roles.blind = created.body.role.id;
    await clients.olga!.put(`/api/projects/${ids.project}/groups/${ids.group}`, { roleId: roles.blind });
    assert.equal(await projectStatus('hana'), 200, 'elle voit le projet');
    assert.ok(!(await knowledge('hana')).includes(`ticket:${ids.ticket}`), 'mais le RAG ne le fouille pas pour elle');
    await chat('hana', `outil:get_ticket ${JSON.stringify({ ticket: ids.ticket })}`);
    assert.ok(toolOutput().error, 'et l’assistant ne le lit pas');
    assert.equal((await admin.del(`/api/admin/roles/${roles.blind}`)).status, 409, 'un rôle donné à un groupe ne se supprime pas');
    await clients.olga!.put(`/api/projects/${ids.project}/groups/${ids.group}`, { roleId: roles['project:viewer'] });
  });

  it('un jeton d’API ne voit que ce que le groupe donne encore', async () => {
    const created = await clients.hana!.post('/api/me/tokens', { name: 'agent', scope: 'read', projectIds: [ids.project] });
    assert.equal(created.status, 201, 'un projet ouvert par le groupe peut être choisi pour un jeton');
    assert.equal((await clients.hana!.post('/api/me/tokens', { name: 'intrus', scope: 'read', projectIds: [ids.private] })).status, 400);
    const agent = app.client().useToken(created.body.secret);
    assert.equal((await agent.get(`/api/projects/${ids.project}`)).status, 200);
    await leave('hana');
    assert.equal((await agent.get(`/api/projects/${ids.project}`)).status, 404, 'retirée du groupe : son jeton perd l’accès aussitôt');
    await join('hana');
    assert.equal((await agent.get(`/api/projects/${ids.project}`)).status, 200);
  });

  it('dans deux groupes, retirée de l’un elle garde ce que l’autre donne ; changer le rôle d’un groupe change les droits de ses membres', async () => {
    ids.audit = (await clients.olga!.post('/api/groups', { name: 'Audit', memberIds: [ids.hana] })).body.group.id;
    await clients.olga!.put(`/api/projects/${ids.project}/groups/${ids.audit}`, { roleId: roles['project:viewer'] });
    const socket = await socketOf('hana');
    socket.send({ t: 'subscribe', projectId: ids.project });
    await socket.waitFor((message) => message.t === 'subscribed' && message.projectId === ids.project);

    await leave('hana');
    assert.equal(await projectStatus('hana'), 200, 'toujours dans le projet, par Audit');
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(!socket.messages.some((message) => message.t === 'project.revoked'), 'pas sortie du projet à tort');
    assert.equal((await clients.hana!.get(`/api/documentation/spaces/${ids.space}`)).status, 404, 'mais plus l’espace que seul l’autre groupe donnait');

    // Le rôle du groupe change : ses membres ont aussitôt les nouveaux droits, et leur page ouverte les relit.
    const since = socket.messages.length;
    await clients.olga!.put(`/api/projects/${ids.project}/groups/${ids.audit}`, { roleId: roles['project:editor'] });
    assert.ok((await permissionsOf('hana')).includes('ticket.edit'));
    await socket.waitFor((message) => socket.messages.indexOf(message) >= since && message.t === 'event' && message.event.type === 'members.changed');
    await clients.olga!.put(`/api/projects/${ids.project}/groups/${ids.audit}`, { roleId: roles['project:viewer'] });
    assert.ok(!(await permissionsOf('hana')).includes('ticket.edit'));
    assert.equal((await clients.hana!.patch(`/api/tickets/${ids.ticket}`, { title: 'Encore' })).status, 403);

    // Audit supprimé : Hana, qui n'est plus dans l'autre groupe, n'a plus rien.
    assert.equal((await clients.olga!.del(`/api/groups/${ids.audit}`)).status, 200);
    await socket.waitFor((message) => message.t === 'project.revoked' && message.projectId === ids.project);
    assert.equal(await projectStatus('hana'), 404);
    await join('hana');
    assert.equal(await projectStatus('hana'), 200);
  });

  it('supprimer le groupe reprend ses accès partout, et la personne qui le quitte les perd aussi', async () => {
    // Gus quitte le groupe de lui-même : il garde ses rôles directs, pas le reste.
    assert.equal((await clients.gus!.del(`/api/groups/${ids.group}/members/${ids.gus}`)).status, 200);
    assert.equal((await clients.gus!.get(`/api/boards/spaces/${ids.boards}`)).status, 404);
    assert.equal(await projectStatus('gus'), 200, 'son rôle direct dans le projet reste');

    const access = (await clients.hana!.get(`/api/groups/${ids.group}`)).body.access as Array<{ kind: string; id: number }>;
    assert.deepEqual(access.map((entry) => `${entry.kind}:${entry.id}`).sort(), [`boards:${ids.boards}`, `docs:${ids.space}`, `project:${ids.project}`].sort());
    assert.deepEqual(((await clients.ivan!.get(`/api/groups/${ids.group}`)).body.access as unknown[]).length, 0, 'on ne voit pas où le groupe a accès sans y avoir accès soi-même');

    const hana = await socketOf('hana');
    hana.send({ t: 'subscribe', projectId: ids.project });
    await hana.waitFor((message) => message.t === 'subscribed');
    assert.equal((await clients.ivan!.del(`/api/groups/${ids.group}`)).status, 403);
    assert.equal((await clients.olga!.del(`/api/groups/${ids.group}`)).status, 200);
    await hana.waitFor((message) => message.t === 'project.revoked');
    assert.equal(await projectStatus('hana'), 404);
    assert.equal((await clients.hana!.get(`/api/documentation/spaces/${ids.space}`)).status, 404);
    assert.equal((await clients.hana!.get(`/api/boards/spaces/${ids.boards}`)).status, 404);
    assert.deepEqual(await knowledge('hana'), []);
    assert.equal(ctx().db.get<{ n: number }>('SELECT (SELECT COUNT(*) FROM project_groups) + (SELECT COUNT(*) FROM doc_space_groups) + (SELECT COUNT(*) FROM board_space_groups) AS n')!.n, 0, 'ses accès sont effacés');
  });
});
