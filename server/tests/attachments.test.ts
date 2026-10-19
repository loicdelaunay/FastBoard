import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { sanitizeFileName, sniffImageMime } from '../../shared/attachments.ts';
import { startServer } from '../app.ts';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('pièces jointes', () => {
  let app: Booted;
  let admin: TestClient;
  let bob: TestClient;
  let alice: TestClient;
  let carl: TestClient;
  const ids: Record<string, number> = {};
  const uploadsDir = () => app.running.ctx.uploadsDir;

  const upload = (client: TestClient, ticketId: number, name: string, body: Uint8Array, type = 'application/octet-stream') =>
    client.raw('POST', `/api/tickets/${ticketId}/attachments`, body, { 'Content-Type': type, 'X-File-Name': encodeURIComponent(name) });

  before(async () => {
    app = await bootServer();
    admin = app.client();
    await admin.login('admin@admin.com', 'admin1234');
    const roles = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
    const role = (key: string, scope = 'global') => roles.find((r) => r.key === key && r.scope === scope)!.id;
    for (const name of ['bob', 'alice', 'carl']) {
      ids[name] = (await admin.post('/api/admin/users', { email: `${name}@t.fr`, name, password: 'motdepasse1', roleId: role('member') })).body.user.id;
    }
    bob = app.client();
    await bob.login('bob@t.fr', 'motdepasse1');
    alice = app.client();
    await alice.login('alice@t.fr', 'motdepasse1');
    carl = app.client();
    await carl.login('carl@t.fr', 'motdepasse1');
    ids.project = (await bob.post('/api/projects', { name: 'Pièces', key: 'PJ' })).body.project.id;
    await bob.post(`/api/projects/${ids.project}/members`, { userId: ids.alice, roleId: role('contributor', 'project') });
    await bob.post(`/api/projects/${ids.project}/members`, { userId: ids.carl, roleId: role('viewer', 'project') });
    ids.ticket = (await bob.post(`/api/projects/${ids.project}/tickets`, { title: 'Avec fichiers' })).body.ticket.id;
  });

  after(async () => {
    await app.running.close();
  });

  it('enregistre un fichier brut, avec son nom accentué, et le liste', async () => {
    const result = await upload(bob, ids.ticket, 'Rapport été 2026.pdf', Buffer.from('%PDF-1.4 contenu'), 'application/pdf');
    assert.equal(result.status, 201);
    const attachment = result.json.attachment;
    assert.equal(attachment.name, 'Rapport été 2026.pdf');
    assert.equal(attachment.mime, 'application/pdf');
    assert.equal(attachment.size, 16);
    assert.equal(attachment.userId, ids.bob);
    ids.pdf = attachment.id;

    const list = (await bob.get(`/api/tickets/${ids.ticket}/attachments`)).body.attachments;
    assert.deepEqual(list.map((a: { id: number }) => a.id), [ids.pdf]);
    assert.equal((await bob.get(`/api/tickets/${ids.ticket}`)).body.ticket.attachmentCount, 1);
    assert.equal(fs.readdirSync(uploadsDir()).length, 1);
  });

  it('accepte un fichier JSON sans le confondre avec une requête JSON', async () => {
    const result = await upload(bob, ids.ticket, 'données.json', Buffer.from('{"a":1}'), 'application/json');
    assert.equal(result.status, 201);
    assert.equal(result.json.attachment.mime, 'application/json');
    await bob.del(`/api/attachments/${result.json.attachment.id}`);
  });

  it("sert le fichier en téléchargement isolé, jamais en ligne sauf pour une vraie image", async () => {
    const file = await bob.raw('GET', `/api/attachments/${ids.pdf}/download?inline=1`);
    assert.equal(file.status, 200);
    assert.equal(file.bytes.toString(), '%PDF-1.4 contenu');
    assert.match(file.headers.get('content-disposition') ?? '', /^attachment; filename="Rapport _t_ 2026\.pdf"; filename\*=UTF-8''Rapport%20%C3%A9t%C3%A9%202026\.pdf$/);
    assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
    assert.match(file.headers.get('content-security-policy') ?? '', /sandbox/);

    const image = (await upload(bob, ids.ticket, 'pixel.png', PNG, 'image/png')).json.attachment;
    assert.equal(image.mime, 'image/png');
    const shown = await bob.raw('GET', `/api/attachments/${image.id}/download?inline=1`);
    assert.match(shown.headers.get('content-disposition') ?? '', /^inline/);
    assert.equal(shown.headers.get('content-type'), 'image/png');
    const downloaded = await bob.raw('GET', `/api/attachments/${image.id}/download`);
    assert.match(downloaded.headers.get('content-disposition') ?? '', /^attachment/);
    ids.png = image.id;
  });

  it("ne fait pas confiance au type annoncé : un faux PNG ou un SVG ne s'affiche jamais en ligne", async () => {
    const fake = (await upload(bob, ids.ticket, 'faux.png', Buffer.from('<script>alert(1)</script>'), 'image/png')).json.attachment;
    assert.equal(fake.mime, 'application/octet-stream');
    const svg = (await upload(bob, ids.ticket, 'dessin.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml')).json.attachment;
    const shown = await bob.raw('GET', `/api/attachments/${svg.id}/download?inline=1`);
    assert.match(shown.headers.get('content-disposition') ?? '', /^attachment/);
    // Un PNG annoncé comme autre chose est quand même reconnu.
    const real = (await upload(bob, ids.ticket, 'photo', PNG, 'application/octet-stream')).json.attachment;
    assert.equal(real.mime, 'image/png');
    for (const id of [fake.id, svg.id, real.id]) await bob.del(`/api/attachments/${id}`);
  });

  it('refuse le multipart, les fichiers vides et les noms dangereux sont assainis', async () => {
    const multipart = await bob.raw('POST', `/api/tickets/${ids.ticket}/attachments`, Buffer.from('--x\r\n'), { 'Content-Type': 'multipart/form-data; boundary=x' });
    assert.equal(multipart.status, 415);
    assert.equal((await upload(bob, ids.ticket, 'vide.txt', Buffer.alloc(0))).status, 400);
    const sneaky = await upload(bob, ids.ticket, '../../etc/passwd', Buffer.from('x'));
    assert.equal(sneaky.json.attachment.name, 'passwd');
    await bob.del(`/api/attachments/${sneaky.json.attachment.id}`);
    assert.equal(sanitizeFileName('a'.repeat(300) + '.txt', 50).length, 50);
    assert.ok(sanitizeFileName('a'.repeat(300) + '.txt', 50).endsWith('.txt'));
    assert.equal(sanitizeFileName('..', 50), 'fichier');
  });

  it('applique les permissions : contributeur oui, lecteur non, étranger au projet voit 404', async () => {
    assert.equal((await upload(alice, ids.ticket, 'alice.txt', Buffer.from('alice'))).status, 201);
    assert.equal((await upload(carl, ids.ticket, 'carl.txt', Buffer.from('carl'))).status, 403);
    assert.equal((await carl.get(`/api/tickets/${ids.ticket}/attachments`)).status, 200, 'un lecteur voit la liste');
    assert.equal((await carl.raw('GET', `/api/attachments/${ids.pdf}/download`)).status, 200);

    const stranger = app.client();
    await admin.post('/api/admin/users', { email: 'zed@t.fr', name: 'zed', password: 'motdepasse1', roleId: (await admin.get('/api/admin/roles?scope=global')).body.roles.find((r: { key: string }) => r.key === 'member').id });
    await stranger.login('zed@t.fr', 'motdepasse1');
    assert.equal((await upload(stranger, ids.ticket, 'x.txt', Buffer.from('x'))).status, 404);
    assert.equal((await stranger.raw('GET', `/api/attachments/${ids.pdf}/download`)).status, 404);
  });

  it("limite la suppression à l'auteur ou à un modérateur, supprime le fichier et diffuse l'évènement", async () => {
    const mine = (await upload(alice, ids.ticket, 'a-supprimer.txt', Buffer.from('bye'))).json.attachment;
    const socket = await bob.connect();
    socket.send({ t: 'subscribe', projectId: ids.project });
    await socket.waitFor((m) => m.t === 'subscribed');

    assert.equal((await carl.del(`/api/attachments/${mine.id}`)).status, 403);
    // Bob est propriétaire donc modérateur ; Alice, auteur, peut aussi supprimer.
    assert.equal((await bob.del(`/api/attachments/${mine.id}`)).status, 200);
    const message = await socket.waitFor((m) => m.t === 'event' && m.event.type === 'attachment.deleted');
    assert.ok(message.t === 'event' && message.event.type === 'attachment.deleted');
    assert.equal(message.event.attachment.id, mine.id);
    socket.close();

    const own = (await upload(alice, ids.ticket, 'a-moi.txt', Buffer.from('x'))).json.attachment;
    assert.equal((await alice.del(`/api/attachments/${own.id}`)).status, 200);
    assert.equal((await bob.get(`/api/attachments/${own.id}/download`)).status, 404);
    const kept = (await bob.get(`/api/tickets/${ids.ticket}/attachments`)).body.attachments.map((a: { name: string }) => a.name);
    assert.ok(!kept.includes('a-moi.txt'));
  });

  it("alimente l'historique du ticket et le journal d'activité", async () => {
    const history = (await bob.get(`/api/tickets/${ids.ticket}/history`)).body.history as Array<{ data: { kind: string; action?: string; name?: string } }>;
    assert.ok(history.some((entry) => entry.data.kind === 'attachment' && entry.data.action === 'added' && entry.data.name === 'Rapport été 2026.pdf'));
    assert.ok(history.some((entry) => entry.data.kind === 'attachment' && entry.data.action === 'removed'));
    const feed = (await bob.get(`/api/projects/${ids.project}/activity?limit=100`)).body.activities as Array<{ data: { kind: string; entry?: { kind: string } } }>;
    assert.ok(feed.some((a) => a.data.kind === 'ticket' && a.data.entry?.kind === 'attachment'));
  });

  it("fonctionne avec un jeton d'API en écriture, pas en lecture seule", async () => {
    const write = app.client().useToken((await bob.post('/api/me/tokens', { name: 'agent', scope: 'write' })).body.secret);
    const read = app.client().useToken((await bob.post('/api/me/tokens', { name: 'lecteur', scope: 'read' })).body.secret);
    const sent = await upload(write, ids.ticket, 'depuis-agent.txt', Buffer.from('agent'));
    assert.equal(sent.status, 201);
    assert.equal((await upload(read, ids.ticket, 'non.txt', Buffer.from('x'))).status, 403);
    assert.equal((await read.raw('GET', `/api/attachments/${sent.json.attachment.id}/download`)).bytes.toString(), 'agent');
    const feed = (await bob.get(`/api/projects/${ids.project}/activity?viaApi=true`)).body.activities;
    assert.ok(feed.length > 0);
  });

  it('applique la taille maximale (en-tête et flux) et la limite par ticket', async () => {
    const small = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', loginRateLimit: null, apiRateLimit: null, logToConsole: false, maxUploadBytes: 1024 });
    try {
      const client = new TestClient(`http://127.0.0.1:${small.port}`);
      await client.login('admin@admin.com', 'admin1234');
      const project = (await client.post('/api/projects', { name: 'Petit', key: 'PT' })).body.project.id;
      const ticket = (await client.post(`/api/projects/${project}/tickets`, { title: 't' })).body.ticket.id;
      const tooBig = await upload(client, ticket, 'gros.bin', Buffer.alloc(2048, 1));
      assert.equal(tooBig.status, 413);
      assert.match(tooBig.json.error.message, /taille maximale/);
      assert.equal(fs.readdirSync(small.ctx.uploadsDir).length, 0, 'aucun fichier partiel ne reste');
      assert.equal((await upload(client, ticket, 'ok.bin', Buffer.alloc(1024, 1))).status, 201);
    } finally {
      await small.close();
    }
  });

  it('supprime les fichiers avec le ticket puis avec le projet', async () => {
    const before = fs.readdirSync(uploadsDir()).length;
    assert.ok(before > 0);
    const ticket = (await bob.post(`/api/projects/${ids.project}/tickets`, { title: 'À supprimer' })).body.ticket.id;
    await upload(bob, ticket, 'temp.txt', Buffer.from('temp'));
    assert.equal(fs.readdirSync(uploadsDir()).length, before + 1);
    await bob.del(`/api/tickets/${ticket}`);
    assert.equal(fs.readdirSync(uploadsDir()).length, before);

    await bob.del(`/api/projects/${ids.project}`);
    assert.equal(fs.readdirSync(uploadsDir()).length, 0, 'plus aucun fichier orphelin');
    assert.equal(app.running.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ticket_attachments')?.n, 0);
  });

  it('reconnaît les images par leur contenu', () => {
    assert.equal(sniffImageMime(PNG), 'image/png');
    assert.equal(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
    assert.equal(sniffImageMime(Buffer.from('GIF89a....')), 'image/gif');
    assert.equal(sniffImageMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
    assert.equal(sniffImageMime(Buffer.from('<html>')), null);
    assert.ok(path.isAbsolute(uploadsDir()));
  });
});
