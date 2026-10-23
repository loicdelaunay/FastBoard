import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { after, before, describe, it } from 'node:test';
import { createSelfSignedCertificate } from '../system/selfSigned.ts';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/** Requête HTTPS qui fait confiance au certificat de test. */
function secureGet(port: number, ca: string, pathname = '/api/health'): Promise<{ status: number; headers: Record<string, unknown>; fingerprint: string }> {
  return new Promise((resolve, reject) => {
    const request = https.get({ host: '127.0.0.1', port, path: pathname, ca, servername: 'localhost' }, (response) => {
      const socket = response.socket as tls.TLSSocket;
      const fingerprint = socket.getPeerCertificate().fingerprint256;
      response.resume();
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, fingerprint }));
    });
    request.on('error', reject);
  });
}

describe('version 1.4', () => {
  let app: Booted;
  let owner: TestClient;
  const ids: Record<string, number> = {};

  before(async () => {
    app = await bootServer();
    owner = app.client();
    await owner.login('admin@admin.com', 'admin1234');
    ids.project = (await owner.post('/api/projects', { name: 'Atelier', key: 'ATL' })).body.project.id;
    ids.other = (await owner.post('/api/projects', { name: 'Ailleurs', key: 'AIL' })).body.project.id;
    ids.parent = (await owner.post(`/api/projects/${ids.project}/tickets`, { title: 'Refonte du site' })).body.ticket.id;
  });

  after(async () => {
    await app.running.close();
  });

  describe('sous-tickets', () => {
    it('crée des sous-tickets complets, sur un seul niveau et dans le même projet', async () => {
      const child = await owner.post(`/api/projects/${ids.project}/tickets`, { title: 'Maquettes', parentId: ids.parent, priorityId: null });
      assert.equal(child.status, 201);
      assert.equal(child.body.ticket.parentId, ids.parent);
      ids.child = child.body.ticket.id;
      ids.loose = (await owner.post(`/api/projects/${ids.project}/tickets`, { title: 'Hébergement' })).body.ticket.id;

      // Un seul niveau ; même projet ; pas soi-même.
      assert.equal((await owner.post(`/api/projects/${ids.project}/tickets`, { title: 'Petit-fils', parentId: ids.child })).status, 400);
      assert.equal((await owner.patch(`/api/tickets/${ids.parent}`, { parentId: ids.loose })).status, 400, 'un parent ne devient pas sous-ticket');
      assert.equal((await owner.patch(`/api/tickets/${ids.loose}`, { parentId: ids.loose })).status, 400);
      const foreign = (await owner.post(`/api/projects/${ids.other}/tickets`, { title: 'Autre' })).body.ticket.id;
      assert.equal((await owner.patch(`/api/tickets/${foreign}`, { parentId: ids.parent })).status, 400);

      // Rattacher un ticket existant : inscrit dans l'historique.
      const attached = await owner.patch(`/api/tickets/${ids.loose}`, { parentId: ids.parent });
      assert.equal(attached.body.ticket.parentId, ids.parent);
      const history = (await owner.get(`/api/tickets/${ids.loose}/history`)).body.history;
      const change = history.find((entry: { data: { kind: string } }) => entry.data.kind === 'updated').data.changes[0];
      assert.deepEqual([change.field, change.from, change.to], ['parent', null, 'ATL-1 — Refonte du site']);

      const csv = String((await owner.get(`/api/projects/${ids.project}/export?format=csv`)).body);
      assert.ok(csv.split('\r\n')[0]!.includes('Ticket parent'));
      assert.ok(csv.includes(';ATL-1;'), 'le parent figure dans l’export');
    });

    it('détache les sous-tickets quand le parent est supprimé ou change de projet', async () => {
      await owner.del(`/api/tickets/${ids.parent}`);
      assert.equal((await owner.get(`/api/tickets/${ids.child}`)).body.ticket.parentId, null, 'le sous-ticket reste, détaché');
      await owner.patch(`/api/tickets/${ids.child}`, { parentId: ids.loose });
      const moved = await owner.post(`/api/tickets/${ids.loose}/transfer`, { projectId: ids.other, status: 'todo' });
      assert.equal(moved.status, 200);
      assert.equal(moved.body.ticket.parentId, null);
      assert.equal((await owner.get(`/api/tickets/${ids.child}`)).body.ticket.parentId, null, 'les sous-tickets restent dans leur projet');
    });
  });

  it('règle l’affichage de l’avancement à 0 % (onglet Ticket)', async () => {
    const project = (await owner.get(`/api/projects/${ids.project}`)).body.project;
    assert.equal(project.settings.hideZeroProgress, false);
    const updated = await owner.patch(`/api/projects/${ids.project}`, { settings: { hideZeroProgress: true } });
    assert.equal(updated.body.project.settings.hideZeroProgress, true);
  });

  describe('HTTPS', () => {
    let dir: string;
    let port: number;
    const first = createSelfSignedCertificate(['localhost', '127.0.0.1']);

    before(async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fastboard-https-'));
      fs.writeFileSync(path.join(dir, 'cert.pem'), first.cert);
      fs.writeFileSync(path.join(dir, 'key.pem'), first.key);
      port = await freePort();
    });

    after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const settings = (extra: Record<string, unknown> = {}) => ({
      enabled: true,
      port,
      format: 'pem',
      certPath: path.join(dir, 'cert.pem'),
      keyPath: path.join(dir, 'key.pem'),
      caPath: '',
      pfxPath: '',
      redirectHttp: true,
      hsts: true,
      hstsMaxAgeDays: 30,
      trustProxy: false,
      ...extra,
    });

    it('vérifie les certificats avant de les enregistrer', async () => {
      const initial = (await owner.get('/api/admin/https')).body;
      assert.equal(initial.settings.enabled, false);
      assert.equal(initial.status.https.listening, false);

      const ok = await owner.post('/api/admin/https/test', { format: 'pem', certPath: path.join(dir, 'cert.pem'), keyPath: path.join(dir, 'key.pem') });
      assert.equal(ok.body.ok, true);
      assert.deepEqual(ok.body.certificate.altNames, ['localhost', '127.0.0.1']);
      assert.equal(ok.body.certificate.selfSigned, true);
      assert.ok(ok.body.certificate.daysLeft > 800);

      const other = createSelfSignedCertificate(['autre']);
      fs.writeFileSync(path.join(dir, 'other-key.pem'), other.key);
      const mismatch = await owner.post('/api/admin/https/test', { format: 'pem', certPath: path.join(dir, 'cert.pem'), keyPath: path.join(dir, 'other-key.pem') });
      assert.equal(mismatch.body.ok, false);
      assert.match(mismatch.body.message, /ne correspond pas/);
      assert.match((await owner.post('/api/admin/https/test', { format: 'pem', certPath: path.join(dir, 'absent.pem'), keyPath: path.join(dir, 'key.pem') })).body.message, /introuvable/);
      fs.writeFileSync(path.join(dir, 'bad.pfx'), 'pas un pfx');
      assert.equal((await owner.post('/api/admin/https/test', { format: 'pfx', pfxPath: path.join(dir, 'bad.pfx'), passphrase: 'x' })).body.ok, false);

      assert.equal((await owner.request('PUT', '/api/admin/https', settings({ keyPath: path.join(dir, 'other-key.pem') }))).status, 400, 'certificat refusé');
      assert.equal((await owner.request('PUT', '/api/admin/https', settings({ port: app.running.port }))).status, 400, 'port HTTP déjà pris');
      assert.equal((await owner.request('PUT', '/api/admin/https', settings({ certPath: '' }))).status, 400);
      assert.equal((await owner.get('/api/admin/https')).body.status.https.listening, false, 'rien n’a démarré');
    });

    it('sert le site en HTTPS sans redémarrer, avec HSTS, et recharge un nouveau certificat', async () => {
      const saved = await owner.request('PUT', '/api/admin/https', settings());
      assert.equal(saved.status, 200);
      assert.equal(saved.body.status.https.listening, true);
      assert.equal(saved.body.status.https.port, port);
      assert.equal(saved.body.status.https.certificate.altNames[0], 'localhost');

      const secure = await secureGet(port, first.cert);
      assert.equal(secure.status, 200);
      assert.equal(secure.headers['strict-transport-security'], `max-age=${30 * 86_400}`);
      // Depuis la machine elle-même, HTTP n'est pas redirigé (accès de secours) et n'a pas d'en-tête HSTS.
      const plain = await fetch(`${owner.base}/api/health`, { redirect: 'manual' });
      assert.equal(plain.status, 200);
      assert.equal(plain.headers.get('strict-transport-security'), null);

      // Nouveau certificat sur le même port : rechargé à chaud.
      const renewed = (await owner.post('/api/admin/https/self-signed', { hostnames: ['localhost'] })).body;
      assert.ok(fs.existsSync(renewed.certPath) && fs.existsSync(renewed.keyPath));
      const reloaded = await owner.request('PUT', '/api/admin/https', settings({ certPath: renewed.certPath, keyPath: renewed.keyPath }));
      assert.equal(reloaded.body.status.https.port, port);
      const again = await secureGet(port, fs.readFileSync(renewed.certPath, 'utf8'));
      assert.equal(again.fingerprint, renewed.certificate.fingerprint);

      const disabled = await owner.request('PUT', '/api/admin/https', settings({ enabled: false }));
      assert.equal(disabled.body.status.https.listening, false);
      await assert.rejects(secureGet(port, first.cert), 'HTTPS arrêté');
    });
  });
});
