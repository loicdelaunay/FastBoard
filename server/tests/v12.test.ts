import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { addDays, todayISO } from '../../shared/dates.ts';
import { ticketProgress } from '../../shared/progress.ts';
import { normalizeSettings } from '../../shared/settings.ts';
import type { NotificationDTO, TicketDTO } from '../../shared/types.ts';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

describe('réglages 1.2 (unitaires)', () => {
  it('compte à 100 % les colonnes choisies, « Terminé » toujours inclus', () => {
    const ticket = { status: 'review' as const, progress: 20, assignees: [] };
    assert.equal(ticketProgress(ticket), 20);
    assert.equal(ticketProgress(ticket, ['review']), 100);
    const settings = normalizeSettings({ completeStatuses: ['review', 'bogus'], columnSort: { todo: { field: 'priority', direction: 'desc' }, done: { field: 'x' } }, deliveryWarnDays: 3, deliveryDangerDays: 9 });
    assert.deepEqual(settings.completeStatuses, ['review', 'done']);
    assert.deepEqual(settings.columnSort, { todo: { field: 'priority', direction: 'desc' } });
    assert.equal(settings.deliveryDangerDays, 3, 'le seuil rouge ne dépasse pas le seuil orange');
  });
});

describe('version 1.2 : liens, transfert, export, personnalisation, maintenance, notifications', () => {
  let app: Booted;
  let admin: TestClient;
  let bob: TestClient;
  let alice: TestClient;
  let agent: TestClient;
  const ids: Record<string, number> = {};

  const notifications = async (client: TestClient): Promise<{ notifications: NotificationDTO[]; unread: number }> => (await client.get('/api/me/notifications')).body;

  before(async () => {
    app = await bootServer();
    admin = app.client();
    await admin.login('admin@admin.com', 'admin1234');
    const roles = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
    const role = (key: string, scope = 'global') => roles.find((r) => r.key === key && r.scope === scope)!.id;
    for (const name of ['bob', 'alice']) {
      ids[name] = (await admin.post('/api/admin/users', { email: `${name}@t.fr`, name, password: 'motdepasse1', roleId: role('member') })).body.user.id;
    }
    bob = app.client();
    await bob.login('bob@t.fr', 'motdepasse1');
    alice = app.client();
    await alice.login('alice@t.fr', 'motdepasse1');
    ids.project = (await bob.post('/api/projects', { name: 'Suivi', key: 'SV' })).body.project.id;
    ids.other = (await bob.post('/api/projects', { name: 'Opérations', key: 'OPS' })).body.project.id;
    ids.editor = role('editor', 'project');
    await bob.post(`/api/projects/${ids.project}/members`, { userId: ids.alice, roleId: ids.editor });
    agent = app.client().useToken((await bob.post('/api/me/tokens', { name: 'agent', scope: 'write' })).body.secret);
    ids.ticket = (await bob.post(`/api/projects/${ids.project}/tickets`, { title: 'Paiement', status: 'todo' })).body.ticket.id;
  });

  after(async () => {
    await app.running.close();
  });

  it('ajoute des liens web et des chemins de fichiers aux pièces jointes', async () => {
    const url = await bob.post(`/api/tickets/${ids.ticket}/attachment-links`, { kind: 'url', target: 'exemple.fr/spec', name: 'Spécification' });
    assert.equal(url.status, 201);
    assert.equal(url.body.attachment.kind, 'url');
    assert.equal(url.body.attachment.url, 'https://exemple.fr/spec');
    assert.equal((await bob.post(`/api/tickets/${ids.ticket}/attachment-links`, { kind: 'url', target: 'javascript:alert(1)' })).status, 400);
    const path = await bob.post(`/api/tickets/${ids.ticket}/attachment-links`, { kind: 'path', target: '"C:\\Partage\\Maquette v2.fig"' });
    assert.equal(path.status, 201);
    assert.equal(path.body.attachment.url, 'C:\\Partage\\Maquette v2.fig');
    assert.equal(path.body.attachment.name, 'Maquette v2.fig');
    assert.equal((await bob.post(`/api/tickets/${ids.ticket}/attachment-links`, { kind: 'path', target: 'relatif/fichier.txt' })).status, 400);

    assert.equal((await bob.get(`/api/attachments/${url.body.attachment.id}/download`)).status, 404, 'pas de fichier pour un lien');
    assert.equal((await agent.post(`/api/attachments/${path.body.attachment.id}/open`)).status, 409, 'jamais ouvert pour un jeton');
    assert.equal((await bob.post(`/api/attachments/${url.body.attachment.id}/open`)).status, 400, 'seuls les chemins s’ouvrent');
    // Chemin absent de la machine : refusé avant toute ouverture.
    const missing = await bob.post(`/api/tickets/${ids.ticket}/attachment-links`, { kind: 'path', target: 'C:\\fastboard-test-inexistant\\x.txt' });
    assert.equal((await bob.post(`/api/attachments/${missing.body.attachment.id}/open`)).status, process.platform === 'win32' ? 404 : 400);

    const list = (await bob.get(`/api/tickets/${ids.ticket}/attachments`)).body.attachments;
    assert.equal(list.length, 3);
    assert.equal((await bob.del(`/api/attachments/${url.body.attachment.id}`)).status, 200);
    const history = (await bob.get(`/api/tickets/${ids.ticket}/history`)).body.history;
    assert.ok(history.some((entry: { data: { kind: string; link?: string } }) => entry.data.kind === 'attachment' && entry.data.link === 'url'));
  });

  it('déplace un ticket vers un autre projet en reprenant les listes de même nom', async () => {
    const otherPriorities = (await bob.get(`/api/projects/${ids.other}`)).body.priorities;
    const high = (await bob.get(`/api/projects/${ids.project}`)).body.priorities.find((p: { name: string }) => p.name === 'Haute').id;
    const created = (await bob.post(`/api/projects/${ids.project}/tickets`, { title: 'À déplacer', priorityId: high, assigneeIds: [ids.alice, ids.bob] })).body.ticket as TicketDTO;
    await bob.post(`/api/tickets/${created.id}/links`, { targetId: ids.ticket, reason: 'Lié à' });
    await bob.post(`/api/tickets/${created.id}/comments`, { body: 'Un commentaire qui suit le ticket.' });

    assert.equal((await alice.post(`/api/tickets/${created.id}/transfer`, { projectId: ids.other, status: 'todo' })).status, 404, 'alice ne voit pas le projet cible');
    const moved = await bob.post(`/api/tickets/${created.id}/transfer`, { projectId: ids.other, status: 'in_progress' });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.key, 'OPS-1');
    const ticket = moved.body.ticket as TicketDTO;
    assert.equal(ticket.projectId, ids.other);
    assert.equal(ticket.status, 'in_progress');
    assert.equal(ticket.priorityId, otherPriorities.find((p: { name: string }) => p.name === 'Haute').id);
    assert.deepEqual(ticket.assignees.map((a) => a.userId), [ids.bob], 'alice n’est pas membre du projet cible');
    assert.equal(ticket.links.length, 0);
    assert.equal(ticket.commentCount, 1);
    assert.equal((await bob.get(`/api/projects/${ids.project}/tickets?key=SV-2`)).body.total, 0);
    const history = (await bob.get(`/api/tickets/${created.id}/history`)).body.history;
    assert.equal(history[0].data.kind, 'transferred');
    const feed = (await bob.get(`/api/projects/${ids.project}/activity`)).body.activities;
    assert.equal(feed[0].data.kind, 'ticket_transferred');
    assert.equal(feed[0].data.direction, 'out');
  });

  it('exporte un projet en JSON complet et en CSV', async () => {
    const json = await bob.raw('GET', `/api/projects/${ids.project}/export?format=json`);
    assert.equal(json.status, 200);
    assert.match(json.headers.get('content-disposition') ?? '', /attachment; filename="sv-\d{4}-\d{2}-\d{2}\.json"/);
    assert.equal(json.json.project.key, 'SV');
    assert.ok(Array.isArray(json.json.tickets[0].history));
    assert.ok(Array.isArray(json.json.tickets[0].comments));
    const csv = await bob.raw('GET', `/api/projects/${ids.project}/export?format=csv`);
    const text = csv.bytes.toString('utf8');
    assert.ok(text.startsWith('\ufeffClé;Titre;'));
    assert.ok(text.includes('SV-1;Paiement;'));
    assert.equal((await app.client().get(`/api/projects/${ids.project}/export`)).status, 401);
  });

  it('change le nom, le logo et le message de maintenance (public, diffusé)', async () => {
    const before = (await app.client().get('/api/app')).body;
    assert.equal(before.name, 'FastBoard');
    assert.equal(before.maintenance, null);
    assert.equal((await bob.request('PUT', '/api/admin/app', { name: 'Atelier' })).status, 403);

    const socket = await bob.connect();
    try {
      const renamed = await admin.request('PUT', '/api/admin/app', { name: 'Atelier' });
      assert.equal(renamed.body.name, 'Atelier');
      await socket.waitFor((message) => message.t === 'app' && message.app.name === 'Atelier');
    } finally {
      socket.close();
    }
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const logo = await admin.raw('PUT', '/api/admin/app/logo', png, { 'Content-Type': 'image/png' });
    assert.equal(logo.status, 200);
    assert.ok(logo.json.logoVersion > 0);
    const served = await app.client().raw('GET', `/api/app/logo?v=${logo.json.logoVersion}`);
    assert.equal(served.headers.get('content-type'), 'image/png');
    assert.equal((await admin.raw('PUT', '/api/admin/app/logo', Buffer.from('<svg/>'), { 'Content-Type': 'image/png' })).status, 400);

    const ends = new Date(Date.now() + 3_600_000).toISOString();
    const set = await admin.request('PUT', '/api/admin/maintenance', { enabled: true, level: 'warning', title: 'Mise à jour', message: 'Quelques minutes.', endsAt: ends });
    assert.equal(set.status, 200);
    const info = (await app.client().get('/api/app')).body;
    assert.equal(info.maintenance.level, 'warning');
    assert.equal(info.maintenance.title, 'Mise à jour');
    const past = await admin.request('PUT', '/api/admin/maintenance', { enabled: true, level: 'info', message: 'Fini', endsAt: new Date(Date.now() - 60_000).toISOString() });
    assert.equal(past.body.app.maintenance, null, 'un message terminé disparaît');
    assert.equal((await admin.request('PUT', '/api/admin/maintenance', { enabled: true, level: 'info', startsAt: ends, endsAt: ends })).status, 400);
  });

  it('notifie les abonnés, les assignés et les personnes mentionnées', async () => {
    const ticket = (await bob.post(`/api/projects/${ids.project}/tickets`, { title: 'Notifs', assigneeIds: [ids.alice] })).body.ticket as TicketDTO;
    assert.deepEqual(ticket.watcherIds.sort(), [ids.bob, ids.alice].sort(), 'créateur et assignée suivent le ticket');

    let feed = await notifications(alice);
    assert.equal(feed.notifications[0]!.type, 'assigned');
    assert.equal(feed.notifications[0]!.ticketKey, 'SV-3');

    // Un changement fait par bob notifie alice (abonnée), pas bob lui-même.
    await bob.post(`/api/tickets/${ticket.id}/move`, { status: 'in_progress', beforeId: null });
    feed = await notifications(alice);
    assert.equal(feed.notifications[0]!.type, 'activity');
    assert.equal((await notifications(bob)).notifications.filter((n) => n.ticketId === ticket.id).length, 0);

    // Mention dans un commentaire : notification « mention » avec l'extrait, une seule fois.
    const socket = await alice.connect();
    try {
      await bob.post(`/api/tickets/${ticket.id}/comments`, { body: `Peux-tu relire @[alice](user:${ids.alice}) ? Merci.` });
      const pushed = await socket.waitFor((message) => message.t === 'notification' && message.notification.type === 'mention');
      assert.ok(pushed.t === 'notification' && pushed.notification.excerpt?.includes('@alice'));
    } finally {
      socket.close();
    }
    feed = await notifications(alice);
    assert.equal(feed.notifications.filter((n) => n.type === 'mention').length, 1);
    assert.equal(feed.notifications.filter((n) => n.createdAt === feed.notifications[0]!.createdAt && n.type === 'activity' && n.activity?.kind === 'comment').length, 0, 'pas de doublon « activité »');

    // Une mention ajoutée dans la description notifie ; la même mention n'est pas renvoyée ensuite.
    const carol = (await admin.post('/api/admin/users', { email: 'carol@t.fr', name: 'carol', password: 'motdepasse1', roleId: (await admin.get('/api/admin/roles')).body.roles.find((r: { key: string }) => r.key === 'member').id })).body.user.id;
    await bob.post(`/api/projects/${ids.project}/members`, { userId: carol, roleId: ids.editor });
    const carolClient = app.client();
    await carolClient.login('carol@t.fr', 'motdepasse1');
    await bob.patch(`/api/tickets/${ticket.id}`, { description: `Voir avec @[carol](user:${carol})` });
    await bob.patch(`/api/tickets/${ticket.id}`, { description: `Voir avec @[carol](user:${carol}) demain` });
    const carolFeed = await notifications(carolClient);
    assert.equal(carolFeed.notifications.filter((n) => n.type === 'mention').length, 1);
    // Une personne qui ne voit pas le projet n'est jamais notifiée.
    const outsider = (await admin.post('/api/admin/users', { email: 'dan@t.fr', name: 'dan', password: 'motdepasse1', roleId: (await admin.get('/api/admin/roles')).body.roles.find((r: { key: string }) => r.key === 'member').id })).body.user.id;
    await bob.post(`/api/tickets/${ticket.id}/comments`, { body: `@[dan](user:${outsider})` });
    const dan = app.client();
    await dan.login('dan@t.fr', 'motdepasse1');
    assert.equal((await notifications(dan)).notifications.length, 0);

    // Lecture.
    feed = await notifications(alice);
    assert.ok(feed.unread >= 3);
    const one = await alice.post('/api/me/notifications/read', { ids: [feed.notifications[0]!.id] });
    assert.equal(one.body.unread, feed.unread - 1);
    assert.equal((await alice.post('/api/me/notifications/read', {})).body.unread, 0);

    // Ne plus suivre : plus de notification d'activité.
    const unwatched = await alice.del(`/api/tickets/${ticket.id}/watch`);
    assert.ok(!unwatched.body.ticket.watcherIds.includes(ids.alice));
    await bob.patch(`/api/tickets/${ticket.id}`, { title: 'Notifs (renommé)' });
    assert.equal((await notifications(alice)).unread, 0);
    assert.equal((await alice.post(`/api/tickets/${ticket.id}/watch`)).body.ticket.watcherIds.includes(ids.alice), true);
  });

  it('affiche la livraison en cours sur la liste des projets', async () => {
    const today = todayISO();
    await bob.post(`/api/projects/${ids.project}/deliveries`, { name: 'V1', startDate: addDays(today, -5), endDate: addDays(today, 4) });
    const delivery = (await bob.get(`/api/projects/${ids.project}`)).body.deliveries[0].id;
    await bob.patch(`/api/tickets/${ids.ticket}`, { deliveryId: delivery, status: 'review' });
    await bob.patch(`/api/projects/${ids.project}`, { settings: { completeStatuses: ['review'] } });
    const summary = (await bob.get('/api/projects')).body.projects.find((p: { id: number }) => p.id === ids.project);
    assert.equal(summary.currentDelivery.name, 'V1');
    assert.equal(summary.currentDelivery.progress, 100, '« À tester » compte pour 100 %');
    assert.equal(summary.currentDelivery.timeElapsed, 60);
    assert.equal(summary.currentDelivery.daysLeft, 4);
    assert.equal(summary.currentDelivery.doneCount, 1);
    const other = (await bob.get('/api/projects')).body.projects.find((p: { id: number }) => p.id === ids.other);
    assert.equal(other.currentDelivery, null);
  });
});
