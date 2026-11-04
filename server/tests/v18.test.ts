import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { ticketProgress } from '../../shared/progress.ts';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

describe('version 1.8 : avancement d’après les sous-tickets', () => {
  it('fait la moyenne des sous-tickets, sauf si le ticket le désactive', () => {
    const parent = { status: 'in_progress' as const, progress: 10, parts: [] };
    const children = [
      { status: 'done' as const, progress: 0, parts: [] },
      { status: 'todo' as const, progress: 0, parts: [{ done: false, progress: 50 }] },
    ];
    assert.equal(ticketProgress(parent, ['done'], children), 75, 'par défaut : moyenne des sous-tickets');
    assert.equal(ticketProgress({ ...parent, progressFromChildren: false }, ['done'], children), 10, 'désactivé : avancement propre');
    assert.equal(ticketProgress({ ...parent, status: 'done' }, ['done'], children), 100, 'terminé : 100 %');
    assert.equal(ticketProgress(parent, ['done'], []), 10, 'sans sous-ticket : inchangé');
  });

  describe('API', () => {
    let app: Booted;
    let owner: TestClient;
    const ids: Record<string, number> = {};

    before(async () => {
      app = await bootServer();
      owner = app.client();
      await owner.login('admin@admin.com', 'admin1234');
      ids.project = (await owner.post('/api/projects', { name: 'Atelier', key: 'ATL' })).body.project.id;
      ids.parent = (await owner.post(`/api/projects/${ids.project}/tickets`, { title: 'Refonte', progress: 10 })).body.ticket.id;
      await owner.post(`/api/projects/${ids.project}/tickets`, { title: 'Maquettes', parentId: ids.parent, status: 'done' });
      await owner.post(`/api/projects/${ids.project}/tickets`, { title: 'Intégration', parentId: ids.parent, progress: 40 });
    });

    after(async () => {
      await app.running.close();
    });

    it('active le calcul par défaut, se règle par ticket et suit dans l’export et la page des projets', async () => {
      const parent = (await owner.get(`/api/tickets/${ids.parent}`)).body.ticket;
      assert.equal(parent.progressFromChildren, true);
      const progressColumn = () =>
        owner.get(`/api/projects/${ids.project}/export?format=csv`).then((response) => {
          const lines = String(response.body).split('\r\n');
          const index = lines[0]!.split(';').indexOf('Avancement (%)');
          return lines.find((line) => line.startsWith('ATL-1;'))!.split(';')[index];
        });
      assert.equal(await progressColumn(), '70', 'moyenne de 100 % et 40 %');
      const summary = (await owner.get('/api/projects')).body.projects.find((project: { id: number }) => project.id === ids.project);
      assert.equal(summary.progress, Math.round((70 + 100 + 40) / 3));

      const off = await owner.patch(`/api/tickets/${ids.parent}`, { progressFromChildren: false });
      assert.equal(off.body.ticket.progressFromChildren, false);
      assert.equal(await progressColumn(), '10', 'avancement propre au ticket');
      const history = (await owner.get(`/api/tickets/${ids.parent}/history`)).body.history;
      const change = history.find((entry: { data: { kind: string; changes?: Array<{ field: string }> } }) => entry.data.changes?.some((item) => item.field === 'progressFromChildren')).data.changes[0];
      assert.deepEqual([change.from, change.to], ['true', 'false']);
    });
  });
});
