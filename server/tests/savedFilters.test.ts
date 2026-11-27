import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { ServerMessage } from '../../shared/realtime.ts';
import { filtersFromQuery, filtersToQuery, emptyTicketFilters, sameFilters, type SavedFilterDTO, type TicketFilterValues } from '../../shared/ticketFilters.ts';
import { Db } from '../db/database.ts';
import { migrate } from '../db/migrations.ts';
import { bootServer, type SocketProbe, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

/**
 * Filtres des vues : leur forme dans l'adresse (lien partageable), et les filtres enregistrés d'un projet, gardés pour
 * soi ou partagés avec tout le projet (nom de l'auteur, description), avec leurs droits et leur diffusion en direct.
 */
describe('filtres : adresse et filtres enregistrés', () => {
  let app: Booted;
  let admin: TestClient;
  const clients: Record<string, TestClient> = {};
  const ids: Record<string, number> = {};
  const sockets: SocketProbe[] = [];
  const list = async (name: string, projectId = ids.project) => (await clients[name]!.get(`/api/projects/${projectId}/filters`)).body.filters as SavedFilterDTO[];
  const filters: TicketFilterValues = { ...emptyTicketFilters(), statuses: ['todo', 'in_progress'], categoryIds: [3, 'none'], overdueOnly: true };

  before(async () => {
    app = await bootServer();
    admin = app.client();
    await admin.login('admin@admin.com', 'admin1234');
    const roles = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
    const role = (key: string, scope = 'global') => roles.find((entry) => entry.key === key && entry.scope === scope)!.id;
    for (const name of ['olga', 'gus', 'vic', 'ivan']) {
      ids[name] = (await admin.post('/api/admin/users', { email: `${name}@f.fr`, name, password: 'motdepasse1', roleId: role('member') })).body.user.id;
      clients[name] = app.client();
      await clients[name]!.login(`${name}@f.fr`, 'motdepasse1');
    }
    ids.project = (await clients.olga!.post('/api/projects', { name: 'Site', key: 'ST' })).body.project.id;
    await clients.olga!.post(`/api/projects/${ids.project}/members`, { userId: ids.gus, roleId: role('editor', 'project') });
    await clients.olga!.post(`/api/projects/${ids.project}/members`, { userId: ids.vic, roleId: role('viewer', 'project') });
  });

  after(async () => {
    for (const socket of sockets) socket.close();
    await app.running.close();
  });

  it('migration 36 : la table des filtres enregistrés s’ajoute à une base existante, une seule fois', () => {
    const db = new Db(':memory:');
    migrate(db, 35);
    migrate(db);
    assert.equal(db.get<{ user_version: number }>('PRAGMA user_version')!.user_version, 37);
    assert.ok(db.get("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'ticket_filters'"));
    migrate(db);
    assert.equal(db.get<{ user_version: number }>('PRAGMA user_version')!.user_version, 37);
    db.close();
  });

  it('écrit les filtres dans l’adresse et les relit, sans rien de plus', () => {
    const query = filtersToQuery({ ...filters, search: ' paiement ', assigneeIds: [7], mineOnly: true });
    assert.deepEqual(query, { q: 'paiement', categories: '3,sans', personnes: '7', statuts: 'todo,in_progress', retard: '1', mes: '1' });
    assert.ok(sameFilters(filtersFromQuery(query), { ...filters, search: 'paiement', assigneeIds: [7], mineOnly: true }));
    assert.deepEqual(filtersToQuery(emptyTicketFilters()), {}, 'sans filtre : adresse propre');
    const odd = filtersFromQuery({ statuts: 'todo,inconnu', categories: 'abc,-2,4,4', retard: 'non', livraisons: ['9', '1'] });
    assert.deepEqual([odd.statuses, odd.categoryIds, odd.overdueOnly, odd.deliveryIds], [['todo'], [4], false, [9]], 'ce qui est illisible est ignoré');
  });

  it('un filtre personnel reste à son auteur ; un filtre partagé est vu de tout le projet, avec son auteur et sa description', async () => {
    const gusSocket = await clients.gus!.connect();
    sockets.push(gusSocket);
    gusSocket.send({ t: 'subscribe', projectId: ids.project });
    await gusSocket.waitFor((message) => message.t === 'subscribed');

    const mine = await clients.olga!.post(`/api/projects/${ids.project}/filters`, { name: 'Mes urgences', filters });
    assert.equal(mine.status, 201, JSON.stringify(mine.body));
    assert.deepEqual([mine.body.filter.shared, mine.body.filter.canEdit, mine.body.filter.createdByName], [false, true, 'olga']);
    const shared = await clients.olga!.post(`/api/projects/${ids.project}/filters`, { name: 'À tester cette semaine', description: 'Pour la revue du vendredi.', filters, shared: true });
    ids.shared = shared.body.filter.id;
    const event = (await gusSocket.waitFor((message) => message.t === 'event' && message.event.type === 'filter.saved')) as Extract<ServerMessage, { t: 'event' }>;
    assert.equal(event.event.type === 'filter.saved' && event.event.filter.id, ids.shared, 'seul le filtre partagé est diffusé');

    assert.deepEqual((await list('olga')).map((filter) => filter.name), ['À tester cette semaine', 'Mes urgences']);
    const seen = await list('gus');
    assert.deepEqual(seen.map((filter) => [filter.name, filter.description, filter.createdByName, filter.canEdit]), [['À tester cette semaine', 'Pour la revue du vendredi.', 'olga', false]]);
    assert.ok(sameFilters(seen[0]!.filters, filters), 'les valeurs sont gardées telles quelles');
    assert.equal((await list('vic')).length, 1, 'un lecteur du projet l’utilise aussi');
    assert.equal((await clients.ivan!.get(`/api/projects/${ids.project}/filters`)).status, 404, 'hors du projet : rien');
    assert.equal((await clients.gus!.request('PATCH', `/api/filters/${mine.body.filter.id}`, { name: 'x' })).status, 404, 'le filtre personnel d’un autre n’existe pas pour lui');
  });

  it('seul son auteur, ou qui gère le projet, modifie ou supprime un filtre partagé', async () => {
    assert.equal((await clients.gus!.request('PATCH', `/api/filters/${ids.shared}`, { name: 'Repris' })).status, 403);
    assert.equal((await clients.gus!.del(`/api/filters/${ids.shared}`)).status, 403);
    const own = await clients.gus!.post(`/api/projects/${ids.project}/filters`, { name: 'Bugs de Gus', filters, shared: true });
    // La propriétaire du projet gère tous les filtres partagés, sans pouvoir retirer à Gus le sien.
    assert.equal((await clients.olga!.request('PATCH', `/api/filters/${own.body.filter.id}`, { name: 'Bugs ouverts' })).body.filter.name, 'Bugs ouverts');
    assert.equal((await clients.olga!.request('PATCH', `/api/filters/${own.body.filter.id}`, { shared: false })).status, 403);
    assert.equal((await clients.olga!.del(`/api/filters/${own.body.filter.id}`)).status, 200);
    assert.ok(!(await list('gus')).some((filter) => filter.id === own.body.filter.id));
    assert.equal((await clients.olga!.post(`/api/projects/${ids.project}/filters`, { name: ' ', filters })).status, 400, 'il faut un nom');
    assert.equal((await clients.olga!.post(`/api/projects/${ids.project}/filters`, { name: 'Faux', filters: { statuses: ['inconnu'] } })).status, 400);
  });

  it('ne plus partager un filtre le retire aux autres, pas à son auteur ; un compte supprimé garde ses filtres partagés', async () => {
    const gusSocket = sockets[0]!;
    assert.equal((await clients.olga!.request('PATCH', `/api/filters/${ids.shared}`, { shared: false })).status, 200);
    const gone = (await gusSocket.waitFor((message) => message.t === 'event' && message.event.type === 'filter.deleted' && message.event.filterId === ids.shared)) as Extract<ServerMessage, { t: 'event' }>;
    assert.equal(gone.event.type === 'filter.deleted' && gone.event.keepFor, ids.olga);
    assert.equal((await list('gus')).length, 0);
    assert.ok((await list('olga')).some((filter) => filter.id === ids.shared));

    // Vic partage un filtre et en garde un pour lui, puis son compte est supprimé.
    await clients.vic!.post(`/api/projects/${ids.project}/filters`, { name: 'De Vic (partagé)', filters, shared: true });
    await clients.vic!.post(`/api/projects/${ids.project}/filters`, { name: 'De Vic (perso)', filters });
    assert.equal((await admin.del(`/api/admin/users/${ids.vic}`)).status, 200);
    const left = (await list('gus')).find((filter) => filter.name === 'De Vic (partagé)');
    assert.deepEqual([left?.createdBy, left?.createdByName], [null, null], 'le filtre partagé reste, sans auteur');
    assert.equal(app.running.ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM ticket_filters WHERE name = 'De Vic (perso)'")!.n, 0, 'le filtre personnel part avec le compte');
  });
});
