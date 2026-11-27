import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { PersonalBoardDTO } from '../../shared/personalBoard.ts';
import type { ServerMessage } from '../../shared/realtime.ts';
import { bootServer, type SocketProbe, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

/**
 * « Mon tableau » (Accueil) : les tickets assignés à la personne dans tous ses projets, avec les listes et les droits de
 * chacun, l'activité qui la concerne, et les évènements en direct de ses projets — jamais rien d'un projet qu'elle ne
 * voit pas.
 */
describe('mon tableau', () => {
  let app: Booted;
  const clients: Record<string, TestClient> = {};
  const ids: Record<string, number> = {};
  const sockets: SocketProbe[] = [];
  const board = async (name: string): Promise<PersonalBoardDTO> => (await clients[name]!.get('/api/me/board')).body.board;

  before(async () => {
    app = await bootServer();
    const admin = app.client();
    await admin.login('admin@admin.com', 'admin1234');
    const roles = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
    const role = (key: string, scope = 'global') => roles.find((entry) => entry.key === key && entry.scope === scope)!.id;
    for (const name of ['alice', 'bob']) {
      ids[name] = (await admin.post('/api/admin/users', { email: `${name}@m.fr`, name, password: 'motdepasse1', roleId: role('member') })).body.user.id;
      clients[name] = app.client();
      await clients[name]!.login(`${name}@m.fr`, 'motdepasse1');
    }
    const alice = clients.alice!;
    // Bob est éditeur de « Site », lecteur de « Paie » ; « Secret » et « Ancien » ne le regardent pas, ou plus.
    for (const [name, key] of [['Site', 'ST'], ['Paie', 'PA'], ['Secret', 'SE'], ['Ancien', 'AN']] as const) ids[key] = (await alice.post('/api/projects', { name, key })).body.project.id;
    await alice.post(`/api/projects/${ids.ST}/members`, { userId: ids.bob, roleId: role('editor', 'project') });
    await alice.post(`/api/projects/${ids.PA}/members`, { userId: ids.bob, roleId: role('viewer', 'project') });
    await alice.post(`/api/projects/${ids.AN}/members`, { userId: ids.bob, roleId: role('editor', 'project') });
    const ticket = async (key: string, title: string, assigneeIds: number[]) => (await alice.post(`/api/projects/${ids[key]}/tickets`, { title, assigneeIds })).body.ticket.id as number;
    ids.siteMine = await ticket('ST', 'Refaire la page d’accueil', [ids.bob]);
    ids.siteOther = await ticket('ST', 'Corriger le pied de page', [ids.alice]);
    ids.paieMine = await ticket('PA', 'Vérifier les bulletins', [ids.bob, ids.alice]);
    ids.ancien = await ticket('AN', 'Vieux ticket', [ids.bob]);
    ids.secret = await ticket('SE', 'Ticket secret', [ids.alice]);
    await alice.patch(`/api/projects/${ids.AN}`, { archived: true });
  });

  after(async () => {
    for (const socket of sockets) socket.close();
    await app.running.close();
  });

  it('rassemble mes tickets de tous mes projets, avec leurs listes et mes droits dans chacun', async () => {
    const mine = await board('bob');
    assert.deepEqual(mine.projects.map((entry) => entry.project.key).sort(), ['PA', 'ST'], 'ni le projet archivé, ni celui où je ne suis pas');
    assert.deepEqual(mine.tickets.map((ticket) => ticket.id).sort((a, b) => a - b), [ids.siteMine, ids.paieMine].sort((a, b) => a - b), 'seulement les tickets qui me sont assignés');
    const site = mine.projects.find((entry) => entry.project.key === 'ST')!;
    const paie = mine.projects.find((entry) => entry.project.key === 'PA')!;
    assert.ok(site.permissions.includes('ticket.edit') && !paie.permissions.includes('ticket.edit'), 'chaque projet garde ses droits');
    assert.ok(site.memberIds.includes(ids.alice) && site.memberIds.includes(ids.bob));
    assert.ok(mine.categories.some((category) => category.projectId === ids.ST) && mine.categories.some((category) => category.projectId === ids.PA), 'les listes de chaque projet');
    assert.ok(mine.categories.every((category) => [ids.ST, ids.PA].includes(category.projectId)));
    assert.deepEqual(mine.users.map((user) => user.name).sort(), ['alice', 'bob']);
    // Lecteur de « Paie » : son ticket se lit, mais ne se modifie pas.
    assert.equal((await clients.bob!.patch(`/api/tickets/${ids.paieMine}`, { title: 'Non' })).status, 403);
    assert.equal((await clients.bob!.patch(`/api/tickets/${ids.siteMine}`, { title: 'Refaire la page d’accueil (v2)' })).status, 200);
  });

  it('l’activité qui me concerne : mes actions et ce qui touche mes tickets, rien d’autre', async () => {
    await clients.alice!.patch(`/api/tickets/${ids.siteOther}`, { title: 'Pied de page (Alice seule)' });
    await clients.alice!.patch(`/api/tickets/${ids.paieMine}`, { title: 'Vérifier les bulletins de novembre' });
    const { activities } = (await clients.bob!.get('/api/me/activity?limit=100')).body as { activities: Array<{ projectId: number; userId: number | null; data: { ticketId?: number } }> };
    const tickets = new Set(activities.map((activity) => activity.data.ticketId));
    assert.ok(tickets.has(ids.paieMine) && tickets.has(ids.siteMine), 'ce qui touche mes tickets');
    assert.ok(activities.some((activity) => activity.userId === ids.bob), 'mes propres actions');
    assert.ok(!tickets.has(ids.siteOther), 'pas le ticket d’Alice seule');
    assert.ok(!tickets.has(ids.secret), 'jamais un projet que je ne vois pas');
    const filtered = (await clients.bob!.get(`/api/me/activity?userId=${ids.bob}`)).body.activities as Array<{ userId: number }>;
    assert.ok(filtered.length > 0 && filtered.every((activity) => activity.userId === ids.bob), 'les filtres de l’activité s’appliquent');
  });

  it('reçoit en direct les évènements de mes projets, jamais ceux des autres', async () => {
    const socket = await clients.bob!.connect();
    sockets.push(socket);
    socket.send({ t: 'subscribe.mine' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await clients.alice!.patch(`/api/tickets/${ids.secret}`, { title: 'Secret modifié' });
    await clients.alice!.patch(`/api/tickets/${ids.paieMine}`, { title: 'Bulletins vérifiés' });
    const event = (await socket.waitFor((message) => message.t === 'event' && message.event.type === 'ticket.updated' && message.event.ticket.id === ids.paieMine)) as Extract<ServerMessage, { t: 'event' }>;
    assert.equal(event.projectId, ids.PA);
    assert.ok(!socket.messages.some((message) => message.t === 'event' && message.projectId === ids.SE), 'rien du projet « Secret »');
    // Retiré de « Paie » : il en est averti, et ses évènements ne lui parviennent plus.
    await clients.alice!.del(`/api/projects/${ids.PA}/members/${ids.bob}`);
    await socket.waitFor((message) => message.t === 'project.revoked' && message.projectId === ids.PA);
    const count = socket.messages.length;
    await clients.alice!.patch(`/api/tickets/${ids.paieMine}`, { title: 'Après le départ de Bob' });
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.ok(!socket.messages.slice(count).some((message) => message.t === 'event' && message.projectId === ids.PA));
    assert.deepEqual((await board('bob')).projects.map((entry) => entry.project.key), ['ST']);
  });

  it('un jeton limité à un projet ne voit que ce projet dans mon tableau', async () => {
    const created = await clients.bob!.post('/api/me/tokens', { name: 'agent', scope: 'read', projectIds: [ids.ST] });
    const agent = app.client().useToken(created.body.secret);
    const seen = (await agent.get('/api/me/board')).body.board as PersonalBoardDTO;
    assert.deepEqual(seen.projects.map((entry) => entry.project.key), ['ST']);
    assert.ok(seen.tickets.every((ticket) => ticket.projectId === ids.ST));
  });
});
