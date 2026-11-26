import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { offlineCacheable, serverUnreachable } from '../../shared/offline.ts';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

describe('lecture seule hors ligne', () => {
  it('garde les lectures de l’application, pas l’administration, la connexion, l’IA, les exports ni les recherches', () => {
    for (const path of ['/me', '/projects', '/projects/3/tickets', '/documentation/spaces/2', '/boards/nodes/7', '/notifications?limit=20', '/app'])
      assert.equal(offlineCacheable(path), true, path);
    for (const path of ['/admin/ai', '/admin', '/auth/providers', '/ai/conversations', '/backups', '/tokens', '/me/tokens', '/documentation/spaces/2/export', '/search?q=abc', '/documentation/search?q=x', '/documentation/tags?q=v1', '/users?q=al'])
      assert.equal(offlineCacheable(path), false, path);
  });

  it('reconnaît un serveur absent : réseau coupé, ou 502 / 503 / 504 d’un intermédiaire sans message de FastBoard', () => {
    assert.equal(serverUnreachable(0, false), true);
    assert.equal(serverUnreachable(502, false), true);
    assert.equal(serverUnreachable(504, false), true);
    assert.equal(serverUnreachable(503, true), false, 'l’annuaire injoignable : une erreur de FastBoard');
    assert.equal(serverUnreachable(502, true), false, 'le fournisseur d’IA en erreur : une erreur de FastBoard');
    assert.equal(serverUnreachable(500, false), false);
    assert.equal(serverUnreachable(404, true), false);
  });

  describe('images des notes', () => {
    let app: Booted;
    let admin: TestClient;

    before(async () => {
      app = await bootServer();
      admin = app.client();
      await admin.login('admin@admin.com', 'admin1234');
      await admin.request('PUT', '/api/admin/documentation', { enabled: true });
    });

    after(async () => {
      await app.running.close();
    });

    it('une image demandée avec sa version se garde dans le navigateur (lisible hors ligne), sans elle 5 minutes', async () => {
      const space = (await admin.post('/api/documentation/spaces', { name: 'Hors ligne' })).body.space.id as number;
      const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
      const node = (await admin.raw('POST', `/api/documentation/spaces/${space}/images`, png, { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'a.png', 'X-Requested-With': 'fetch' })).json.node as { id: number; updatedAt: string };
      const versioned = await admin.raw('GET', `/api/documentation/nodes/${node.id}/raw?v=${encodeURIComponent(node.updatedAt)}`);
      assert.equal(versioned.headers.get('cache-control'), 'private, max-age=31536000, immutable');
      const plain = await admin.raw('GET', `/api/documentation/nodes/${node.id}/raw`);
      assert.equal(plain.headers.get('cache-control'), 'private, max-age=300');
    });
  });
});
