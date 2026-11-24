import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { contextOfItems, guessCapabilities, numberLines, parseAiImageRef, REASONING_PRESETS, reasoningPresetOf, type AiChangeDTO, type AiRenderRequest, type AiStreamEvent } from '../../shared/ai.ts';
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
const VISION_MODEL = { id: 'modele-vision', vision: true, contextWindow: 128000, reasoning: false };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
/** Image « dessinée par le panneau » dans les tests. */
const DRAWN = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';

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
    // Réglages de réflexion devinés d'après le nom : ceux du fournisseur quand on le reconnaît, sinon ceux d'OpenAI.
    assert.equal(reasoningPresetOf(guessCapabilities('deepseek-v4.1-flash').reasoningOptions), 'deepseek');
    assert.equal(reasoningPresetOf(guessCapabilities('qwen3-max').reasoningOptions), 'qwen');
    assert.equal(reasoningPresetOf(guessCapabilities('o3-mini').reasoningOptions), 'openai');
    assert.equal(reasoningPresetOf([{ id: 'x', label: 'Mien', params: { effort: 3 } }]), 'custom');
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
    const sources = events(read.body).flatMap((event) => (event.type === 'source' ? [event.source] : []));
    assert.deepEqual(sources, [{ kind: 'ticket', id: ids.ticket, label: 'BTQ-1 — Paiement par carte', detail: 'Boutique', projectId: ids.project }], 'le ticket lu est une source, avec son projet');
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

  it('ajoute et termine une ligne d’avancement, et lit les lignes du ticket', async () => {
    const context = { projectId: ids.project };
    const added = events((await chat(bob, 'outil:add_part {"ticket":"BTQ-1","note":"Relire les CGV"}', context, true)).body);
    const [change] = changesOf(added);
    assert.equal(change?.action.kind, 'part.create');
    const partId = change?.action.kind === 'part.create' ? change.action.partId : null;
    assert.ok(partId);

    const read = events((await chat(bob, 'outil:get_ticket {"ticket":"BTQ-1"}', context, false)).body);
    assert.ok(read.some((event) => event.type === 'message' && event.content.includes('Relire les CGV')), 'les lignes sont lues avec le ticket');

    const done = changesOf(events((await chat(bob, `outil:set_part {"partId":${partId},"done":true}`, context, true)).body));
    assert.equal(done[0]?.action.kind, 'part.update');
    const ticket = (await bob.get(`/api/tickets/${ids.ticket}`)).body.ticket;
    assert.equal(ticket.parts.find((part: { id: number }) => part.id === partId).done, true);

    const denied = events((await chat(vera, `outil:set_part {"partId":${partId},"done":false}`, context, true)).body);
    assert.equal(changesOf(denied).length, 0, 'mêmes droits que pour le reste');
    await bob.del(`/api/parts/${partId}`);
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

      // Réglages de réflexion : sans réglages propres, les quatre niveaux d'OpenAI ; le panneau n'en reçoit que les noms.
      const offeredOptions = offered.models[1].reasoningOptions as Array<{ id: string; params: object }>;
      assert.deepEqual(offeredOptions.map((option) => option.id), ['minimal', 'low', 'medium', 'high']);
      assert.deepEqual(offeredOptions[0]!.params, {}, 'les paramètres restent côté serveur');
      // L'administrateur donne à ce modèle les réglages de DeepSeek, plus un réglage à lui.
      const custom = [...REASONING_PRESETS.find((preset) => preset.key === 'deepseek')!.options, { id: 'budget', label: 'Budget court', params: { thinking: { type: 'enabled' }, thinking_budget: 2048 } }];
      const withOptions = (options: unknown) => ({
        enabled: true,
        maxSteps: 10,
        maxTurns: 20,
        providers: [
          { id: providerId, name: 'Principal', baseUrl: provider.url, timeoutSeconds: 30, models: [{ ...MODEL, label: 'Rapide' }] },
          { id: local.id, name: 'Local', baseUrl: second.url, timeoutSeconds: 300, models: [{ id: 'raisonneur', label: 'Réfléchi', vision: true, contextWindow: 3000, reasoning: true, reasoningOptions: options }] },
        ],
        defaultModel: `${providerId}:modele-test`,
      });
      const refused = await admin.request('PUT', '/api/admin/ai', withOptions([{ id: 'piege', label: '', params: { model: 'autre-modele' } }]));
      assert.equal(refused.status, 400, 'un réglage ne remplace pas le modèle');
      const kept = await admin.request('PUT', '/api/admin/ai', withOptions(custom));
      assert.equal(kept.status, 200);
      assert.deepEqual(kept.body.settings.providers[1].models[0].reasoningOptions, custom);
      assert.deepEqual(
        ((await bob.get('/api/ai/models')).body.models[1].reasoningOptions as Array<{ id: string; label: string }>).map((option) => [option.id, option.label]),
        [['off', ''], ['low', ''], ['high', ''], ['max', ''], ['budget', 'Budget court']],
      );
      const ask = async (reasoning: string): Promise<Record<string, unknown>> => {
        await bob.request('POST', '/api/ai/chat', { messages: [{ role: 'user', content: 'Salut' }], context: {}, model: `${local.id}:raisonneur`, reasoning });
        return second.requests.at(-1)!.body as unknown as Record<string, unknown>;
      };
      let body = await ask('max');
      assert.deepEqual([body.thinking, body.reasoning_effort], [{ type: 'enabled' }, 'max']);
      body = await ask('off');
      assert.deepEqual([body.thinking, body.reasoning_effort], [{ type: 'disabled' }, undefined]);
      body = await ask('budget');
      assert.equal(body.thinking_budget, 2048);
      body = await ask('medium');
      assert.deepEqual([body.thinking, body.reasoning_effort], [undefined, undefined], 'un réglage que ce modèle n’a pas est ignoré');

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

  it('lit et dessine sur les tableaux blancs, dans les droits de la personne', async () => {
    const spaceId = (await bob.post('/api/boards/spaces', { name: 'Ateliers IA' })).body.space.id as number;
    await bob.post(`/api/boards/spaces/${spaceId}/members`, { userId: ids.vera, role: 'reader' });
    const boardId = (await bob.post(`/api/boards/spaces/${spaceId}/nodes`, { path: 'Rétro' })).body.node.id as number;
    const elementsOf = async () => (await bob.get(`/api/boards/nodes/${boardId}`)).body.elements as Array<{ id: string; type: string; text?: string }>;
    const toolOutput = () => JSON.parse(provider.requests.at(-1)!.body.messages.at(-1)!.content as string) as Record<string, any>;

    // Le tableau ouvert est connu, et l'écriture n'est proposée qu'avec l'autorisation.
    await chat(bob, 'Bonjour', { boardId });
    const system = provider.requests.at(-1)!.body.messages[0]!.content as string;
    assert.ok(system.includes('« Rétro » (id ') && system.includes('ce tableau'));
    const names = provider.requests.at(-1)!.body.tools!.map((tool) => tool.function.name);
    assert.ok(names.includes('read_board') && !names.includes('draw_on_board'));

    // Dessin en Mermaid, appliqué en direct puis lisible.
    const drawn = events((await chat(bob, `outil:draw_on_board {"board":${boardId},"mermaid":"flowchart LR\\nA[Idée] --> B[Projet]"}`, { boardId }, true)).body);
    const [change] = changesOf(drawn);
    assert.equal(change!.state, 'applied');
    assert.equal(change!.action.kind, 'board.elements');
    assert.deepEqual((await elementsOf()).map((element) => element.type).sort(), ['connector', 'shape', 'shape']);
    await chat(bob, `outil:read_board {"board":${boardId}}`, { boardId });
    assert.match(toolOutput().mermaid, /Idée/);

    // Post-it, modification puis suppression d'un élément.
    events((await chat(bob, `outil:add_sticky_notes {"board":${boardId},"notes":["Bien","À revoir"],"color":"green"}`, { boardId }, true)).body);
    const sticky = (await elementsOf()).find((element) => element.text === 'Bien')!;
    events((await chat(bob, `outil:edit_board_element {"board":${boardId},"element":"${sticky.id}","text":"Très bien"}`, { boardId }, true)).body);
    assert.ok((await elementsOf()).some((element) => element.text === 'Très bien'));
    events((await chat(bob, `outil:delete_board_elements {"board":${boardId},"elements":["${sticky.id}"]}`, { boardId }, true)).body);
    assert.equal((await elementsOf()).length, 4);

    // Proposer ne change rien ; un lecteur ne peut pas écrire.
    const proposed = changesOf(events((await chat(bob, `outil:add_sticky_notes {"board":${boardId},"notes":["Plus tard"]}`, { boardId }, true, { writeMode: 'propose' })).body));
    assert.equal(proposed[0]!.state, 'pending');
    assert.equal((await elementsOf()).length, 4);
    const denied = changesOf(events((await chat(vera, `outil:add_sticky_notes {"board":${boardId},"notes":["Non"]}`, { boardId }, true)).body));
    assert.equal(denied.length, 0);
    assert.equal((await elementsOf()).length, 4);

    // La route de fusion, utilisée pour rejouer ou annuler un changement depuis le panneau.
    const shapeId = (await elementsOf()).find((element) => element.type === 'shape')!.id;
    const merged = await bob.request('PATCH', `/api/boards/nodes/${boardId}/elements`, { upsert: [], remove: [shapeId] });
    assert.equal(merged.body.count, 2, 'la forme part avec son lien');
  });

  describe('documentation', () => {
    let spaceId = 0;
    let noteId = 0;
    const CONTENT = '# Guide\n\nInstaller le serveur de test.\n\n## Suite\n\nFin.';

    const nodeText = async (id: number) => (await bob.get(`/api/documentation/nodes/${id}`)).body.content as string;
    const toolOutput = () => JSON.parse(provider.requests.at(-1)!.body.messages.at(-1)!.content as string) as Record<string, any>;
    const toolNames = () => provider.requests.at(-1)!.body.tools!.map((tool) => tool.function.name);

    before(async () => {
      await admin.request('PUT', '/api/admin/documentation', { enabled: true });
      const space = (await bob.post('/api/documentation/spaces', { name: 'Guide technique' })).body.space;
      spaceId = space.id;
      await bob.post(`/api/documentation/spaces/${spaceId}/members`, { userId: ids.vera, role: 'reader' });
      noteId = (await bob.post(`/api/documentation/spaces/${spaceId}/nodes`, { path: 'Guides/Installation', kind: 'markdown', content: CONTENT })).body.node.id;
    });

    it('connaît la note ouverte, et lit et cherche dans la documentation', async () => {
      await chat(bob, 'Bonjour', { docSpaceId: spaceId, docNodeId: noteId });
      const system = provider.requests.at(-1)!.body.messages[0]!.content as string;
      assert.ok(system.includes('« Guides/Installation.md »') && system.includes('Guide technique'));
      assert.ok(toolNames().includes('read_doc') && !toolNames().includes('edit_doc'), 'en lecture seule, pas d’outil d’écriture');

      const stream = events((await chat(bob, `outil:read_doc {"note":${noteId}}`, { docNodeId: noteId })).body);
      const read = toolOutput();
      assert.equal(read.path, 'Guides/Installation.md');
      assert.equal(read.firstLine, 1);
      assert.equal(read.content, numberLines(CONTENT), 'chaque ligne porte son numéro, pour être citée');
      assert.ok(read.content.startsWith('1│ # Guide\n2│ \n3│ Installer'));
      assert.deepEqual(read.outline, ['# Guide', '## Suite']);
      assert.deepEqual(
        stream.filter((event) => event.type === 'source'),
        [{ type: 'source', source: { kind: 'doc', id: noteId, label: 'Installation', detail: 'Guides/Installation.md' } }],
        'la note lue figure dans les sources',
      );
      const rules = provider.requests.at(-1)!.body.messages[0]!.content as string;
      assert.ok(rules.includes(`@[Titre](doc:ID#L12-18)`) && rules.includes('@[Titre](board:ID#el:id1,id2)'), 'le modèle sait citer des lignes et des éléments');

      // Lecture par tranches : la numérotation continue où la tranche commence.
      await chat(bob, `outil:read_doc {"note":${noteId},"offset":${CONTENT.indexOf('## Suite')}}`);
      assert.equal(toolOutput().firstLine, 5);
      assert.ok(toolOutput().content.startsWith('5│ ## Suite'));

      await chat(bob, `outil:read_doc {"note":"Guides/Installation","spaceId":${spaceId}}`);
      assert.equal(toolOutput().id, noteId, 'une note se désigne aussi par son chemin');

      await chat(bob, 'outil:search_docs {"query":"serveur de test"}');
      assert.deepEqual(toolOutput().notes.map((note: { path: string }) => note.path), ['Guides/Installation.md']);
    });

    it('ajoute au contexte les éléments choisis, sauf ceux auxquels la personne n’a pas accès', async () => {
      const secret = (await admin.post('/api/projects', { name: 'Projet secret', key: 'SEC' })).body.project.id;
      await chat(bob, 'Bonjour', { ...contextOfItems([
        { kind: 'note', id: noteId, parentId: spaceId },
        { kind: 'ticket', id: ids.ticket, parentId: ids.project },
        { kind: 'project', id: secret },
      ]) });
      const system = provider.requests.at(-1)!.body.messages[0]!.content as string;
      assert.ok(system.includes('Note ouverte : « Guides/Installation.md »'));
      assert.ok(system.includes('Ticket ouvert : BTQ-1 « Paiement par carte »'), 'le premier ticket devient « ce ticket »');
      assert.ok(!system.includes('Projet secret'), 'un projet inaccessible est ignoré');

      assert.ok(!system.includes('Éléments ajoutés au contexte'));

      await chat(bob, 'Bonjour', { items: [{ kind: 'note', id: noteId }, { kind: 'project', id: ids.project }, { kind: 'note', id: noteId + 1000 }] });
      const second = provider.requests.at(-1)!.body.messages[0]!.content as string;
      assert.match(second, /Éléments ajoutés au contexte[^\n]*\n- note « Guides\/Installation\.md »[^\n]*\n- projet « Boutique »[^\n]*$/);
      assert.equal((await chat(bob, 'Bonjour', { items: [{ kind: 'autre', id: 1 }] })).status, 400);
    });

    it('n’ouvre que les espaces de la personne', async () => {
      const eve = app.client();
      const roles = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
      await admin.post('/api/admin/users', { email: 'eve@t.fr', name: 'eve', password: 'motdepasse1', roleId: roles.find((r) => r.key === 'member' && r.scope === 'global')!.id });
      await eve.login('eve@t.fr', 'motdepasse1');
      assert.equal((await chat(eve, 'Bonjour', { docSpaceId: spaceId })).status, 404);
      assert.equal((await chat(eve, 'Bonjour', { docNodeId: noteId })).status, 404);
      await chat(eve, `outil:read_doc {"note":${noteId}}`);
      assert.ok(toolOutput().error, 'l’outil refuse aussi');
      await chat(eve, 'outil:search_docs {"query":"serveur de test"}');
      assert.deepEqual(toolOutput().notes, [], 'la recherche ne montre rien d’inaccessible');
    });

    it('retouche un passage, avec de quoi annuler, et le signale dans l’historique', async () => {
      const stream = events((await chat(bob, `outil:edit_doc {"note":${noteId},"old":"serveur de test","new":"serveur de production"}`, {}, true)).body);
      const change = changesOf(stream)[0]!;
      assert.equal(change.state, 'applied');
      assert.equal(change.projectId, null);
      assert.ok(change.action.kind === 'doc.edit');
      assert.ok(change.action.before.includes('serveur de test') && change.action.after.includes('serveur de production'));
      assert.ok(change.action.before.length < CONTENT.length, 'seul le passage voyage');
      assert.ok((await nodeText(noteId)).includes('serveur de production'));
      const versions = (await bob.get(`/api/documentation/nodes/${noteId}/versions`)).body.versions;
      assert.equal(versions[0].origin, 'ai');
    });

    it('ignore les numéros de ligne recopiés de read_doc dans une retouche', async () => {
      const before = await nodeText(noteId);
      const line = before.split('\n').findIndex((text) => text.startsWith('Installer')) + 1;
      const stream = events((await chat(bob, `outil:edit_doc ${JSON.stringify({ note: noteId, old: `${line}│ ${before.split('\n')[line - 1]}`, new: `${line}│ Installer le serveur de recette.` })}`, {}, true)).body);
      assert.equal(changesOf(stream)[0]?.state, 'applied');
      const after = await nodeText(noteId);
      assert.ok(after.includes('\nInstaller le serveur de recette.\n'), 'le texte est retouché, sans les numéros');
      assert.ok(!after.includes('│'));
    });

    it('explique pourquoi un passage ne convient pas', async () => {
      await chat(bob, `outil:edit_doc {"note":${noteId},"old":"absent du texte","new":"x"}`, {}, true);
      assert.match(toolOutput().error, /Passage introuvable/);
      await chat(bob, `outil:edit_doc {"note":${noteId},"old":"e","new":"x"}`, {}, true);
      assert.match(toolOutput().error, /plusieurs fois/);
    });

    it('propose sans écrire, et respecte le rôle dans l’espace', async () => {
      const before = await nodeText(noteId);
      const stream = events((await chat(bob, `outil:rewrite_doc {"note":${noteId},"content":"Tout neuf"}`, {}, true, { writeMode: 'propose' })).body);
      const change = changesOf(stream)[0]!;
      assert.equal(change.state, 'pending');
      assert.equal(await nodeText(noteId), before);

      await chat(vera, `outil:edit_doc {"note":${noteId},"old":"Fin.","new":"x"}`, {}, true);
      assert.ok(toolOutput().error, 'un lecteur ne modifie pas, même avec l’assistant');
      assert.equal(await nodeText(noteId), before);
    });

    it('crée une note et ses dossiers', async () => {
      const stream = events((await chat(bob, `outil:create_doc {"spaceId":${spaceId},"path":"Nouveau/Synthèse","content":"# Synthèse"}`, {}, true)).body);
      const change = changesOf(stream)[0]!;
      assert.ok(change.action.kind === 'doc.create' && change.action.nodeId);
      const nodes = (await bob.get(`/api/documentation/spaces/${spaceId}`)).body.nodes as Array<{ path: string }>;
      assert.ok(nodes.some((node) => node.path === 'Nouveau/Synthèse.md'));
      await chat(bob, `outil:create_doc {"spaceId":${spaceId},"path":"Nouveau/Synthèse","content":"x"}`, {}, true);
      assert.ok(toolOutput().error, 'pas d’écrasement');
    });

    it('ne propose pas ses outils quand la documentation est coupée', async () => {
      await admin.request('PUT', '/api/admin/documentation', { enabled: false });
      await chat(bob, 'Bonjour');
      assert.ok(!toolNames().includes('read_doc'));
      await admin.request('PUT', '/api/admin/documentation', { enabled: true });
    });
  });

  describe('images et vision', () => {
    let visionRef = '';
    let imageId = 0;
    let noteId = 0;
    let boardId = 0;
    let assetKey = '';
    let attachmentId = 0;
    const lastRequest = () => provider.requests.at(-1)!.body;
    const toolNames = () => lastRequest().tools!.map((tool) => tool.function.name);
    /** Sortie du dernier outil appelé (le message « tool » le plus récent envoyé au fournisseur). */
    const toolOutput = () => JSON.parse(lastRequest().messages.filter((message) => message.role === 'tool').at(-1)!.content as string) as Record<string, any>;
    /** Images envoyées au fournisseur dans sa dernière requête. */
    const sentImages = () => lastRequest().messages.flatMap((message) => (Array.isArray(message.content) ? message.content.filter((part) => part.type === 'image_url').map((part) => part.image_url!.url) : []));

    /** Conversation lue au fil de l'eau : le « panneau » répond aux demandes de dessin avec `draw`. */
    async function chatDrawing(client: TestClient, content: string, context: Record<string, unknown>, draw: (request: AiRenderRequest) => string | Error, extra: Record<string, unknown> = {}): Promise<{ stream: AiStreamEvent[]; renders: AiRenderRequest[] }> {
      const response = await fetch(`${app.base}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: client.cookie },
        body: JSON.stringify({ messages: [{ role: 'user', content }], context, allowWrite: false, model: visionRef, canRender: true, ...extra }),
      });
      assert.equal(response.status, 200);
      const stream: AiStreamEvent[] = [];
      const renders: AiRenderRequest[] = [];
      const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let index: number;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 2);
          if (!chunk.startsWith('data: ')) continue;
          const event = JSON.parse(chunk.slice(6)) as AiStreamEvent;
          stream.push(event);
          if (event.type === 'render') {
            renders.push(event.request);
            const result = draw(event.request);
            const answer = await client.request('POST', `/api/ai/renders/${event.id}`, result instanceof Error ? { error: result.message } : { image: result });
            assert.equal(answer.status, 200, JSON.stringify(answer.body));
          }
        }
      }
      return { stream, renders };
    }

    before(async () => {
      const saved = await admin.request('PUT', '/api/admin/ai', settings(provider.url, {}, { models: [MODEL, VISION_MODEL] }));
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      providerId = (await admin.get('/api/admin/ai')).body.settings.providers[0].id;
      visionRef = `${providerId}:modele-vision`;
      await admin.request('PUT', '/api/admin/documentation', { enabled: true });
      const docSpace = (await bob.post('/api/documentation/spaces', { name: 'Vision' })).body.space.id as number;
      const image = (await bob.raw('POST', `/api/documentation/spaces/${docSpace}/images`, PNG, { 'Content-Type': 'image/png', 'X-File-Name': 'schema.png' })).json.node;
      imageId = image.id;
      noteId = (await bob.post(`/api/documentation/spaces/${docSpace}/nodes`, { path: 'Archi', content: `# Archi\n\n![Le schéma](${image.path})\n\n![loin](https://exemple.fr/a.png)\n\n![[absente.png]]\n\n\`\`\`\n![dans le code](ignoree.png)\n\`\`\`\n` })).body.node.id;
      const boardSpace = (await bob.post('/api/boards/spaces', { name: 'Vision' })).body.space.id as number;
      assetKey = (await bob.raw('POST', `/api/boards/spaces/${boardSpace}/assets`, PNG, { 'Content-Type': 'image/png', 'X-File-Name': 'logo.png' })).json.asset.key;
      boardId = (
        await bob.post(`/api/boards/spaces/${boardSpace}/nodes`, {
          path: 'Schéma',
          elements: [
            { id: 's1', type: 'shape', shape: 'rect', x: 100, y: 50, w: 200, h: 100, z: 1, text: 'Serveur', color: 'blue', fill: 'tint', angle: 0 },
            { id: 'i1', type: 'image', x: 400, y: 0, w: 120, h: 80, z: 2, asset: assetKey, name: 'logo.png' },
          ],
        })
      ).body.node.id;
      attachmentId = (await bob.raw('POST', `/api/tickets/${ids.ticket}/attachments`, PNG, { 'Content-Type': 'image/png', 'X-File-Name': 'capture.png' })).json.attachment.id;
    });

    it('liste les images d’une note, d’un tableau et d’un ticket, même sans vision', async () => {
      await chat(bob, `outil:list_images {"note":${noteId}}`);
      assert.ok(toolNames().includes('list_images'));
      assert.ok(!toolNames().includes('view_image') && !toolNames().includes('view_board'), 'regarder demande la vision');
      const note = toolOutput();
      assert.deepEqual(note.images.map((entry: Record<string, unknown>) => entry.image ?? entry.url ?? entry.link), [`doc:${imageId}`, 'https://exemple.fr/a.png', 'absente.png'], 'hors du code');
      assert.equal(note.images[0].alt, 'Le schéma');
      assert.equal(note.images[1].readable, false);
      assert.equal(note.images[2].missing, true);
      assert.match(note.hint, /ne lit pas les images/);
      assert.match(String(lastRequest().messages[0]!.content), /Tu ne vois pas les images/);

      await chat(bob, `outil:list_images {"board":${boardId}}`);
      assert.deepEqual(toolOutput().images, [{ image: `asset:${assetKey}`, name: 'logo.png', element: 'i1', x: 400, y: 0, w: 120, h: 80 }]);
      await chat(bob, `outil:list_images {"ticket":"BTQ-1"}`);
      assert.deepEqual(toolOutput().images.map((entry: { image: string }) => entry.image), [`attachment:${attachmentId}`]);
      await chat(vera, `outil:list_images {"note":${noteId}}`);
      assert.ok(toolOutput().error, 'une note d’un espace dont on n’est pas membre reste fermée');
      assert.deepEqual(parseAiImageRef(`asset:${assetKey}`), { kind: 'asset', key: assetKey });
      assert.equal(parseAiImageRef('fichier:3'), null);
    });

    it('montre une image au modèle avec vision, dans les droits de la personne', async () => {
      const stream = events((await chat(bob, `outil:view_image {"image":"doc:${imageId}"}`, {}, false, { model: visionRef })).body);
      assert.ok(toolNames().includes('view_image') && !toolNames().includes('view_board'), 'sans panneau qui dessine, pas de vue de tableau');
      assert.deepEqual(sentImages(), [`data:image/png;base64,${PNG.toString('base64')}`], 'l’image suit le résultat de l’outil');
      const last = lastRequest().messages.at(-1)!;
      assert.equal(last.role, 'user');
      assert.match(JSON.stringify(last.content), /Images demandées aux outils.*schema\.png/);
      const step = stream.find((event) => event.type === 'step' && event.status === 'done');
      assert.ok(step?.type === 'step' && step.image === `/api/documentation/nodes/${imageId}/raw`, 'le panneau montre l’image regardée');
      assert.match(String(lastRequest().messages[0]!.content), /Tu vois les images/);

      events((await chat(bob, `outil:view_image {"image":"attachment:${attachmentId}"}`, {}, false, { model: visionRef })).body);
      assert.equal(sentImages().length, 1);
      events((await chat(vera, `outil:view_image {"image":"doc:${imageId}"}`, {}, false, { model: visionRef })).body);
      assert.ok(toolOutput().error, 'pas d’image hors de ses droits');
      assert.equal(sentImages().length, 0);
    });

    it('voit d’emblée le tableau ouvert et en regarde une zone de près, dessinés par le panneau', async () => {
      const { stream, renders } = await chatDrawing(bob, `outil:view_board {"board":${boardId},"elements":["s1"],"width":900}`, { boardId }, () => DRAWN);
      assert.deepEqual(renders[0], { kind: 'board', boardId, region: null, width: 1400 }, 'vue d’ensemble au début');
      assert.deepEqual(renders[1], { kind: 'board', boardId, region: { x: 68, y: 18, w: 264, h: 164 }, width: 900 }, 'zone de l’élément, avec une marge');
      const first = provider.requests.at(-2)!.body.messages.at(-1)!;
      assert.match(JSON.stringify(first.content), /outil:view_board.*Vue d’ensemble du tableau ouvert/, 'la vue d’ensemble accompagne la question');
      assert.deepEqual(sentImages(), [DRAWN, DRAWN]);
      assert.deepEqual(toolOutput().region, { x: 68, y: 18, w: 264, h: 164 });
      const steps = stream.filter((event): event is Extract<AiStreamEvent, { type: 'step' }> => event.type === 'step' && event.status === 'done');
      assert.ok(steps.some((step) => step.label === 'Vue d’ensemble de « Schéma »'));
      const renderEvents = stream.filter((event) => event.type === 'render');
      assert.ok(renderEvents.every((event) => event.type === 'render' && steps.some((step) => step.id === event.stepId)), 'chaque dessin est rattaché à son étape');
      assert.ok(toolNames().includes('view_board'));

      // Le panneau n'arrive pas à dessiner : l'outil échoue proprement, la réponse continue.
      const failed = await chatDrawing(bob, `outil:view_board {"board":${boardId},"region":{"x":0,"y":0,"w":300,"h":200}}`, {}, () => new Error('Dessin impossible'));
      assert.equal(failed.renders.length, 1, 'sans tableau ouvert, pas de vue d’ensemble');
      assert.match(String(toolOutput().error), /Dessin impossible/);
      assert.ok(failed.stream.some((event) => event.type === 'done'));
    });

    it('ne laisse répondre à une demande de dessin que la bonne personne, avec une vraie image', async () => {
      const unknown = '00000000-0000-4000-8000-000000000000';
      assert.equal((await bob.request('POST', `/api/ai/renders/${unknown}`, { image: DRAWN })).status, 404);
      assert.equal((await bob.request('POST', `/api/ai/renders/${unknown}`, { image: 'data:text/html;base64,PHNjcmlwdD4=' })).status, 400);
      assert.equal((await bob.request('POST', '/api/ai/renders/pas-un-id', { image: DRAWN })).status, 400);
    });

    it('dessine une zone d’un tableau en SVG, à la largeur demandée', async () => {
      const svg = String((await bob.get(`/api/boards/nodes/${boardId}/preview?x=68&y=18&w=264&h=164&width=900`)).body);
      assert.match(svg, /viewBox="68 18 264 164" width="900"/);
      const whole = String((await bob.get(`/api/boards/nodes/${boardId}/preview?width=2048`)).body);
      assert.doesNotMatch(whole, /width="2048"/, 'le tableau entier n’est jamais agrandi');
    });
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
