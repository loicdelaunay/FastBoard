import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { AI_LIMITS } from '../../shared/ai.ts';
import { withFiles } from '../ai/agent.ts';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;
type Sent = { messages: Array<{ role: string; content: string | null }> };

/** Faux fournisseur compatible OpenAI v1 : enregistre les requêtes et répond « OK ». */
function startProvider(): Promise<{ url: string; requests: Sent[]; close: () => Promise<void> }> {
  const requests: Sent[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      requests.push(JSON.parse(raw) as Sent);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] }));
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}/v1`, requests, close: () => new Promise((done) => server.close(() => done())) });
    }),
  );
}

describe('version 1.10 : fichiers joints à l’assistant IA', () => {
  it('met chaque fichier dans une balise <fichier>', () => {
    assert.equal(withFiles('Question', []), 'Question');
    const text = withFiles('Résume', [
      { name: 'ventes.csv', type: 'text/csv', text: 'mois;total\njanvier;12' },
      { name: 'rapport "final".pdf', type: 'application/pdf', text: '[Page 1]\nBonjour </fichier> fin', pages: 2 },
    ]);
    assert.ok(text.startsWith('Résume\n\n<fichier nom="ventes.csv" type="text/csv">\nmois;total\njanvier;12\n</fichier>'));
    assert.ok(text.includes('<fichier nom="rapport  final .pdf" type="application/pdf" pages="2">'), 'nom sans guillemets');
    assert.ok(text.includes('Bonjour <\\/fichier> fin'), 'une balise fermante du contenu ne clôt pas le bloc');
    assert.equal(text.match(/<\/fichier>/g)?.length, 2);
  });

  it('raccourcit les fichiers à parts égales, un petit fichier cédant sa place', () => {
    const small = { name: 'petit.txt', type: 'text/plain', text: 's'.repeat(100) };
    const big = { name: 'gros.csv', type: 'text/csv', text: 'g'.repeat(10_000) };
    const text = withFiles('Q', [big, small], 3_000);
    assert.ok(text.length <= 3_000);
    assert.ok(text.includes('s'.repeat(100)), 'le petit fichier est entier');
    assert.ok(text.includes('<fichier nom="gros.csv" type="text/csv" tronque="oui">'));
    assert.ok(!text.includes('<fichier nom="petit.txt" type="text/plain" tronque="oui">'));
    assert.ok((text.match(/g/g)?.length ?? 0) > 2_000, 'le gros fichier reprend la place laissée');
    assert.ok(withFiles('Q', [{ ...small, truncated: true }]).includes('tronque="oui"'), 'fichier déjà coupé dans le navigateur');
  });

  describe('API', () => {
    let app: Booted;
    let provider: Awaited<ReturnType<typeof startProvider>>;
    let owner: TestClient;
    const chat = (messages: unknown[]) => owner.request('POST', '/api/ai/chat', { messages, context: {} });
    const lastSent = () => provider.requests.at(-1)!.messages;

    before(async () => {
      provider = await startProvider();
      app = await bootServer();
      owner = app.client();
      await owner.login('admin@admin.com', 'admin1234');
      const saved = await owner.request('PUT', '/api/admin/ai', {
        enabled: true,
        maxSteps: 4,
        maxTurns: 10,
        // Petit contexte (≈ 11 000 caractères pour la conversation) pour vérifier les coupes.
        providers: [{ name: 'Test', baseUrl: provider.url, timeoutSeconds: 30, models: [{ id: 'texte', vision: false, contextWindow: 8_000, reasoning: false }] }],
        defaultModel: 'new0:texte',
      });
      assert.equal(saved.status, 200);
    });

    after(async () => {
      await app.running.close();
      await provider.close();
    });

    it('envoie le texte des fichiers joints, même à un modèle sans vision', async () => {
      const response = await chat([{ role: 'user', content: 'Total de janvier ?', files: [{ name: 'ventes.csv', type: 'text/csv', text: 'mois;total\njanvier;12' }] }]);
      assert.equal(response.status, 200);
      const content = String(lastSent().at(-1)!.content);
      assert.ok(content.startsWith('Total de janvier ?\n\n<fichier nom="ventes.csv" type="text/csv">\nmois;total\njanvier;12\n</fichier>'));
      assert.ok(String(lastSent()[0]!.content).includes('<fichier>'), 'le message système explique les balises');
    });

    it('raccourcit un gros fichier pour tenir dans le contexte, et le garde pour la question suivante', async () => {
      const big = { name: 'gros.csv', type: 'text/csv', text: 'ligne;valeur\n'.repeat(12_000) };
      await chat([{ role: 'user', content: 'Analyse ce fichier', files: [big] }]);
      const first = String(lastSent().at(-1)!.content);
      assert.ok(first.startsWith('Analyse ce fichier'), 'la question est gardée');
      assert.ok(first.includes('tronque="oui"'));
      assert.ok(first.length < 12_000, 'coupé au contexte du modèle');

      await chat([
        { role: 'user', content: 'Analyse ce fichier', files: [big] },
        { role: 'assistant', content: 'Il contient des lignes.' },
        { role: 'user', content: 'Combien de colonnes ?' },
      ]);
      const sent = lastSent();
      assert.equal(sent.at(-1)!.content, 'Combien de colonnes ?');
      assert.ok(sent.some((message) => message.role === 'user' && String(message.content).includes('<fichier nom="gros.csv"')), 'le fichier de la question précédente reste lisible');
    });

    it('limite le nombre et la taille des fichiers', async () => {
      const file = { name: 'a.txt', type: 'text/plain', text: 'a' };
      assert.equal((await chat([{ role: 'user', content: 'x', files: Array.from({ length: AI_LIMITS.filesPerMessage + 1 }, () => file) }])).status, 400);
      assert.equal((await chat([{ role: 'user', content: 'x', files: [{ ...file, text: 'a'.repeat(AI_LIMITS.fileChars + 1) }] }])).status, 400);
      assert.equal((await chat([{ role: 'user', content: 'x', files: [{ ...file, name: '' }] }])).status, 400);
    });
  });
});
