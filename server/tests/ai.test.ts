import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { AiChangeDTO, AiStreamEvent } from '../../shared/ai.ts';
import { writeSetting } from '../services/appSettings.ts';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

interface RecordedRequest {
  authorization: string | undefined;
  body: {
    model: string;
    messages: Array<{ role: string; content: string | null | Array<{ type: string; text?: string; image_url?: { url: string } }>; tool_calls?: unknown[] }>;
    tools?: Array<{ function: { name: string } }>;
    reasoning_effort?: string;
    temperature?: number;
  };
}

/**
 * Faux fournisseur compatible OpenAI v1 : demande d'abord l'outil indiqué dans le message (« outil:nom {json} »),
 * puis répond en recopiant la sortie de l'outil. « réfléchis » renvoie aussi un raisonnement (`reasoning_content`).
 */
function startFakeProvider(): Promise<{ url: string; requests: RecordedRequest[]; close: () => Promise<void> }> {
  const requests: RecordedRequest[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      if (req.method === 'GET' && req.url === '/v1/models') {
        requests.push({ authorization: req.headers.authorization, body: { model: '', messages: [] } });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'gpt-4o', owned_by: 'openai' }, { id: 'o3-mini', owned_by: 'openai' }, { id: 'local-model', context_length: 8192 }] }));
        return;
      }
      if (req.url !== '/v1/chat/completions') {
        res.writeHead(404).end();
        return;
      }
      const body = JSON.parse(raw) as RecordedRequest['body'];
      requests.push({ authorization: req.headers.authorization, body });
      const last = body.messages.at(-1)!;
      const reply = (message: Record<string, unknown>) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', ...message }, finish_reason: 'stop' }] }));
      };
      if (last.role === 'tool') {
        reply({ content: `Résultat : ${last.content}` });
        return;
      }
      const text = typeof last.content === 'string' ? last.content : (last.content ?? []).map((part) => part.text ?? '').join(' ');
      const match = /outil:(\w+) (\{.*\})/.exec(text);
      if (match && body.tools?.some((tool) => tool.function.name === match[1])) {
        reply({ content: null, tool_calls: [{ id: `call_${requests.length}`, type: 'function', function: { name: match[1], arguments: match[2] } }] });
        return;
      }
      if (text.includes('réfléchis')) {
        reply({ content: 'Voilà.', reasoning_content: 'Je pèse le pour et le contre.' });
        return;
      }
      reply({ content: match ? `Outil ${match[1]} indisponible.` : 'OK' });
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}/v1`, requests, close: () => new Promise((done) => server.close(() => done())) });
    }),
  );
}

function events(text: unknown): AiStreamEvent[] {
  return String(text)
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice(6)) as AiStreamEvent);
}

const changesOf = (stream: AiStreamEvent[]): AiChangeDTO[] => stream.flatMap((event) => (event.type === 'change' ? [event.change] : []));

const MODEL = { id: 'modele-test', vision: false, contextWindow: 128000, reasoning: false };

describe('assistant IA', () => {
  let app: Booted;
  let provider: Awaited<ReturnType<typeof startFakeProvider>>;
  let admin: TestClient;
  let bob: TestClient;
  let vera: TestClient;
  const ids: Record<string, number> = {};
  /** Identifiant du fournisseur enregistré (attribué au premier enregistrement). */
  let providerId = '';

  /** Réglages à un fournisseur (le fournisseur déjà enregistré si `providerId` est connu). */
  const settings = (baseUrl: string, extra: Record<string, unknown> = {}, providerExtra: Record<string, unknown> = {}) => ({
    enabled: true,
    maxSteps: 10,
    maxTurns: 20,
    providers: [{ ...(providerId ? { id: providerId } : {}), name: 'Test', baseUrl, timeoutSeconds: 30, models: [MODEL], ...providerExtra }],
    defaultModel: providerId ? `${providerId}:modele-test` : 'new0:modele-test',
    ...extra,
  });

  const chat = async (client: TestClient, content: string, context: Record<string, unknown> = {}, allowWrite = false, extra: Record<string, unknown> = {}) =>
    client.request('POST', '/api/ai/chat', { messages: [{ role: 'user', content }], context, allowWrite, ...extra });

  before(async () => {
    provider = await startFakeProvider();
    app = await bootServer();
    admin = app.client();
    await admin.login('admin@admin.com', 'admin1234');
    const roles = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
    const role = (key: string, scope = 'global') => roles.find((r) => r.key === key && r.scope === scope)!.id;
    for (const name of ['bob', 'vera']) {
      ids[name] = (await admin.post('/api/admin/users', { email: `${name}@t.fr`, name, password: 'motdepasse1', roleId: role('member') })).body.user.id;
    }
    bob = app.client();
    await bob.login('bob@t.fr', 'motdepasse1');
    vera = app.client();
    await vera.login('vera@t.fr', 'motdepasse1');
    ids.project = (await bob.post('/api/projects', { name: 'Boutique', key: 'BTQ' })).body.project.id;
    await bob.post(`/api/projects/${ids.project}/members`, { userId: ids.vera, roleId: role('viewer', 'project') });
    ids.ticket = (await bob.post(`/api/projects/${ids.project}/tickets`, { title: 'Paiement par carte', description: 'Brancher le prestataire de paiement.' })).body.ticket.id;
    await bob.post(`/api/tickets/${ids.ticket}/comments`, { body: 'Penser au remboursement partiel.' });
  });

  after(async () => {
    await app.running.close();
    await provider.close();
  });

  it('reprend les réglages à un seul fournisseur de la 1.3', async () => {
    writeSetting(app.running.ctx.db, 'ai', { enabled: false, baseUrl: provider.url, models: [MODEL], defaultModel: 'modele-test', key: null, keyHint: null });
    const legacy = (await admin.get('/api/admin/ai')).body.settings;
    assert.equal(legacy.providers.length, 1);
    assert.equal(legacy.providers[0].id, 'p1');
    assert.equal(legacy.providers[0].baseUrl, provider.url);
    assert.equal(legacy.providers[0].timeoutSeconds, 120);
    assert.equal(legacy.defaultModel, 'p1:modele-test');
    assert.equal(legacy.maxSteps, 10);
    assert.equal(legacy.maxTurns, 20);
    writeSetting(app.running.ctx.db, 'ai', {});
  });

  it("se configure dans l'administration (clés chiffrées, jamais renvoyées)", async () => {
    assert.equal((await app.client().get('/api/app')).body.ai, false);
    assert.equal((await chat(bob, 'Bonjour')).status, 409, 'désactivé par défaut');
    assert.equal((await bob.request('PUT', '/api/admin/ai', settings(provider.url))).status, 403);

    // Avant tout enregistrement : la clé saisie sert à détecter les modèles et à tester.
    const detected = await admin.post('/api/admin/ai/models', { baseUrl: provider.url, apiKey: 'sk-tape-0000' });
    assert.equal(detected.status, 200);
    assert.equal(provider.requests.at(-1)!.authorization, 'Bearer sk-tape-0000');
    const byId = Object.fromEntries(detected.body.models.map((model: { id: string }) => [model.id, model]));
    assert.equal(byId['gpt-4o'].vision, true, 'vision devinée');
    assert.equal(byId['o3-mini'].reasoning, true, 'réflexion devinée');
    assert.equal(byId['local-model'].contextWindow, 8192, 'contexte fourni par l’API');
    const unsavedTest = await admin.post('/api/admin/ai/test', { baseUrl: provider.url, model: 'gpt-4o', apiKey: 'sk-tape-0000' });
    assert.equal(unsavedTest.body.ok, true);
    assert.equal(provider.requests.at(-1)!.body.model, 'gpt-4o');
    assert.equal((await admin.request('PUT', '/api/admin/ai', settings(provider.url, {}, { models: [] }))).status, 400, 'au moins un modèle');
    assert.equal((await admin.request('PUT', '/api/admin/ai', settings(provider.url, { maxSteps: 0 }))).status, 400, 'au moins un tour');

    const saved = await admin.request('PUT', '/api/admin/ai', settings(`${provider.url}/`, { maxSteps: 4, maxTurns: 6 }, { apiKey: 'sk-secret-1234', timeoutSeconds: 45 }));
    assert.equal(saved.status, 200);
    const stored = saved.body.settings.providers[0];
    providerId = stored.id;
    assert.match(providerId, /^p[0-9a-f]+$/);
    assert.equal(stored.hasKey, true);
    assert.equal(stored.keyHint, '1234');
    assert.equal(stored.baseUrl, provider.url, 'barre finale retirée');
    assert.equal(stored.timeoutSeconds, 45);
    assert.equal(saved.body.settings.defaultModel, `${providerId}:modele-test`, 'le fournisseur ajouté reçoit son identifiant');
    assert.equal(saved.body.settings.maxSteps, 4);
    assert.equal(saved.body.settings.maxTurns, 6);
    assert.ok(!JSON.stringify(saved.body).includes('sk-secret'), 'la clé ne ressort jamais');
    assert.equal(saved.body.app.ai, true);

    const test = await admin.post('/api/admin/ai/test', { providerId, baseUrl: provider.url });
    assert.equal(test.body.ok, true);
    assert.equal(provider.requests.at(-1)!.authorization, 'Bearer sk-secret-1234', 'la clé enregistrée du fournisseur sert à l’essai');
    assert.equal(provider.requests.at(-1)!.body.model, 'modele-test');

    // Garder la clé quand apiKey est absent ; un fournisseur ajouté sans clé n'hérite pas de celle des autres.
    const kept = await admin.request('PUT', '/api/admin/ai', settings(provider.url));
    assert.equal(kept.body.settings.providers[0].keyHint, '1234');
    assert.equal(kept.body.settings.maxSteps, 10);
  });

  it('cherche sur tous les champs, commentaires compris, avec le contexte du projet', async () => {
    const response = await chat(bob, 'outil:search {"query":"remboursement"}', { projectId: ids.project });
    assert.equal(response.status, 200);
    const stream = events(response.body);
    const steps = stream.filter((event) => event.type === 'step');
    assert.deepEqual(steps.map((step) => step.type === 'step' && step.status), ['running', 'done']);
    const message = stream.find((event) => event.type === 'message');
    assert.ok(message && message.type === 'message' && message.content.includes('BTQ-1'), 'le ticket est trouvé par son commentaire');
    assert.ok(message.type === 'message' && message.content.includes('comments'));
    assert.deepEqual(stream.at(-1), { type: 'done', changes: 0 });
    const system = String(provider.requests.at(-2)!.body.messages[0]!.content ?? '');
    assert.ok(system.includes('Boutique'), 'le projet ouvert est donné au modèle');
  });

  it('transmet le raisonnement exposé par le modèle', async () => {
    const stream = events((await chat(bob, 'réfléchis bien')).body);
    const thought = stream.find((event) => event.type === 'thought');
    assert.ok(thought && thought.type === 'thought' && thought.text === 'Je pèse le pour et le contre.');
  });

  it("ne propose pas les outils d'écriture sans autorisation, et respecte les droits", async () => {
    const readOnly = await chat(bob, 'outil:create_ticket {"projectId":1,"title":"Nouveau"}', { projectId: ids.project }, false);
    const names = provider.requests.at(-1)!.body.tools!.map((tool) => tool.function.name);
    assert.ok(names.includes('search') && !names.includes('create_ticket'));
    assert.ok(String(readOnly.body).includes('indisponible'));

    const created = await chat(bob, `outil:create_ticket {"projectId":${ids.project},"title":"Créé par l'IA","priority":"Haute","parent":"BTQ-1"}`, { projectId: ids.project }, true);
    const stream = events(created.body);
    assert.deepEqual(stream.at(-1), { type: 'done', changes: 1 });
    const tickets = (await bob.get(`/api/projects/${ids.project}/tickets?q=Créé par l'IA`)).body.tickets;
    assert.equal(tickets.length, 1);
    assert.equal(tickets[0].parentId, ids.ticket, 'sous-ticket créé par l’assistant');
    const [change] = changesOf(stream);
    assert.equal(change!.state, 'applied');
    assert.equal(change!.action.kind, 'ticket.create');
    assert.equal(change!.action.kind === 'ticket.create' && change!.action.ticketId, tickets[0].id, 'de quoi annuler la création');
    assert.ok(change!.diff.some((entry) => entry.field === 'priorityId' && entry.to === 'Haute'), 'différences lisibles (noms)');
    assert.ok(change!.diff.some((entry) => entry.field === 'parentId' && entry.to?.startsWith('BTQ-1')));
    const history = (await bob.get(`/api/tickets/${tickets[0].id}/history`)).body.history;
    assert.equal(history.at(-1).via, 'Assistant IA', 'les actions de l’IA sont signalées « via Assistant IA »');
    assert.equal(history.at(-1).userId, ids.bob);

    // Modification : l'état d'avant est gardé pour pouvoir annuler.
    const moved = changesOf(events((await chat(bob, 'outil:move_ticket {"ticket":"BTQ-1","status":"in_progress"}', { projectId: ids.project }, true)).body))[0]!;
    assert.equal(moved.label, 'Déplacement de BTQ-1');
    assert.deepEqual(moved.action.kind === 'ticket.update' && [moved.action.before, moved.action.after], [{ status: 'backlog' }, { status: 'in_progress' }]);
    await bob.patch(`/api/tickets/${ids.ticket}`, { status: 'backlog' });

    // Lectrice : l'assistant lit, mais ne peut pas écrire même si elle le demande.
    const denied = await chat(vera, `outil:update_ticket {"ticket":"BTQ-1","title":"Piraté"}`, { projectId: ids.project }, true);
    const failed = events(denied.body).find((event) => event.type === 'step' && event.status === 'failed');
    assert.ok(failed, 'l’outil échoue');
    assert.equal((await bob.get(`/api/tickets/${ids.ticket}`)).body.ticket.title, 'Paiement par carte');
    const read = await chat(vera, 'outil:get_ticket {"ticket":"BTQ-1"}', { projectId: ids.project, ticketId: ids.ticket });
    assert.ok(String(read.body).includes('remboursement'), 'la lecture est permise');
    assert.ok(String(read.body).includes('subTickets'), 'les sous-tickets sont lus');
  });

  it('propose des modifications sans les appliquer (mode « proposer »)', async () => {
    const response = await chat(bob, 'outil:update_ticket {"ticket":"BTQ-1","title":"Paiement CB","assignees":["bob"]}', { projectId: ids.project }, true, { writeMode: 'propose' });
    const stream = events(response.body);
    assert.deepEqual(stream.at(-1), { type: 'done', changes: 0 }, 'rien n’est modifié');
    const [proposal] = changesOf(stream);
    assert.equal(proposal!.state, 'pending');
    assert.equal(proposal!.ticketKey, 'BTQ-1');
    assert.deepEqual(proposal!.action.kind === 'ticket.update' && proposal!.action.after, { title: 'Paiement CB', assigneeIds: [ids.bob] });
    assert.deepEqual(proposal!.action.kind === 'ticket.update' && proposal!.action.before, { title: 'Paiement par carte', assigneeIds: [] });
    assert.deepEqual(proposal!.diff.map((entry) => [entry.field, entry.from, entry.to]), [['title', 'Paiement par carte', 'Paiement CB'], ['assigneeIds', null, 'bob']]);
    assert.ok(String(response.body).includes('Proposition enregistrée'), 'le modèle sait que c’est une proposition');
    assert.equal((await bob.get(`/api/tickets/${ids.ticket}`)).body.ticket.title, 'Paiement par carte');
    // Les droits restent vérifiés pour une proposition.
    const denied = events((await chat(vera, 'outil:update_ticket {"ticket":"BTQ-1","title":"x"}', { projectId: ids.project }, true, { writeMode: 'propose' })).body);
    assert.equal(changesOf(denied).length, 0);
  });

  it('limite les tours de réflexion et de discussion', async () => {
    await admin.request('PUT', '/api/admin/ai', settings(provider.url, { maxSteps: 1, maxTurns: 1 }));
    const stopped = events((await chat(bob, 'outil:search {"query":"paiement"}', { projectId: ids.project })).body);
    const message = stopped.find((event) => event.type === 'message');
    assert.ok(message?.type === 'message' && message.content.includes('(1)'), 'arrêt après un tour de réflexion');
    await bob.request('POST', '/api/ai/chat', {
      messages: [
        { role: 'user', content: 'premier' },
        { role: 'assistant', content: 'r1' },
        { role: 'user', content: 'deuxième' },
        { role: 'assistant', content: 'r2' },
        { role: 'user', content: 'troisième' },
      ],
      context: {},
    });
    const sent = provider.requests.at(-1)!.body.messages.filter((entry) => entry.role !== 'system').map((entry) => entry.content);
    assert.deepEqual(sent, ['deuxième', 'r2', 'troisième'], 'un seul échange précédent est transmis');
    await admin.request('PUT', '/api/admin/ai', settings(provider.url));
  });

  it("refuse un projet sans droit IA et ne voit pas les projets d'autrui", async () => {
    const roles = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string; permissions: string[] }>;
    const viewer = roles.find((r) => r.key === 'viewer' && r.scope === 'project')!;
    await admin.patch(`/api/admin/roles/${viewer.id}`, { permissions: viewer.permissions.filter((permission) => permission !== 'ai.read') });
    assert.equal((await chat(vera, 'Bonjour', { projectId: ids.project })).status, 403);
    const search = await chat(vera, 'outil:search {"query":"paiement"}');
    const answer = events(search.body).find((event) => event.type === 'message');
    assert.ok(answer && answer.type === 'message' && answer.content.includes('"total":0'), 'sans ai.read, rien n’est trouvé');
    await admin.patch(`/api/admin/roles/${viewer.id}`, { permissions: viewer.permissions });

    const other = (await admin.post('/api/projects', { name: 'Secret', key: 'SEC' })).body.project.id;
    await admin.post(`/api/projects/${other}/tickets`, { title: 'Paiement confidentiel' });
    const scoped = await chat(vera, 'outil:search {"query":"paiement"}');
    assert.ok(!String(scoped.body).includes('SEC-1'), 'les projets invisibles ne sont jamais lus');
    assert.equal((await chat(vera, 'Bonjour', { projectId: other })).status, 404);
  });

  it('propose les modèles de plusieurs fournisseurs, transmet la réflexion, les images et réduit la conversation au contexte', async () => {
    const second = await startFakeProvider();
    try {
      const saved = await admin.request('PUT', '/api/admin/ai', {
        enabled: true,
        maxSteps: 10,
        maxTurns: 20,
        providers: [
          { id: providerId, name: 'Principal', baseUrl: provider.url, timeoutSeconds: 30, models: [{ ...MODEL, label: 'Rapide' }] },
          { name: 'Local', baseUrl: second.url, timeoutSeconds: 300, apiKey: 'sk-local-9999', models: [{ id: 'raisonneur', label: 'Réfléchi', vision: true, contextWindow: 3000, reasoning: true }] },
        ],
        defaultModel: `${providerId}:modele-test`,
      });
      assert.equal(saved.status, 200);
      const local = saved.body.settings.providers[1];
      assert.equal(saved.body.settings.providers[0].keyHint, '1234', 'chaque fournisseur garde sa clé');
      assert.equal(local.keyHint, '9999');
      const offered = (await bob.get('/api/ai/models')).body;
      assert.deepEqual(
        offered.models.map((model: { ref: string; provider: string }) => [model.ref, model.provider]),
        [
          [`${providerId}:modele-test`, 'Principal'],
          [`${local.id}:raisonneur`, 'Local'],
        ],
      );
      assert.equal(offered.defaultModel, `${providerId}:modele-test`);

      // Par défaut : modèle par défaut, température basse, pas de reasoning_effort.
      let stream = events((await chat(bob, 'Bonjour')).body);
      assert.deepEqual(stream[0], { type: 'model', model: 'modele-test', label: 'Rapide' });
      assert.equal(provider.requests.at(-1)!.body.reasoning_effort, undefined);
      assert.equal(provider.requests.at(-1)!.body.temperature, 0.2);

      // Modèle d'un autre fournisseur (avec sa clé), niveau de réflexion et image jointe.
      const image = 'data:image/png;base64,iVBORw0KGgo=';
      const long = 'x'.repeat(11_000);
      const response = await bob.request('POST', '/api/ai/chat', {
        messages: [
          { role: 'user', content: long },
          { role: 'assistant', content: 'Réponse précédente' },
          { role: 'user', content: 'Décris cette capture', images: [image] },
        ],
        context: {},
        allowWrite: false,
        model: `${local.id}:raisonneur`,
        reasoning: 'high',
      });
      stream = events(response.body);
      assert.equal(stream[0]!.type === 'model' && stream[0]!.model, 'raisonneur');
      const request = second.requests.at(-1)!;
      assert.equal(request.authorization, 'Bearer sk-local-9999', 'requête envoyée au second fournisseur, avec sa clé');
      const sent = request.body;
      assert.equal(sent.model, 'raisonneur');
      assert.equal(sent.reasoning_effort, 'high');
      assert.equal(sent.temperature, undefined, 'pas de température pour un modèle de réflexion');
      const lastUser = sent.messages.at(-1)!;
      assert.ok(Array.isArray(lastUser.content) && lastUser.content.some((part) => part.type === 'image_url' && part.image_url?.url === image));
      assert.ok(!sent.messages.some((message) => typeof message.content === 'string' && message.content.length >= 11_000), 'le long message ancien est retiré (petit contexte)');

      // Référence sans fournisseur (panneau de la 1.3) : retrouvée ; modèle sans vision : image signalée ; inconnu : défaut.
      await bob.request('POST', '/api/ai/chat', { messages: [{ role: 'user', content: 'Salut' }], context: {}, model: 'raisonneur' });
      assert.equal(second.requests.at(-1)!.body.messages.at(-1)!.content, 'Salut');
      await bob.request('POST', '/api/ai/chat', { messages: [{ role: 'user', content: 'Et ça ?', images: [image] }], context: {}, model: 'inconnu' });
      const plain = provider.requests.at(-1)!.body;
      assert.equal(plain.model, 'modele-test');
      assert.ok(typeof plain.messages.at(-1)!.content === 'string' && String(plain.messages.at(-1)!.content).includes('ignorée'));
      assert.equal((await bob.request('POST', '/api/ai/chat', { messages: [{ role: 'user', content: 'x', images: ['javascript:alert(1)'] }], context: {} })).status, 400);
    } finally {
      await admin.request('PUT', '/api/admin/ai', settings(provider.url));
      await second.close();
    }
  });

  it('garde les 50 dernières conversations de chaque personne', async () => {
    const id = '0f6c8a52-2f4e-4c1b-9a0e-1d2c3b4a5f60';
    const turns = [
      { id: 1, role: 'user', content: 'Où en est le projet ?', steps: [] },
      { id: 2, role: 'assistant', content: 'Tout va bien.', steps: [] },
    ];
    const saved = await bob.request('PUT', `/api/ai/conversations/${id}`, { title: 'Où en est le projet ?', context: { projectId: ids.project }, turns });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.conversation.messageCount, 1);
    const opened = (await bob.get(`/api/ai/conversations/${id}`)).body.conversation;
    assert.deepEqual(opened.turns, turns);
    assert.deepEqual(opened.context, { projectId: ids.project });
    assert.equal((await vera.get(`/api/ai/conversations/${id}`)).status, 404, 'privée');
    assert.equal((await vera.request('PUT', `/api/ai/conversations/${id}`, { title: 'x', turns: [] })).status, 404, 'pas d’écrasement par une autre personne');
    assert.equal((await bob.request('PUT', '/api/ai/conversations/../x', { title: 'x', turns: [] })).status >= 400, true);

    for (let index = 0; index < 51; index += 1) {
      await bob.request('PUT', `/api/ai/conversations/conv-${String(index).padStart(4, '0')}`, { title: `Conversation ${index}`, turns: [] });
    }
    const list = (await bob.get('/api/ai/conversations')).body.conversations as Array<{ id: string }>;
    assert.equal(list.length, 50);
    assert.ok(!list.some((entry) => entry.id === id), 'la plus ancienne est retirée');
    assert.equal((await bob.request('DELETE', '/api/ai/conversations/conv-0050')).status, 200);
    assert.equal((await bob.get('/api/ai/conversations/conv-0050')).status, 404);
  });

  it("signale les erreurs du fournisseur et se coupe une fois désactivé", async () => {
    await admin.request('PUT', '/api/admin/ai', settings(`${provider.url}/introuvable`));
    const failure = await chat(bob, 'Bonjour');
    const error = events(failure.body).find((event) => event.type === 'error');
    assert.ok(error && error.type === 'error' && error.message.includes('404'));
    await admin.request('PUT', '/api/admin/ai', settings(provider.url, { enabled: false }));
    assert.equal((await app.client().get('/api/app')).body.ai, false);
    assert.equal((await chat(bob, 'Bonjour')).status, 409);
  });
});
