import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { applyRagTemplate, detectRagPreset, ragTemplates } from '../../shared/rag.ts';
import { boardChunks, docChunks, textChunks } from '../rag/chunks.ts';
import { normalize, similarity } from '../rag/embeddings.ts';
import { ragStatus, runRagIndex } from '../rag/index.ts';
import { DIMENSIONS, events, startFakeProvider } from './fakeAi.ts';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

const NOTE = [
  '# Paiements',
  '',
  'Cette note décrit le module de paiement.',
  '',
  '## Carte bancaire',
  '',
  'Le paiement par carte bancaire passe par le prestataire Stripe.',
  'Les remboursements partiels sont possibles pendant trente jours.',
  '',
  '## Livraison',
  '',
  'Les colis partent en vingt-quatre heures par transporteur.',
].join('\n');

describe('recherche sémantique (RAG)', () => {
  let provider: Awaited<ReturnType<typeof startFakeProvider>>;
  let app: Booted;
  let admin: TestClient;
  let bob: TestClient;
  let vera: TestClient;
  const ids: Record<string, number> = {};

  const ragSettings = (extra: Record<string, unknown> = {}) => ({ enabled: true, baseUrl: provider.url, model: 'embeddinggemma', format: 'auto', intervalHours: 6, ...extra });
  const chat = async (client: TestClient, content: string) => client.request('POST', '/api/ai/chat', { messages: [{ role: 'user', content }], context: {}, allowWrite: false });
  const toolOutput = () => JSON.parse(String(provider.chats.at(-1)!.messages.at(-1)!.content)) as Record<string, any>;
  const ctx = () => app.running.ctx;

  before(async () => {
    provider = await startFakeProvider();
    app = await bootServer();
    admin = app.client();
    await admin.login('admin@admin.com', 'admin1234');
    const roles = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
    const role = (key: string, scope = 'global') => roles.find((entry) => entry.key === key && entry.scope === scope)!.id;
    for (const name of ['bob', 'vera']) {
      ids[name] = (await admin.post('/api/admin/users', { email: `${name}@t.fr`, name, password: 'motdepasse1', roleId: role('member') })).body.user.id;
    }
    bob = app.client();
    await bob.login('bob@t.fr', 'motdepasse1');
    vera = app.client();
    await vera.login('vera@t.fr', 'motdepasse1');
    await admin.request('PUT', '/api/admin/documentation', { enabled: true });
    await admin.request('PUT', '/api/admin/ai', {
      enabled: true,
      maxSteps: 6,
      maxTurns: 10,
      providers: [{ name: 'Test', baseUrl: provider.url, timeoutSeconds: 30, models: [{ id: 'modele-test', vision: false, contextWindow: 128000, reasoning: false }] }],
      defaultModel: 'new0:modele-test',
    });

    // Bob : un projet, un espace de documentation et un espace de tableaux. Vera lit le projet, pas les espaces.
    ids.project = (await bob.post('/api/projects', { name: 'Boutique', key: 'BTQ' })).body.project.id;
    await bob.post(`/api/projects/${ids.project}/members`, { userId: ids.vera, roleId: role('viewer', 'project') });
    ids.ticket = (await bob.post(`/api/projects/${ids.project}/tickets`, { title: 'Paiement par carte bancaire', description: 'Brancher le prestataire de paiement Stripe pour la carte bancaire.' })).body.ticket.id;
    ids.other = (await bob.post(`/api/projects/${ids.project}/tickets`, { title: 'Emballage des colis', description: 'Choisir des cartons recyclés.' })).body.ticket.id;
    ids.space = (await bob.post('/api/documentation/spaces', { name: 'Guide' })).body.space.id;
    ids.note = (await bob.post(`/api/documentation/spaces/${ids.space}/nodes`, { path: 'Paiements', content: NOTE })).body.node.id;
    ids.boards = (await bob.post('/api/boards/spaces', { name: 'Schémas' })).body.space.id;
    const shape = (id: string, x: number, text: string) => ({ id, type: 'shape', shape: 'rect', x, y: 0, w: 200, h: 80, z: 1, text, color: 'blue', fill: 'tint', angle: 0 });
    ids.board = (
      await bob.post(`/api/boards/spaces/${ids.boards}/nodes`, {
        path: 'Architecture',
        elements: [
          shape('boutique0001', 0, 'Boutique en ligne'),
          shape('stripe000001', 400, 'Passerelle de paiement Stripe carte bancaire'),
          { id: 'lien00000001', type: 'connector', z: 2, from: { id: 'boutique0001', side: 'right' }, to: { id: 'stripe000001', side: 'left' }, color: 'default', style: 'straight', startArrow: false, endArrow: true, dashed: false, label: 'paiement' },
        ],
      })
    ).body.node.id;

    // L'administrateur : un projet et un espace où Bob n'est pas, qui parlent aussi de paiement.
    ids.secret = (await admin.post('/api/projects', { name: 'Finances', key: 'FIN' })).body.project.id;
    ids.secretTicket = (await admin.post(`/api/projects/${ids.secret}/tickets`, { title: 'Paiement par carte bancaire des fournisseurs', description: 'Carte bancaire et prestataire de paiement confidentiels.' })).body.ticket.id;
    ids.secretSpace = (await admin.post('/api/documentation/spaces', { name: 'Direction' })).body.space.id;
    ids.secretNote = (await admin.post(`/api/documentation/spaces/${ids.secretSpace}/nodes`, { path: 'Budget', content: 'Paiement par carte bancaire du prestataire de paiement : budget confidentiel.' })).body.node.id;
  });

  after(async () => {
    await app.running.close();
    await provider.close();
  });

  it('met en forme les textes selon le modèle (EmbeddingGemma, Nomic, Qwen3 Embedding)', () => {
    assert.equal(detectRagPreset('embeddinggemma:300m'), 'embeddinggemma');
    assert.equal(detectRagPreset('google/embeddinggemma-2'), 'embeddinggemma');
    assert.equal(detectRagPreset('nomic-embed-text:v1.5'), 'nomic');
    assert.equal(detectRagPreset('Qwen/Qwen3-Embedding-0.6B'), 'qwen3');
    assert.equal(detectRagPreset('qwen3-embedding:4b'), 'qwen3');
    assert.equal(detectRagPreset('text-embedding-3-small'), 'none');
    const gemma = ragTemplates({ format: 'auto', model: 'embeddinggemma', queryTemplate: '', documentTemplate: '' });
    assert.equal(applyRagTemplate(gemma.query, 'où ?'), 'task: search result | query: où ?');
    assert.equal(applyRagTemplate(gemma.document, 'texte', 'Guide'), 'title: Guide | text: texte');
    assert.equal(applyRagTemplate(gemma.document, 'texte'), 'title: none | text: texte', 'sans titre : « none »');
    const qwen = ragTemplates({ format: 'qwen3', model: 'x', queryTemplate: '', documentTemplate: '' });
    assert.match(applyRagTemplate(qwen.query, 'où ?'), /^Instruct: .+\nQuery:où \?$/);
    assert.equal(applyRagTemplate(qwen.document, 'texte'), 'texte', 'Qwen3 : le document tel quel');
    assert.equal(applyRagTemplate('search_query: ', 'où ?'), 'search_query: où ?', 'sans {text}, un simple préfixe');
    const vector = normalize([3, 4, 12], 2);
    assert.deepEqual([...vector].map((value) => Math.round(value * 10) / 10), [0.6, 0.8], 'tronqué puis normé');
    assert.ok(Math.abs(similarity(vector, vector) - 1) < 1e-6);
  });

  it('découpe les notes (lignes, titres), les tickets et les tableaux (éléments, liens)', () => {
    const chunks = docChunks('Paiements', NOTE, 300);
    const card = chunks.find((chunk) => chunk.text.includes('Stripe'))!;
    assert.equal(card.title, 'Paiements › Carte bancaire');
    assert.deepEqual([card.lineFrom, card.lineTo], [5, 8]);
    assert.equal(chunks.find((chunk) => chunk.text.includes('colis'))!.title, 'Paiements › Livraison');
    const code = docChunks('Code', '# Titre\n\n```bash\n# pas un titre\nnpm start\n```\n', 300);
    assert.equal(code.length, 1, 'un « # » dans un bloc de code n’est pas un titre');
    assert.equal(code[0]!.title, 'Code › Titre');

    assert.equal(textChunks('T', 'a'.repeat(700), 300).length, 3, 'un long paragraphe est coupé');
    assert.deepEqual(textChunks('T', 'Un.\n\nDeux.', 300).map((chunk) => chunk.text), ['Un.\n\nDeux.']);

    const board = boardChunks('Archi', [
      { id: 'b', type: 'shape', shape: 'rect', x: 400, y: 0, w: 10, h: 10, z: 1, text: 'API', color: 'blue', fill: 'tint', angle: 0 },
      { id: 'a', type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, z: 1, text: 'Navigateur', color: 'blue', fill: 'tint', angle: 0 },
      { id: 'c', type: 'connector', z: 2, from: { id: 'a', side: 'right' }, to: { id: 'b', side: 'left' }, color: 'default', style: 'straight', startArrow: false, endArrow: true, dashed: false, label: 'HTTPS' },
    ] as never);
    assert.equal(board[0]!.text, 'Navigateur\nAPI\nNavigateur → API (HTTPS)', 'de gauche à droite, puis les liens');
    assert.deepEqual(board[0]!.elements, ['a', 'b', 'c']);
  });

  it('se règle dans l’administration, clé chiffrée, et s’essaie avant d’être enregistré', async () => {
    const initial = (await admin.get('/api/admin/rag')).body;
    assert.equal(initial.settings.enabled, false);
    assert.equal(initial.settings.format, 'auto');
    assert.equal(initial.settings.intervalHours, 24);
    assert.equal((await bob.get('/api/admin/rag')).status, 403);
    assert.equal((await bob.request('POST', '/api/admin/rag/test', { baseUrl: provider.url, model: 'nomic-embed-text' })).status, 403);
    assert.equal((await app.client().get('/api/app')).body.rag, false);

    const test = async (model: string, extra: Record<string, unknown> = {}) => (await admin.post('/api/admin/rag/test', { baseUrl: provider.url, model, ...extra })).body.result;
    const gemma = await test('embeddinggemma:300m', { apiKey: 'sk-emb-0001' });
    assert.equal(gemma.ok, true, JSON.stringify(gemma));
    assert.equal(gemma.format, 'embeddinggemma');
    assert.equal(gemma.dimensions, DIMENSIONS);
    assert.ok(gemma.related > gemma.unrelated);
    const call = provider.embeddings.at(-1)!;
    assert.equal(call.authorization, 'Bearer sk-emb-0001', 'la clé saisie sert à l’essai');
    assert.match(call.input[0]!, /^task: search result \| query: /);
    assert.match(call.input[1]!, /^title: Guide d’installation \| text: /);

    await test('nomic-embed-text');
    assert.match(provider.embeddings.at(-1)!.input[0]!, /^search_query: /);
    assert.match(provider.embeddings.at(-1)!.input[1]!, /^search_document: /);
    await test('qwen3-embedding:0.6b');
    assert.match(provider.embeddings.at(-1)!.input[0]!, /^Instruct: .+\nQuery:/);
    assert.doesNotMatch(provider.embeddings.at(-1)!.input[1]!, /^Instruct/);
    await test('autre', { format: 'custom', queryTemplate: 'Q: {text}', documentTemplate: 'D[{title}] {text}' });
    assert.match(provider.embeddings.at(-1)!.input[0]!, /^Q: /);
    assert.match(provider.embeddings.at(-1)!.input[1]!, /^D\[Guide d’installation\] /);
    assert.equal((await test('nomic-embed-text', { dimensions: 16 })).dimensions, 16, 'vecteurs tronqués');
    const broken = await test('en-panne');
    assert.equal(broken.ok, false);
    assert.match(broken.message, /a répondu 500 : modèle introuvable/);
    assert.deepEqual((await admin.post('/api/admin/rag/models', { baseUrl: provider.url, model: '' })).body.models, ['embeddinggemma:300m', 'nomic-embed-text', 'qwen3-embedding:0.6b']);
    assert.equal((await admin.request('PUT', '/api/admin/rag', ragSettings({ intervalHours: 0 }))).status, 400, 'au moins une heure');

    const saved = await admin.request('PUT', '/api/admin/rag', ragSettings({ apiKey: 'sk-emb-secret-9876' }));
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.settings.hasKey, true);
    assert.equal(saved.body.settings.keyHint, '9876');
    assert.ok(!JSON.stringify(saved.body).includes('sk-emb-secret'), 'la clé n’est jamais renvoyée');
    assert.ok(!JSON.stringify((await admin.get('/api/admin/rag')).body).includes('sk-emb-secret'));
    assert.equal((await app.client().get('/api/app')).body.rag, true);
    await test('embeddinggemma');
    assert.equal(provider.embeddings.at(-1)!.authorization, 'Bearer sk-emb-secret-9876', 'sans clé saisie, la clé enregistrée');
  });

  it('s’active projet par projet et espace par espace (aucun par défaut), par ceux qui en ont le droit', async () => {
    assert.equal((await bob.get(`/api/projects/${ids.project}`)).body.project.rag, false);
    assert.equal((await vera.patch(`/api/projects/${ids.project}`, { rag: true })).status, 403, 'une lectrice ne le change pas');
    assert.equal((await bob.patch(`/api/projects/${ids.project}`, { rag: true })).body.project.rag, true);
    await bob.post(`/api/documentation/spaces/${ids.space}/members`, { userId: ids.vera, role: 'reader' });
    assert.equal((await vera.patch(`/api/documentation/spaces/${ids.space}`, { rag: true })).status, 403);
    await bob.request('DELETE', `/api/documentation/spaces/${ids.space}/members/${ids.vera}`);
    assert.equal((await bob.get(`/api/documentation/spaces/${ids.space}`)).body.space.rag, false);
    assert.equal((await bob.patch(`/api/documentation/spaces/${ids.space}`, { rag: true })).body.space.rag, true);
    assert.equal((await bob.patch(`/api/boards/spaces/${ids.boards}`, { rag: true })).body.space.rag, true);
    assert.equal((await admin.patch(`/api/projects/${ids.secret}`, { rag: true })).body.project.rag, true);
    assert.equal((await admin.patch(`/api/documentation/spaces/${ids.secretSpace}`, { rag: true })).body.space.rag, true);
  });

  it('indexe les tickets, les notes et les tableaux, puis seulement ce qui change', async () => {
    await runRagIndex(ctx());
    const status = ragStatus(ctx());
    assert.equal(status.lastError, null);
    assert.equal(status.dimensions, DIMENSIONS);
    assert.deepEqual(status.scopes.map((scope) => [scope.scope, scope.enabled, scope.sources]), [['project', 2, 3], ['docs', 2, 2], ['boards', 1, 1]]);
    const lines = ctx().db.all<{ line_from: number; line_to: number; title: string }>("SELECT line_from, line_to, title FROM rag_chunks WHERE kind = 'doc' AND source_id = ? ORDER BY position", ids.note);
    assert.ok(lines.some((row) => row.title === 'Paiements › Carte bancaire' && row.line_from === 5), JSON.stringify(lines));
    const documents = provider.embeddings.at(-1)!.input;
    assert.ok(documents.every((input) => input.startsWith('title: ')), 'format EmbeddingGemma pour les documents');

    const before = provider.embeddings.length;
    await runRagIndex(ctx());
    assert.equal(provider.embeddings.length, before, 'rien n’a changé : aucun calcul');
    await bob.patch(`/api/tickets/${ids.other}`, { description: 'Choisir des cartons recyclés et du papier kraft.' });
    await runRagIndex(ctx());
    const added = provider.embeddings.slice(before).flatMap((call) => call.input);
    assert.equal(added.length, 1, 'seul le ticket modifié est recalculé');
    assert.match(added[0]!, /kraft/);
  });

  it('l’assistant cherche par le sens, dans les seuls projets et espaces de la personne', async () => {
    const stream = events((await chat(bob, 'outil:search_knowledge {"query":"paiement par carte bancaire"}')).body);
    const output = toolOutput();
    const found = output.results.map((hit: { kind: string; id: number }) => `${hit.kind}:${hit.id}`);
    assert.ok(found.includes(`ticket:${ids.ticket}`), JSON.stringify(output));
    assert.ok(found.includes(`doc:${ids.note}`));
    assert.ok(found.includes(`board:${ids.board}`));
    assert.ok(!found.includes(`ticket:${ids.secretTicket}`) && !found.includes(`doc:${ids.secretNote}`), 'rien des espaces de l’administrateur');
    const note = output.results.find((hit: { kind: string }) => hit.kind === 'doc');
    assert.equal(note.lines, '5-8', 'les lignes du passage, pour le citer');
    assert.equal(note.spaceId, ids.space);
    const board = output.results.find((hit: { kind: string }) => hit.kind === 'board');
    assert.ok(board.elements.includes('stripe000001'));
    const sources = stream.flatMap((event) => (event.type === 'source' ? [`${event.source.kind}:${event.source.id}`] : []));
    assert.ok(sources.includes(`ticket:${ids.ticket}`) && sources.includes(`doc:${ids.note}`), 'les passages trouvés rejoignent les sources');
    assert.match(String(provider.embeddings.at(-1)!.input[0]), /^task: search result \| query: paiement/);
    assert.ok(String(provider.chats[0]?.messages[0]?.content ?? '').length > 0);

    await chat(bob, 'outil:search_knowledge {"query":"paiement par carte bancaire","kinds":["doc"]}');
    assert.deepEqual([...new Set(toolOutput().results.map((hit: { kind: string }) => hit.kind))], ['doc']);

    // Vera lit le projet de Bob, mais n'est dans aucun de ses espaces.
    await chat(vera, 'outil:search_knowledge {"query":"paiement par carte bancaire"}');
    assert.deepEqual([...new Set(toolOutput().results.map((hit: { kind: string }) => hit.kind))], ['ticket']);
    assert.ok(toolOutput().results.every((hit: { projectId: number }) => hit.projectId === ids.project));

    // L'administrateur voit tout ce qui est activé.
    await chat(admin, 'outil:search_knowledge {"query":"paiement par carte bancaire","limit":20}');
    const all = toolOutput().results.map((hit: { kind: string; id: number }) => `${hit.kind}:${hit.id}`);
    assert.ok(all.includes(`ticket:${ids.secretTicket}`) && all.includes(`doc:${ids.secretNote}`));
  });

  it('retire aussitôt de l’index un espace dont on coupe le RAG, et un élément supprimé', async () => {
    await bob.patch(`/api/documentation/spaces/${ids.space}`, { rag: false });
    assert.equal(ctx().db.get<{ n: number }>("SELECT COUNT(*) AS n FROM rag_chunks WHERE kind = 'doc' AND container_id = ?", ids.space)!.n, 0);
    await bob.request('DELETE', `/api/tickets/${ids.ticket}`);
    await chat(bob, 'outil:search_knowledge {"query":"paiement par carte bancaire"}');
    const found = toolOutput().results.map((hit: { kind: string; id: number }) => `${hit.kind}:${hit.id}`);
    assert.ok(!found.includes(`doc:${ids.note}`), 'espace coupé');
    assert.ok(!found.includes(`ticket:${ids.ticket}`), 'ticket supprimé, même avant la prochaine indexation');
  });

  it('reconstruit l’index quand le modèle change, et ne propose l’outil que si le RAG est activé', async () => {
    await admin.request('PUT', '/api/admin/rag', ragSettings({ model: 'nomic-embed-text' }));
    assert.equal(ragStatus(ctx()).stale, true);
    await chat(bob, 'outil:search_knowledge {"query":"paiement"}');
    assert.match(toolOutput().error, /reconstruction/);
    await runRagIndex(ctx());
    assert.equal(ragStatus(ctx()).stale, false);
    assert.ok(provider.embeddings.at(-1)!.input.every((input) => input.startsWith('search_document: ')), 'tout recalculé au format Nomic');
    await chat(bob, 'outil:search_knowledge {"query":"colis en carton"}');
    assert.ok(toolOutput().results.length > 0);
    assert.match(String(provider.embeddings.at(-1)!.input[0]), /^search_query: colis/);

    await admin.request('PUT', '/api/admin/rag', ragSettings({ enabled: false }));
    await chat(bob, 'Bonjour');
    assert.ok(!provider.chats.at(-1)!.tools.includes('search_knowledge'));
    assert.equal((await admin.post('/api/admin/rag/reindex', {})).status, 400);
    assert.equal((await app.client().get('/api/app')).body.rag, false);
  });
});
