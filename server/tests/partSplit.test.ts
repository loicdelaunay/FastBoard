import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { splitPlan } from '../../shared/partSplit.ts';
import type { TicketDTO } from '../../shared/types.ts';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

describe('découper les lignes d’avancement en sous-tickets', () => {
  let app: Booted;
  let admin: TestClient;
  let bob: TestClient;
  let alice: TestClient;
  const ids: Record<string, number> = {};

  before(async () => {
    app = await bootServer();
    admin = app.client();
    await admin.login('admin@admin.com', 'admin1234');
    const roles = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
    const role = (key: string, scope = 'global') => roles.find((r) => r.key === key && r.scope === scope)!.id;
    for (const name of ['bob', 'alice']) ids[name] = (await admin.post('/api/admin/users', { email: `${name}@s.fr`, name, password: 'motdepasse1', roleId: role('member') })).body.user.id;
    bob = app.client();
    await bob.login('bob@s.fr', 'motdepasse1');
    alice = app.client();
    await alice.login('alice@s.fr', 'motdepasse1');
    ids.project = (await bob.post('/api/projects', { name: 'Refonte', key: 'RF' })).body.project.id;
    await bob.post(`/api/projects/${ids.project}/members`, { userId: ids.alice, roleId: role('contributor', 'project') });
    const categories = (await bob.post(`/api/projects/${ids.project}/categories`, { name: 'Front', color: '#3366ff' })).body;
    ids.category = (categories.category ?? categories.categories?.at(-1))?.id;
  });

  after(async () => {
    await app.running.close();
  });

  it('décide du titre, de la description et du statut de chaque sous-ticket', () => {
    const parent = { title: 'Page d’accueil', status: 'in_progress' as const };
    assert.deepEqual(splitPlan({ note: 'Maquette', done: false, progress: 0 }, parent, 'alice'), { title: 'Maquette', description: '', status: 'todo' });
    assert.deepEqual(splitPlan({ note: 'Intégration\nAvec les tests', done: false, progress: 40 }, parent, null), { title: 'Intégration', description: 'Intégration\nAvec les tests', status: 'in_progress' });
    assert.deepEqual(splitPlan({ note: '', done: true, progress: 100 }, parent, 'bob'), { title: 'Page d’accueil — bob', description: '', status: 'done' });
    assert.equal(splitPlan({ note: 'x', done: false, progress: 0 }, { title: 'T', status: 'backlog' }, null).status, 'backlog', 'le statut du ticket s’il n’est pas avancé');
    assert.equal(splitPlan({ note: 'x', done: false, progress: 30 }, parent, null, (status) => status !== 'in_progress').status, 'todo', 'colonne masquée : repli');
    const long = 'a'.repeat(250);
    const plan = splitPlan({ note: long, done: false, progress: 0 }, parent, null);
    assert.equal(plan.title.length, 200);
    assert.equal(plan.description, long, 'le texte entier reste dans la description');
  });

  it('transforme chaque ligne en sous-ticket, qui reprend la personne, l’avancement et les champs du ticket', async () => {
    const ticket = (await bob.post(`/api/projects/${ids.project}/tickets`, { title: 'Page d’accueil', status: 'in_progress', categoryId: ids.category ?? null, startDate: '2026-12-01', endDate: '2026-12-10' })).body.ticket as TicketDTO;
    await bob.post(`/api/tickets/${ticket.id}/parts`, { note: 'Maquette', userId: ids.alice });
    const second = (await bob.post(`/api/tickets/${ticket.id}/parts`, { note: 'Intégration\nAvec les tests', userId: ids.bob })).body.ticket as TicketDTO;
    await bob.patch(`/api/parts/${second.parts.at(-1)!.id}`, { progress: 40 });
    const third = (await bob.post(`/api/tickets/${ticket.id}/parts`, { note: 'Relecture' })).body.ticket as TicketDTO;
    await bob.patch(`/api/parts/${third.parts.at(-1)!.id}`, { done: true });

    assert.equal((await alice.post(`/api/tickets/${ticket.id}/parts/split`, {})).status, 403, 'il faut pouvoir modifier et créer des tickets');
    const response = await bob.post(`/api/tickets/${ticket.id}/parts/split`, {});
    assert.equal(response.status, 200);
    const parent = response.body.ticket as TicketDTO;
    const children = response.body.children as TicketDTO[];
    assert.equal(parent.parts.length, 0, 'les lignes quittent le ticket');
    assert.equal(parent.progressFromChildren, true);
    assert.deepEqual(children.map((child) => [child.title, child.status, child.parentId]), [
      ['Maquette', 'todo', ticket.id],
      ['Intégration', 'in_progress', ticket.id],
      ['Relecture', 'done', ticket.id],
    ]);
    assert.deepEqual(children[0]!.parts.map((part) => [part.userId, part.progress]), [[ids.alice, 0]]);
    assert.deepEqual(children[1]!.parts.map((part) => [part.userId, part.progress]), [[ids.bob, 40]]);
    assert.equal(children[1]!.description, 'Intégration\nAvec les tests');
    assert.equal(children[2]!.parts.length, 0, 'sans personne, pas de ligne');
    assert.equal(children[2]!.progress, 100);
    for (const child of children) {
      assert.equal(child.categoryId, ids.category ?? null);
      assert.deepEqual([child.startDate, child.endDate], ['2026-12-01', '2026-12-10']);
    }
    const history = (await bob.get(`/api/tickets/${ticket.id}/history`)).body.history as Array<{ data: { kind: string; action?: string } }>;
    assert.ok(history.some((entry) => entry.data.kind === 'part' && entry.data.action === 'removed'), 'l’historique du ticket le dit');

    // Plus rien à découper ; un sous-ticket ne se découpe pas (un seul niveau).
    assert.equal((await bob.post(`/api/tickets/${ticket.id}/parts/split`, {})).status, 400);
    await bob.post(`/api/tickets/${children[0]!.id}/parts`, { note: 'Détail' });
    assert.equal((await bob.post(`/api/tickets/${children[0]!.id}/parts/split`, {})).status, 400);
  });
});
