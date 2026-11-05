import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { assigneesOf, ticketProgress } from '../../shared/progress.ts';
import type { HistoryEntryDTO, TicketDTO } from '../../shared/types.ts';
import { Db } from '../db/database.ts';
import { migrate } from '../db/migrations.ts';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

describe('lignes d’avancement', () => {
  it('résume les personnes à partir de leurs lignes', () => {
    const line = (id: number, userId: number | null, done: boolean, progress: number, doneAt: string | null = null) => ({ id, userId, note: '', done, progress, doneAt, position: id });
    const parts = [line(1, 7, true, 0, '2026-11-02'), line(2, 7, false, 50), line(3, null, false, 0), line(4, 8, true, 0, '2026-11-01'), line(5, 8, true, 0, '2026-11-03')];
    assert.deepEqual(assigneesOf(parts), [
      { userId: 7, done: false, progress: 75, doneAt: null },
      { userId: 8, done: true, progress: 100, doneAt: '2026-11-03' },
    ]);
    assert.equal(ticketProgress({ status: 'in_progress', progress: 12, parts }), 70, 'la ligne sans personne compte aussi');
  });

  describe('API', () => {
    let app: Booted;
    let owner: TestClient;
    let alice: TestClient;
    const ids: Record<string, number> = {};

    const newTicket = async (body: Record<string, unknown> = {}) => (await owner.post(`/api/projects/${ids.project}/tickets`, { title: 'Ticket', status: 'in_progress', ...body })).body.ticket as TicketDTO;
    const add = async (ticketId: number, body: Record<string, unknown>) => (await owner.post(`/api/tickets/${ticketId}/parts`, body)).body.ticket as TicketDTO;
    const historyOf = async (ticketId: number) => (await owner.get(`/api/tickets/${ticketId}/history`)).body.history as HistoryEntryDTO[];

    before(async () => {
      app = await bootServer();
      owner = app.client();
      await owner.login('admin@admin.com', 'admin1234');
      const roles = (await owner.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
      const role = (key: string, scope = 'global') => roles.find((entry) => entry.key === key && entry.scope === scope)!.id;
      ids.alice = (await owner.post('/api/admin/users', { email: 'alice@t.fr', name: 'alice', password: 'motdepasse1', roleId: role('member') })).body.user.id;
      ids.me = (await owner.get('/api/me')).body.user.id;
      alice = app.client();
      await alice.login('alice@t.fr', 'motdepasse1');
      ids.project = (await owner.post('/api/projects', { name: 'Lignes', key: 'LIG' })).body.project.id;
      await owner.post(`/api/projects/${ids.project}/members`, { userId: ids.alice, roleId: role('contributor', 'project') });
    });

    after(async () => {
      await app.running.close();
    });

    it('ajoute des lignes libres, avec ou sans personne, plusieurs par personne', async () => {
      const ticket = await newTicket();
      assert.deepEqual(ticket.parts, []);

      const free = await add(ticket.id, { note: '  Rédiger la note  ' });
      assert.equal(free.parts[0]!.note, 'Rédiger la note');
      assert.equal(free.parts[0]!.userId, null);
      assert.deepEqual(free.assignees, [], 'une ligne sans personne n’assigne personne');

      await add(ticket.id, { note: 'Maquette', userId: ids.alice });
      const third = await add(ticket.id, { note: 'Intégration', userId: ids.alice });
      assert.equal(third.parts.length, 3);
      assert.deepEqual(third.assignees.map((entry) => entry.userId), [ids.alice], 'une seule entrée par personne');

      const assigned = (await historyOf(ticket.id)).filter((entry) => entry.data.kind === 'assignees');
      assert.equal(assigned.length, 1, 'assignée une seule fois');
      assert.ok(third.watcherIds.includes(ids.alice!), 'la personne suit le ticket');

      assert.equal((await owner.post(`/api/tickets/${ticket.id}/parts`, {})).status, 400, 'il faut un texte ou une personne');
      assert.equal((await owner.post(`/api/tickets/${ticket.id}/parts`, { note: '   ' })).status, 400);
      assert.equal((await owner.patch(`/api/parts/${free.parts[0]!.id}`, { note: '' })).status, 400, 'une ligne libre garde un texte');
      assert.equal((await owner.post(`/api/tickets/${ticket.id}/parts`, { userId: 999_999 })).status, 400, 'membre du projet uniquement');
    });

    it('confie, réordonne et supprime une ligne', async () => {
      const created = await add((await newTicket()).id, { note: 'A' });
      await add(created.id, { note: 'B' });
      const list = await add(created.id, { note: 'C' });
      const [a, b, c] = list.parts;

      const moved = (await owner.patch(`/api/parts/${c!.id}`, { position: 0 })).body.ticket as TicketDTO;
      assert.deepEqual(moved.parts.map((part) => part.note), ['C', 'A', 'B']);

      const assigned = (await owner.patch(`/api/parts/${a!.id}`, { userId: ids.alice })).body.ticket as TicketDTO;
      assert.deepEqual(assigned.assignees.map((entry) => entry.userId), [ids.alice]);
      const released = (await owner.patch(`/api/parts/${a!.id}`, { userId: null })).body.ticket as TicketDTO;
      assert.deepEqual(released.assignees, []);

      const removed = (await owner.del(`/api/parts/${b!.id}`)).body.ticket as TicketDTO;
      assert.deepEqual(removed.parts.map((part) => part.note), ['C', 'A']);
      const actions = (await historyOf(created.id)).flatMap((entry) => (entry.data.kind === 'part' ? [entry.data.action] : []));
      assert.deepEqual(actions, ['removed', 'assigned', 'assigned', 'added', 'added', 'added']);
      assert.equal((await owner.patch('/api/parts/999999', { done: true })).status, 404);
    });

    it('la personne gère ses lignes, pas celles des autres', async () => {
      const ticket = await add((await newTicket()).id, { note: 'À moi', userId: ids.alice });
      const list = await add(ticket.id, { note: 'Sans personne' });
      const [mine, free] = list.parts;

      assert.equal((await alice.patch(`/api/parts/${mine!.id}`, { progress: 40, note: 'Précisé' })).status, 200);
      assert.equal((await alice.patch(`/api/parts/${mine!.id}`, { done: true })).status, 200);
      assert.equal((await alice.patch(`/api/parts/${mine!.id}`, { userId: null })).status, 403, 'confier demande ticket.edit');
      assert.equal((await alice.patch(`/api/parts/${mine!.id}`, { position: 1 })).status, 403);
      assert.equal((await alice.patch(`/api/parts/${free!.id}`, { done: true })).status, 403);
      assert.equal((await alice.post(`/api/tickets/${ticket.id}/parts`, { note: 'Non' })).status, 403);
      assert.equal((await alice.del(`/api/parts/${mine!.id}`)).status, 403);
    });

    it('termine le ticket quand toutes les lignes sont terminées, et le rouvre', async () => {
      const ticket = await add((await newTicket()).id, { note: 'A' });
      const list = await add(ticket.id, { note: 'B' });
      const [a, b] = list.parts;

      assert.equal(((await owner.patch(`/api/parts/${a!.id}`, { done: true })).body.ticket as TicketDTO).status, 'in_progress');
      assert.equal(((await owner.patch(`/api/parts/${b!.id}`, { done: true })).body.ticket as TicketDTO).status, 'done');
      assert.equal(((await owner.post(`/api/tickets/${ticket.id}/parts`, { note: 'Encore' })).body.ticket as TicketDTO).status, 'in_progress', 'une ligne de plus le rouvre');

      const reopened = (await owner.get(`/api/tickets/${ticket.id}`)).body.ticket as TicketDTO;
      const last = reopened.parts.at(-1)!;
      assert.equal(((await owner.del(`/api/parts/${last.id}`)).body.ticket as TicketDTO).status, 'done', 'il ne restait que cette ligne à faire');
    });

    it('une ligne à 100 % est terminée, et le pourcentage la rouvre', async () => {
      const ticket = await add((await newTicket()).id, { note: 'Seule' });
      const part = ticket.parts[0]!;
      const patch = async (body: Record<string, unknown>) => (await owner.patch(`/api/parts/${part.id}`, body)).body.ticket as TicketDTO;

      const full = await patch({ progress: 100 });
      assert.equal(full.parts[0]!.done, true);
      assert.ok(full.parts[0]!.doneAt);
      assert.equal(full.status, 'done', 'comme toutes les lignes terminées');

      const back = await patch({ progress: 70 });
      assert.deepEqual([back.parts[0]!.done, back.parts[0]!.progress, back.parts[0]!.doneAt], [false, 70, null]);
      assert.equal(back.status, 'in_progress');

      assert.equal((await patch({ done: true })).parts[0]!.done, true, 'terminer sans pourcentage reste possible');
      assert.equal((await patch({ done: false })).parts[0]!.progress, 70, 'on retrouve le pourcentage d’avant');

      await patch({ progress: 100 });
      const reopened = await patch({ done: false });
      assert.deepEqual([reopened.parts[0]!.done, reopened.parts[0]!.progress], [false, 0], 'une ligne rouverte quitte les 100 %');
      assert.equal((await patch({ done: true, progress: 40 })).parts[0]!.done, false, 'le pourcentage décide');
    });

    it('retirer une personne garde ses lignes rédigées, sans personne', async () => {
      const ticket = await newTicket({ assigneeIds: [ids.me, ids.alice] });
      const first = ticket.parts.find((part) => part.userId === ids.alice)!;
      await owner.patch(`/api/parts/${first.id}`, { note: 'Écrite' });
      await add(ticket.id, { userId: ids.alice });

      const after = (await owner.patch(`/api/tickets/${ticket.id}`, { assigneeIds: [ids.me] })).body.ticket as TicketDTO;
      assert.deepEqual(after.assignees.map((entry) => entry.userId), [ids.me]);
      assert.deepEqual(after.parts.map((part) => [part.userId, part.note]), [[ids.me, ''], [null, 'Écrite']], 'la ligne vide disparaît');
    });

    it('quitter le projet ou supprimer le compte libère les lignes', async () => {
      const email = 'temporaire@t.fr';
      const memberRole = ((await owner.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>).find((entry) => entry.key === 'member' && entry.scope === 'global')!.id;
      const contributor = ((await owner.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>).find((entry) => entry.key === 'contributor' && entry.scope === 'project')!.id;
      const temp = (await owner.post('/api/admin/users', { email, name: 'temp', password: 'motdepasse1', roleId: memberRole })).body.user.id as number;
      await owner.post(`/api/projects/${ids.project}/members`, { userId: temp, roleId: contributor });

      const ticket = await newTicket({ assigneeIds: [temp] });
      await add(ticket.id, { note: 'Rédigée', userId: temp });
      assert.equal((await owner.del(`/api/projects/${ids.project}/members/${temp}`)).status, 200);
      const left = (await owner.get(`/api/tickets/${ticket.id}`)).body.ticket as TicketDTO;
      assert.deepEqual(left.parts.map((part) => [part.userId, part.note]), [[null, 'Rédigée']]);

      await owner.post(`/api/projects/${ids.project}/members`, { userId: temp, roleId: contributor });
      const again = await newTicket({ assigneeIds: [temp] });
      await add(again.id, { note: 'Rédigée', userId: temp });
      assert.equal((await owner.del(`/api/admin/users/${temp}`)).status, 200);
      const gone = (await owner.get(`/api/tickets/${again.id}`)).body.ticket as TicketDTO;
      assert.deepEqual(gone.parts.map((part) => [part.userId, part.note]), [[null, 'Rédigée']]);
    });

    it('n’expose plus les sous-tâches', async () => {
      const ticket = await newTicket();
      assert.equal('subtasks' in ticket, false);
      assert.equal((await owner.post(`/api/tickets/${ticket.id}/subtasks`, { title: 'x' })).status, 404);
      assert.equal((await owner.patch(`/api/tickets/${ticket.id}/assignees/${ids.me}`, { done: true })).status, 404);
    });
  });
});

describe('migration v17 : parts et sous-tâches', () => {
  it('reprend les parts et les sous-tâches dans une liste unique', () => {
    const db = new Db(':memory:');
    migrate(db, 16);
    const now = '2026-10-01T10:00:00.000Z';
    db.run("INSERT INTO roles (scope, key, name, permissions, is_system, created_at) VALUES ('global', 'member', 'Membre', '[]', 1, ?)", now);
    for (const name of ['a', 'b']) db.run('INSERT INTO users (email, name, password_hash, role_id, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)', `${name}@t.fr`, name, 'x', now, now);
    const settings = (fields: Record<string, boolean>) => JSON.stringify({ ticketFields: fields });
    db.run("INSERT INTO projects (name, key, owner_id, created_at, updated_at, settings) VALUES ('P', 'PR', 1, ?, ?, ?)", now, now, settings({ assignees: false, progress: false, subtasks: true }));
    db.run("INSERT INTO projects (name, key, owner_id, created_at, updated_at, settings) VALUES ('Q', 'QR', 1, ?, ?, ?)", now, now, settings({ subtasks: false }));
    for (const number of [1, 2]) db.run("INSERT INTO tickets (project_id, number, title, created_by, created_at, updated_at) VALUES (1, ?, 'T', 1, ?, ?)", number, now, now);

    const part = (ticket: number, user: number, done: number, progress: number, note: string, at: string) =>
      db.run('INSERT INTO ticket_assignees (ticket_id, user_id, done, progress, done_at, assigned_at, note) VALUES (?, ?, ?, ?, ?, ?, ?)', ticket, user, done, progress, done ? now : null, at, note);
    const subtask = (ticket: number, title: string, position: number, done: number, assignee: number | null) =>
      db.run('INSERT INTO ticket_subtasks (ticket_id, title, done, position, assignee_id, created_at, done_at) VALUES (?, ?, ?, ?, ?, ?, ?)', ticket, title, done, position, assignee, now, done ? now : null);
    part(1, 1, 0, 0, '', '2026-10-01T10:00:01.000Z');
    part(1, 2, 0, 40, 'Mission de b', '2026-10-01T10:00:02.000Z');
    subtask(1, 'Seconde', 2, 0, null);
    subtask(1, 'Première', 1, 1, 1);
    subtask(1, 'Autre pour a', 3, 0, 1);
    subtask(1, 'Pour b', 4, 0, 2);
    subtask(2, 'Seule', 1, 1, null);

    migrate(db);

    const lines = (ticket: number) => db.all<{ user_id: number | null; note: string; done: number; progress: number }>('SELECT user_id, note, done, progress FROM ticket_parts WHERE ticket_id = ? ORDER BY position', ticket);
    assert.deepEqual(lines(1).map((line) => ({ ...line })), [
      { user_id: 1, note: 'Première', done: 1, progress: 100 },
      { user_id: 2, note: 'Mission de b', done: 0, progress: 40 },
      { user_id: null, note: 'Seconde', done: 0, progress: 0 },
      { user_id: 1, note: 'Autre pour a', done: 0, progress: 0 },
      { user_id: 2, note: 'Pour b', done: 0, progress: 0 },
    ]);
    assert.deepEqual(lines(2).map((line) => ({ ...line })), [{ user_id: null, note: 'Seule', done: 1, progress: 100 }]);

    for (const table of ['ticket_assignees', 'ticket_subtasks']) assert.equal(db.get('SELECT 1 FROM sqlite_master WHERE name = ?', table), undefined, `${table} supprimée`);
    const fields = (id: number) => (JSON.parse(db.get<{ settings: string }>('SELECT settings FROM projects WHERE id = ?', id)!.settings) as { ticketFields: Record<string, boolean> }).ticketFields;
    assert.equal(fields(1).progress, true, 'un projet qui n’affichait que les sous-tâches garde ses lignes visibles');
    assert.equal(fields(2).progress, undefined);
    assert.equal(db.get<{ user_version: number }>('PRAGMA user_version')?.user_version, 20);

    // Une ligne déjà à 100 % sans être cochée compte désormais comme terminée.
    db.exec('PRAGMA user_version = 19');
    db.run('INSERT INTO ticket_parts (ticket_id, user_id, note, done, progress, position, created_at) VALUES (2, NULL, ?, 0, 100, 99, ?)', 'À cent pour cent', now);
    migrate(db);
    const full = db.get<{ done: number; done_at: string | null }>('SELECT done, done_at FROM ticket_parts WHERE note = ?', 'À cent pour cent')!;
    assert.equal(full.done, 1);
    assert.ok(full.done_at);

    db.run('DELETE FROM users WHERE id = 1');
    assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ticket_parts WHERE user_id IS NULL AND ticket_id = 1')?.n, 3, 'un compte supprimé laisse ses lignes');
    db.close();
  });
});
