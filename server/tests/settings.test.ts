import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { defaultColumns, normalizeSettings } from '../../shared/settings.ts';
import type { ProjectSettingsDTO } from '../../shared/settings.ts';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

describe('réglages du projet', () => {
  let app: Booted;
  let bob: TestClient;
  let viewer: TestClient;
  const ids: Record<string, number> = {};

  const settings = async (): Promise<ProjectSettingsDTO> => (await bob.get(`/api/projects/${ids.project}`)).body.project.settings;
  const patch = (body: unknown, client = bob) => client.patch(`/api/projects/${ids.project}`, { settings: body });

  before(async () => {
    app = await bootServer();
    const admin = app.client();
    await admin.login('admin@admin.com', 'admin1234');
    const roles = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
    const member = roles.find((r) => r.key === 'member')!.id;
    for (const name of ['bob', 'vic']) {
      ids[name] = (await admin.post('/api/admin/users', { email: `${name}@t.fr`, name, password: 'motdepasse1', roleId: member })).body.user.id;
    }
    bob = app.client();
    await bob.login('bob@t.fr', 'motdepasse1');
    viewer = app.client();
    await viewer.login('vic@t.fr', 'motdepasse1');
    ids.project = (await bob.post('/api/projects', { name: 'Réglages', key: 'RG' })).body.project.id;
    await bob.post(`/api/projects/${ids.project}/members`, { userId: ids.vic, roleId: roles.find((r) => r.key === 'viewer' && r.scope === 'project')!.id });
  });

  after(async () => {
    await app.running.close();
  });

  it('applique par défaut les automatisations actuelles et les six colonnes', async () => {
    const current = await settings();
    assert.deepEqual([current.autoMoveDone, current.autoReopen, current.confetti], [true, true, true]);
    assert.deepEqual(current.columns, defaultColumns());
  });

  it('désactive le passage automatique à « Terminé » puis la réouverture automatique', async () => {
    const ticket = (await bob.post(`/api/projects/${ids.project}/tickets`, { title: 'Auto', status: 'in_progress', assigneeIds: [ids.bob] })).body.ticket;
    assert.equal((await patch({ autoMoveDone: false })).status, 200);
    const done = (await bob.patch(`/api/tickets/${ticket.id}/assignees/${ids.bob}`, { done: true })).body.ticket;
    assert.equal(done.status, 'in_progress', 'la colonne ne change pas toute seule');
    assert.ok(done.assignees[0].done);

    // Le passage manuel reste possible, et la réouverture est réglée à part.
    await bob.post(`/api/tickets/${ticket.id}/move`, { status: 'done', beforeId: null });
    assert.equal((await patch({ autoReopen: false })).status, 200);
    const reopened = (await bob.patch(`/api/tickets/${ticket.id}/assignees/${ids.bob}`, { done: false })).body.ticket;
    assert.equal(reopened.status, 'done', 'pas de réouverture automatique');

    await patch({ autoMoveDone: true, autoReopen: true });
    await bob.patch(`/api/tickets/${ticket.id}/assignees/${ids.bob}`, { done: true });
    await bob.patch(`/api/tickets/${ticket.id}/assignees/${ids.bob}`, { done: false });
    assert.equal((await bob.get(`/api/tickets/${ticket.id}`)).body.ticket.status, 'in_progress', 'réouverture automatique rétablie');
    await bob.patch(`/api/tickets/${ticket.id}/assignees/${ids.bob}`, { done: true });
    assert.equal((await bob.get(`/api/tickets/${ticket.id}`)).body.ticket.status, 'done');
    const history = (await bob.get(`/api/tickets/${ticket.id}/history`)).body.history as Array<{ data: { auto?: string } }>;
    assert.ok(history.some((entry) => entry.data.auto === 'all_parts_done'), 'le comportement historique est rétabli');
  });

  it('renomme, recolore et réordonne les colonnes', async () => {
    const columns = defaultColumns().map((column) => ({ ...column }));
    columns[1]!.label = 'Prêt à démarrer';
    columns[1]!.color = '#10b981';
    const reordered = [columns[1]!, columns[0]!, ...columns.slice(2)];
    const result = await patch({ columns: reordered });
    assert.equal(result.status, 200);
    const saved = await settings();
    assert.deepEqual(saved.columns.map((c) => c.status), ['todo', 'backlog', 'in_progress', 'blocked', 'review', 'done']);
    assert.equal(saved.columns[0]!.label, 'Prêt à démarrer');
    assert.equal(saved.columns[0]!.color, '#10b981');
    assert.equal(saved.autoMoveDone, true, 'les autres réglages sont conservés');
  });

  it('refuse les colonnes invalides', async () => {
    const columns = defaultColumns();
    assert.equal((await patch({ columns: columns.slice(1) })).status, 400, 'il faut les six colonnes');
    assert.equal((await patch({ columns: [columns[0], ...columns.slice(0, 5)] })).status, 400, 'pas de doublon');
    assert.equal((await patch({ columns: columns.map((c) => ({ ...c, label: '   ' })) })).status, 400, 'libellé vide');
    assert.equal((await patch({ columns: columns.map((c) => ({ ...c, color: 'rouge' })) })).status, 400);
    assert.equal((await patch({ columns: columns.map((c) => (c.status === 'done' ? { ...c, hidden: true } : c)) })).status, 400, '« Terminé » reste visible');
  });

  it('masque une colonne vide, pas une colonne qui contient des tickets, et refuse d\'y déplacer', async () => {
    await bob.post(`/api/projects/${ids.project}/tickets`, { title: 'En test', status: 'review' });
    const withTicket = defaultColumns().map((c) => (c.status === 'review' ? { ...c, hidden: true } : c));
    const refused = await patch({ columns: withTicket });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error.message, /contient 1 ticket/);

    const hideBlocked = (await settings()).columns.map((c) => (c.status === 'blocked' ? { ...c, hidden: true } : c));
    assert.equal((await patch({ columns: hideBlocked })).status, 200);
    const ticket = (await bob.post(`/api/projects/${ids.project}/tickets`, { title: 'Candidat' })).body.ticket;
    assert.equal((await bob.post(`/api/tickets/${ticket.id}/move`, { status: 'blocked', beforeId: null })).status, 400);
    assert.equal((await bob.patch(`/api/tickets/${ticket.id}`, { status: 'blocked' })).status, 400);
    assert.equal((await bob.post(`/api/projects/${ids.project}/tickets`, { title: 'x', status: 'blocked' })).status, 400);
    assert.equal((await bob.post(`/api/tickets/${ticket.id}/move`, { status: 'todo', beforeId: null })).status, 200);
  });

  it('réserve les réglages à la permission project.edit et les journalise', async () => {
    assert.equal((await patch({ confetti: false }, viewer)).status, 403);
    assert.equal((await patch({ confetti: false })).status, 200);
    assert.equal((await settings()).confetti, false);
    const feed = (await bob.get(`/api/projects/${ids.project}/activity?limit=50`)).body.activities as Array<{ data: { kind: string; changes?: Array<{ field: string; to: string }> } }>;
    const change = feed.find((a) => a.data.kind === 'project' && a.data.changes?.some((c) => c.field === 'settings' && /confettis : désactivé/.test(c.to)));
    assert.ok(change, 'le changement de réglage apparaît dans les activités');
  });

  it('diffuse les réglages aux membres connectés', async () => {
    const socket = await viewer.connect();
    socket.send({ t: 'subscribe', projectId: ids.project });
    await socket.waitFor((m) => m.t === 'subscribed');
    await patch({ confetti: true });
    const message = await socket.waitFor((m) => m.t === 'event' && m.event.type === 'project.updated');
    assert.ok(message.t === 'event' && message.event.type === 'project.updated');
    assert.equal(message.event.project.settings.confetti, true);
    socket.close();
  });

  it("mémorise la langue choisie par l'utilisateur sur son compte", async () => {
    assert.equal((await bob.get('/api/me')).body.user.locale, null, 'aucune langue choisie au départ');
    const changed = await bob.patch('/api/me', { locale: 'en' });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.user.locale, 'en');
    assert.equal((await bob.get('/api/me')).body.user.locale, 'en');
    assert.equal((await bob.patch('/api/me', { locale: 'de' })).status, 400, 'langue inconnue');
    assert.equal((await bob.patch('/api/me', { locale: 'fr' })).body.user.locale, 'fr');
  });

  it('corrige des réglages incomplets ou corrompus', () => {
    const fixed = normalizeSettings({ autoMoveDone: 'oui', columns: [{ status: 'done', label: '  ', color: 'x', hidden: true }, { status: 'inconnu' }, { status: 'done', label: 'Doublon' }] });
    assert.equal(fixed.autoMoveDone, true);
    assert.equal(fixed.columns.length, 6);
    assert.equal(fixed.columns[0]!.status, 'done');
    assert.equal(fixed.columns[0]!.label, 'Terminé');
    assert.equal(fixed.columns[0]!.hidden, false);
    assert.deepEqual(normalizeSettings(null), normalizeSettings(undefined));
  });
});
