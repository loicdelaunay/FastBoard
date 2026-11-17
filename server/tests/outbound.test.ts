import assert from 'node:assert/strict';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import tls from 'node:tls';
import { after, before, describe, it } from 'node:test';
import { describeNetworkError, outboundRequest, trustSystemCertificates } from '../system/outbound.ts';
import { createSelfSignedCertificate } from '../system/selfSigned.ts';
import { bootServer, TestClient } from './helpers.ts';

const MODEL = { id: 'modele-test', vision: false, contextWindow: 128000, reasoning: false };

/** Fournisseur d'IA en HTTPS avec un certificat auto-signé, comme un serveur interne. */
function startHttpsProvider(cert: string, key: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = https.createServer({ cert, key }, (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/models') res.end(JSON.stringify({ data: [{ id: 'modele-test' }] }));
    else res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'OK' } }] }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `https://localhost:${port}/v1`, close: () => new Promise((done) => server.close(() => done())) });
    });
  });
}

describe('appels sortants en HTTPS (fournisseurs d’IA)', () => {
  const { cert, key } = createSelfSignedCertificate(['localhost']);
  let provider: Awaited<ReturnType<typeof startHttpsProvider>>;
  let app: Awaited<ReturnType<typeof bootServer>>;
  let admin: TestClient;

  before(async () => {
    provider = await startHttpsProvider(cert, key);
    app = await bootServer();
    admin = app.client();
    await admin.login('admin@admin.com', 'admin1234');
  });

  after(async () => {
    await app.running.close();
    await provider.close();
  });

  it('explique un certificat non reconnu au lieu de « fetch failed », et passe sans vérification si on le demande', async () => {
    const refused = await admin.post('/api/admin/ai/models', { baseUrl: provider.url });
    assert.equal(refused.status, 502);
    assert.match(refused.body.error.message, /certificat HTTPS auto-signé/);
    assert.doesNotMatch(refused.body.error.message, /fetch failed/);
    const test = await admin.post('/api/admin/ai/test', { baseUrl: provider.url, model: 'modele-test' });
    assert.equal(test.body.ok, false);
    assert.match(test.body.message, /Vérifier le certificat HTTPS/);

    const accepted = await admin.post('/api/admin/ai/models', { baseUrl: provider.url, verifyCertificate: false });
    assert.equal(accepted.status, 200);
    assert.deepEqual(accepted.body.models.map((model: { id: string }) => model.id), ['modele-test']);
    assert.equal((await admin.post('/api/admin/ai/test', { baseUrl: provider.url, model: 'modele-test', verifyCertificate: false })).body.ok, true);

    // Le choix est gardé avec le fournisseur, et l'assistant passe par lui.
    const saved = await admin.request('PUT', '/api/admin/ai', {
      enabled: true,
      maxSteps: 4,
      maxTurns: 4,
      providers: [{ name: 'Interne', baseUrl: provider.url, timeoutSeconds: 30, models: [MODEL], verifyCertificate: false }],
      defaultModel: 'new0:modele-test',
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.settings.providers[0].verifyCertificate, false);
    const reply = await admin.request('POST', '/api/ai/chat', { messages: [{ role: 'user', content: 'Bonjour' }], context: {}, allowWrite: false });
    assert.match(String(reply.body), /OK/);
    assert.equal((await admin.get('/api/admin/ai')).body.settings.providers[0].verifyCertificate, false);
  });

  it('ajoute les autorités du système à celles de Node, sans doublon', () => {
    const before = tls.getCACertificates('default').length;
    const added = trustSystemCertificates();
    assert.equal(tls.getCACertificates('default').length, before + added);
    assert.equal(trustSystemCertificates(), 0, 'déjà ajoutées');
  });

  it('donne une cause lisible quand rien ne répond', async () => {
    // Un port libéré aussitôt : rien n'y écoute.
    const probe = https.createServer();
    const port = await new Promise<number>((resolve) => probe.listen(0, '127.0.0.1', () => resolve((probe.address() as AddressInfo).port)));
    await new Promise((resolve) => probe.close(resolve));
    const closed = `https://127.0.0.1:${port}/v1/models`;
    await assert.rejects(outboundRequest(closed), (error) => /connexion refusée/.test(describeNetworkError(error)));
    await assert.rejects(outboundRequest(closed, { verifyCertificate: false }), (error) => /connexion refusée/.test(describeNetworkError(error)));
  });
});
