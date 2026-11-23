import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { progressReminderUsers, withProgressUpdate } from '../../shared/progressReminder.ts';
import { normalizeSettings } from '../../shared/settings.ts';
import type { TicketDTO } from '../../shared/types.ts';
import { bootServer, patchPart, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

describe('rappel d’avancement', () => {
  const DAY = 86_400_000;
  const now = Date.parse('2026-11-23T12:00:00Z');
  const delivery = { startDate: '2026-11-16', endDate: '2026-11-30' };
  const settings = { progressReminder: true, progressReminderDays: 2 };
  const ago = (days: number) => new Date(now - days * DAY).toISOString();
  const ticket = (patch: Partial<Pick<TicketDTO, 'status' | 'deliveryId' | 'progressUpdates' | 'statusChangedAt' | 'deliveryAddedAt'>> = {}) => ({
    status: 'in_progress' as const,
    deliveryId: 1,
    assignees: [
      { userId: 1, done: false, progress: 40 },
      { userId: 2, done: false, progress: 10 },
      { userId: 3, done: true, progress: 100 },
    ],
    progressUpdates: [{ userId: 1, at: ago(0.5) }],
    statusChangedAt: ago(10),
    deliveryAddedAt: ago(10),
    ...patch,
  });

  it('signale les personnes sans mise à jour depuis le délai, pas celles à jour ni celles qui ont fini', () => {
    assert.deepEqual(progressReminderUsers(ticket(), delivery, settings, '2026-11-23', now), [2]);
    assert.deepEqual(progressReminderUsers(ticket({ progressUpdates: [{ userId: 1, at: ago(3) }] }), delivery, settings, '2026-11-23', now), [1, 2]);
  });

  it('seulement si le réglage est actif, le ticket « En cours » et sa livraison en cours', () => {
    assert.deepEqual(progressReminderUsers(ticket(), delivery, { ...settings, progressReminder: false }, '2026-11-23', now), []);
    assert.deepEqual(progressReminderUsers(ticket({ status: 'review' }), delivery, settings, '2026-11-23', now), []);
    assert.deepEqual(progressReminderUsers(ticket({ deliveryId: null }), undefined, settings, '2026-11-23', now), []);
    assert.deepEqual(progressReminderUsers(ticket(), delivery, settings, '2026-12-01', now), [], 'livraison terminée');
    assert.deepEqual(progressReminderUsers(ticket(), delivery, settings, '2026-11-15', now), [], 'livraison pas commencée');
  });

  it('ne compte pas le temps passé avant l’arrivée du ticket dans sa colonne ou sa livraison', () => {
    assert.deepEqual(progressReminderUsers(ticket({ statusChangedAt: ago(1) }), delivery, settings, '2026-11-23', now), []);
    assert.deepEqual(progressReminderUsers(ticket({ deliveryAddedAt: ago(1) }), delivery, settings, '2026-11-23', now), []);
  });

  it('garde la mise à jour la plus récente de chacun', () => {
    const updates = [{ userId: 1, at: '2026-11-20T10:00:00.000Z' }];
    assert.deepEqual(withProgressUpdate(updates, 1, '2026-11-19T10:00:00.000Z'), updates);
    assert.deepEqual(withProgressUpdate(updates, 1, '2026-11-21T10:00:00.000Z'), [{ userId: 1, at: '2026-11-21T10:00:00.000Z' }]);
    assert.deepEqual(withProgressUpdate(updates, 2, '2026-11-21T10:00:00.000Z').length, 2);
  });

  it('le réglage est désactivé par défaut, avec un délai borné', () => {
    assert.equal(normalizeSettings({}).progressReminder, false);
    assert.equal(normalizeSettings({}).progressReminderDays, 2);
    assert.equal(normalizeSettings({ progressReminderDays: 0 }).progressReminderDays, 2);
    assert.equal(normalizeSettings({ progressReminder: true, progressReminderDays: 5 }).progressReminderDays, 5);
  });

  describe('API', () => {
    let app: Booted;
    let bob: TestClient;
    let alice: TestClient;
    const ids: Record<string, number> = {};
    const updatesOf = async (ticketId: number) => ((await bob.get(`/api/tickets/${ticketId}`)).body.ticket as TicketDTO).progressUpdates;

    before(async () => {
      app = await bootServer();
      const admin = app.client();
      await admin.login('admin@admin.com', 'admin1234');
      const roles = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
      const role = (key: string, scope = 'global') => roles.find((r) => r.key === key && r.scope === scope)!.id;
      for (const name of ['bob', 'alice']) {
        ids[name] = (await admin.post('/api/admin/users', { email: `${name}@r.fr`, name, password: 'motdepasse1', roleId: role('member') })).body.user.id;
      }
      bob = app.client();
      await bob.login('bob@r.fr', 'motdepasse1');
      alice = app.client();
      await alice.login('alice@r.fr', 'motdepasse1');
      ids.project = (await bob.post('/api/projects', { name: 'Rappel', key: 'RP' })).body.project.id;
      await bob.post(`/api/projects/${ids.project}/members`, { userId: ids.alice, roleId: role('editor', 'project') });
    });

    after(async () => {
      await app.running.close();
    });

    it('se règle dans le projet', async () => {
      const response = await bob.patch(`/api/projects/${ids.project}`, { settings: { progressReminder: true, progressReminderDays: 3 } });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.project.settings.progressReminder, true);
      assert.equal(response.body.project.settings.progressReminderDays, 3);
      assert.equal((await bob.patch(`/api/projects/${ids.project}`, { settings: { progressReminderDays: 31 } })).status, 400);
    });

    it('date la dernière mise à jour de chacun : sa ligne ou un commentaire', async () => {
      const ticket = (await bob.post(`/api/projects/${ids.project}/tickets`, { title: 'Paiement', status: 'in_progress', assigneeIds: [ids.alice, ids.bob] })).body.ticket as TicketDTO;
      assert.deepEqual(ticket.progressUpdates, [], 'créer et assigner ne compte pas');

      assert.equal((await patchPart(alice, ticket.id, ids.alice!, { progress: 30 })).status, 200);
      let updates = await updatesOf(ticket.id);
      assert.deepEqual(updates.map((update) => update.userId), [ids.alice]);
      const first = updates[0]!.at;

      await bob.post(`/api/tickets/${ticket.id}/comments`, { body: 'Le paiement par carte fonctionne.' });
      updates = await updatesOf(ticket.id);
      assert.deepEqual(updates.map((update) => update.userId).sort(), [ids.alice, ids.bob].sort());

      await alice.post(`/api/tickets/${ticket.id}/comments`, { body: 'Reste le remboursement.' });
      updates = await updatesOf(ticket.id);
      assert.ok(updates.find((update) => update.userId === ids.alice)!.at >= first, 'la plus récente');
      const listed = ((await bob.get(`/api/projects/${ids.project}`)).body.tickets as TicketDTO[]).find((entry) => entry.id === ticket.id)!;
      assert.deepEqual(listed.progressUpdates, updates, 'même valeur dans le projet');
    });
  });
});
