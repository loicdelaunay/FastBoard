import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

describe('version 1.6', () => {
  let app: Booted;
  let admin: TestClient;
  let bob: TestClient;
  let vera: TestClient;
  const ids: Record<string, number> = {};

  before(async () => {
    app = await bootServer();
    admin = app.client();
    await admin.login('admin@admin.com', 'admin1234');
    const roles = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
    const role = (key: string, scope = 'global') => roles.find((r) => r.key === key && r.scope === scope)!.id;
    for (const name of ['bob', 'vera']) {
      ids[name] = (await admin.post('/api/admin/users', { email: `${name}@t.fr`, name, password: 'motdepasse1', roleId: role('member') })).body.user.id;
    }
    ids.project = (await admin.post('/api/projects', { name: 'Atelier', key: 'ATL' })).body.project.id;
    await admin.post(`/api/projects/${ids.project}/members`, { userId: ids.bob, roleId: role('editor', 'project') });
    await admin.post(`/api/projects/${ids.project}/members`, { userId: ids.vera, roleId: role('viewer', 'project') });
    bob = app.client();
    await bob.login('bob@t.fr', 'motdepasse1');
    vera = app.client();
    await vera.login('vera@t.fr', 'motdepasse1');
    ids.ticket = (await bob.post(`/api/projects/${ids.project}/tickets`, { title: 'Refonte' })).body.ticket.id;
  });

  after(async () => {
    await app.running.close();
  });

  it('commente les évènements du journal, avec mentions notifiées', async () => {
    const activity = (await admin.get(`/api/projects/${ids.project}/activity`)).body.activities[0];
    assert.deepEqual(activity.comments, []);
    const created = await bob.post(`/api/activities/${activity.id}/comments`, { body: `Bien vu @[vera](user:${ids.vera}) !` });
    assert.equal(created.status, 201);
    assert.equal(created.body.comment.activityId, activity.id);
    assert.equal(created.body.comment.userId, ids.bob);

    const page = (await admin.get(`/api/projects/${ids.project}/activity`)).body.activities;
    assert.equal(page.find((entry: { id: number }) => entry.id === activity.id).comments.length, 1, 'commentaires inclus dans le journal');

    const notifications = (await vera.get('/api/me/notifications')).body.notifications;
    assert.equal(notifications[0].type, 'mention');
    assert.equal(notifications[0].ticketId, ids.ticket, 'rattachée au ticket de l’évènement');
    assert.match(notifications[0].excerpt, /@vera/);

    // Droits : une lectrice ne commente pas ; seul l'auteur modifie ; la modération supprime.
    assert.equal((await vera.post(`/api/activities/${activity.id}/comments`, { body: 'Moi aussi' })).status, 403);
    assert.equal((await bob.post(`/api/activities/${activity.id}/comments`, { body: '   ' })).status, 400);
    const commentId = created.body.comment.id;
    assert.equal((await admin.patch(`/api/activity-comments/${commentId}`, { body: 'Piraté' })).status, 403);
    const edited = await bob.patch(`/api/activity-comments/${commentId}`, { body: 'Bien vu, merci' });
    assert.equal(edited.body.comment.body, 'Bien vu, merci');
    assert.equal((await vera.del(`/api/activity-comments/${commentId}`)).status, 403);
    const removed = await admin.del(`/api/activity-comments/${commentId}`);
    assert.equal(removed.body.comment.deleted, true);
    assert.equal(removed.body.comment.body, '');
    assert.equal((await bob.post('/api/activities/999999/comments', { body: 'x' })).status, 404);
  });

  it('laisse créer composants et choix depuis les tickets quand le projet le permet', async () => {
    assert.equal((await bob.post(`/api/projects/${ids.project}/components`, { name: 'Paiement', color: '#6366f1', icon: 'pi pi-box' })).status, 403, 'réglage désactivé');
    await admin.patch(`/api/projects/${ids.project}`, {
      settings: {
        allowNewComponents: true,
        customFields: [
          { id: 'cf_client', label: 'Client', type: 'select', options: ['Acme'], allowNewOptions: true },
          { id: 'cf_tags', label: 'Étiquettes', type: 'multiselect', options: [], allowNewOptions: true },
          { id: 'cf_fixe', label: 'Fixe', type: 'select', options: ['A'] },
        ],
      },
    });
    const component = await bob.post(`/api/projects/${ids.project}/components`, { name: 'Paiement', color: '#6366f1', icon: 'pi pi-box' });
    assert.equal(component.status, 201);
    assert.equal((await vera.post(`/api/projects/${ids.project}/components`, { name: 'Autre', color: '#6366f1', icon: 'pi pi-box' })).status, 403, 'il faut pouvoir modifier les tickets');

    const updated = await bob.patch(`/api/tickets/${ids.ticket}`, { customFields: { cf_client: ' Globex ', cf_tags: ['web', 'mobile'] } });
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.body.ticket.customFields, { cf_client: 'Globex', cf_tags: ['web', 'mobile'] });
    const settings = (await bob.get(`/api/projects/${ids.project}`)).body.project.settings;
    assert.deepEqual(settings.customFields[0].options, ['Acme', 'Globex'], 'choix ajouté à la liste du projet');
    assert.deepEqual(settings.customFields[1].options, ['web', 'mobile']);
    assert.equal((await bob.patch(`/api/tickets/${ids.ticket}`, { customFields: { cf_fixe: 'B' } })).status, 400, 'liste fermée');
  });

  it('met à jour la dernière activité quand la session est réutilisée', async () => {
    const before = (await admin.get('/api/admin/users')).body.users.find((user: { id: number }) => user.id === ids.vera);
    assert.ok(before.lastSeenAt, 'renseignée à la connexion');
    // Connexion ancienne, session toujours valide : une requête met la dernière activité à jour.
    app.running.ctx.db.run("UPDATE users SET last_login_at = '2026-01-01T00:00:00.000Z', last_seen_at = '2026-01-01T00:00:00.000Z' WHERE id = ?", ids.bob);
    const { markSeen } = await import('../auth/sessions.ts');
    markSeen(app.running.ctx, ids.bob, true);
    await bob.get('/api/me');
    const after = (await admin.get('/api/admin/users')).body.users.find((user: { id: number }) => user.id === ids.bob);
    assert.equal(after.lastLoginAt, '2026-01-01T00:00:00.000Z');
    assert.ok(Date.parse(after.lastSeenAt) > Date.parse('2026-06-01'), 'activité récente');
  });
});
