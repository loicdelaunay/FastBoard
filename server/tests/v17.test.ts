import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

describe('version 1.7', () => {
  let app: Booted;
  let owner: TestClient;
  let projectId = 0;

  before(async () => {
    app = await bootServer();
    owner = app.client();
    await owner.login('admin@admin.com', 'admin1234');
    projectId = (await owner.post('/api/projects', { name: 'Atelier', key: 'ATL' })).body.project.id;
  });

  after(async () => {
    await app.running.close();
  });

  it('masque par défaut les terminés de « Non assigné » dans l’analyseur (réglable)', async () => {
    const settings = (await owner.get(`/api/projects/${projectId}`)).body.project.settings;
    assert.equal(settings.hideDoneUnassigned, true, 'activé par défaut');
    const updated = await owner.patch(`/api/projects/${projectId}`, { settings: { hideDoneUnassigned: false } });
    assert.equal(updated.body.project.settings.hideDoneUnassigned, false);
    const activity = (await owner.get(`/api/projects/${projectId}/activity`)).body.activities[0];
    assert.match(JSON.stringify(activity.data), /terminés masqués dans « Non assigné » : désactivé/);
  });
});
