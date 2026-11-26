import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { DEFAULT_FONTS, normalizeAppearance } from '../../shared/themes.ts';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

describe('correcteur orthographique du navigateur (préférence du compte)', () => {
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

  it('activé par défaut, y compris pour une apparence enregistrée avant la préférence', () => {
    assert.equal(normalizeAppearance({}).spellcheck, true);
    assert.equal(normalizeAppearance({ customThemes: [], fonts: DEFAULT_FONTS, reading: 'full' }).spellcheck, true);
    assert.equal(normalizeAppearance({ spellcheck: false }).spellcheck, false);
  });

  it('se coupe et se rallume sur le compte', async () => {
    const appearance = (await admin.get('/api/me')).body.user.appearance;
    assert.equal(appearance.spellcheck, true);
    const off = await admin.patch('/api/me', { appearance: { ...appearance, spellcheck: false } });
    assert.equal(off.status, 200, JSON.stringify(off.body));
    assert.equal((await admin.get('/api/me')).body.user.appearance.spellcheck, false, 'gardé sur le compte');
    const { spellcheck: _ignored, ...older } = appearance;
    assert.equal((await admin.patch('/api/me', { appearance: older })).body.user.appearance.spellcheck, true, 'un ancien client qui ne l’envoie pas le rallume (valeur par défaut)');
    assert.equal((await admin.patch('/api/me', { appearance: { ...appearance, spellcheck: 'non' } })).status, 400);
  });
});
