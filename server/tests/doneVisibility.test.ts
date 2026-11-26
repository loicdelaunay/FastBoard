import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { defaultDoneVisibility, doneTicketHidden, inPastDelivery, isDoneVisibility } from '../../shared/doneVisibility.ts';
import { normalizeSettings } from '../../shared/settings.ts';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

describe('tickets terminés masqués dans le tableau', () => {
  const deliveries = new Map([
    [1, { endDate: '2026-11-20' }],
    [2, { endDate: '2026-11-26' }],
    [3, { endDate: '2026-12-15' }],
  ]);
  const today = '2026-11-26';
  const done = (deliveryId: number | null) => ({ status: 'done' as const, deliveryId });

  it('une livraison est passée quand sa date de fin est avant aujourd’hui (le jour de fin compte encore)', () => {
    assert.equal(inPastDelivery(done(1), deliveries, today), true);
    assert.equal(inPastDelivery(done(2), deliveries, today), false, 'finit aujourd’hui : en cours');
    assert.equal(inPastDelivery(done(3), deliveries, today), false);
    assert.equal(inPastDelivery(done(null), deliveries, today), false, 'sans livraison');
    assert.equal(inPastDelivery(done(99), deliveries, today), false, 'livraison supprimée');
  });

  it('masque selon le mode, et seulement les tickets terminés', () => {
    assert.equal(doneTicketHidden(done(1), 'all', deliveries, today), false);
    assert.equal(doneTicketHidden(done(1), 'current', deliveries, today), true);
    assert.equal(doneTicketHidden(done(3), 'current', deliveries, today), false);
    assert.equal(doneTicketHidden(done(null), 'none', deliveries, today), true);
    assert.equal(doneTicketHidden({ status: 'in_progress', deliveryId: 1 }, 'none', deliveries, today), false, 'un ticket en cours reste visible');
  });

  it('le mode par défaut suit l’automatisation du projet, désactivée par défaut', () => {
    assert.equal(normalizeSettings({}).hidePastDeliveryDone, false);
    assert.equal(normalizeSettings({ hidePastDeliveryDone: true }).hidePastDeliveryDone, true);
    assert.equal(defaultDoneVisibility(normalizeSettings({})), 'all');
    assert.equal(defaultDoneVisibility({ hidePastDeliveryDone: true }), 'current');
    assert.equal(isDoneVisibility('current'), true);
    assert.equal(isDoneVisibility('autre'), false);
  });

  describe('réglage du projet', () => {
    let app: Booted;
    let admin: TestClient;
    before(async () => {
      app = await bootServer();
      admin = app.client();
      await admin.login('admin@admin.com', 'admin1234');
    });
    after(async () => {
      await app.running.close();
    });

    it('s’active par l’API et entre dans l’historique du projet', async () => {
      const projectId = (await admin.post('/api/projects', { name: 'Livraisons' })).body.project.id as number;
      assert.equal((await admin.get(`/api/projects/${projectId}`)).body.project.settings.hidePastDeliveryDone, false);
      const updated = await admin.patch(`/api/projects/${projectId}`, { settings: { hidePastDeliveryDone: true } });
      assert.equal(updated.status, 200, JSON.stringify(updated.body));
      assert.equal(updated.body.project.settings.hidePastDeliveryDone, true);
      assert.equal((await admin.patch(`/api/projects/${projectId}`, { settings: { hidePastDeliveryDone: 'oui' } })).status, 400);
    });
  });
});
