import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { bootServer, type TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

describe('session', () => {
  let app: Booted;
  let client: TestClient;

  before(async () => {
    app = await bootServer();
    client = app.client();
    await client.login('admin@admin.com', 'admin1234');
  });

  after(async () => {
    await app.running.close();
  });

  it('se prolonge quand on s’en sert, et le cookie suit', async () => {
    const { db } = app.running.ctx;
    const days = app.running.ctx.config.sessionDays;
    // Session ouverte il y a longtemps : il ne lui reste que deux jours.
    db.run('UPDATE sessions SET expires_at = ?', new Date(Date.now() + 2 * 86_400_000).toISOString());

    const response = await client.raw('GET', '/api/me');
    assert.equal(response.status, 200);
    const expires = db.get<{ expires_at: string }>('SELECT expires_at FROM sessions')!.expires_at;
    assert.ok(Date.parse(expires) > Date.now() + (days - 1) * 86_400_000, 'repartie pour toute sa durée');
    const maxAge = Number(/Max-Age=(\d+)/.exec(response.headers.get('set-cookie') ?? '')?.[1]);
    assert.ok(maxAge > (days - 1) * 86_400, `cookie prolongé (${maxAge} s)`);

    // Sans utilisation pendant toute sa durée, elle expire.
    db.run('UPDATE sessions SET expires_at = ?', new Date(Date.now() - 1000).toISOString());
    assert.equal((await client.raw('GET', '/api/me')).status, 401);
  });
});
