import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { notificationCategory, type NotificationCounts } from '../../shared/notificationCategories.ts';
import type { NotificationDTO } from '../../shared/types.ts';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

describe('notifications : catégories, page et effacement', () => {
  let app: Booted;
  let admin: TestClient;
  let bob: TestClient;
  let alice: TestClient;
  const ids: Record<string, number> = {};

  const feed = async (client: TestClient, query = '') => (await client.get(`/api/me/notifications?limit=100${query}`)).body as { notifications: NotificationDTO[]; unread: number; counts: NotificationCounts };

  before(async () => {
    app = await bootServer();
    admin = app.client();
    await admin.login('admin@admin.com', 'admin1234');
    const roles = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
    const role = (key: string, scope = 'global') => roles.find((r) => r.key === key && r.scope === scope)!.id;
    for (const name of ['bob', 'alice']) ids[name] = (await admin.post('/api/admin/users', { email: `${name}@c.fr`, name, password: 'motdepasse1', roleId: role('member') })).body.user.id;
    bob = app.client();
    await bob.login('bob@c.fr', 'motdepasse1');
    alice = app.client();
    await alice.login('alice@c.fr', 'motdepasse1');
    ids.project = (await bob.post('/api/projects', { name: 'Catégories', key: 'CA' })).body.project.id;
    await bob.post(`/api/projects/${ids.project}/members`, { userId: ids.alice, roleId: role('editor', 'project') });
    // Alice reçoit une assignation, un commentaire, un changement et une mention.
    ids.ticket = (await bob.post(`/api/projects/${ids.project}/tickets`, { title: 'Paiement', status: 'todo', assigneeIds: [ids.alice] })).body.ticket.id;
    await bob.post(`/api/tickets/${ids.ticket}/comments`, { body: 'Premier retour' });
    await bob.patch(`/api/tickets/${ids.ticket}`, { status: 'in_progress' });
    await bob.post(`/api/tickets/${ids.ticket}/comments`, { body: `Tu peux regarder @[alice](user:${ids.alice}) ?` });
  });

  after(async () => {
    await app.running.close();
  });

  it('classe chaque notification et compte les catégories', async () => {
    const all = await feed(alice);
    const categories = all.notifications.map(notificationCategory).sort();
    assert.deepEqual(categories, ['assigned', 'change', 'comment', 'mention']);
    assert.deepEqual(all.counts, { mention: { total: 1, unread: 1 }, assigned: { total: 1, unread: 1 }, comment: { total: 1, unread: 1 }, change: { total: 1, unread: 1 } });
    for (const category of ['mention', 'assigned', 'comment', 'change'] as const) {
      const filtered = await feed(alice, `&category=${category}`);
      assert.deepEqual(filtered.notifications.map(notificationCategory), [category], category);
    }
    assert.equal((await alice.get('/api/me/notifications?category=autre')).status, 400);
  });

  it('marque comme lue une catégorie seulement', async () => {
    const read = await alice.post('/api/me/notifications/read', { category: 'change' });
    assert.equal(read.status, 200);
    assert.equal(read.body.unread, 3);
    assert.deepEqual(read.body.counts.change, { total: 1, unread: 0 });
    assert.equal(read.body.counts.mention.unread, 1);
  });

  it('efface une notification, les lues, puis toutes ; chacun seulement les siennes', async () => {
    const mention = (await feed(alice, '&category=mention')).notifications[0]!;
    assert.equal((await bob.request('DELETE', `/api/me/notifications/${mention.id}`)).body.removed, 0, 'pas celles des autres');
    const one = await alice.request('DELETE', `/api/me/notifications/${mention.id}`);
    assert.equal(one.body.removed, 1);
    assert.equal(one.body.counts.mention.total, 0);

    const onlyRead = await alice.request('DELETE', '/api/me/notifications?read=true');
    assert.equal(onlyRead.body.removed, 1, 'le changement, déjà lu');
    assert.deepEqual((await feed(alice)).notifications.map(notificationCategory).sort(), ['assigned', 'comment']);

    const everything = await alice.request('DELETE', '/api/me/notifications');
    assert.equal(everything.body.removed, 2);
    assert.equal(everything.body.unread, 0);
    assert.equal((await feed(alice)).notifications.length, 0);
  });
});
