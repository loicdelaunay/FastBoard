import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { burndownSeries } from '../../shared/burndown.ts';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

describe('version 1.9 : burn-down des tickets ajoutés', () => {
  const range = { start: '2026-11-01', end: '2026-11-05', today: '2026-11-04' };
  const tickets = [
    { added: '2026-10-28', done: '2026-11-02' },
    { added: '2026-11-01' },
    { added: '2026-11-03' },
    { added: '2026-11-03', done: '2026-11-04' },
    { added: '2026-10-20', done: '2026-10-25' },
    // Terminé avant d'être rattaché : n'entre jamais dans le reste à faire.
    { added: '2026-11-03', done: '2026-11-02' },
  ];

  it('compte tout le périmètre dès le premier jour sans le mode', () => {
    const series = burndownSeries(tickets, range, false);
    assert.deepEqual(series.actual, [5, 3, 3, 2, null]);
    assert.deepEqual(series.ideal, [5, 3.75, 2.5, 1.25, 0], 'ligne droite vers zéro');
    assert.deepEqual(series.added, [null, null, null, null, null]);
    assert.equal(series.tracksAdded, false);
  });

  it('fait remonter la courbe le jour des ajouts et compte les ajouts', () => {
    const series = burndownSeries(tickets, range, true);
    assert.deepEqual(series.actual, [2, 1, 3, 2, null]);
    assert.deepEqual(series.ideal, [2, 1.5, 4, 2, 0], 'l’idéal remonte des 3 ajouts puis repart vers zéro');
    assert.deepEqual(series.added, [0, 0, 3, 0, null]);
    assert.equal(series.tracksAdded, true);
  });

  it('ne retire un ticket « À tester » qu’après son ajout', () => {
    const series = burndownSeries([{ added: '2026-11-03', review: '2026-11-02' }, { added: '2026-10-30' }], range, true);
    assert.deepEqual(series.actual, [1, 1, 2, 2, null]);
    assert.deepEqual(series.withReview, [1, 1, 1, 1, null]);
  });

  describe('API', () => {
    let app: Booted;
    let owner: TestClient;
    const ids: Record<string, number> = {};

    before(async () => {
      app = await bootServer();
      owner = app.client();
      await owner.login('admin@admin.com', 'admin1234');
      ids.project = (await owner.post('/api/projects', { name: 'Sprint', key: 'SPR' })).body.project.id;
      ids.v1 = (await owner.post(`/api/projects/${ids.project}/deliveries`, { name: 'V1', startDate: '2026-11-01', endDate: '2026-11-15' })).body.delivery.id;
      ids.v2 = (await owner.post(`/api/projects/${ids.project}/deliveries`, { name: 'V2', startDate: '2026-11-16', endDate: '2026-11-30' })).body.delivery.id;
    });

    after(async () => {
      await app.running.close();
    });

    it('date le rattachement d’un ticket à sa livraison', async () => {
      const inSprint = (await owner.post(`/api/projects/${ids.project}/tickets`, { title: 'Prévu', deliveryId: ids.v1 })).body.ticket;
      assert.equal(inSprint.deliveryAddedAt, inSprint.createdAt);
      const loose = (await owner.post(`/api/projects/${ids.project}/tickets`, { title: 'Hors sprint' })).body.ticket;
      assert.equal(loose.deliveryAddedAt, null);

      const attached = (await owner.patch(`/api/tickets/${loose.id}`, { deliveryId: ids.v1 })).body.ticket;
      assert.ok(attached.deliveryAddedAt && attached.deliveryAddedAt >= loose.createdAt);
      const moved = (await owner.patch(`/api/tickets/${inSprint.id}`, { deliveryId: ids.v2 })).body.ticket;
      assert.ok(moved.deliveryAddedAt > inSprint.deliveryAddedAt, 'changer de livraison renouvelle la date');
      const unchanged = (await owner.patch(`/api/tickets/${inSprint.id}`, { title: 'Prévu (renommé)' })).body.ticket;
      assert.equal(unchanged.deliveryAddedAt, moved.deliveryAddedAt);
      const detached = (await owner.patch(`/api/tickets/${inSprint.id}`, { deliveryId: null })).body.ticket;
      assert.equal(detached.deliveryAddedAt, null);
    });
  });
});
