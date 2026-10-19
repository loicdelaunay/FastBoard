import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

describe('FastBoard API', () => {
  let app: Booted;
  let admin: TestClient;
  let bob: TestClient;
  let alice: TestClient;
  let carol: TestClient;
  const ids: Record<string, number> = {};
  let projectId = 0;

  before(async () => {
    app = await bootServer();
    admin = app.client();
    const login = await admin.login('admin@admin.com', 'admin1234');
    assert.equal(login.status, 200);
  });

  after(async () => {
    await app.running.close();
  });

  describe('authentification', () => {
    it('crée le super administrateur au lancement', async () => {
      const me = await admin.get('/api/me');
      assert.equal(me.status, 200);
      assert.equal(me.body.user.email, 'admin@admin.com');
      assert.deepEqual(me.body.user.permissions, ['*']);
    });

    it('refuse un mauvais mot de passe et les routes sans session', async () => {
      const wrong = await app.client().login('admin@admin.com', 'mauvais');
      assert.equal(wrong.status, 401);
      assert.equal((await app.client().get('/api/projects')).status, 401);
    });

    it("refuse d'agir quand l'onglet croit être un autre compte que celui du cookie (changement de compte dans un autre onglet)", async () => {
      const me = await admin.get('/api/me');
      const adminId = me.body.user.id as number;
      const matching = await admin.request('GET', '/api/projects', undefined, { 'x-user-id': String(adminId) });
      assert.equal(matching.status, 200);
      const stale = await admin.request('GET', '/api/projects', undefined, { 'x-user-id': String(adminId + 99) });
      assert.equal(stale.status, 401);
      assert.equal(stale.body.error.code, 'session_changed');
      const staleWrite = await admin.request('POST', '/api/projects', { name: 'Ne doit pas exister' }, { 'x-user-id': String(adminId + 99) });
      assert.equal(staleWrite.status, 401);
      assert.equal((await admin.get('/api/projects')).body.projects.length, 0, 'aucune écriture au nom du mauvais compte');
    });

    it("rejette les requêtes modifiantes d'une autre origine", async () => {
      const response = await admin.post('/api/projects', { name: 'X' }, { Origin: 'https://evil.example' });
      assert.equal(response.status, 403);
    });
  });

  describe('comptes et permissions globales', () => {
    it('le super admin crée des comptes', async () => {
      const roles = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
      const role = (key: string, scope = 'global') => roles.find((r) => r.key === key && r.scope === scope)!.id;
      ids.member = role('member');
      ids.guest = role('guest');
      ids.admin = role('admin');
      ids.superAdmin = role('super_admin');
      ids.owner = role('owner', 'project');
      ids.editor = role('editor', 'project');
      ids.contributor = role('contributor', 'project');
      ids.viewer = role('viewer', 'project');
      ids.manager = role('manager', 'project');

      for (const [name, roleId] of [['bob', ids.member], ['alice', ids.member], ['carol', ids.guest], ['dave', ids.admin]] as const) {
        const created = await admin.post('/api/admin/users', { email: `${name}@test.fr`, name, password: 'motdepasse1', roleId });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        ids[name] = created.body.user.id;
      }

      bob = app.client();
      alice = app.client();
      carol = app.client();
      for (const [client, name] of [[bob, 'bob'], [alice, 'alice'], [carol, 'carol']] as const) {
        assert.equal((await client.login(`${name}@test.fr`, 'motdepasse1')).status, 200);
      }
    });

    it("interdit l'administration aux membres simples", async () => {
      assert.equal((await bob.get('/api/admin/users')).status, 403);
      assert.equal((await bob.post('/api/admin/users', { email: 'x@y.fr', name: 'x', password: 'motdepasse1', roleId: ids.member })).status, 403);
    });

    it("empêche l'escalade de privilèges", async () => {
      const dave = app.client();
      await dave.login('dave@test.fr', 'motdepasse1');
      const escalate = await dave.post('/api/admin/users', { email: 'root@test.fr', name: 'root', password: 'motdepasse1', roleId: ids.superAdmin });
      assert.equal(escalate.status, 403);
      const editRoot = await dave.patch(`/api/admin/users/1`, { name: 'pwned' });
      assert.equal(editRoot.status, 403);
    });

    it('protège le dernier super administrateur', async () => {
      const self = await admin.patch('/api/admin/users/1', { isActive: false });
      assert.equal(self.status, 403);
      assert.equal((await admin.del('/api/admin/users/1')).status, 403);
    });

    it("refuse un mot de passe trop court et un e-mail déjà pris", async () => {
      assert.equal((await admin.post('/api/admin/users', { email: 'n@test.fr', name: 'n', password: 'court', roleId: ids.member })).status, 400);
      assert.equal((await admin.post('/api/admin/users', { email: 'BOB@test.fr', name: 'bob2', password: 'motdepasse1', roleId: ids.member })).status, 409);
    });

    it('désactiver un compte ferme ses sessions', async () => {
      const temp = (await admin.post('/api/admin/users', { email: 'temp@test.fr', name: 'temp', password: 'motdepasse1', roleId: ids.member })).body.user;
      const client = app.client();
      await client.login('temp@test.fr', 'motdepasse1');
      assert.equal((await client.get('/api/me')).status, 200);
      await admin.patch(`/api/admin/users/${temp.id}`, { isActive: false });
      assert.equal((await client.get('/api/me')).status, 401);
      assert.equal((await app.client().login('temp@test.fr', 'motdepasse1')).status, 403);
    });
  });

  describe('profil', () => {
    it('modifie le nom et le thème, valide le thème', async () => {
      const ok = await bob.patch('/api/me', { name: 'Bob Martin', theme: 'aura-emerald-dark' });
      assert.equal(ok.body.user.name, 'Bob Martin');
      assert.equal(ok.body.user.theme, 'aura-emerald-dark');
      assert.equal((await bob.patch('/api/me', { theme: 'inconnu' })).status, 400);
    });

    it("enregistre une image de profil valide et rejette le reste", async () => {
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
      const upload = await fetch(`${app.base}/api/me/avatar`, { method: 'PUT', headers: { 'Content-Type': 'image/png', Cookie: bob.cookie }, body: png });
      assert.equal(upload.status, 200);
      const version = ((await upload.json()) as { user: { avatarVersion: number } }).user.avatarVersion;
      assert.equal(version, 1);
      const image = await fetch(`${app.base}/api/users/${ids.bob}/avatar`, { headers: { Cookie: alice.cookie } });
      assert.equal(image.status, 200);
      assert.equal(image.headers.get('content-type'), 'image/png');

      const fake = await fetch(`${app.base}/api/me/avatar`, { method: 'PUT', headers: { 'Content-Type': 'image/png', Cookie: bob.cookie }, body: Buffer.from('pas une image du tout') });
      assert.equal(fake.status, 400);
    });

    it('change son mot de passe', async () => {
      const wrong = await alice.post('/api/me/password', { currentPassword: 'faux', newPassword: 'nouveaumdp1' });
      assert.equal(wrong.status, 400);
      assert.equal((await alice.post('/api/me/password', { currentPassword: 'motdepasse1', newPassword: 'nouveaumdp1' })).status, 200);
      assert.equal((await alice.get('/api/me')).status, 200);
      assert.equal((await app.client().login('alice@test.fr', 'motdepasse1')).status, 401);
      assert.equal((await app.client().login('alice@test.fr', 'nouveaumdp1')).status, 200);
    });
  });

  describe('projets et membres', () => {
    it("un membre crée un projet avec catégories par défaut ; un invité ne peut pas", async () => {
      assert.equal((await carol.post('/api/projects', { name: 'Interdit' })).status, 403);
      const created = await bob.post('/api/projects', { name: 'Refonte Site', description: 'Projet test' });
      assert.equal(created.status, 201);
      projectId = created.body.project.id;
      assert.equal(created.body.project.key, 'RS');

      const snapshot = await bob.get(`/api/projects/${projectId}`);
      assert.equal(snapshot.body.categories.length, 3);
      assert.equal(snapshot.body.members.length, 1);
      assert.ok(snapshot.body.permissions.includes('project.delete'));
    });

    it('un projet est invisible aux non-membres puis partagé par invitation', async () => {
      assert.equal((await alice.get(`/api/projects/${projectId}`)).status, 404);
      assert.equal((await alice.get('/api/projects')).body.projects.length, 0);

      const add = await bob.post(`/api/projects/${projectId}/members`, { userId: ids.alice, roleId: ids.editor });
      assert.equal(add.status, 201);
      assert.equal((await bob.post(`/api/projects/${projectId}/members`, { userId: ids.carol, roleId: ids.viewer })).status, 201);
      assert.equal((await alice.get(`/api/projects/${projectId}`)).status, 200);
      assert.equal((await alice.get('/api/projects')).body.projects.length, 1);
      assert.equal((await bob.post(`/api/projects/${projectId}/members`, { userId: ids.alice, roleId: ids.editor })).status, 409);
    });

    it("un éditeur ne configure pas le projet ni les membres", async () => {
      assert.equal((await alice.patch(`/api/projects/${projectId}`, { name: 'Autre' })).status, 403);
      assert.equal((await alice.post(`/api/projects/${projectId}/categories`, { name: 'Z', color: '#112233' })).status, 403);
      assert.equal((await alice.post(`/api/projects/${projectId}/members`, { userId: ids.dave, roleId: ids.viewer })).status, 403);
      assert.equal((await alice.del(`/api/projects/${projectId}`)).status, 403);
    });

    it('un gestionnaire ne peut pas attribuer le rôle propriétaire', async () => {
      await bob.patch(`/api/projects/${projectId}/members/${ids.alice}`, { roleId: ids.manager });
      const escalate = await alice.patch(`/api/projects/${projectId}/members/${ids.carol}`, { roleId: ids.owner });
      assert.equal(escalate.status, 403);
      await bob.patch(`/api/projects/${projectId}/members/${ids.alice}`, { roleId: ids.editor });
    });

    it('gère les catégories et les livraisons par projet', async () => {
      const category = await bob.post(`/api/projects/${projectId}/categories`, { name: 'Design', color: '#ec4899' });
      assert.equal(category.status, 201);
      ids.category = category.body.category.id;
      assert.equal((await bob.post(`/api/projects/${projectId}/categories`, { name: 'design', color: '#ec4899' })).status, 409);

      assert.equal((await bob.post(`/api/projects/${projectId}/deliveries`, { name: 'V1', startDate: '2026-12-01', endDate: '2026-11-01' })).status, 400);
      const delivery = await bob.post(`/api/projects/${projectId}/deliveries`, { name: 'V1', startDate: '2026-11-01', endDate: '2026-12-15' });
      assert.equal(delivery.status, 201);
      ids.delivery = delivery.body.delivery.id;
      const second = await bob.post(`/api/projects/${projectId}/deliveries`, { name: 'V2', startDate: '2027-01-01', endDate: '2027-02-15' });
      ids.delivery2 = second.body.delivery.id;
    });
  });

  describe('tickets', () => {
    it('crée un ticket avec assignés, catégorie et livraison ciblée', async () => {
      const created = await bob.post(`/api/projects/${projectId}/tickets`, {
        title: 'Page accueil',
        description: 'Maquette + intégration',
        status: 'todo',
        categoryId: ids.category,
        deliveryId: ids.delivery,
        assigneeIds: [ids.bob, ids.alice],
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const ticket = created.body.ticket;
      ids.ticket = ticket.id;
      assert.equal(ticket.number, 1);
      assert.equal(ticket.initialDeliveryId, ids.delivery);
      assert.equal(ticket.assignees.length, 2);
    });

    it('refuse un assigné qui ne fait pas partie du projet et des champs invalides', async () => {
      const outsider = await bob.post(`/api/projects/${projectId}/tickets`, { title: 'X', assigneeIds: [ids.dave] });
      assert.equal(outsider.status, 400);
      assert.equal((await bob.post(`/api/projects/${projectId}/tickets`, { title: '   ' })).status, 400);
      assert.equal((await bob.patch(`/api/tickets/${ids.ticket}`, { startDate: '2026-12-10', endDate: '2026-12-01' })).status, 400);
      assert.equal((await bob.patch(`/api/tickets/${ids.ticket}`, { status: 'inconnu' })).status, 400);
    });

    it("un lecteur ne peut ni créer ni modifier", async () => {
      assert.equal((await carol.post(`/api/projects/${projectId}/tickets`, { title: 'Nope' })).status, 403);
      assert.equal((await carol.patch(`/api/tickets/${ids.ticket}`, { title: 'Nope' })).status, 403);
      assert.equal((await carol.get(`/api/tickets/${ids.ticket}/history`)).status, 200);
    });

    it("enregistre l'historique des modifications", async () => {
      await alice.patch(`/api/tickets/${ids.ticket}`, { title: 'Page d’accueil', startDate: '2026-11-03', endDate: '2026-11-20', deliveryId: ids.delivery2 });
      const history = (await bob.get(`/api/tickets/${ids.ticket}/history`)).body.history as Array<{ data: any; userId: number }>;
      const updated = history.find((entry) => entry.data.kind === 'updated');
      assert.ok(updated);
      assert.equal(updated.userId, ids.alice);
      const fields = updated.data.changes.map((change: any) => change.field).sort();
      assert.deepEqual(fields, ['delivery', 'endDate', 'startDate', 'title']);
      assert.ok(history.some((entry) => entry.data.kind === 'created'));
      const snapshot = (await bob.get(`/api/projects/${projectId}`)).body;
      const ticket = snapshot.tickets.find((t: any) => t.id === ids.ticket);
      assert.equal(ticket.initialDeliveryId, ids.delivery, 'la livraison initiale reste la première ciblée');
      assert.equal(ticket.deliveryId, ids.delivery2);
    });

    it('chaque assigné déclare sa part ; le ticket se termine quand toutes le sont', async () => {
      assert.equal((await carol.patch(`/api/tickets/${ids.ticket}/assignees/${ids.bob}`, { done: true })).status, 403);
      // alice (éditeur) ne peut pas modifier la part de bob en tant que simple assignée… mais ticket.edit le permet.
      const own = await alice.patch(`/api/tickets/${ids.ticket}/assignees/${ids.alice}`, { done: true });
      assert.equal(own.status, 200);
      assert.equal(own.body.ticket.status, 'todo');
      const last = await bob.patch(`/api/tickets/${ids.ticket}/assignees/${ids.bob}`, { done: true });
      assert.equal(last.body.ticket.status, 'done', 'passage automatique à Terminé');
      assert.ok(last.body.ticket.completedAt);

      const reopen = await alice.patch(`/api/tickets/${ids.ticket}/assignees/${ids.alice}`, { done: false, progress: 40 });
      assert.equal(reopen.body.ticket.status, 'in_progress', 'une part rouverte relance le ticket');
      assert.equal(reopen.body.ticket.completedAt, null);
    });

    it('un contributeur met à jour sa part mais ne modifie pas le ticket', async () => {
      await bob.patch(`/api/projects/${projectId}/members/${ids.alice}`, { roleId: ids.contributor });
      assert.equal((await alice.patch(`/api/tickets/${ids.ticket}`, { title: 'Interdit' })).status, 403);
      assert.equal((await alice.patch(`/api/tickets/${ids.ticket}/assignees/${ids.alice}`, { progress: 60 })).status, 200);
      assert.equal((await alice.patch(`/api/tickets/${ids.ticket}/assignees/${ids.bob}`, { done: false })).status, 403);
      await bob.patch(`/api/projects/${projectId}/members/${ids.alice}`, { roleId: ids.editor });
    });

    it("chaque assigné peut avoir une mission facultative, historisée et protégée par les permissions", async () => {
      const ticket = (await bob.get(`/api/projects/${projectId}`)).body.tickets.find((t: any) => t.id === ids.ticket);
      assert.ok(ticket.assignees.every((a: any) => a.note === ''), 'vide par défaut');

      // Un éditeur (ticket.edit) décrit la mission de n'importe quel assigné.
      const set = await bob.patch(`/api/tickets/${ids.ticket}/assignees/${ids.alice}`, { note: '  Écrire les tests d\'intégration  ' });
      assert.equal(set.status, 200, JSON.stringify(set.body));
      const alicePart = set.body.ticket.assignees.find((a: any) => a.userId === ids.alice);
      assert.equal(alicePart.note, 'Écrire les tests d\'intégration', 'espaces superflus retirés');
      assert.equal(set.body.ticket.assignees.find((a: any) => a.userId === ids.bob).note, '', 'les autres parts sont intactes');

      // Un contributeur ne modifie que sa propre mission.
      await bob.patch(`/api/projects/${projectId}/members/${ids.alice}`, { roleId: ids.contributor });
      assert.equal((await alice.patch(`/api/tickets/${ids.ticket}/assignees/${ids.alice}`, { note: 'Précisé par moi' })).status, 200);
      assert.equal((await alice.patch(`/api/tickets/${ids.ticket}/assignees/${ids.bob}`, { note: 'Non' })).status, 403);
      await bob.patch(`/api/projects/${projectId}/members/${ids.alice}`, { roleId: ids.editor });

      // Rien ne change : pas d'entrée d'historique en double ; une valeur trop longue est refusée.
      const history = async () => ((await bob.get(`/api/tickets/${ids.ticket}/history`)).body.history as Array<{ data: any }>).filter((h) => h.data.kind === 'part' && h.data.note !== undefined);
      const before = (await history()).length;
      await bob.patch(`/api/tickets/${ids.ticket}/assignees/${ids.alice}`, { note: 'Précisé par moi' });
      assert.equal((await history()).length, before);
      assert.equal((await bob.patch(`/api/tickets/${ids.ticket}/assignees/${ids.alice}`, { note: 'x'.repeat(2001) })).status, 400);

      // Effacer la mission est possible et historisé.
      const cleared = await bob.patch(`/api/tickets/${ids.ticket}/assignees/${ids.alice}`, { note: '' });
      assert.equal(cleared.body.ticket.assignees.find((a: any) => a.userId === ids.alice).note, '');
      const entries = await history();
      assert.deepEqual(entries[0]!.data, { kind: 'part', user: { id: ids.alice, name: 'alice' }, note: '' });
      assert.equal(entries[1]!.data.note, 'Précisé par moi');
    });

    it("conserve la mission quand d'autres assignés changent, et la perd si la personne est retirée", async () => {
      await bob.patch(`/api/tickets/${ids.ticket}/assignees/${ids.bob}`, { note: 'Relire la maquette' });
      const current = (await bob.get(`/api/projects/${projectId}`)).body.tickets.find((t: any) => t.id === ids.ticket);
      const ids2 = current.assignees.map((a: any) => a.userId);
      // On retire alice : la mission de bob reste.
      const without = await bob.patch(`/api/tickets/${ids.ticket}`, { assigneeIds: ids2.filter((id: number) => id !== ids.alice) });
      assert.equal(without.body.ticket.assignees.length, 1);
      assert.equal(without.body.ticket.assignees[0].note, 'Relire la maquette');
      // On la réassigne : sa mission repart de zéro.
      const again = await bob.patch(`/api/tickets/${ids.ticket}`, { assigneeIds: ids2 });
      assert.equal(again.body.ticket.assignees.find((a: any) => a.userId === ids.alice).note, '');
    });

    it('déplace et ordonne les tickets dans les colonnes', async () => {
      const make = async (title: string) =>
        (await bob.post(`/api/projects/${projectId}/tickets`, { title, status: 'backlog' })).body.ticket.id as number;
      const a = await make('A');
      const b = await make('B');
      const c = await make('C');
      const column = async () => {
        const tickets = (await bob.get(`/api/projects/${projectId}`)).body.tickets as Array<{ id: number; status: string; position: number }>;
        return tickets.filter((t) => t.status === 'backlog').sort((x, y) => x.position - y.position).map((t) => t.id);
      };
      assert.deepEqual(await column(), [a, b, c]);
      await bob.post(`/api/tickets/${c}/move`, { status: 'backlog', beforeId: a });
      assert.deepEqual(await column(), [c, a, b]);
      await bob.post(`/api/tickets/${a}/move`, { status: 'backlog', beforeId: b });
      assert.deepEqual(await column(), [c, a, b]);
      await bob.post(`/api/tickets/${c}/move`, { status: 'blocked', beforeId: null });
      assert.deepEqual(await column(), [a, b]);
      assert.equal((await bob.post(`/api/tickets/${a}/move`, { status: 'blocked', beforeId: b })).status, 400);
    });

    it('reste cohérent après de nombreux insertions au même endroit (renumérotation)', async () => {
      const ids2: number[] = [];
      for (let i = 0; i < 3; i++) {
        ids2.push((await bob.post(`/api/projects/${projectId}/tickets`, { title: `R${i}`, status: 'review' })).body.ticket.id);
      }
      for (let i = 0; i < 60; i++) {
        const moved = await bob.post(`/api/tickets/${ids2[2]}/move`, { status: 'review', beforeId: ids2[0] });
        assert.equal(moved.status, 200);
        const reverse = await bob.post(`/api/tickets/${ids2[0]}/move`, { status: 'review', beforeId: ids2[2] });
        assert.equal(reverse.status, 200);
      }
      const tickets = (await bob.get(`/api/projects/${projectId}`)).body.tickets as Array<{ id: number; status: string; position: number }>;
      const positions = tickets.filter((t) => t.status === 'review').map((t) => t.position);
      assert.equal(new Set(positions).size, positions.length, 'positions uniques');
    });
  });

  describe('commentaires', () => {
    it('permet de discuter, répondre, modifier et supprimer', async () => {
      const root = await bob.post(`/api/tickets/${ids.ticket}/comments`, { body: 'On commence par la maquette ?' });
      assert.equal(root.status, 201);
      const reply = await alice.post(`/api/tickets/${ids.ticket}/comments`, { body: 'Oui, je m’en occupe.', parentId: root.body.comment.id });
      assert.equal(reply.body.comment.parentId, root.body.comment.id);

      assert.equal((await carol.post(`/api/tickets/${ids.ticket}/comments`, { body: 'Lecteur' })).status, 403);
      assert.equal((await alice.patch(`/api/comments/${root.body.comment.id}`, { body: 'Piratage' })).status, 403);
      const edited = await bob.patch(`/api/comments/${root.body.comment.id}`, { body: 'On commence par la maquette (v2) ?' });
      assert.ok(edited.body.comment.updatedAt);
      assert.equal((await alice.del(`/api/comments/${root.body.comment.id}`)).status, 403);

      const removed = await bob.del(`/api/comments/${root.body.comment.id}`);
      assert.equal(removed.body.comment.deleted, true);
      assert.equal(removed.body.comment.body, '');
      const list = (await bob.get(`/api/tickets/${ids.ticket}/comments`)).body.comments;
      assert.equal(list.length, 2);
      const ticket = (await bob.get(`/api/projects/${projectId}`)).body.tickets.find((t: any) => t.id === ids.ticket);
      assert.equal(ticket.commentCount, 1, 'les messages supprimés ne sont pas comptés');
    });
  });

  describe('temps réel (WebSocket)', () => {
    it("refuse la connexion sans session", async () => {
      await assert.rejects(app.client().connect());
    });

    it('diffuse les évènements du projet aux seuls membres abonnés', async () => {
      const aliceSocket = await alice.connect();
      const daveClient = app.client();
      await daveClient.login('dave@test.fr', 'motdepasse1');
      // dave possède projects.manage_all : il voit le projet. carol est lecteur.
      const carolSocket = await carol.connect();

      aliceSocket.send({ t: 'subscribe', projectId });
      carolSocket.send({ t: 'subscribe', projectId });
      await aliceSocket.waitFor((m) => m.t === 'subscribed');
      await carolSocket.waitFor((m) => m.t === 'subscribed');

      aliceSocket.send({ t: 'presence', ticketId: ids.ticket, view: 'kanban' });
      const presence = await carolSocket.waitFor((m) => m.t === 'presence' && m.users.some((u) => u.userId === ids.alice && u.ticketIds.includes(ids.ticket!)));
      assert.equal(presence.t, 'presence');

      await bob.patch(`/api/tickets/${ids.ticket}`, { title: 'Titre en direct' }).then(() => undefined);
      const event = await aliceSocket.waitFor((m) => m.t === 'event' && m.event.type === 'ticket.updated' && m.event.ticket.title === 'Titre en direct');
      assert.equal(event.t === 'event' && event.actorId, ids.bob);
      await carolSocket.waitFor((m) => m.t === 'event' && m.event.type === 'history.created');

      await alice.post(`/api/tickets/${ids.ticket}/comments`, { body: 'Message temps réel' });
      await carolSocket.waitFor((m) => m.t === 'event' && m.event.type === 'comment.created' && m.event.comment.body === 'Message temps réel');

      aliceSocket.close();
      carolSocket.close();
    });

    it("n'abonne pas un utilisateur sans accès au projet", async () => {
      const other = app.client();
      const created = await admin.post('/api/admin/users', { email: 'eve@test.fr', name: 'eve', password: 'motdepasse1', roleId: ids.member });
      assert.equal(created.status, 201);
      assert.equal((await other.login('eve@test.fr', 'motdepasse1')).status, 200);
      const socket = await other.connect();
      socket.send({ t: 'subscribe', projectId });
      await socket.waitFor((m) => m.t === 'project.revoked');
      socket.close();
    });

    it("retire l'accès en direct quand un membre est supprimé du projet", async () => {
      const carolSocket = await carol.connect();
      carolSocket.send({ t: 'subscribe', projectId });
      await carolSocket.waitFor((m) => m.t === 'subscribed');
      await bob.del(`/api/projects/${projectId}/members/${ids.carol}`);
      await carolSocket.waitFor((m) => m.t === 'project.revoked');
      assert.equal((await carol.get(`/api/projects/${projectId}`)).status, 404);
      carolSocket.close();
    });
  });

  describe('rôles personnalisés', () => {
    it('crée un rôle de projet sur mesure et le limite aux permissions possédées', async () => {
      const custom = await admin.post('/api/admin/roles', {
        scope: 'project', name: 'Relecteur', description: 'Commente seulement', permissions: ['comment.create'],
      });
      assert.equal(custom.status, 201);
      const unknown = await admin.post('/api/admin/roles', { scope: 'project', name: 'Faux', permissions: ['inexistante'] });
      assert.equal(unknown.status, 400);
      const daveClient = app.client();
      await daveClient.login('dave@test.fr', 'motdepasse1');
      const beyond = await daveClient.post('/api/admin/roles', { scope: 'global', name: 'Trop', permissions: ['admin.access', 'users.view', 'inexistante'] });
      assert.equal(beyond.status, 400);
      assert.equal((await bob.post('/api/admin/roles', { scope: 'project', name: 'Hack', permissions: [] })).status, 403);
    });

    it("un administrateur (gère tous les projets) peut créer un rôle de projet, pas un rôle global plus puissant", async () => {
      const daveClient = app.client();
      await daveClient.login('dave@test.fr', 'motdepasse1');
      const projectRole = await daveClient.post('/api/admin/roles', { scope: 'project', name: 'Chef de chantier', permissions: ['ticket.edit', 'ticket.create', 'comment.create'] });
      assert.equal(projectRole.status, 201, JSON.stringify(projectRole.body));
      const tooMuch = await daveClient.post('/api/admin/roles', { scope: 'global', name: 'Presque dieu', permissions: ['admin.access', 'projects.manage_all'] });
      assert.equal(tooMuch.status, 201, 'dave possède ces permissions : autorisé');
      const noRoleManage = await bob.post('/api/admin/roles', { scope: 'project', name: 'Pirate', permissions: ['ticket.edit'] });
      assert.equal(noRoleManage.status, 403);
    });

    it('verrouille les rôles système et empêche de supprimer un rôle utilisé', async () => {
      assert.equal((await admin.patch(`/api/admin/roles/${ids.superAdmin}`, { permissions: [] })).status, 409);
      assert.equal((await admin.patch(`/api/admin/roles/${ids.owner}`, { permissions: [] })).status, 409);
      assert.equal((await admin.del(`/api/admin/roles/${ids.member}`)).status, 409);
    });
  });

  describe('projet archivé et suppression', () => {
    it("un projet archivé est en lecture seule", async () => {
      assert.equal((await bob.patch(`/api/projects/${projectId}`, { archived: true })).status, 200);
      assert.equal((await bob.post(`/api/projects/${projectId}/tickets`, { title: 'Après archivage' })).status, 409);
      assert.equal((await bob.patch(`/api/projects/${projectId}`, { archived: false })).status, 200);
    });

    it("supprime un projet et tout son contenu", async () => {
      assert.equal((await alice.del(`/api/projects/${projectId}`)).status, 403);
      assert.equal((await bob.del(`/api/projects/${projectId}`)).status, 200);
      assert.equal((await bob.get(`/api/projects/${projectId}`)).status, 404);
      const leftovers = app.running.ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tickets');
      assert.equal(leftovers?.n, 0);
    });
  });
});
