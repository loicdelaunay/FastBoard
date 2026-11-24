import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { manifestLanguage } from '../services/webManifest.ts';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

/** En-tête PNG d'une image `size` × `size` (le serveur ne lit que la signature et les dimensions). */
function pngOf(size: number): string {
  const header = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'ascii');
  header.writeUInt32BE(size, 16);
  header.writeUInt32BE(size, 20);
  header[24] = 8;
  header[25] = 6;
  return `data:image/png;base64,${header.toString('base64')}`;
}

const ICONS = { 'icon-192': pngOf(192), 'icon-512': pngOf(512), 'maskable-192': pngOf(192), 'maskable-512': pngOf(512), 'apple-touch-icon': pngOf(180) };
const LOGO = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

describe('application installable (PWA)', () => {
  let app: Booted;
  let admin: TestClient;
  let bob: TestClient;
  let guest: TestClient;

  const manifest = async (language?: string) => {
    const response = await fetch(`${app.base}/api/app/manifest.webmanifest`, { headers: language ? { 'Accept-Language': language } : {} });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^application\/manifest\+json/);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    return (await response.json()) as Record<string, any>;
  };

  before(async () => {
    app = await bootServer();
    admin = app.client();
    await admin.login('admin@admin.com', 'admin1234');
    const roles = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
    await admin.post('/api/admin/users', { email: 'bob@t.fr', name: 'bob', password: 'motdepasse1', roleId: roles.find((role) => role.key === 'member' && role.scope === 'global')!.id });
    bob = app.client();
    await bob.login('bob@t.fr', 'motdepasse1');
    guest = app.client();
  });

  after(async () => {
    await app.running.close();
  });

  it('publie un manifeste sans session, avec les icônes par défaut et les modules activés', async () => {
    const value = await manifest();
    assert.equal(value.name, 'FastBoard');
    assert.equal(value.id, '/');
    assert.equal(value.start_url, '/');
    assert.equal(value.scope, '/');
    assert.equal(value.display, 'standalone');
    assert.equal(value.lang, 'fr');
    assert.deepEqual(
      value.icons.map((icon: { src: string; sizes: string; purpose: string }) => `${icon.src} ${icon.sizes} ${icon.purpose}`),
      ['/icons/icon-192.png 192x192 any', '/icons/icon-512.png 512x512 any', '/icons/maskable-192.png 192x192 maskable', '/icons/maskable-512.png 512x512 maskable'],
    );
    assert.deepEqual(value.shortcuts.map((shortcut: { url: string }) => shortcut.url), ['/', '/tableaux', '/search'], 'documentation et assistant coupés par défaut');

    await admin.request('PUT', '/api/admin/documentation', { enabled: true });
    assert.deepEqual((await manifest()).shortcuts.map((shortcut: { name: string }) => shortcut.name), ['Projets', 'Documentations', 'Tableaux blancs', 'Rechercher']);
    await admin.request('PUT', '/api/admin/documentation', { enabled: false });
  });

  it('parle la langue du navigateur et prend le nom de l’application', async () => {
    const english = await manifest('en-US,en;q=0.9,fr;q=0.8');
    assert.equal(english.lang, 'en');
    assert.equal(english.shortcuts[0].name, 'Projects');
    assert.equal((await manifest('fr-FR,fr;q=0.9,en;q=0.8')).lang, 'fr');
    assert.equal(manifestLanguage('de-DE,de;q=0.9'), 'fr', 'ni français ni anglais : français');
    assert.equal(manifestLanguage('de,en;q=0.5'), 'en');
    assert.equal(manifestLanguage(undefined), 'fr');

    await admin.request('PUT', '/api/admin/app', { name: 'Atelier de conception' });
    const renamed = await manifest();
    assert.equal(renamed.name, 'Atelier de conception');
    assert.ok(renamed.short_name.length <= 15);
    await admin.request('PUT', '/api/admin/app', { name: 'FastBoard' });
  });

  it('prend les icônes tirées du logo, et revient aux icônes par défaut quand le logo change', async () => {
    assert.equal((await admin.request('PUT', '/api/admin/app/icons', { icons: ICONS })).status, 400, 'pas de logo : rien d’où tirer les icônes');
    assert.equal((await admin.raw('PUT', '/api/admin/app/logo', LOGO, { 'Content-Type': 'image/png' })).status, 200);
    assert.equal((await bob.request('PUT', '/api/admin/app/icons', { icons: ICONS })).status, 403);
    assert.equal((await admin.request('PUT', '/api/admin/app/icons', { icons: { ...ICONS, 'icon-512': pngOf(256) } })).status, 400, 'taille vérifiée');
    assert.equal((await admin.request('PUT', '/api/admin/app/icons', { icons: { ...ICONS, 'icon-192': 'data:image/png;base64,PHN2Zz4=' } })).status, 400, 'un vrai PNG');

    const saved = await admin.request('PUT', '/api/admin/app/icons', { icons: ICONS });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const version = saved.body.iconsVersion as number;
    assert.ok(version > 0);
    assert.equal((await guest.get('/api/app')).body.iconsVersion, version);
    const value = await manifest();
    assert.equal(value.icons[0].src, `/api/app/icons/icon-192.png?v=${version}`);
    assert.equal(value.icons[3].src, `/api/app/icons/maskable-512.png?v=${version}`);
    const icon = await guest.raw('GET', `/api/app/icons/apple-touch-icon.png?v=${version}`);
    assert.equal(icon.status, 200, 'public : le navigateur les lit sans session');
    assert.equal(icon.headers.get('content-type'), 'image/png');
    assert.equal(icon.bytes.readUInt32BE(16), 180);
    assert.equal((await guest.raw('GET', '/api/app/icons/inconnue.png')).status, 404);

    // Nouveau logo : les icônes tirées de l'ancien partent (l'interface redessine les nouvelles).
    await admin.raw('PUT', '/api/admin/app/logo', LOGO, { 'Content-Type': 'image/png' });
    assert.equal((await guest.get('/api/app')).body.iconsVersion, 0);
    assert.equal((await guest.raw('GET', '/api/app/icons/icon-192.png')).status, 404);
    assert.equal((await manifest()).icons[0].src, '/icons/icon-192.png');
    await admin.request('PUT', '/api/admin/app/icons', { icons: ICONS });
    await admin.request('DELETE', '/api/admin/app/logo');
    assert.equal((await guest.get('/api/app')).body.iconsVersion, 0, 'plus de logo, plus d’icônes tirées du logo');
  });
});
