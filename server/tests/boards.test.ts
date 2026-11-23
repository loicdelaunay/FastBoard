import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import * as Y from 'yjs';
import { attachAt, connectorGeometry, connectorStroke, crossingsOf, layoutMind, shapePath, shiftSegment } from '../../shared/boardGeometry.ts';
import { boardPreviewSvg } from '../../shared/boardPreview.ts';
import { diffElements, MOCKUP_KINDS, shiftConnector, type BoardElement, type BoardNodeDTO, type BoardVersionDTO, type ConnectorElement, type MindElement, type MockupElement, type ShapeElement } from '../../shared/boards.ts';
import { base64ToBytes, bytesToBase64 } from '../../shared/docs.ts';
import type { ServerMessage } from '../../shared/realtime.ts';
import { sanitizeElements } from '../boards/elements.ts';
import { elementsHash } from '../boards/versions.ts';
import { WebSocket } from 'ws';
import { bootServer, SocketProbe, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Délai dépassé');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const shape = (id: string, x: number, y: number, text = id): ShapeElement => ({ id, type: 'shape', z: 1, x, y, w: 160, h: 80, shape: 'rect', text, color: 'default', fill: 'solid', size: 'm' });
const link = (id: string, from: string, to: string): ConnectorElement => ({
  id,
  type: 'connector',
  z: 2,
  from: { id: from, side: null, x: 0, y: 0 },
  to: { id: to, side: null, x: 0, y: 0 },
  label: '',
  route: 'elbow',
  dashed: false,
  arrowStart: false,
  arrowEnd: true,
  color: 'default',
});

describe('géométrie des tableaux blancs', () => {
  it('accroche un lien au côté tourné vers l’autre élément', () => {
    const index = new Map<string, BoardElement>([
      ['a', shape('a', 0, 0)],
      ['b', shape('b', 400, 0)],
    ]);
    const straight = connectorGeometry({ ...link('l', 'a', 'b'), route: 'straight' }, index);
    assert.deepEqual(straight.start, { x: 160, y: 40 });
    assert.deepEqual(straight.end, { x: 400, y: 40 });
    const elbow = connectorGeometry({ ...link('l', 'a', 'b'), to: { id: 'b', side: 'top', x: 0, y: 0 } }, index);
    assert.ok(elbow.points.every((point, position) => position === 0 || point.x === elbow.points[position - 1]!.x || point.y === elbow.points[position - 1]!.y), 'que des angles droits');
    assert.match(shapePath('diamond', 100, 60), /^M50,0 L100,30/);
  });

  it('accroche précisément, passe par les points de passage et décale un segment', () => {
    const index = new Map<string, BoardElement>([
      ['a', shape('a', 0, 0)],
      ['b', shape('b', 400, 200)],
    ]);
    // Près du bord haut, à un quart de la largeur : côté et position ; au cœur de la forme : automatique.
    assert.deepEqual(attachAt(shape('x', 0, 0), { x: 40, y: 2 }), { side: 'top', t: 0.25 });
    assert.deepEqual(attachAt(shape('x', 0, 0), { x: 82, y: 1 }), { side: 'top', t: 0.5 }, 'aimanté au milieu');
    assert.equal(attachAt(shape('x', 0, 0), { x: 80, y: 40 }), null);
    const precise = connectorGeometry({ ...link('l', 'a', 'b'), from: { id: 'a', side: 'bottom', x: 0, y: 0, t: 0.25 } }, index);
    assert.deepEqual(precise.start, { x: 40, y: 80 });

    const via = connectorGeometry({ ...link('l', 'a', 'b'), route: 'straight', waypoints: [{ x: 300, y: -100 }] }, index);
    assert.deepEqual(via.line[1], { x: 300, y: -100 });
    const curve = connectorGeometry({ ...link('l', 'a', 'b'), route: 'curve', waypoints: [{ x: 300, y: -100 }] }, index);
    assert.equal(curve.curves?.length, 2, 'une courbe par tronçon');
    assert.deepEqual(curve.curves![0]![3], { x: 300, y: -100 }, 'la courbe passe par le point');

    const elbow = connectorGeometry({ ...link('l', 'a', 'b'), from: { id: 'a', side: 'right', x: 0, y: 0 }, to: { id: 'b', side: 'left', x: 0, y: 0 } }, index);
    const middle = elbow.line.findIndex((point, position) => position > 0 && position < elbow.line.length - 2 && point.x === elbow.line[position + 1]!.x && !elbow.fixed.includes(position));
    const moved = shiftSegment(elbow, middle, 60);
    assert.ok(moved.length >= 2 && moved.every((point) => point.x === elbow.line[middle]!.x + 60), 'le segment vertical glisse de 60');
    const rerouted = connectorGeometry({ ...link('l', 'a', 'b'), from: { id: 'a', side: 'right', x: 0, y: 0 }, to: { id: 'b', side: 'left', x: 0, y: 0 }, waypoints: moved }, index);
    assert.ok(rerouted.line.every((point, position) => position === 0 || point.x === rerouted.line[position - 1]!.x || point.y === rerouted.line[position - 1]!.y), 'toujours à angles droits');
  });

  it('dessine les sauts aux croisements et garde les réglages des liens', () => {
    const horizontal = [{ x: 0, y: 50 }, { x: 200, y: 50 }];
    const vertical = [{ x: 100, y: 0 }, { x: 100, y: 100 }];
    const found = crossingsOf(horizontal, [vertical]);
    assert.deepEqual(found.get(0), [100]);
    const index = new Map<string, BoardElement>([
      ['a', shape('a', 0, 0)],
      ['b', shape('b', 400, 0)],
    ]);
    const geometry = connectorGeometry({ ...link('l', 'a', 'b'), route: 'straight' }, index);
    const crossing = crossingsOf(geometry.line, [[{ x: 280, y: -100 }, { x: 280, y: 200 }]]);
    assert.match(connectorStroke({ ...link('l', 'a', 'b'), route: 'straight', jump: 'arc' }, geometry, crossing).d, / A[\d.]+,[\d.]+ 0 0 1 /);
    assert.match(connectorStroke({ ...link('l', 'a', 'b'), route: 'straight', jump: 'gap' }, geometry, crossing).d, / M/);

    const [kept, cleaned] = sanitizeElements([
      { ...link('k', 'a', 'b'), from: { id: 'a', side: 'top', x: 0, y: 0, t: 0.3 }, waypoints: [{ x: 1, y: 2 }], jump: 'gap', animation: 'dots', animationReverse: true, animationColor: 'red', animationSpeed: 'fast' },
      { ...link('c', 'a', 'b'), waypoints: 'non', jump: 'boing', animation: 'feu', animationReverse: true },
    ] as unknown as BoardElement[]) as ConnectorElement[];
    assert.deepEqual(
      { t: kept!.from.t, waypoints: kept!.waypoints, jump: kept!.jump, animation: kept!.animation, reverse: kept!.animationReverse, color: kept!.animationColor, speed: kept!.animationSpeed },
      { t: 0.3, waypoints: [{ x: 1, y: 2 }], jump: 'gap', animation: 'dots', reverse: true, color: 'red', speed: 'fast' },
    );
    for (const key of ['waypoints', 'jump', 'animation', 'animationReverse']) assert.ok(!(key in cleaned!), key);
    assert.deepEqual(shiftConnector(kept!, 10, 5).waypoints, [{ x: 11, y: 7 }]);
  });

  it('compare deux états d’un tableau et regroupe les versions rapprochées', () => {
    const before = [shape('a', 0, 0, 'Un'), shape('b', 300, 0, 'Deux'), shape('c', 600, 0)];
    const after = [shape('a', 0, 0, 'Un'), shape('b', 320, 0, 'Deux'), shape('d', 900, 0)];
    assert.deepEqual(diffElements(before, after), { added: ['d'], changed: ['b'], removed: ['c'] });
    // L'empreinte ne dépend pas de l'ordre des éléments (une salle d'édition a le sien).
    assert.equal(elementsHash(JSON.stringify(before)), elementsHash(JSON.stringify([...before].reverse())));
    assert.notEqual(elementsHash(JSON.stringify(before)), elementsHash(JSON.stringify(after)));
  });

  it('range les enfants d’une carte mentale à droite de leur parent, sans chevauchement', () => {
    const node = (id: string, parent: string | null, y = 0): MindElement => ({ id, type: 'mind', z: 1, x: 0, y, w: 120, h: 40, text: id, color: 'blue', parent, direction: 'right' });
    const elements = [node('root', null), node('a', 'root', 10), node('b', 'root', 20), node('a1', 'a', 30)];
    const moves = layoutMind(elements, 'root');
    assert.ok(moves.get('a')!.x > 120 && moves.get('a1')!.x > moves.get('a')!.x);
    assert.ok(moves.get('a')!.y + 40 <= moves.get('b')!.y, 'les sous-arbres ne se chevauchent pas');
  });

  it('écarte les éléments illisibles et borne les valeurs', () => {
    const clean = sanitizeElements([{ id: 'x', type: 'shape', x: 'a', y: 1e12, w: -5, text: 42, shape: 'étoile' }, { id: 'y', type: 'inconnu' }, { type: 'shape' }, { id: 'z', type: 'fast', ref: { kind: 'ticket', id: 'NaN' } }]);
    assert.equal(clean.length, 1);
    assert.deepEqual({ ...clean[0], z: 0 }, { id: 'x', type: 'shape', z: 0, x: 0, y: 1_000_000, w: 4, h: 80, shape: 'rect', text: '', color: 'default', fill: 'solid', size: 'm' });
  });

  it('garde le groupe d’un élément, borné, sauf sur un nœud de carte mentale', () => {
    const mind: MindElement = { id: 'm', type: 'mind', z: 1, x: 0, y: 0, w: 120, h: 40, text: 'Idée', color: 'blue', parent: null, direction: 'right' };
    const clean = sanitizeElements([
      { ...shape('a', 0, 0), group: 'g1' },
      { ...link('l', 'a', 'b'), group: 'g1' },
      { ...shape('b', 300, 0), group: 'x'.repeat(100) },
      { ...shape('c', 600, 0), group: 42 },
      { ...shape('d', 900, 0), group: '   ' },
      { ...mind, group: 'g1' },
    ]);
    const groups = Object.fromEntries(clean.map((element) => [element.id, element.group]));
    assert.deepEqual(groups, { a: 'g1', l: 'g1', b: 'x'.repeat(40), c: undefined, d: undefined, m: undefined });
    assert.ok(!('group' in clean.find((element) => element.id === 'c')!), 'pas de champ vide');
  });

  it('dessine un aperçu SVG sans rien d’exécutable', () => {
    const svg = boardPreviewSvg([shape('a', 0, 0, '<script>alert(1)</script>'), shape('b', 300, 0), link('l', 'a', 'b')]);
    assert.ok(svg.startsWith('<svg'));
    assert.ok(!svg.includes('<script'));
    assert.match(svg, /&#60;script&#62;/);
    assert.match(svg, /<polygon class="arrow" points=/);
  });

  it('nettoie et dessine les composants de maquette', () => {
    const [button, wrong, escaped] = sanitizeElements([
      { id: 'b', type: 'mockup', z: 1, x: 0, y: 0, w: 120, h: 40, kind: 'button', text: 'Valider', color: 'blue', variant: 'outline', checked: true, value: 250, size: 'l' },
      { id: 'w', type: 'mockup', z: 2, x: 0, y: 60, w: 120, h: 40, kind: 'fusée', variant: 'néon', value: 'beaucoup' },
      { id: 'e', type: 'mockup', z: 3, x: 0, y: 120, w: 300, h: 56, kind: 'tabs', text: 'Un\n<script>alert(1)</script>', color: 'red', value: 2 },
    ]) as MockupElement[];
    assert.deepEqual(
      { kind: button!.kind, variant: button!.variant, checked: button!.checked, value: button!.value, size: button!.size },
      { kind: 'button', variant: 'outline', checked: true, value: 100, size: 'l' },
    );
    assert.deepEqual({ kind: wrong!.kind, variant: wrong!.variant, value: wrong!.value, text: wrong!.text }, { kind: 'button', variant: 'primary', value: 50, text: '' });
    for (const kind of MOCKUP_KINDS) {
      const svg = boardPreviewSvg([{ ...escaped!, kind }]);
      assert.ok(!svg.includes('<script'), kind);
      assert.ok(!svg.includes('NaN'), kind);
    }
  });

  it('garde l’épaisseur d’un lien et dessine la grosse flèche', () => {
    const [heavy, plain, wrong] = sanitizeElements([
      { ...link('h', 'a', 'b'), weight: 'block', arrowStart: true },
      { ...link('p', 'a', 'b'), weight: 'm' },
      { ...link('w', 'a', 'b'), weight: 'énorme' } as unknown as ConnectorElement,
    ]) as ConnectorElement[];
    assert.equal(heavy!.weight, 'block');
    assert.ok(!('weight' in plain!), 'l’épaisseur habituelle n’est pas écrite');
    assert.ok(!('weight' in wrong!));
    const svg = boardPreviewSvg([shape('a', 0, 0), shape('b', 300, 0), heavy!]);
    // Deux pointes, chacune dessinée deux fois (contour puis remplissage).
    assert.equal(svg.match(/<polygon/g)?.length, 4);
  });
});

describe('tableaux blancs', () => {
  let app: Booted;
  let admin: TestClient;
  let bob: TestClient;
  let vera: TestClient;
  let eve: TestClient;
  const ids: Record<string, number> = {};

  before(async () => {
    app = await bootServer();
    admin = app.client();
    await admin.login('admin@admin.com', 'admin1234');
    const roles = (await admin.get('/api/admin/roles')).body.roles as Array<{ id: number; key: string; scope: string }>;
    const member = roles.find((role) => role.key === 'member' && role.scope === 'global')!.id;
    for (const name of ['bob', 'vera', 'eve']) {
      ids[name] = (await admin.post('/api/admin/users', { email: `${name}@t.fr`, name, password: 'motdepasse1', roleId: member })).body.user.id;
    }
    bob = app.client();
    await bob.login('bob@t.fr', 'motdepasse1');
    vera = app.client();
    await vera.login('vera@t.fr', 'motdepasse1');
    eve = app.client();
    await eve.login('eve@t.fr', 'motdepasse1');
  });

  after(async () => {
    await app.running.close();
  });

  const newSpace = async (name: string) => (await bob.post('/api/boards/spaces', { name })).body.space.id as number;
  const newBoard = async (spaceId: number, path: string, elements?: BoardElement[]) => (await bob.post(`/api/boards/spaces/${spaceId}/nodes`, { path, ...(elements ? { elements } : {}) })).body.node as BoardNodeDTO;

  it('sont activés d’office, et se coupent depuis l’administration', async () => {
    assert.equal((await app.client().get('/api/app')).body.boards, true);
    assert.equal((await admin.request('PUT', '/api/admin/boards', { enabled: false })).status, 200);
    const refused = await bob.get('/api/boards/spaces');
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'boards_disabled');
    assert.equal((await bob.request('PUT', '/api/admin/boards', { enabled: true })).status, 403);
    assert.equal((await admin.request('PUT', '/api/admin/boards', { enabled: true })).status, 200);
    assert.equal((await admin.get('/api/admin/boards')).body.enabled, true);
  });

  it('rangent des tableaux en dossiers, selon le rôle de chacun', async () => {
    const spaceId = await newSpace('Ateliers');
    await bob.post(`/api/boards/spaces/${spaceId}/members`, { userId: ids.vera, role: 'reader' });
    const board = await newBoard(spaceId, 'Rétros/2026/Mars');
    assert.equal(board.kind, 'board');
    const { nodes, role } = (await vera.get(`/api/boards/spaces/${spaceId}`)).body;
    assert.equal(role, 'reader');
    assert.deepEqual(
      nodes.map((node: BoardNodeDTO) => `${node.kind}:${node.path}`),
      ['folder:Rétros', 'folder:Rétros/2026', 'board:Rétros/2026/Mars'],
    );
    assert.equal((await vera.post(`/api/boards/spaces/${spaceId}/nodes`, { path: 'Interdit' })).status, 403, 'un lecteur ne crée rien');
    assert.equal((await eve.get(`/api/boards/spaces/${spaceId}`)).status, 404, 'hors de l’espace : introuvable');
    assert.equal((await bob.post(`/api/boards/spaces/${spaceId}/nodes`, { path: 'Rétros/2026/Mars' })).status, 409, 'nom déjà pris');

    // Renommer un dossier emmène son contenu.
    const folder = nodes.find((node: BoardNodeDTO) => node.path === 'Rétros')!;
    assert.equal((await bob.request('PATCH', `/api/boards/nodes/${folder.id}`, { path: 'Archives/Rétros' })).status, 200);
    const moved = (await bob.get(`/api/boards/spaces/${spaceId}`)).body.nodes.map((node: BoardNodeDTO) => node.path);
    assert.ok(moved.includes('Archives/Rétros/2026/Mars'));
    assert.equal((await bob.request('PATCH', `/api/boards/nodes/${folder.id}`, { path: 'Archives/Rétros/Dedans' })).status, 400, 'pas dans lui-même');

    // Corbeille et restauration.
    assert.equal((await bob.del(`/api/boards/nodes/${folder.id}`)).status, 200);
    assert.deepEqual((await bob.get(`/api/boards/spaces/${spaceId}`)).body.nodes.map((node: BoardNodeDTO) => node.path), ['Archives']);
    const trash = (await bob.get(`/api/boards/spaces/${spaceId}/trash`)).body.nodes as BoardNodeDTO[];
    assert.deepEqual(trash.map((node) => node.path), ['Archives/Rétros/2026/Mars']);
    assert.equal((await bob.post(`/api/boards/nodes/${board.id}/restore`)).body.node.path, 'Archives/Rétros/2026/Mars');
  });

  it('gardent leurs éléments, les nettoient, et donnent un aperçu', async () => {
    const spaceId = await newSpace('Schémas');
    const board = await newBoard(spaceId, 'Architecture', [shape('a', 0, 0, 'Client'), shape('b', 300, 0, 'Serveur'), link('l', 'a', 'b')]);
    assert.equal(board.elementCount, 3);
    const read = (await bob.get(`/api/boards/nodes/${board.id}`)).body;
    assert.equal(read.space.name, 'Schémas');
    assert.deepEqual(read.elements.map((element: BoardElement) => element.id), ['a', 'b', 'l']);

    assert.equal((await bob.request('PUT', `/api/boards/nodes/${board.id}/elements`, { elements: [shape('c', 0, 0, 'Base de données'), { id: 'bad', type: 'inconnu' }] })).body.count, 1);
    assert.deepEqual((await bob.get(`/api/boards/nodes/${board.id}`)).body.elements.map((element: BoardElement) => element.id), ['c']);

    const preview = await bob.raw('GET', `/api/boards/nodes/${board.id}/preview`);
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get('content-type') ?? '', /image\/svg\+xml/);
    assert.match(preview.headers.get('content-security-policy') ?? '', /sandbox/);
    assert.match(preview.bytes.toString(), /Base de donn/);

    const hits = (await bob.get('/api/boards/search?q=donnees')).body.boards;
    assert.deepEqual(hits.map((hit: { path: string }) => hit.path), ['Architecture'], 'par le contenu, sans les accents');
    assert.deepEqual((await eve.get('/api/boards/search?q=archi')).body.boards, [], 'jamais hors de ses espaces');

    const copy = (await bob.post(`/api/boards/nodes/${board.id}/duplicate`)).body.node as BoardNodeDTO;
    assert.equal(copy.path, 'Architecture (copie)');
    assert.equal(copy.elementCount, 1);
  });

  it('gardent leur historique : versions, restauration et copie d’une version', async () => {
    const spaceId = await newSpace('Historique');
    await bob.post(`/api/boards/spaces/${spaceId}/members`, { userId: ids.vera, role: 'editor' });
    const board = await newBoard(spaceId, 'Projets/Suivi', [shape('a', 0, 0, 'Un')]);
    const put = (who: TestClient, elements: BoardElement[]) => who.request('PUT', `/api/boards/nodes/${board.id}/elements`, { elements });
    const history = async (who: TestClient = bob) => (await who.get(`/api/boards/nodes/${board.id}/versions`)).body as { versions: BoardVersionDTO[]; currentVersionId: number | null };

    await put(vera, [shape('a', 0, 0, 'Un'), shape('b', 300, 0, 'Deux')]);
    await put(bob, [shape('a', 0, 0, 'Un'), shape('b', 300, 0, 'Deux'), shape('c', 600, 0, 'Trois')]);
    // Bob continue aussitôt : sa version garde son dernier état, sans en créer une autre.
    await put(bob, [shape('a', 0, 0, 'Un'), shape('b', 300, 0, 'Deux'), shape('c', 600, 0, 'Trois'), shape('d', 900, 0, 'Quatre')]);
    let { versions, currentVersionId } = await history();
    assert.deepEqual(
      versions.map((version) => [version.userId, version.kind, version.elementCount]),
      [
        [ids.bob, 'edit', 1],
        [ids.vera, 'edit', 2],
        [ids.bob, 'edit', 4],
      ],
    );
    assert.equal(currentVersionId, versions[2]!.id, 'la dernière version est l’état actuel');
    const first = (await vera.get(`/api/boards/nodes/${board.id}/versions/${versions[0]!.id}`)).body as { elements: BoardElement[] };
    assert.deepEqual(first.elements.map((element) => element.id), ['a']);
    assert.equal((await eve.get(`/api/boards/nodes/${board.id}/versions`)).status, 404, 'jamais hors de ses espaces');
    assert.equal((await bob.get(`/api/boards/nodes/${board.id}/versions/999999`)).status, 404);

    // Un lecteur parcourt l'historique sans pouvoir restaurer ni copier.
    await bob.post(`/api/boards/spaces/${spaceId}/members`, { userId: ids.eve, role: 'reader' });
    assert.equal((await history(eve)).versions.length, 3);
    assert.equal((await eve.post(`/api/boards/nodes/${board.id}/versions/${versions[0]!.id}/restore`)).status, 403);
    assert.equal((await eve.post(`/api/boards/nodes/${board.id}/versions/${versions[0]!.id}/fork`, {})).status, 403);

    // Restaurer : le tableau reprend la version, l'état d'avant reste dans l'historique.
    assert.equal((await vera.post(`/api/boards/nodes/${board.id}/versions/${versions[1]!.id}/restore`)).body.count, 2);
    assert.deepEqual((await bob.get(`/api/boards/nodes/${board.id}`)).body.elements.map((element: BoardElement) => element.id), ['a', 'b']);
    ({ versions, currentVersionId } = await history());
    assert.deepEqual(
      versions.map((version) => [version.userId, version.kind, version.elementCount]).slice(2),
      [
        [ids.bob, 'edit', 4],
        [ids.vera, 'restore', 2],
      ],
    );
    assert.equal(currentVersionId, versions[3]!.id);
    // Ce qui suit une restauration a sa propre version, même de la même personne.
    await put(vera, [shape('a', 0, 0, 'Un'), shape('z', 0, 200, 'Après')]);
    assert.equal((await history()).versions.length, 5);

    // Copier une version dans un nouveau tableau, à côté de l'original.
    const fork = (await bob.post(`/api/boards/nodes/${board.id}/versions/${versions[2]!.id}/fork`, {})).body.node as BoardNodeDTO;
    assert.deepEqual([fork.path, fork.elementCount], ['Projets/Suivi (version)', 4]);
    const named = (await vera.post(`/api/boards/nodes/${board.id}/versions/${versions[0]!.id}/fork`, { name: 'Avant refonte' })).body.node as BoardNodeDTO;
    assert.deepEqual([named.path, named.elementCount], ['Projets/Avant refonte', 1]);
    assert.equal((await history()).versions.length, 5, 'copier ne touche pas à l’historique');
  });

  it('gardent les groupes d’éléments, par l’API comme par un modèle', async () => {
    const spaceId = await newSpace('Groupes');
    const board = await newBoard(spaceId, 'Groupé', [{ ...shape('a', 0, 0), group: 'g1' }, { ...shape('b', 300, 0), group: 'g1' }, shape('c', 600, 0)]);
    const groupsOf = async () => Object.fromEntries(((await bob.get(`/api/boards/nodes/${board.id}`)).body.elements as BoardElement[]).map((element) => [element.id, element.group ?? null]));
    assert.deepEqual(await groupsOf(), { a: 'g1', b: 'g1', c: null });

    assert.equal((await bob.request('PUT', `/api/boards/nodes/${board.id}/elements`, { elements: [{ ...shape('a', 0, 0), group: 'g2' }, { ...shape('b', 300, 0), group: 'g2' }, { ...shape('c', 600, 0), group: 'g2' }] })).status, 200);
    assert.deepEqual(await groupsOf(), { a: 'g2', b: 'g2', c: 'g2' });

    // Dégrouper : l'élément revient sans son champ.
    assert.equal((await bob.request('PATCH', `/api/boards/nodes/${board.id}/elements`, { upsert: [shape('c', 600, 0), { ...shape('d', 0, 200), group: 'g2' }], remove: [] })).status, 200);
    assert.deepEqual(await groupsOf(), { a: 'g2', b: 'g2', c: null, d: 'g2' });

    // Un modèle garde ses groupes, et sa copie de tableau aussi.
    const template = (await bob.post(`/api/boards/spaces/${spaceId}/nodes`, { path: 'Paire', kind: 'template', elements: [{ ...shape('a', 0, 0), group: 'p' }, { ...shape('b', 0, 100), group: 'p' }] })).body.node as BoardNodeDTO;
    const stored = (await bob.get(`/api/boards/nodes/${template.id}`)).body.elements as BoardElement[];
    assert.deepEqual(stored.map((element) => element.group), ['p', 'p']);
    const copy = (await bob.post(`/api/boards/nodes/${board.id}/duplicate`)).body.node as BoardNodeDTO;
    assert.deepEqual(Object.fromEntries(((await bob.get(`/api/boards/nodes/${copy.id}`)).body.elements as BoardElement[]).map((element) => [element.id, element.group ?? null])), { a: 'g2', b: 'g2', c: null, d: 'g2' });
  });

  it('s’éditent à plusieurs en temps réel, et s’enregistrent', async () => {
    const spaceId = await newSpace('Direct');
    await bob.post(`/api/boards/spaces/${spaceId}/members`, { userId: ids.vera, role: 'editor' });
    await bob.post(`/api/boards/spaces/${spaceId}/members`, { userId: ids.eve, role: 'reader' });
    const board = await newBoard(spaceId, 'Tableau partagé', [shape('a', 0, 0, 'Départ')]);

    const join = async (client: TestClient) => {
      const socket = await client.connect();
      const doc = new Y.Doc();
      socket.ws.on('message', (raw) => {
        const message = JSON.parse(raw.toString()) as ServerMessage;
        if ((message.t === 'board.sync' || message.t === 'board.update') && message.boardId === board.id) Y.applyUpdate(doc, base64ToBytes(message.update), 'remote');
      });
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        if (origin !== 'remote') socket.send({ t: 'board.update', boardId: board.id, update: bytesToBase64(update) });
      });
      socket.send({ t: 'board.join', boardId: board.id, stateVector: bytesToBase64(Y.encodeStateVector(doc)) });
      const sync = (await socket.waitFor((message) => message.t === 'board.sync')) as Extract<ServerMessage, { t: 'board.sync' }>;
      return { socket, doc, map: doc.getMap<BoardElement>('elements'), sync };
    };

    const one = await join(bob);
    const two = await join(vera);
    const reader = await join(eve);
    assert.equal(one.sync.canWrite, true);
    assert.equal(reader.sync.canWrite, false);
    assert.equal((one.map.get('a') as ShapeElement).text, 'Départ');

    one.map.set('b', shape('b', 300, 0, 'Arrivée'));
    await until(() => two.map.has('b'));
    // Ce qu'écrit un lecteur est refusé : il est sorti de la salle.
    reader.map.set('pirate', shape('pirate', 0, 0));
    await reader.socket.waitFor((message) => message.t === 'board.closed');
    await until(async () => (await bob.get(`/api/boards/nodes/${board.id}`)).body.elements.length === 2);
    assert.ok(!two.map.has('pirate'));

    // Une écriture par l'API arrive dans la salle ouverte.
    await bob.request('PUT', `/api/boards/nodes/${board.id}/elements`, { elements: [shape('a', 0, 0, 'Départ'), shape('c', 0, 200, 'Par l’API')] });
    await until(() => two.map.has('c') && !two.map.has('b'));

    one.socket.close();
    two.socket.close();
    reader.socket.close();
    await until(async () => (await bob.get(`/api/boards/spaces/${spaceId}`)).body.nodes.find((node: BoardNodeDTO) => node.id === board.id)?.elementCount === 2);
  });

  it('se partagent par un lien : personnes connectées, liste, ou tout le monde avec un mot de passe', async () => {
    const spaceId = await newSpace('Partages');
    const board = await newBoard(spaceId, 'Rétro', [shape('a', 0, 0, 'Départ')]);
    assert.equal((await vera.request('PUT', `/api/boards/nodes/${board.id}/share`, { audience: 'users' })).status, 404, 'réservé aux propriétaires (et invisible aux autres)');
    const share = (await bob.request('PUT', `/api/boards/nodes/${board.id}/share`, { audience: 'users', role: 'reader' })).body.share;
    assert.match(share.slug, /^[\w-]{12}$/);
    assert.equal((await bob.get(`/api/boards/spaces/${spaceId}`)).body.nodes.find((node: BoardNodeDTO) => node.id === board.id).share, 'users');

    const open = (client: TestClient | null, token?: string) =>
      client
        ? client.request('GET', `/api/board-shares/${share.slug}`, undefined, token ? { 'X-Board-Share': token } : {})
        : fetch(`${app.base}/api/board-shares/${share.slug}`, { headers: token ? { 'X-Board-Share': token } : {} }).then(async (response) => ({ status: response.status, body: await response.json() }));
    const eveSees = (await open(eve)).body.share;
    assert.deepEqual({ role: eveSees.role, member: eveSees.member, title: eveSees.title }, { role: 'reader', member: false, title: 'Rétro' });
    assert.equal((await open(null)).status, 401, 'personnes connectées seulement');
    assert.equal((await open(bob)).body.share.role, 'owner', 'un membre garde ses droits');

    await bob.request('PUT', `/api/boards/nodes/${board.id}/share`, { audience: 'people', people: [ids.vera], role: 'editor' });
    assert.equal((await open(eve)).status, 403);
    assert.equal((await open(vera)).body.share.role, 'editor');

    await bob.request('PUT', `/api/boards/nodes/${board.id}/share`, { audience: 'public', role: 'editor', password: 'cerise' });
    const locked = await open(null);
    assert.equal(locked.status, 401);
    assert.equal(locked.body.error.code, 'board_password');
    const unlock = (password: string) => fetch(`${app.base}/api/board-shares/${share.slug}/unlock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    assert.equal((await unlock('mauvais')).status, 403);
    const { token } = (await (await unlock('cerise')).json()) as { token: string };
    assert.equal((await open(null, token)).body.share.role, 'editor');
    assert.equal((await open(null, `${token}x`)).status, 401, 'un accès falsifié ne sert à rien');

    // Un visiteur sans compte entre dans la salle et dessine.
    const guest = new SocketProbe(new WebSocket(`${app.base.replace('http', 'ws')}/ws?guest=1`));
    await guest.opened;
    const doc = new Y.Doc();
    guest.ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as ServerMessage;
      if ((message.t === 'board.sync' || message.t === 'board.update') && message.boardId === board.id) Y.applyUpdate(doc, base64ToBytes(message.update), 'remote');
    });
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== 'remote') guest.send({ t: 'board.update', boardId: board.id, update: bytesToBase64(update) });
    });
    guest.send({ t: 'board.join', boardId: board.id, stateVector: bytesToBase64(Y.encodeStateVector(doc)), share: { slug: share.slug, token: null } });
    assert.equal(((await guest.waitFor((message) => message.t === 'board.closed')) as { reason: string }).reason, 'revoked', 'sans le mot de passe, pas d’entrée');
    guest.send({ t: 'board.join', boardId: board.id, stateVector: bytesToBase64(Y.encodeStateVector(doc)), share: { slug: share.slug, token } });
    const sync = (await guest.waitFor((message) => message.t === 'board.sync')) as Extract<ServerMessage, { t: 'board.sync' }>;
    assert.equal(sync.canWrite, true);
    doc.getMap<BoardElement>('elements').set('g', shape('g', 0, 200, 'Par un invité'));
    await until(async () => (await bob.get(`/api/boards/nodes/${board.id}`)).body.elements.some((element: BoardElement) => element.id === 'g'));

    // Le partage passe en lecture : le visiteur se raccorde, sans pouvoir écrire.
    await bob.request('PUT', `/api/boards/nodes/${board.id}/share`, { audience: 'public', role: 'reader' });
    assert.equal(((await guest.waitFor((message) => message.t === 'board.closed' && message.reason === 'changed')) as { reason: string }).reason, 'changed');
    guest.messages.length = 0;
    guest.send({ t: 'board.join', boardId: board.id, stateVector: bytesToBase64(Y.encodeStateVector(doc)), share: { slug: share.slug, token } });
    assert.equal(((await guest.waitFor((message) => message.t === 'board.sync')) as { canWrite: boolean }).canWrite, false);
    // Un invité ne voit rien d'autre que le tableau partagé.
    guest.send({ t: 'boards.watch', spaceId });
    guest.send({ t: 'subscribe', projectId: 1 });

    assert.equal((await bob.del(`/api/boards/nodes/${board.id}/share`)).status, 200);
    await guest.waitFor((message) => message.t === 'board.closed' && message.reason === 'revoked');
    assert.equal((await open(null, token)).status, 404, 'le lien ne fonctionne plus');
    assert.ok(!guest.messages.some((message) => message.t === 'boards.tree' || message.t === 'event'));
    guest.close();
  });

  it('ont leurs rétroliens : notes et tickets qui les mentionnent, tableaux qui les montrent', async () => {
    assert.equal((await admin.request('PUT', '/api/admin/documentation', { enabled: true })).status, 200);
    const spaceId = await newSpace('Liens');
    await bob.post(`/api/boards/spaces/${spaceId}/members`, { userId: ids.vera, role: 'reader' });
    const target = await newBoard(spaceId, 'Cible');
    const docSpace = (await bob.post('/api/documentation/spaces', { name: 'Notes liées' })).body.space.id as number;
    const note = (await bob.post(`/api/documentation/spaces/${docSpace}/nodes`, { path: 'Schéma', content: `Voir @[Cible](board:${target.id}).` })).body.node as { id: number };
    await bob.post(`/api/documentation/spaces/${docSpace}/members`, { userId: ids.vera, role: 'reader' });
    const project = (await bob.post('/api/projects', { name: 'Liens', key: 'LNK' })).body.project.id as number;
    const ticket = (await bob.post(`/api/projects/${project}/tickets`, { title: 'Dessiner', description: `Suivre @[Cible](board:${target.id})` })).body.ticket as { id: number };
    const fast = (id: string, kind: string, refId: number): BoardElement => ({ id, type: 'fast', z: 1, x: 0, y: 0, w: 280, h: 160, ref: { kind, id: refId }, label: id }) as BoardElement;
    const citing = await newBoard(spaceId, 'Vue d’ensemble', [fast('f1', 'board', target.id), fast('f2', 'note', note.id), fast('f3', 'ticket', ticket.id)]);
    await bob.request('PUT', `/api/boards/nodes/${target.id}/elements`, { elements: [fast('f4', 'note', note.id), fast('f5', 'board', citing.id)] });

    const links = (await bob.get(`/api/boards/nodes/${target.id}/links`)).body;
    assert.deepEqual(links.backlinks.notes.map((entry: { id: number }) => entry.id), [note.id], 'la note qui le mentionne');
    assert.deepEqual(links.backlinks.tickets.map((entry: { key: string }) => entry.key), ['LNK-1'], 'le ticket qui le mentionne');
    assert.deepEqual(links.backlinks.boards.map((entry: { title: string }) => entry.title), ['Vue d’ensemble'], 'le tableau qui le montre');
    assert.deepEqual(links.outgoing.notes.map((entry: { id: number }) => entry.id), [note.id]);
    assert.deepEqual(links.outgoing.boards.map((entry: { id: number }) => entry.id), [citing.id]);
    const overview = (await bob.get(`/api/boards/nodes/${citing.id}/links`)).body;
    assert.deepEqual(overview.outgoing.tickets.map((entry: { key: string }) => entry.key), ['LNK-1']);
    assert.deepEqual(overview.backlinks.boards.map((entry: { id: number }) => entry.id), [target.id]);

    // La note, de son côté, connaît le tableau qu'elle mentionne et ceux qui la montrent.
    const noteLinks = (await bob.get(`/api/documentation/nodes/${note.id}/links`)).body;
    assert.deepEqual(noteLinks.outgoing.boards.map((entry: { id: number }) => entry.id), [target.id]);
    assert.deepEqual(noteLinks.backlinks.boards.map((entry: { id: number }) => entry.id).sort(), [target.id, citing.id].sort());

    // Chacun ne voit que ce qui lui est ouvert : Vera n'est pas dans le projet, Eve pas dans l'espace.
    const forVera = (await vera.get(`/api/boards/nodes/${target.id}/links`)).body;
    assert.equal(forVera.backlinks.notes.length, 1);
    assert.equal(forVera.backlinks.tickets.length, 0);
    assert.equal((await eve.get(`/api/boards/nodes/${target.id}/links`)).status, 404, 'hors de l’espace, le tableau n’existe pas');
  });

  it('ont des modèles, des icônes et des images d’espace', async () => {
    const spaceId = await newSpace('Bibliothèque');
    await bob.post(`/api/boards/spaces/${spaceId}/members`, { userId: ids.vera, role: 'reader' });

    // Modèles : leurs noms à part de ceux des tableaux, sans dossier, sans lien vers un autre modèle, jamais partagés.
    await newBoard(spaceId, 'Carte');
    const linked = { ...shape('a', 0, 0, 'Titre'), tpl: { id: 99, inst: 'i1', key: 'a', v: 'x' } };
    const created = await bob.post(`/api/boards/spaces/${spaceId}/nodes`, { path: 'Carte', kind: 'template', elements: [linked, shape('b', 0, 100, 'Corps')] });
    assert.equal(created.status, 201, 'un modèle peut porter le nom d’un tableau');
    const template = created.body.node as BoardNodeDTO;
    assert.equal(template.kind, 'template');
    const stored = (await bob.get(`/api/boards/nodes/${template.id}`)).body.elements as BoardElement[];
    assert.equal(stored.length, 2);
    assert.ok(stored.every((element) => !element.tpl), 'un modèle garde ses originaux');
    assert.equal((await bob.post(`/api/boards/spaces/${spaceId}/nodes`, { path: 'Carte', kind: 'template' })).status, 409);
    assert.equal((await bob.post(`/api/boards/spaces/${spaceId}/nodes`, { path: 'Dossier/Carte 2', kind: 'template' })).status, 400);
    assert.equal((await bob.request('PUT', `/api/boards/nodes/${template.id}/share`, { audience: 'users', role: 'reader' })).status, 400);
    assert.equal((await bob.request('PATCH', `/api/boards/nodes/${template.id}`, { path: 'Fiche' })).body.node.path, 'Fiche');

    // Une copie garde son lien ; une icône inconnue est écartée.
    const board = await newBoard(spaceId, 'Avec copies');
    const copy = { ...shape('c1', 0, 0), tpl: { id: template.id, inst: 'k1', key: 'a', v: template.updatedAt } };
    const icon = { id: 'i', type: 'icon', z: 3, x: 0, y: 0, w: 48, h: 48, icon: 'lucide:camera', color: 'blue', stroke: 2 };
    const unknown = { ...icon, id: 'j', icon: 'http://exemple.fr/x.svg' };
    const saved = await bob.request('PUT', `/api/boards/nodes/${board.id}/elements`, { elements: [copy, icon, unknown] });
    assert.equal(saved.body.count, 2);
    const read = (await bob.get(`/api/boards/nodes/${board.id}`)).body.elements as BoardElement[];
    assert.deepEqual(read.find((element) => element.id === 'c1')?.tpl, { id: template.id, inst: 'k1', key: 'a', v: template.updatedAt });
    const preview = (await bob.raw('GET', `/api/boards/nodes/${board.id}/preview`)).bytes.toString('utf8');
    assert.match(preview, /viewBox="0 0 24 24"/, 'l’icône est dessinée dans l’aperçu');

    // Icônes ajoutées par un administrateur, lisibles par tous.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>';
    assert.equal((await bob.post('/api/admin/board-icons', { name: 'Rond', svg })).status, 403);
    assert.equal((await admin.post('/api/admin/board-icons', { name: 'Piège', svg: '<svg onload="alert(1)"></svg>' })).status, 400);
    const added = (await admin.post('/api/admin/board-icons', { name: 'Rond', svg })).body.icon as { id: number };
    assert.deepEqual((await bob.get('/api/boards/icons')).body.icons.map((entry: { name: string }) => entry.name), ['Rond']);
    const served = await app.client().raw('GET', `/api/board-icons/${added.id}`);
    assert.equal(served.status, 200);
    assert.match(served.headers.get('content-type') ?? '', /image\/svg\+xml/);
    assert.match(served.headers.get('content-security-policy') ?? '', /sandbox/);
    assert.equal((await admin.request('DELETE', `/api/admin/board-icons/${added.id}`)).status, 200);
    assert.equal((await app.client().raw('GET', `/api/board-icons/${added.id}`)).status, 404);

    // Images de l'espace : envoyées par un éditeur, lues par leur clé (même sans compte).
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const upload = (client: TestClient, body: Uint8Array, name: string) => client.raw('POST', `/api/boards/spaces/${spaceId}/assets`, body, { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name), 'X-Requested-With': 'fetch' });
    assert.equal((await upload(vera, png, 'logo.png')).status, 403, 'un lecteur n’envoie rien');
    const sent = await upload(bob, png, 'logo.png');
    assert.equal(sent.status, 201);
    const asset = sent.json.asset as { id: number; key: string; mime: string; name: string };
    assert.equal(asset.mime, 'image/png');
    assert.equal(asset.name, 'logo.png');
    assert.equal((await upload(bob, Buffer.from('<svg><script>alert(1)</script></svg>'), 'x.svg')).status, 400);
    assert.equal((await upload(bob, Buffer.from(svg), 'rond.svg')).json.asset.mime, 'image/svg+xml');
    assert.equal((await vera.get(`/api/boards/spaces/${spaceId}/assets`)).body.assets.length, 2);
    const file = await app.client().raw('GET', `/api/board-assets/${asset.key}`);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'image/png');
    assert.equal((await vera.request('DELETE', `/api/boards/assets/${asset.id}`)).status, 403);
    assert.equal((await bob.request('DELETE', `/api/boards/assets/${asset.id}`)).status, 200);
    assert.equal((await app.client().raw('GET', `/api/board-assets/${asset.key}`)).status, 404);
  });

  it('suivent les droits : un membre retiré n’y a plus accès', async () => {
    const spaceId = await newSpace('Privé');
    await bob.post(`/api/boards/spaces/${spaceId}/members`, { userId: ids.vera, role: 'editor' });
    const board = await newBoard(spaceId, 'Secret');
    assert.equal((await vera.get(`/api/boards/nodes/${board.id}`)).status, 200);
    assert.equal((await bob.del(`/api/boards/spaces/${spaceId}/members/${ids.vera}`)).status, 200);
    assert.equal((await vera.get(`/api/boards/nodes/${board.id}`)).status, 404);
    assert.equal((await bob.del(`/api/boards/spaces/${spaceId}/members/${ids.bob}`)).status, 409, 'il reste un propriétaire');
    assert.equal((await admin.get(`/api/boards/nodes/${board.id}`)).status, 200, 'boards.manage voit tout');
    // L'administrateur entre par ses droits : l'espace le dit, pas au propriétaire.
    const seen = (await admin.get(`/api/boards/spaces/${spaceId}`)).body as { space: { role: string; adminAccess: boolean } };
    assert.deepEqual([seen.space.role, seen.space.adminAccess], ['owner', true]);
    assert.equal(((await bob.get(`/api/boards/spaces/${spaceId}`)).body as { space: { adminAccess: boolean } }).space.adminAccess, false);
  });
});
