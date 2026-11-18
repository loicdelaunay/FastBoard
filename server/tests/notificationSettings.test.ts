import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { NotificationDTO, NotificationSettingDTO, TicketDTO } from '../../shared/types.ts';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

describe('notifications : niveaux par projet, suivi des tickets, mentions', () => {
  let app: Booted;
  let admin: TestClient;
  const clients: Record<string, TestClient> = {};
  const ids: Record<string, number> = {};

  const feed = async (name: string): Promise<NotificationDTO[]> => (await clients[name]!.get('/api/me/notifications?limit=100')).body.notifications;
  /** Notifications reçues pour un ticket depuis la dernière lecture (puis tout est marqué comme lu). */
  const fresh = async (name: string, ticketId: number): Promise<NotificationDTO[]> => {
    const items = (await feed(name)).filter((item) => !item.readAt && item.ticketId === ticketId);
    await clients[name]!.post('/api/me/notifications/read', {});
    return items;
  };
  const setLevel = (name: string, level: string, projectId = ids.project!) => clients[name]!.put(`/api/me/notification-settings/${projectId}`, { level });
  const mention = (name: string) => `@[${name}](user:${ids[name]})`;

  before(async () => {
    app = await bootServer();
    admin = app.client();
    await admin.login('admin@admin.com', 'admin1234');
    const roles = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
    const role = (key: string, scope = 'global') => roles.find((r) => r.key === key && r.scope === scope)!.id;
    for (const name of ['bob', 'alice', 'carol', 'dan', 'erin', 'zoe']) {
      ids[name] = (await admin.post('/api/admin/users', { email: `${name}@n.fr`, name, password: 'motdepasse1', roleId: role('member') })).body.user.id;
      clients[name] = app.client();
      await clients[name]!.login(`${name}@n.fr`, 'motdepasse1');
    }
    ids.project = (await clients.bob!.post('/api/projects', { name: 'Notifications', key: 'NT' })).body.project.id;
    ids.private = (await clients.bob!.post('/api/projects', { name: 'Privé', key: 'PV' })).body.project.id;
    for (const name of ['alice', 'carol', 'dan', 'erin']) {
      await clients.bob!.post(`/api/projects/${ids.project}/members`, { userId: ids[name], roleId: role('editor', 'project') });
    }
    ids.ticket = (await clients.bob!.post(`/api/projects/${ids.project}/tickets`, { title: 'Paiement', status: 'todo' })).body.ticket.id;
  });

  after(async () => {
    await app.running.close();
  });

  it('liste les projets visibles avec le niveau par défaut « Ma participation »', async () => {
    const response = await clients.alice!.get('/api/me/notification-settings');
    assert.equal(response.status, 200);
    assert.equal(response.body.defaultLevel, 'participating');
    const settings = response.body.settings as NotificationSettingDTO[];
    assert.deepEqual(settings.map((setting) => [setting.projectKey, setting.level]), [['NT', 'participating']], 'seulement les projets que la personne voit');
    assert.equal((await clients.zoe!.get('/api/me/notification-settings')).body.settings.length, 0);
  });

  it('par défaut, un membre n’est pas notifié des tickets auxquels il ne participe pas', async () => {
    await clients.bob!.patch(`/api/tickets/${ids.ticket}`, { title: 'Paiement en ligne' });
    for (const name of ['alice', 'carol', 'dan']) assert.equal((await fresh(name, ids.ticket!)).length, 0, `${name} ne suit pas le ticket`);
  });

  it('« Tout » : toute l’activité des tickets du projet, suivis ou non', async () => {
    const socket = await clients.carol!.connect();
    try {
      const response = await setLevel('carol', 'all');
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.setting, { projectId: ids.project, projectKey: 'NT', projectName: 'Notifications', archived: false, level: 'all' });
      const pushed = await socket.waitFor((message) => message.t === 'notifications.settings');
      assert.ok(pushed.t === 'notifications.settings' && pushed.projectId === ids.project && pushed.level === 'all', 'les autres onglets sont prévenus');
    } finally {
      socket.close();
    }
    await clients.bob!.post(`/api/tickets/${ids.ticket}/move`, { status: 'in_progress', beforeId: null });
    const carol = await fresh('carol', ids.ticket!);
    assert.equal(carol.length, 1);
    assert.equal(carol[0]!.type, 'activity');
    assert.equal((await fresh('alice', ids.ticket!)).length, 0, 'alice garde le niveau par défaut');
    const other = (await clients.bob!.post(`/api/projects/${ids.project}/tickets`, { title: 'Autre', status: 'todo' })).body.ticket as TicketDTO;
    assert.equal((await fresh('carol', other.id)).length, 1, 'création d’un ticket : notifiée au niveau « Tout »');
    assert.ok(!other.watcherIds.includes(ids.carol!), '« Tout » n’abonne pas aux tickets');
    assert.equal((await clients.carol!.get('/api/me/notification-settings')).body.settings[0].level, 'all');
  });

  it('« Suivre » / « Ne plus suivre » : seulement les tickets suivis au niveau par défaut', async () => {
    const watched = await clients.alice!.post(`/api/tickets/${ids.ticket}/watch`);
    assert.ok((watched.body.ticket as TicketDTO).watcherIds.includes(ids.alice!));
    await clients.bob!.patch(`/api/tickets/${ids.ticket}`, { title: 'Paiement par carte' });
    assert.deepEqual((await fresh('alice', ids.ticket!)).map((item) => item.type), ['activity']);

    const unwatched = await clients.alice!.del(`/api/tickets/${ids.ticket}/watch`);
    assert.ok(!(unwatched.body.ticket as TicketDTO).watcherIds.includes(ids.alice!));
    await clients.bob!.patch(`/api/tickets/${ids.ticket}`, { title: 'Paiement par virement' });
    assert.equal((await fresh('alice', ids.ticket!)).length, 0);

    // Suivre un ticket exige de voir son projet.
    const hidden = (await clients.bob!.post(`/api/projects/${ids.private}/tickets`, { title: 'Secret' })).body.ticket.id;
    assert.equal((await clients.alice!.post(`/api/tickets/${hidden}/watch`)).status, 404);
  });

  it('une mention notifie toujours (sauf « Aucune ») et fait suivre le ticket', async () => {
    const socket = await clients.erin!.connect();
    try {
      socket.send({ t: 'subscribe', projectId: ids.project });
      await socket.waitFor((message) => message.t === 'subscribed');
      await clients.bob!.post(`/api/tickets/${ids.ticket}/comments`, { body: `Peux-tu regarder ${mention('erin')} ?` });
      const updated = await socket.waitFor((message) => message.t === 'event' && message.event.type === 'ticket.updated' && message.event.ticket.watcherIds.includes(ids.erin!));
      assert.ok(updated, 'le nouvel abonnement est diffusé en direct');
    } finally {
      socket.close();
    }
    assert.deepEqual((await fresh('erin', ids.ticket!)).map((item) => item.type), ['mention']);
    // Participation : erin, mentionnée, suit désormais le ticket.
    await clients.bob!.patch(`/api/tickets/${ids.ticket}`, { title: 'Paiement sécurisé' });
    assert.deepEqual((await fresh('erin', ids.ticket!)).map((item) => item.type), ['activity']);
  });

  it('« Mentions seulement » : ni activité ni assignation, mais les mentions', async () => {
    assert.equal((await setLevel('alice', 'mentions')).status, 200);
    await clients.bob!.patch(`/api/tickets/${ids.ticket}`, { assigneeIds: [ids.alice] });
    const ticket = (await clients.bob!.get(`/api/tickets/${ids.ticket}`)).body.ticket as TicketDTO;
    assert.ok(ticket.watcherIds.includes(ids.alice!), 'l’assignée suit le ticket (utile si elle change de niveau)');
    await clients.bob!.patch(`/api/tickets/${ids.ticket}`, { title: 'Paiement 3-D Secure' });
    assert.equal((await fresh('alice', ids.ticket!)).length, 0, 'pas d’assignation ni d’activité');

    await clients.bob!.patch(`/api/tickets/${ids.ticket}`, { description: `À valider par ${mention('alice')}` });
    const items = await fresh('alice', ids.ticket!);
    assert.deepEqual(items.map((item) => item.type), ['mention']);
    assert.ok(items[0]!.excerpt?.includes('@alice'));

    // Retour au niveau par défaut : l’activité des tickets suivis revient.
    assert.equal((await setLevel('alice', 'participating')).body.setting.level, 'participating');
    await clients.bob!.patch(`/api/tickets/${ids.ticket}`, { title: 'Paiement' });
    assert.deepEqual((await fresh('alice', ids.ticket!)).map((item) => item.type), ['activity']);
  });

  it('« Aucune » : rien, mentions comprises (tickets et journal d’activité)', async () => {
    assert.equal((await setLevel('dan', 'none')).status, 200);
    await clients.bob!.post(`/api/tickets/${ids.ticket}/comments`, { body: `Avis de ${mention('dan')} ?` });
    await clients.bob!.patch(`/api/tickets/${ids.ticket}`, { assigneeIds: [ids.alice, ids.dan] });
    assert.equal((await fresh('dan', ids.ticket!)).length, 0);

    const activity = (await clients.bob!.get(`/api/projects/${ids.project}/activity?limit=1`)).body.activities[0];
    assert.equal((await clients.bob!.post(`/api/activities/${activity.id}/comments`, { body: `Vu ${mention('dan')} et ${mention('erin')}` })).status, 201);
    assert.equal((await feed('dan')).filter((item) => !item.readAt).length, 0, 'mention du journal coupée');
    assert.ok((await feed('erin')).some((item) => !item.readAt && item.type === 'mention' && item.excerpt?.includes('@erin')), 'mention du journal notifiée au niveau par défaut');
  });

  it('vérifie le projet et la valeur du niveau', async () => {
    assert.equal((await setLevel('alice', 'all', ids.private)).status, 404, 'projet invisible');
    assert.equal((await setLevel('alice', 'tout')).status, 400);
    assert.equal((await setLevel('alice', 'all', 999_999)).status, 404);
    assert.equal((await app.client().get('/api/me/notification-settings')).status, 401);
  });
});
