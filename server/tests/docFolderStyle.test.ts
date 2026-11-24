import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { DocNodeDTO } from '../../shared/docs.ts';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

describe('icône et couleur des dossiers de la documentation', () => {
  let app: Booted;
  let bob: TestClient;
  let vera: TestClient;
  let space = 0;
  let folder = 0;
  let note = 0;

  before(async () => {
    app = await bootServer();
    const admin = app.client();
    await admin.login('admin@admin.com', 'admin1234');
    const roles = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
    const member = roles.find((role) => role.key === 'member' && role.scope === 'global')!.id;
    const ids: Record<string, number> = {};
    for (const name of ['bob', 'vera']) ids[name] = (await admin.post('/api/admin/users', { email: `${name}@t.fr`, name, password: 'motdepasse1', roleId: member })).body.user.id;
    await admin.request('PUT', '/api/admin/documentation', { enabled: true });
    bob = app.client();
    await bob.login('bob@t.fr', 'motdepasse1');
    vera = app.client();
    await vera.login('vera@t.fr', 'motdepasse1');
    space = (await bob.post('/api/documentation/spaces', { name: 'Produit' })).body.space.id;
    await bob.post(`/api/documentation/spaces/${space}/members`, { userId: ids.vera, role: 'reader' });
    folder = (await bob.post(`/api/documentation/spaces/${space}/nodes`, { path: 'Guides', kind: 'folder' })).body.node.id;
    note = (await bob.post(`/api/documentation/spaces/${space}/nodes`, { path: 'Guides/Installer', content: '# Installer' })).body.node.id;
  });

  after(async () => {
    await app.running.close();
  });

  const style = (client: TestClient, id: number, body: Record<string, unknown>) => client.request('PUT', `/api/documentation/nodes/${id}/style`, body);
  const tree = async () => (await bob.get(`/api/documentation/spaces/${space}`)).body.nodes as DocNodeDTO[];

  it('un dossier part de l’icône et de la couleur par défaut', async () => {
    const guides = (await tree()).find((node) => node.id === folder)!;
    assert.equal(guides.icon, null);
    assert.equal(guides.color, null);
  });

  it('les éditeurs choisissent l’icône et la couleur, séparément ou ensemble', async () => {
    const both = await style(bob, folder, { icon: 'pi pi-book', color: '#10B981' });
    assert.equal(both.status, 200, JSON.stringify(both.body));
    assert.equal(both.body.node.icon, 'pi pi-book');
    assert.equal(both.body.node.color, '#10b981', 'couleur rangée en minuscules');

    assert.equal((await style(bob, folder, { color: '#ef4444' })).body.node.icon, 'pi pi-book', 'icône absente : inchangée');
    const guides = (await tree()).find((node) => node.id === folder)!;
    assert.deepEqual([guides.icon, guides.color], ['pi pi-book', '#ef4444'], 'l’arbre les donne à tous');

    assert.equal((await style(bob, folder, { icon: 'pi pi-folder' })).body.node.icon, null, 'le dossier habituel est l’icône par défaut');
    assert.equal((await style(bob, folder, { icon: null, color: null })).body.node.color, null, 'retour aux valeurs par défaut');
  });

  it('refuse les lecteurs, les fichiers, une icône hors de la liste et une couleur mal écrite', async () => {
    assert.equal((await style(vera, folder, { icon: 'pi pi-book' })).status, 403);
    assert.equal((await style(bob, note, { icon: 'pi pi-book' })).status, 400, 'seulement les dossiers');
    assert.equal((await style(bob, folder, { icon: 'pi pi-trash' })).status, 400);
    assert.equal((await style(bob, folder, { icon: 'fa fa-book' })).status, 400);
    assert.equal((await style(bob, folder, { color: 'red' })).status, 400);
  });

  it('suit le dossier renommé et s’affiche sur le site web de l’espace', async () => {
    await style(bob, folder, { icon: 'pi pi-code', color: '#8b5cf6' });
    await bob.patch(`/api/documentation/nodes/${folder}`, { path: 'Développement' });
    const moved = (await tree()).find((node) => node.id === folder)!;
    assert.deepEqual([moved.path, moved.icon, moved.color], ['Développement', 'pi pi-code', '#8b5cf6']);

    const site = (await bob.request('PUT', `/api/documentation/spaces/${space}/site`, { visibility: 'members' })).body.site;
    const wiki = (await vera.get(`/api/wiki/${site.slug}`)).body as { nodes: Array<{ path: string; icon: string | null; color: string | null }> };
    assert.deepEqual(
      wiki.nodes.find((node) => node.path === 'Développement'),
      { id: folder, path: 'Développement', kind: 'folder', icon: 'pi pi-code', color: '#8b5cf6' },
    );
  });
});
