import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { ActivityDTO } from '../../shared/types.ts';
import { Db } from '../db/database.ts';
import { migrate } from '../db/migrations.ts';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

const kinds = (activities: ActivityDTO[]): string[] =>
  activities.map((a) => (a.data.kind === 'ticket' ? `ticket:${a.data.entry.kind}` : a.data.kind === 'comment' ? `comment:${a.data.action}` : a.data.kind === 'member' ? `member:${a.data.action}` : a.data.kind === 'category' || a.data.kind === 'delivery' ? `${a.data.kind}:${a.data.action}` : a.data.kind));

describe("journal d'activité", () => {
  let app: Booted;
  let admin: TestClient;
  let bob: TestClient;
  let alice: TestClient;
  let agent: TestClient;
  const ids: Record<string, number> = {};

  const feed = async (client: TestClient, query = ''): Promise<{ activities: ActivityDTO[]; nextBefore: number | null }> =>
    (await client.get(`/api/projects/${ids.project}/activity${query}`)).body;

  before(async () => {
    app = await bootServer();
    admin = app.client();
    await admin.login('admin@admin.com', 'admin1234');
    const roles = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
    const role = (key: string, scope = 'global') => roles.find((r) => r.key === key && r.scope === scope)!.id;
    ids.member = role('member');
    ids.editor = role('editor', 'project');
    ids.viewer = role('viewer', 'project');
    for (const name of ['bob', 'alice', 'zoe']) {
      ids[name] = (await admin.post('/api/admin/users', { email: `${name}@t.fr`, name, password: 'motdepasse1', roleId: ids.member })).body.user.id;
    }
    bob = app.client();
    await bob.login('bob@t.fr', 'motdepasse1');
    alice = app.client();
    await alice.login('alice@t.fr', 'motdepasse1');
    ids.project = (await bob.post('/api/projects', { name: 'Suivi', key: 'SV' })).body.project.id;
    await bob.post(`/api/projects/${ids.project}/members`, { userId: ids.alice, roleId: ids.editor });
    const secret = (await bob.post('/api/me/tokens', { name: 'agent-planning', scope: 'write' })).body.secret as string;
    agent = app.client().useToken(secret);
  });

  after(async () => {
    await app.running.close();
  });

  it("enregistre l'ajout d'un membre et la création d'un ticket (assignés fusionnés)", async () => {
    const { activities } = await feed(bob);
    assert.deepEqual(kinds(activities), ['member:added']);
    assert.equal(activities[0]!.data.kind === 'member' && activities[0]!.data.user.name, 'alice');

    const created = await bob.post(`/api/projects/${ids.project}/tickets`, { title: 'Premier ticket', status: 'todo', assigneeIds: [ids.bob, ids.alice] });
    ids.ticket = created.body.ticket.id;
    const first = (await feed(bob)).activities[0]!;
    assert.equal(first.userId, ids.bob);
    assert.equal(first.group, 'ticket');
    assert.ok(first.data.kind === 'ticket');
    assert.equal(first.data.ticketKey, 'SV-1');
    assert.equal(first.data.entry.kind, 'created');
    assert.deepEqual(first.data.kind === 'ticket' && first.data.entry.kind === 'created' ? first.data.entry.assignees?.map((a) => a.name) : null, ['bob', 'alice']);
    assert.equal((await feed(bob)).activities.filter((a) => a.data.kind === 'ticket').length, 1, 'une seule ligne : créé + assignés');
  });

  it('suit les changements, déplacements, parts, commentaires et suppressions', async () => {
    await bob.post(`/api/tickets/${ids.ticket}/move`, { status: 'in_progress', beforeId: null });
    await alice.patch(`/api/tickets/${ids.ticket}`, { title: 'Premier ticket (renommé)', endDate: '2026-12-01' });
    await alice.patch(`/api/tickets/${ids.ticket}/assignees/${ids.alice}`, { done: true });
    await bob.post(`/api/tickets/${ids.ticket}/comments`, { body: 'Un   commentaire\n sur plusieurs lignes' });
    const reorderOnly = await bob.post(`/api/tickets/${ids.ticket}/move`, { status: 'in_progress', beforeId: null });
    assert.equal(reorderOnly.status, 200);

    const { activities } = await feed(bob);
    const recent = kinds(activities).slice(0, 6);
    assert.deepEqual(recent, ['comment:created', 'ticket:part', 'ticket:updated', 'ticket:updated', 'ticket:created', 'member:added']);
    const comment = activities[0]!.data;
    assert.ok(comment.kind === 'comment');
    assert.equal(comment.excerpt, 'Un commentaire sur plusieurs lignes', 'extrait aplati');
    const moved = activities[3]!.data;
    assert.ok(moved.kind === 'ticket' && moved.entry.kind === 'updated');
    assert.deepEqual(moved.entry.changes, [{ field: 'status', from: 'todo', to: 'in_progress' }]);
    const renamed = activities[2]!.data;
    assert.ok(renamed.kind === 'ticket' && renamed.entry.kind === 'updated');
    assert.deepEqual(renamed.entry.changes.map((c) => c.field).sort(), ['endDate', 'title']);
    assert.equal(renamed.ticketTitle, 'Premier ticket (renommé)');
  });

  it('retient la complétion automatique et la suppression avec la clé du ticket', async () => {
    await bob.patch(`/api/tickets/${ids.ticket}/assignees/${ids.bob}`, { done: true });
    const after = (await feed(bob)).activities.slice(0, 3).map((a) => a.data);
    assert.ok(after[0]!.kind === 'ticket' && after[0]!.entry.kind === 'updated' && after[0]!.entry.auto === 'all_parts_done');
    assert.ok(after[1]!.kind === 'ticket' && after[1]!.entry.kind === 'part');

    const other = (await bob.post(`/api/projects/${ids.project}/tickets`, { title: 'À supprimer' })).body.ticket.id as number;
    await bob.del(`/api/tickets/${other}`);
    const deleted = (await feed(bob)).activities[0]!.data;
    assert.deepEqual(deleted, { kind: 'ticket_deleted', ticketKey: 'SV-2', ticketTitle: 'À supprimer' });
  });

  it('journalise la configuration et les membres', async () => {
    const category = (await bob.post(`/api/projects/${ids.project}/categories`, { name: 'Sécurité', color: '#ef4444' })).body.category;
    await bob.patch(`/api/projects/${ids.project}/categories/${category.id}`, { name: 'Sûreté' });
    const delivery = (await bob.post(`/api/projects/${ids.project}/deliveries`, { name: 'V1', startDate: '2026-11-01', endDate: '2026-12-01' })).body.delivery;
    await bob.del(`/api/projects/${ids.project}/deliveries/${delivery.id}`);
    await bob.patch(`/api/projects/${ids.project}/members/${ids.alice}`, { roleId: ids.viewer });
    await bob.patch(`/api/projects/${ids.project}`, { name: 'Suivi 2026', archived: true });
    await bob.patch(`/api/projects/${ids.project}`, { archived: false });
    const { activities } = await feed(bob, '?group=config,member&limit=20');
    assert.deepEqual(kinds(activities).slice(0, 7), ['project', 'project', 'member:role_changed', 'delivery:deleted', 'delivery:created', 'category:updated', 'category:created']);
    const roleChange = activities.find((a) => a.data.kind === 'member' && a.data.action === 'role_changed')!.data;
    assert.ok(roleChange.kind === 'member');
    assert.deepEqual([roleChange.previousRole, roleChange.role], ['Éditeur', 'Lecteur']);
    const renamed = activities.find((a) => a.data.kind === 'category' && a.data.action === 'updated')!.data;
    assert.ok(renamed.kind === 'category');
    assert.deepEqual([renamed.previousName, renamed.name], ['Sécurité', 'Sûreté']);
    await bob.patch(`/api/projects/${ids.project}/members/${ids.alice}`, { roleId: ids.editor });
  });

  it("attribue à un jeton d'API les actions de l'agent (« via »)", async () => {
    await agent.post(`/api/tickets/${ids.ticket}/comments`, { body: 'Analyse faite par l\'agent' });
    const moved = (await agent.post(`/api/projects/${ids.project}/tickets`, { title: 'Créé par agent', status: 'backlog' })).body.ticket;
    await agent.post(`/api/tickets/${moved.id}/move`, { status: 'todo', beforeId: null });

    const viaApi = await feed(bob, '?viaApi=true');
    assert.equal(viaApi.activities.length, 3);
    assert.ok(viaApi.activities.every((a) => a.via === 'agent-planning' && a.userId === ids.bob));
    const humans = (await feed(bob)).activities.filter((a) => a.via === null);
    assert.ok(humans.length > 3, 'les actions de l\'interface n\'ont pas de « via »');
    assert.equal((await feed(bob, '?viaApi=false')).activities.length > 0, true);
  });

  it('filtre par groupe, personne, ticket et pagine par curseur', async () => {
    const byAlice = await feed(bob, `?userId=${ids.alice}`);
    assert.ok(byAlice.activities.length >= 2 && byAlice.activities.every((a) => a.userId === ids.alice));
    const comments = await feed(bob, '?group=comment');
    assert.ok(comments.activities.every((a) => a.group === 'comment'));
    const forTicket = await feed(bob, `?ticketId=${ids.ticket}&group=ticket`);
    assert.ok(forTicket.activities.length >= 5);
    assert.ok(forTicket.activities.every((a) => a.data.kind === 'ticket' && a.data.ticketId === ids.ticket));

    const all = (await feed(bob, '?limit=200')).activities;
    const seen: number[] = [];
    let cursor: number | null | undefined;
    for (let guard = 0; guard < 50; guard++) {
      const page = await feed(bob, `?limit=4${cursor ? `&before=${cursor}` : ''}`);
      assert.ok(page.activities.length <= 4);
      seen.push(...page.activities.map((a) => a.id));
      cursor = page.nextBefore;
      if (cursor === null) break;
    }
    assert.deepEqual(seen, all.map((a) => a.id), 'la pagination parcourt tout, sans doublon, du plus récent au plus ancien');
    assert.ok(seen.every((id, i) => i === 0 || id < seen[i - 1]!));
    assert.equal((await bob.get(`/api/projects/${ids.project}/activity?limit=0`)).status, 400);
    assert.equal((await bob.get(`/api/projects/${ids.project}/activity?group=inconnu`)).status, 400);
  });

  it("n'est visible que des membres du projet", async () => {
    const zoe = app.client();
    await zoe.login('zoe@t.fr', 'motdepasse1');
    assert.equal((await zoe.get(`/api/projects/${ids.project}/activity`)).status, 404);
    assert.equal((await admin.get(`/api/projects/${ids.project}/activity`)).status, 200, 'les administrateurs voient tous les projets');
  });

  it('diffuse chaque évènement en direct aux membres abonnés', async () => {
    const socket = await alice.connect();
    socket.send({ t: 'subscribe', projectId: ids.project });
    await socket.waitFor((m) => m.t === 'subscribed');
    await bob.post(`/api/tickets/${ids.ticket}/comments`, { body: 'Message pour le flux' });
    const message = await socket.waitFor((m) => m.t === 'event' && m.event.type === 'activity.created' && m.event.activity.data.kind === 'comment');
    assert.ok(message.t === 'event' && message.event.type === 'activity.created');
    assert.equal(message.actorId, ids.bob);
    assert.equal(message.event.activity.projectId, ids.project);
    socket.close();
  });

  it('supprime le journal avec le projet et conserve les actions quand un compte disparaît', async () => {
    const temp = (await bob.post('/api/projects', { name: 'Éphémère' })).body.project.id as number;
    await bob.post(`/api/projects/${temp}/tickets`, { title: 'x' });
    await bob.del(`/api/projects/${temp}`);
    assert.equal(app.running.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM activities WHERE project_id = ?', temp)?.n, 0);

    const before = (await feed(bob, '?limit=200')).activities.length;
    await admin.del(`/api/admin/users/${ids.zoe}`);
    assert.equal((await feed(bob, '?limit=200')).activities.length, before);
  });
});

describe('migration v2 : reprise de l\'existant', () => {
  it("convertit l'historique et les commentaires en journal, et ajoute les permissions aux rôles système", () => {
    const db = new Db(':memory:');
    migrate(db, 1);
    const now = '2026-10-01T10:00:00.000Z';
    db.run("INSERT INTO roles (scope, key, name, permissions, is_system, created_at) VALUES ('global', 'admin', 'Administrateur', ?, 1, ?)", JSON.stringify(['admin.access', 'users.view']), now);
    db.run("INSERT INTO roles (scope, key, name, permissions, is_system, created_at) VALUES ('global', 'member', 'Membre', ?, 1, ?)", JSON.stringify(['projects.create']), now);
    db.run("INSERT INTO roles (scope, key, name, permissions, is_system, created_at) VALUES ('global', 'guest', 'Invité', '[]', 1, ?)", now);
    db.run("INSERT INTO roles (scope, key, name, permissions, is_system, created_at) VALUES ('project', 'editor', 'Éditeur', ?, 1, ?)", JSON.stringify(['ticket.create']), now);
    db.run("INSERT INTO roles (scope, key, name, permissions, is_system, created_at) VALUES ('project', 'manager', 'Gestionnaire', ?, 1, ?)", JSON.stringify(['ticket.create']), now);
    db.run("INSERT INTO users (email, name, password_hash, role_id, created_at, updated_at) VALUES ('a@t.fr', 'A', 'x', 1, ?, ?)", now, now);
    db.run("INSERT INTO projects (name, key, owner_id, created_at, updated_at) VALUES ('P', 'PR', 1, ?, ?)", now, now);
    db.run("INSERT INTO tickets (project_id, number, title, created_by, created_at, updated_at) VALUES (1, 7, 'Un ticket', 1, ?, ?)", now, now);
    db.run('INSERT INTO ticket_history (ticket_id, user_id, data, created_at) VALUES (1, 1, ?, ?)', JSON.stringify({ kind: 'created', title: 'Un ticket' }), '2026-10-01T10:00:01.000Z');
    db.run('INSERT INTO ticket_comments (ticket_id, user_id, body, created_at) VALUES (1, 1, ?, ?)', 'Bonjour', '2026-10-01T10:00:02.000Z');
    db.run('INSERT INTO ticket_comments (ticket_id, user_id, body, created_at, deleted_at) VALUES (1, 1, ?, ?, ?)', 'Supprimé', '2026-10-01T10:00:03.000Z', '2026-10-01T10:00:04.000Z');

    migrate(db);

    const rows = db.all<{ grp: string; data: string; user_id: number }>('SELECT grp, data, user_id FROM activities ORDER BY id');
    assert.equal(rows.length, 2, 'les commentaires supprimés ne sont pas repris');
    assert.deepEqual(rows.map((r) => r.grp), ['ticket', 'comment']);
    assert.deepEqual(JSON.parse(rows[0]!.data), { kind: 'ticket', ticketId: 1, ticketKey: 'PR-7', ticketTitle: 'Un ticket', entry: { kind: 'created', title: 'Un ticket' } });
    assert.equal(JSON.parse(rows[1]!.data).excerpt, 'Bonjour');

    const perms = (key: string) => JSON.parse(db.get<{ permissions: string }>("SELECT permissions FROM roles WHERE key = ?", key)!.permissions) as string[];
    assert.deepEqual(perms('admin'), ['admin.access', 'users.view', 'tokens.create', 'tokens.manage', 'monitoring.view', 'logs.view', 'backups.manage', 'system.manage', 'settings.manage', 'ai.use', 'ai.manage']);
    assert.deepEqual(perms('member'), ['projects.create', 'tokens.create', 'ai.use']);
    assert.deepEqual(perms('guest'), []);
    assert.deepEqual(perms('editor'), ['ticket.create', 'attachment.create', 'ai.read', 'ai.write']);
    assert.deepEqual(perms('manager'), ['ticket.create', 'attachment.create', 'attachment.moderate', 'ai.read', 'ai.write']);
    assert.equal(db.get<{ user_version: number }>('PRAGMA user_version')?.user_version, 13);
    for (const table of ['ticket_attachments', 'app_logs', 'metrics_minutes', 'ai_conversations']) {
      assert.ok(db.get('SELECT 1 FROM sqlite_master WHERE name = ?', table), `la table ${table} est créée`);
    }
    const columns = db.all<{ name: string }>('PRAGMA table_info(ticket_assignees)').map((column) => column.name);
    assert.ok(columns.includes('note'), 'la migration v3 ajoute la mission des assignés');

    migrate(db);
    assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM activities')?.n, 2, 'idempotent : rien n\'est rejoué');
    db.close();
  });
});
