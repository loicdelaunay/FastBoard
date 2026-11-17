<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import Button from 'primevue/button';
import ContextMenu from 'primevue/contextmenu';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import type { MenuItem } from 'primevue/menuitem';
import { anchor, boundsOf, connectorGeometry, intersects, mindLink, mindRoot, shapePath, sideToward, textBox, type Point, type Rect } from '@shared/boardGeometry';
import { exportMermaid, mermaidToElements } from '@shared/boardMermaid';
import {
  boardAssetUrl,
  boardIconUrl,
  isPlaced,
  newElementId,
  type BoardAssetDTO,
  type BoardColor,
  type BoardElement,
  type BoardNodeDTO,
  type IconElement,
  type ImageElement,
  type ChartElement,
  type ConnectorElement,
  type FastElement,
  type MindElement,
  type PathElement,
  type PlacedElement,
  type ShapeElement,
  type ShapeKind,
  type Side,
  type StickyElement,
  type TableElement,
} from '@shared/boards';
import type { UserSummaryDTO } from '@shared/types';
import { api } from '@/api';
import { t } from '@/i18n';
import type { BoardSession } from '@/realtime/boardSession';
import { useAuthStore } from '@/stores/auth';
import { notify, notifyError } from '@/utils/notify';
import BoardChart from './BoardChart.vue';
import BoardChartDialog from './BoardChartDialog.vue';
import BoardFastCard from './BoardFastCard.vue';
import BoardFastPicker from './BoardFastPicker.vue';
import BoardMermaidDialog from './BoardMermaidDialog.vue';
import BoardQuickAdd from './BoardQuickAdd.vue';
import BoardSelectionBar from './BoardSelectionBar.vue';
import BoardTable from './BoardTable.vue';
import BoardToolbar from './BoardToolbar.vue';
import { BoardModel, measureText, mindSize, textPx } from './editor/model';
import { iconLibrary, libraryMarkup, loadIconLibrary } from './editor/icons';
import { fingerprint, frameOf, instancesOf, instantiate, templateKey, templateSource, unlinked, type InstanceState } from './editor/templates';
import { MIND_COLORS, MODE_TOOLS, type BoardMode, type BoardTool, type FastPick, type QuickPick, type SelectionAction } from './editor/tools';

/**
 * Éditeur de tableau blanc, à la manière de Whimsical : plan infini qu'on déplace et zoome, formes, liens, post-it,
 * sections, cartes mentales, dessin, Fast Elements, tableaux et graphiques ; tout est partagé en direct.
 */
const props = defineProps<{
  session: BoardSession;
  canEdit: boolean;
  users: UserSummaryDTO[];
  boardTitle: string;
  /** Espace du tableau : ses images et ses modèles (absent pour un visiteur d'un tableau partagé). */
  spaceId?: number | null;
  /** Modèles de l'espace ; absent : pas de modèles (visiteur). */
  templates?: BoardNodeDTO[];
  /** Le tableau ouvert est lui-même un modèle. */
  isTemplate?: boolean;
}>();
const emit = defineEmits<{ 'open-template': [id: number] }>();

const auth = useAuthStore();
const model = new BoardModel(props.session);
const elements = model.elements;
const index = model.index;

const root = ref<HTMLDivElement | null>(null);
const size = reactive({ width: 800, height: 600 });
const view = reactive({ x: 0, y: 0, zoom: 1 });
const GRID = 8;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;

// --- Modes et outils ---------------------------------------------------------------------------------------------------

const MODE_KEY = 'fb.boards.mode';
const storedMode = (): BoardMode => {
  try {
    const value = localStorage.getItem(MODE_KEY);
    return value === 'sticky' || value === 'mind' || value === 'draw' ? value : 'diagram';
  } catch {
    return 'diagram';
  }
};
const mode = ref<BoardMode>(storedMode());
const tool = ref<BoardTool>('select');
const shapeKind = ref<ShapeKind>('rounded');
const stickyColor = ref<BoardColor>('yellow');
const penColor = ref<BoardColor>('default');
const editable = computed(() => props.canEdit && props.session.canWrite.value);

watch(mode, (value) => {
  tool.value = 'select';
  try {
    localStorage.setItem(MODE_KEY, value);
  } catch {
    // Stockage indisponible : le mode vaut pour cette page.
  }
});
watch(editable, (value) => {
  if (!value && !['select', 'hand'].includes(tool.value)) tool.value = 'select';
});

// --- Sélection ---------------------------------------------------------------------------------------------------------

const selection = shallowRef<Set<string>>(new Set());
const selected = computed(() => [...selection.value].map((id) => index.value.get(id)).filter((element): element is BoardElement => Boolean(element)));
const selectionBounds = computed(() => (selected.value.length ? boundsOf(selected.value, index.value) : null));
const single = computed(() => (selected.value.length === 1 ? selected.value[0]! : null));

function select(ids: Iterable<string>): void {
  selection.value = new Set([...ids].filter((id) => index.value.has(id)));
}

// Un élément supprimé (par quelqu'un d'autre) quitte la sélection.
watch(index, (current) => {
  if ([...selection.value].some((id) => !current.has(id))) select(selection.value);
});
// Les autres voient ce que l'on a sélectionné.
watch(selection, (ids) => props.session.awareness.setLocalStateField('selection', [...ids].slice(0, 200)));

// --- Coordonnées -------------------------------------------------------------------------------------------------------

function toWorld(clientX: number, clientY: number): Point {
  const rect = root.value!.getBoundingClientRect();
  return { x: (clientX - rect.left - view.x) / view.zoom, y: (clientY - rect.top - view.y) / view.zoom };
}

const toScreen = (point: Point): Point => ({ x: point.x * view.zoom + view.x, y: point.y * view.zoom + view.y });
const snap = (value: number, active = true): number => (active ? Math.round(value / GRID) * GRID : value);

function zoomAt(next: number, origin: Point): void {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
  const world = { x: (origin.x - view.x) / view.zoom, y: (origin.y - view.y) / view.zoom };
  view.zoom = zoom;
  view.x = origin.x - world.x * zoom;
  view.y = origin.y - world.y * zoom;
}

function fit(target: readonly BoardElement[] = elements.value): void {
  const bounds = boundsOf(target, index.value);
  if (!bounds) {
    view.zoom = 1;
    view.x = size.width / 2;
    view.y = size.height / 2;
    return;
  }
  const zoom = Math.min(1.25, Math.max(MIN_ZOOM, Math.min((size.width - 160) / Math.max(bounds.w, 1), (size.height - 120) / Math.max(bounds.h, 1))));
  view.zoom = zoom;
  view.x = size.width / 2 - (bounds.x + bounds.w / 2) * zoom;
  view.y = size.height / 2 - (bounds.y + bounds.h / 2) * zoom;
}

const viewKey = computed(() => `fb.boards.view.${props.session.boardId}`);
let viewTimer = 0;
watch(
  () => [view.x, view.y, view.zoom],
  () => {
    window.clearTimeout(viewTimer);
    viewTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(viewKey.value, JSON.stringify(view));
      } catch {
        // Sans stockage, la vue repart du cadrage automatique.
      }
    }, 300);
  },
);

/** À l'ouverture : la vue laissée la dernière fois, sinon tout le tableau. */
function restoreView(): void {
  try {
    const stored = JSON.parse(localStorage.getItem(viewKey.value) ?? 'null') as { x: number; y: number; zoom: number } | null;
    if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.zoom)) {
      Object.assign(view, stored);
      return;
    }
  } catch {
    // Vue illisible : cadrage automatique.
  }
  fit();
}

watch(
  () => props.session.synced.value,
  async (synced) => {
    if (!synced) return;
    model.flush();
    await nextTick();
    restoreView();
  },
  { immediate: true },
);

// --- Rendu -------------------------------------------------------------------------------------------------------------

const frames = computed(() => elements.value.filter((element) => element.type === 'frame'));
const others = computed(() => elements.value.filter((element) => element.type !== 'frame'));
/** Pendant le glisser de nœuds de carte mentale : le nœud qui les recevra (leurs liens actuels s'effacent). */
const mindDrop = shallowRef<{ target: string; nodes: string[] } | null>(null);
const mindLinks = computed(() => {
  const minds = new Map(elements.value.filter((element): element is MindElement => element.type === 'mind').map((element) => [element.id, element]));
  const moving = mindDrop.value;
  return [...minds.values()].flatMap((node) => {
    const parent = node.parent ? minds.get(node.parent) : undefined;
    if (moving && moving.target !== node.parent && moving.nodes.includes(node.id)) return [];
    return parent ? [{ id: node.id, color: node.color, d: mindLink(parent, node) }] : [];
  });
});
/** Aperçu des nouveaux liens : du nœud qui recevra les nœuds glissés vers chacun d'eux. */
const mindDropLinks = computed(() => {
  const moving = mindDrop.value;
  const target = moving ? (index.value.get(moving.target) as MindElement | undefined) : undefined;
  if (!moving || !target) return [];
  return moving.nodes.flatMap((id) => {
    const node = index.value.get(id) as MindElement | undefined;
    return node ? [{ id, d: mindLink(target, node) }] : [];
  });
});
const geometry = (connector: ConnectorElement) => connectorGeometry(connector, index.value);
const pathPoints = (element: PathElement): string => {
  const points: string[] = [];
  for (let position = 0; position + 1 < element.points.length; position += 2) points.push(`${element.x + element.points[position]!},${element.y + element.points[position + 1]!}`);
  return points.join(' ');
};
const box = (element: ShapeElement) => textBox(element.shape, element.w, element.h);
const chartRows = (element: ChartElement): string[][] => {
  const source = element.source ? index.value.get(element.source) : undefined;
  return source?.type === 'table' ? source.rows : element.rows;
};
const gridPattern = computed(() => {
  const spacing = 24 * view.zoom;
  const step = spacing < 10 ? spacing * 4 : spacing;
  return { step, x: view.x % step, y: view.y % step };
});

// Sous l'élément en cours d'écriture, son texte rendu est caché.
const editing = ref<{ id: string; field: 'text' | 'title' | 'label' | 'cells' } | null>(null);
const editingId = computed(() => editing.value?.id ?? null);

// --- Présence des autres ---------------------------------------------------------------------------------------------

interface Peer {
  clientId: number;
  name: string;
  color: string;
  pointer: Point | null;
  /** Éléments que la personne a sélectionnés (ou qu'elle écrit). */
  selection: string[];
}
const peers = shallowRef<Peer[]>([]);
function readPeers(): void {
  const list: Peer[] = [];
  props.session.awareness.getStates().forEach((state, clientId) => {
    if (clientId === props.session.doc.clientID) return;
    const user = state.user as { name?: string; color?: string } | undefined;
    const pointer = state.pointer as Point | null | undefined;
    const chosen = Array.isArray(state.selection) ? (state.selection as unknown[]).filter((id): id is string => typeof id === 'string') : [];
    if (user) list.push({ clientId, name: user.name ?? '', color: user.color ?? '#4f8cff', pointer: pointer ?? null, selection: chosen });
  });
  peers.value = list;
}
/** Cadres de couleur autour de ce que les autres ont sélectionné, avec leur nom. */
const peerSelections = computed(() =>
  peers.value.flatMap((peer) => {
    const chosen = peer.selection.map((id) => index.value.get(id)).filter((element): element is BoardElement => Boolean(element));
    const bounds = chosen.length ? boundsOf(chosen, index.value) : null;
    return bounds ? [{ clientId: peer.clientId, name: peer.name, color: peer.color, bounds }] : [];
  }),
);
const pointers = computed(() => peers.value.filter((peer): peer is Peer & { pointer: Point } => peer.pointer !== null));
props.session.awareness.on('change', readPeers);
let pointerSent = 0;
let pointerTimer = 0;
/** Position du pointeur pour les autres : 25 fois par seconde au plus, et toujours la dernière à l'arrêt. */
function sharePointer(point: Point | null): void {
  window.clearTimeout(pointerTimer);
  const now = Date.now();
  if (point && now - pointerSent < 40) {
    pointerTimer = window.setTimeout(() => sharePointer(point), 40);
    return;
  }
  pointerSent = now;
  props.session.awareness.setLocalStateField('pointer', point);
}

// --- Création ----------------------------------------------------------------------------------------------------------

const defaults = {
  shape: (kind: ShapeKind) => (kind === 'ellipse' || kind === 'diamond' ? { w: 140, h: 100 } : kind === 'triangle' ? { w: 140, h: 110 } : { w: 160, h: 80 }),
};

function createAt(kind: BoardTool, rect: Rect, dragged: boolean): BoardElement | null {
  const z = model.nextZ();
  const id = newElementId();
  const at = (w: number, h: number): Rect => (dragged ? rect : { x: snap(rect.x - w / 2), y: snap(rect.y - h / 2), w, h });
  switch (kind) {
    case 'shape': {
      const { w, h } = defaults.shape(shapeKind.value);
      return { id, type: 'shape', z, ...at(w, h), shape: shapeKind.value, text: '', color: 'default', fill: 'solid', size: 'm' };
    }
    case 'sticky':
      return { id, type: 'sticky', z, ...at(180, 180), text: '', color: stickyColor.value, votes: [] };
    case 'text':
      return { id, type: 'text', z, ...at(220, 40), text: '', color: 'default', size: 'm', align: 'left' };
    case 'frame':
      return { id, type: 'frame', z: Math.min(0, ...elements.value.map((element) => element.z)) - 1, ...at(560, 360), title: t('Section'), color: 'gray' };
    case 'table':
      return { id, type: 'table', z, ...at(360, 120), color: 'blue', rows: [[t('Colonne 1'), t('Colonne 2'), t('Colonne 3')], ['', '', ''], ['', '', '']] };
    case 'chart':
      return {
        id,
        type: 'chart',
        z,
        ...at(380, 260),
        chart: 'bar',
        title: t('Graphique'),
        source: null,
        rows: [
          ['', t('Série 1')],
          ['A', '4'],
          ['B', '7'],
          ['C', '3'],
        ],
      };
    case 'mind': {
      const { w, h } = mindSize({ text: '', parent: null });
      return { id, type: 'mind', z, ...at(w, h), text: '', color: 'blue', parent: null, direction: 'right' };
    }
    default:
      return null;
  }
}

function place(element: BoardElement, edit = true): void {
  model.stopCapturing();
  model.add([element]);
  select([element.id]);
  if (tool.value !== 'pen' && tool.value !== 'highlighter' && tool.value !== 'eraser') tool.value = 'select';
  if (edit && ['shape', 'sticky', 'text', 'mind'].includes(element.type)) void startEdit(element.id, 'text', true);
  if (edit && element.type === 'frame') void startEdit(element.id, 'title', true);
}

// --- Gestes à la souris --------------------------------------------------------------------------------------------------

type Gesture =
  | { kind: 'pan'; startX: number; startY: number; viewX: number; viewY: number }
  | { kind: 'move'; start: Point; originals: Map<string, Point>; free: Map<string, { from: Point; to: Point }>; moved: boolean; mindRoots: Set<string>; mindNodes: string[] }
  | { kind: 'resize'; id: string; handle: string; start: Point; original: Rect }
  | { kind: 'marquee'; start: Point; base: Set<string> }
  | { kind: 'connect'; from: { id: string | null; side: Side | null; point: Point } }
  | { kind: 'end'; id: string; which: 'from' | 'to' }
  | { kind: 'create'; tool: BoardTool; start: Point }
  | { kind: 'draw'; points: Point[] }
  | { kind: 'erase'; ids: Set<string> };

let gesture: Gesture | null = null;
let frame = 0;
let pendingMove: (() => void) | null = null;
const marquee = ref<Rect | null>(null);
const draft = ref<{ from: Point; to: Point } | null>(null);
const drawing = ref<Point[] | null>(null);
const creating = ref<Rect | null>(null);
const erasing = shallowRef<Set<string>>(new Set());
const hoverId = ref<string | null>(null);
const dropTarget = ref<string | null>(null);
const spaceDown = ref(false);

/** Applique un déplacement au plus une fois par image (le serveur reçoit moins de messages). */
function throttle(change: () => void): void {
  pendingMove = change;
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const next = pendingMove;
    pendingMove = null;
    next?.();
  });
}

function elementAt(clientX: number, clientY: number, accept: (element: BoardElement) => boolean): BoardElement | null {
  for (const node of document.elementsFromPoint(clientX, clientY)) {
    const id = node.closest<SVGElement | HTMLElement>('[data-id]')?.dataset.id;
    const element = id ? index.value.get(id) : undefined;
    if (element && accept(element)) return element;
  }
  return null;
}

const rectFrom = (a: Point, b: Point): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });
const connectable = (element: BoardElement): boolean => isPlaced(element) && element.type !== 'path' && element.type !== 'frame';

/** Nœuds de carte mentale (hors racines) choisis pour un déplacement, sans ceux dont un ancêtre est aussi choisi. */
function mindMovers(): MindElement[] {
  const chosen = selected.value.filter((element): element is MindElement => element.type === 'mind' && Boolean(element.parent) && !element.locked);
  const ids = new Set(chosen.map((node) => node.id));
  return chosen.filter((node) => {
    const seen = new Set<string>();
    let parent = node.parent;
    while (parent && !seen.has(parent)) {
      if (ids.has(parent)) return false;
      seen.add(parent);
      parent = (index.value.get(parent) as MindElement | undefined)?.parent ?? null;
    }
    return true;
  });
}

/** Branche d'un nœud : ses enfants, petits-enfants… */
function mindBranch(id: string): MindElement[] {
  const nodes = elements.value.filter((element): element is MindElement => element.type === 'mind');
  const found: MindElement[] = [];
  const queue = [id];
  const seen = new Set<string>([id]);
  while (queue.length) {
    const current = queue.shift()!;
    for (const node of nodes) {
      if (node.parent === current && !seen.has(node.id)) {
        seen.add(node.id);
        found.push(node);
        queue.push(node.id);
      }
    }
  }
  return found;
}

/**
 * Nœud qui recevra les nœuds de carte mentale glissés : celui sous le pointeur, sinon, à la manière de Whimsical, le
 * plus proche du côté où il range ses enfants (à sa droite, ou à sa gauche pour une branche gauche). Aucun : ils
 * restent à leur parent, et la hauteur où on les pose donne leur ordre.
 */
function mindDropTarget(current: Extract<Gesture, { kind: 'move' }>, event: PointerEvent, dx: number, dy: number): string | null {
  const hit = elementAt(event.clientX, event.clientY, (candidate) => candidate.type === 'mind' && !current.originals.has(candidate.id));
  if (hit) return hit.id;
  const leadId = current.mindNodes[0];
  const lead = leadId ? (index.value.get(leadId) as MindElement | undefined) : undefined;
  const origin = leadId ? current.originals.get(leadId) : undefined;
  if (!lead || !origin) return null;
  const box = { x: origin.x + dx, y: origin.y + dy, w: lead.w, h: lead.h };
  const middle = box.y + box.h / 2;
  let best: { id: string; score: number } | null = null;
  for (const candidate of elements.value) {
    if (candidate.type !== 'mind' || current.originals.has(candidate.id)) continue;
    // Écart entre le bord du nœud et celui des nœuds glissés, du côté de ses enfants.
    const gap = candidate.direction === 'left' ? candidate.x - (box.x + box.w) : box.x - (candidate.x + candidate.w);
    const vertical = Math.abs(middle - (candidate.y + candidate.h / 2));
    if (gap < -candidate.w / 2 || gap > 280 || vertical > 160) continue;
    const score = Math.abs(gap - 56) * 0.6 + vertical;
    if (!best || score < best.score) best = { id: candidate.id, score };
  }
  return best?.id ?? null;
}

function startMove(world: Point): void {
  const originals = new Map<string, Point>();
  const free = new Map<string, { from: Point; to: Point }>();
  const mindRoots = new Set<string>();
  // Un ou plusieurs nœuds glissent avec leur branche ; posés sur un autre nœud, ils en deviennent les enfants.
  const movers = mindMovers();
  const moverIds = new Set(movers.map((node) => node.id));
  for (const element of selected.value) {
    if (element.locked) continue;
    if (element.type === 'connector') {
      free.set(element.id, { from: { x: element.from.x, y: element.from.y }, to: { x: element.to.x, y: element.to.y } });
      continue;
    }
    if (element.type === 'mind') {
      if (!element.parent) mindRoots.add(element.id);
      else if (!moverIds.has(element.id)) continue;
    }
    originals.set(element.id, { x: element.x, y: element.y });
    if (element.type === 'frame') for (const inner of model.insideFrame(element)) if (!inner.locked) originals.set(inner.id, { x: inner.x, y: inner.y });
  }
  for (const node of movers) for (const inner of mindBranch(node.id)) if (!originals.has(inner.id)) originals.set(inner.id, { x: inner.x, y: inner.y });
  gesture = { kind: 'move', start: world, originals, free, moved: false, mindRoots, mindNodes: movers.map((node) => node.id) };
}

function onPointerDown(event: PointerEvent): void {
  const target = event.target as Element;
  if (target.closest('.board-ui, .edit-overlay, .board-table.editing')) return;
  root.value?.focus({ preventScroll: true });
  quick.value = null;
  if (editing.value) commitEdit();
  if (event.button === 2) return;
  const world = toWorld(event.clientX, event.clientY);
  root.value?.setPointerCapture(event.pointerId);

  if (event.button === 1 || tool.value === 'hand' || spaceDown.value) {
    gesture = { kind: 'pan', startX: event.clientX, startY: event.clientY, viewX: view.x, viewY: view.y };
    return;
  }

  const handle = target.closest<SVGElement>('[data-handle]');
  if (handle && single.value && isPlaced(single.value) && editable.value) {
    model.stopCapturing();
    gesture = { kind: 'resize', id: single.value.id, handle: handle.dataset.handle!, start: world, original: { x: single.value.x, y: single.value.y, w: single.value.w, h: single.value.h } };
    return;
  }
  const end = target.closest<SVGElement>('[data-end]');
  if (end && single.value?.type === 'connector' && editable.value) {
    model.stopCapturing();
    gesture = { kind: 'end', id: single.value.id, which: end.dataset.end as 'from' | 'to' };
    return;
  }
  const dot = target.closest<SVGElement>('[data-dot]');
  if (dot && editable.value) {
    const source = index.value.get(dot.dataset.of!);
    if (source && isPlaced(source)) {
      const side = dot.dataset.dot as Side;
      gesture = { kind: 'connect', from: { id: source.id, side, point: anchor(source, side) } };
      draft.value = { from: anchor(source, side), to: world };
      return;
    }
  }

  const hit = target.closest<SVGElement | HTMLElement>('[data-id]');
  const element = hit ? index.value.get(hit.dataset.id!) : undefined;

  if (!editable.value || tool.value === 'select') {
    if (element) {
      const group = groupOf(element);
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        const next = new Set(selection.value);
        const on = !next.has(element.id);
        for (const id of group) {
          if (on) next.add(id);
          else next.delete(id);
        }
        select(next);
      } else if (!selection.value.has(element.id)) {
        select(group);
      }
      if (editable.value && selection.value.has(element.id)) {
        model.stopCapturing();
        startMove(world);
      }
      return;
    }
    if (!event.shiftKey) select([]);
    gesture = { kind: 'marquee', start: world, base: new Set(event.shiftKey ? selection.value : []) };
    return;
  }

  switch (tool.value) {
    case 'connector': {
      const source = element && connectable(element) ? (element as PlacedElement) : null;
      const start = source ? { x: source.x + source.w / 2, y: source.y + source.h / 2 } : world;
      gesture = { kind: 'connect', from: { id: source?.id ?? null, side: null, point: start } };
      draft.value = { from: start, to: world };
      return;
    }
    case 'vote':
      if (element?.type === 'sticky') toggleVote(element);
      return;
    case 'pen':
    case 'highlighter':
      gesture = { kind: 'draw', points: [world] };
      drawing.value = [world];
      return;
    case 'eraser':
      gesture = { kind: 'erase', ids: new Set() };
      eraseAt(event.clientX, event.clientY);
      return;
    case 'fast':
      pickAt.value = world;
      pickerOpen.value = true;
      return;
    default:
      gesture = { kind: 'create', tool: tool.value, start: world };
      creating.value = null;
  }
}

function eraseAt(clientX: number, clientY: number): void {
  if (gesture?.kind !== 'erase') return;
  const element = elementAt(clientX, clientY, (candidate) => candidate.type === 'path');
  if (element && !gesture.ids.has(element.id)) {
    gesture.ids.add(element.id);
    erasing.value = new Set(gesture.ids);
  }
}

/** Le pointeur est autour de la forme survolée, assez près pour atteindre ses bulles de liaison. */
function nearHovered(world: Point): boolean {
  const element = hoverId.value ? index.value.get(hoverId.value) : undefined;
  if (!element || !isPlaced(element)) return false;
  const margin = 30 / view.zoom;
  return world.x >= element.x - margin && world.x <= element.x + element.w + margin && world.y >= element.y - margin && world.y <= element.y + element.h + margin;
}

function onPointerMove(event: PointerEvent): void {
  const world = toWorld(event.clientX, event.clientY);
  lastPointer = world;
  sharePointer(world);
  if (!gesture) {
    if (tool.value === 'select' || tool.value === 'connector') {
      const element = (event.target as Element).closest<SVGElement>('[data-id]');
      let id = element?.dataset.id ?? null;
      // Les bulles de liaison sont un peu à l'extérieur de la forme : elle reste survolée tant que le pointeur en est proche.
      if (!id && hoverId.value && nearHovered(world)) id = hoverId.value;
      if (id !== hoverId.value && !(event.target as Element).closest('[data-dot]')) hoverId.value = id;
    }
    return;
  }
  switch (gesture.kind) {
    case 'pan':
      view.x = gesture.viewX + event.clientX - gesture.startX;
      view.y = gesture.viewY + event.clientY - gesture.startY;
      break;
    case 'move': {
      const current = gesture;
      const free = !event.altKey;
      const dx = snap(world.x - current.start.x, free);
      const dy = snap(world.y - current.start.y, free);
      if (!current.moved && Math.hypot(world.x - current.start.x, world.y - current.start.y) * view.zoom < 3) return;
      current.moved = true;
      if (current.mindNodes.length) {
        const target = mindDropTarget(current, event, dx, dy);
        dropTarget.value = target;
        mindDrop.value = target ? { target, nodes: current.mindNodes } : null;
      }
      throttle(() => {
        const patches = new Map<string, Partial<BoardElement>>();
        for (const [id, origin] of current.originals) patches.set(id, { x: origin.x + dx, y: origin.y + dy });
        for (const [id, ends] of current.free) {
          const connector = index.value.get(id) as ConnectorElement | undefined;
          if (!connector) continue;
          patches.set(id, { from: { ...connector.from, x: ends.from.x + dx, y: ends.from.y + dy }, to: { ...connector.to, x: ends.to.x + dx, y: ends.to.y + dy } });
        }
        model.updateMany(patches);
        for (const rootId of current.mindRoots) model.layoutMind(rootId);
      });
      break;
    }
    case 'resize': {
      const current = gesture;
      const { original, handle } = current;
      let { x, y, w, h } = original;
      const dx = world.x - current.start.x;
      const dy = world.y - current.start.y;
      if (handle.includes('e')) w = original.w + dx;
      if (handle.includes('s')) h = original.h + dy;
      if (handle.includes('w')) {
        w = original.w - dx;
        x = original.x + dx;
      }
      if (handle.includes('n')) {
        h = original.h - dy;
        y = original.y + dy;
      }
      if (event.shiftKey && original.w && original.h) {
        const ratio = original.w / original.h;
        if (Math.abs(w / original.w) > Math.abs(h / original.h)) h = w / ratio;
        else w = h * ratio;
        if (handle.includes('n')) y = original.y + original.h - h;
        if (handle.includes('w')) x = original.x + original.w - w;
      }
      const min = 24;
      if (w < min) {
        if (handle.includes('w')) x -= min - w;
        w = min;
      }
      if (h < min) {
        if (handle.includes('n')) y -= min - h;
        h = min;
      }
      throttle(() => model.update(current.id, { x: snap(x, !event.altKey), y: snap(y, !event.altKey), w: snap(w, !event.altKey), h: snap(h, !event.altKey) }));
      break;
    }
    case 'marquee': {
      const rect = rectFrom(gesture.start, world);
      marquee.value = rect;
      const ids = new Set(gesture.base);
      for (const element of elements.value) {
        if (isPlaced(element)) {
          if (element.type === 'frame' ? rect.x <= element.x && rect.y <= element.y && rect.x + rect.w >= element.x + element.w && rect.y + rect.h >= element.y + element.h : intersects(rect, element)) ids.add(element.id);
        }
      }
      for (const element of elements.value) {
        if (element.type !== 'connector') continue;
        const bounds = boundsOf([element], index.value);
        if (bounds && intersects(rect, bounds) && (!element.from.id || ids.has(element.from.id)) && (!element.to.id || ids.has(element.to.id))) ids.add(element.id);
      }
      select(ids);
      break;
    }
    case 'connect': {
      const target = elementAt(event.clientX, event.clientY, (candidate) => connectable(candidate) && candidate.id !== (gesture as { from: { id: string | null } }).from.id);
      hoverId.value = target?.id ?? null;
      draft.value = { from: gesture.from.point, to: target && isPlaced(target) ? anchor(target, sideToward(target, gesture.from.point)) : world };
      break;
    }
    case 'end': {
      const current = gesture;
      const connector = index.value.get(current.id) as ConnectorElement | undefined;
      if (!connector) break;
      const other = connector[current.which === 'from' ? 'to' : 'from'];
      const target = elementAt(event.clientX, event.clientY, (candidate) => connectable(candidate) && candidate.id !== other.id);
      hoverId.value = target?.id ?? null;
      const end = target && isPlaced(target) ? { id: target.id, side: sideToward(target, world), x: world.x, y: world.y } : { id: null, side: null, x: world.x, y: world.y };
      throttle(() => model.update(current.id, { [current.which]: end }));
      break;
    }
    case 'create':
      if (Math.hypot(world.x - gesture.start.x, world.y - gesture.start.y) * view.zoom > 6) creating.value = rectFrom(gesture.start, world);
      break;
    case 'draw': {
      const last = gesture.points[gesture.points.length - 1]!;
      if (Math.hypot(world.x - last.x, world.y - last.y) * view.zoom >= 2) {
        gesture.points.push(world);
        drawing.value = [...gesture.points];
      }
      break;
    }
    case 'erase':
      eraseAt(event.clientX, event.clientY);
      break;
  }
}

function onPointerUp(event: PointerEvent): void {
  const current = gesture;
  gesture = null;
  if (root.value?.hasPointerCapture(event.pointerId)) root.value.releasePointerCapture(event.pointerId);
  if (frame) {
    cancelAnimationFrame(frame);
    frame = 0;
    pendingMove?.();
    pendingMove = null;
  }
  const world = toWorld(event.clientX, event.clientY);
  switch (current?.kind) {
    case 'move':
      if (current.mindNodes.length) {
        const target = dropTarget.value ? (index.value.get(dropTarget.value) as MindElement | undefined) : undefined;
        dropTarget.value = null;
        mindDrop.value = null;
        // Posés sur un nœud : ils en deviennent les enfants ; ailleurs, la place en hauteur donne l'ordre entre frères.
        const roots = new Set(current.mindNodes.map((id) => mindRoot(index.value, id)?.id).filter((id): id is string => Boolean(id)));
        if (target) {
          const moving = current.mindNodes.filter((id) => id !== target.id && !isDescendant(target.id, id));
          model.updateMany(new Map(moving.map((id) => [id, { parent: target.id, direction: target.direction }])));
          const nextRoot = mindRoot(model.index.value, target.id);
          if (nextRoot) roots.add(nextRoot.id);
        }
        for (const root of roots) model.layoutMind(root);
      }
      model.stopCapturing();
      break;
    case 'resize': {
      const element = index.value.get(current.id);
      if (element?.type === 'mind') {
        const rootNode = mindRoot(index.value, element.id);
        if (rootNode) model.layoutMind(rootNode.id);
      }
      model.stopCapturing();
      break;
    }
    case 'marquee':
      marquee.value = null;
      break;
    case 'end':
      hoverId.value = null;
      model.stopCapturing();
      break;
    case 'connect':
      finishConnect(current.from, event, world);
      break;
    case 'create': {
      const rect = creating.value;
      creating.value = null;
      const element = createAt(current.tool, rect ?? { x: current.start.x, y: current.start.y, w: 0, h: 0 }, Boolean(rect && rect.w > 12 && rect.h > 12));
      if (element) place(element);
      break;
    }
    case 'draw': {
      drawing.value = null;
      if (current.points.length < 2) break;
      const xs = current.points.map((point) => point.x);
      const ys = current.points.map((point) => point.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      const highlighter = tool.value === 'highlighter';
      const width = highlighter ? 16 : 3;
      model.stopCapturing();
      model.add([
        {
          id: newElementId(),
          type: 'path',
          z: model.nextZ(),
          x,
          y,
          w: Math.max(1, Math.max(...xs) - x),
          h: Math.max(1, Math.max(...ys) - y),
          points: current.points.flatMap((point) => [Math.round((point.x - x) * 10) / 10, Math.round((point.y - y) * 10) / 10]),
          color: highlighter && penColor.value === 'default' ? 'yellow' : penColor.value,
          width,
          highlighter,
        },
      ]);
      break;
    }
    case 'erase':
      if (current.ids.size) model.remove(current.ids);
      erasing.value = new Set();
      break;
  }
}

function isDescendant(id: string, ancestor: string): boolean {
  let node = index.value.get(id);
  const seen = new Set<string>();
  while (node?.type === 'mind' && !seen.has(node.id)) {
    if (node.id === ancestor) return true;
    seen.add(node.id);
    node = node.parent ? index.value.get(node.parent) : undefined;
  }
  return false;
}

/** Fin d'un lien tiré : sur un élément, il s'y accroche ; dans le vide, il crée une forme pareille au départ. */
function finishConnect(from: { id: string | null; side: Side | null; point: Point }, event: PointerEvent, world: Point): void {
  draft.value = null;
  hoverId.value = null;
  const target = elementAt(event.clientX, event.clientY, (candidate) => connectable(candidate) && candidate.id !== from.id);
  const source = from.id ? index.value.get(from.id) : undefined;
  const connector = (to: ConnectorElement['to']): ConnectorElement => ({
    id: newElementId(),
    type: 'connector',
    z: model.nextZ(),
    from: { id: from.id, side: from.side, x: from.point.x, y: from.point.y },
    to,
    label: '',
    route: 'elbow',
    dashed: false,
    arrowStart: false,
    arrowEnd: true,
    color: 'default',
  });
  model.stopCapturing();
  if (target && isPlaced(target)) {
    const link = connector({ id: target.id, side: null, x: world.x, y: world.y });
    model.add([link]);
    select([link.id]);
  } else if (source && isPlaced(source) && (source.type === 'shape' || source.type === 'sticky') && Math.hypot(world.x - from.point.x, world.y - from.point.y) > 40) {
    // Comme dans Whimsical : tirer dans le vide crée la forme suivante, déjà reliée.
    const copy = { ...source, id: newElementId(), z: model.nextZ(), x: snap(world.x - source.w / 2), y: snap(world.y - source.h / 2), text: '' } as PlacedElement;
    if (copy.type === 'sticky') copy.votes = [];
    const link = connector({ id: copy.id, side: null, x: world.x, y: world.y });
    model.add([copy, link]);
    select([copy.id]);
    void startEdit(copy.id, 'text', true);
  } else if (Math.hypot(world.x - from.point.x, world.y - from.point.y) > 10) {
    const link = connector({ id: null, side: null, x: world.x, y: world.y });
    model.add([link]);
    select([link.id]);
  }
  if (tool.value === 'connector') tool.value = 'select';
}

function toggleVote(sticky: StickyElement): void {
  const me = auth.user?.id;
  if (me === undefined) return;
  const votes = sticky.votes.includes(me) ? sticky.votes.filter((vote) => vote !== me) : [...sticky.votes, me];
  model.stopCapturing();
  model.update(sticky.id, { votes });
}

function onWheel(event: WheelEvent): void {
  if ((event.target as Element).closest('.board-ui, .edit-overlay, .board-table.editing, .fast-card-scroll')) return;
  event.preventDefault();
  const rect = root.value!.getBoundingClientRect();
  if (event.ctrlKey || event.metaKey) {
    zoomAt(view.zoom * Math.exp(-event.deltaY * 0.0022), { x: event.clientX - rect.left, y: event.clientY - rect.top });
  } else {
    view.x -= event.shiftKey ? event.deltaY : event.deltaX;
    view.y -= event.shiftKey ? 0 : event.deltaY;
  }
}

function onDoubleClick(event: MouseEvent): void {
  if (!editable.value || (event.target as Element).closest('.board-ui, .edit-overlay')) return;
  // Poignées et bulles de liaison : rien à éditer ni à créer.
  if (document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-handle], [data-dot], [data-end]')) return;
  // Avec la capture du pointeur, le double-clic peut viser le tableau lui-même : on regarde ce qui est sous le pointeur.
  const hit = (event.target as Element).closest<SVGElement | HTMLElement>('[data-id]');
  const element = (hit ? index.value.get(hit.dataset.id!) : undefined) ?? elementAt(event.clientX, event.clientY, () => true) ?? undefined;
  if (element) {
    if (element.locked) return;
    if (element.type === 'table') {
      editing.value = { id: element.id, field: 'cells' };
      return;
    }
    if (element.type === 'chart') {
      chartEditing.value = element.id;
      return;
    }
    if (element.type === 'fast' || element.type === 'path') return;
    void startEdit(element.id, element.type === 'frame' ? 'title' : element.type === 'connector' ? 'label' : 'text');
    return;
  }
  // Double-clic dans le vide : l'élément de base du mode, prêt à écrire.
  const world = toWorld(event.clientX, event.clientY);
  const kind: BoardTool = mode.value === 'sticky' ? 'sticky' : mode.value === 'mind' ? 'mind' : mode.value === 'draw' ? 'text' : 'shape';
  const created = createAt(kind, { x: world.x, y: world.y, w: 0, h: 0 }, false);
  if (created) place(created);
}

// --- Écriture du texte ---------------------------------------------------------------------------------------------------

const editBox = ref<HTMLDivElement | null>(null);
const editingElement = computed(() => (editing.value ? index.value.get(editing.value.id) : undefined));

/** Zone d'écriture, en coordonnées du tableau. */
const editRect = computed<Rect | null>(() => {
  const element = editingElement.value;
  if (!element || editing.value?.field === 'cells') return null;
  if (element.type === 'connector') {
    const mid = geometry(element).mid;
    return { x: mid.x - 90, y: mid.y - 14, w: 180, h: 28 };
  }
  if (element.type === 'frame') return { x: element.x, y: element.y - 32, w: Math.max(160, element.w), h: 30 };
  if (element.type === 'shape') {
    const inner = box(element);
    return { x: element.x + inner.x, y: element.y + inner.y, w: inner.w, h: inner.h };
  }
  return isPlaced(element) ? { x: element.x, y: element.y, w: element.w, h: element.h } : null;
});

const editClass = computed(() => {
  const element = editingElement.value;
  if (!element) return '';
  const field = editing.value?.field;
  if (field === 'title') return 'edit-title';
  if (field === 'label') return 'edit-label';
  const color = 'color' in element ? element.color : 'default';
  const sizeClass = 'size' in element ? `size-${element.size}` : '';
  return `edit-el-${element.type} c-${color} ${sizeClass}${element.type === 'text' ? ` align-${element.align}` : ''}`;
});

async function startEdit(id: string, field: 'text' | 'title' | 'label', fresh = false): Promise<void> {
  if (!editable.value) return;
  const element = index.value.get(id);
  if (!element) return;
  editing.value = { id, field };
  select([id]);
  await nextTick();
  const box = editBox.value;
  if (!box) return;
  box.textContent = field === 'title' && element.type === 'frame' ? element.title : field === 'label' && element.type === 'connector' ? element.label : 'text' in element ? element.text : '';
  box.focus();
  const range = document.createRange();
  range.selectNodeContents(box);
  if (!fresh) range.collapse(false);
  const selectionRange = window.getSelection();
  selectionRange?.removeAllRanges();
  selectionRange?.addRange(range);
}

/** Enregistre le texte écrit ; une forme ou un post-it qui déborde s'agrandit. */
function commitEdit(): void {
  const current = editing.value;
  if (!current) return;
  editing.value = null;
  if (current.field === 'cells') return;
  const element = index.value.get(current.id);
  const text = (editBox.value?.innerText ?? '').replace(/\n$/, '').replace(/\r/g, '');
  if (!element) return;
  const patch: Record<string, unknown> = {};
  if (current.field === 'title' && element.type === 'frame') patch.title = text;
  else if (current.field === 'label' && element.type === 'connector') patch.label = text;
  else if ('text' in element) {
    patch.text = text;
    if (element.type === 'shape' || element.type === 'sticky') {
      const fontSize = element.type === 'shape' ? textPx(element.size) : 15;
      const width = element.type === 'shape' ? box(element).w : element.w;
      const needed = measureText(text, width, fontSize, element.type === 'sticky' ? 14 : 10).height + (element.type === 'shape' ? element.h - box(element).h : 0);
      if (needed > element.h) patch.h = snap(needed + 4);
    }
    if (element.type === 'text') {
      patch.h = Math.max(32, Math.round(measureText(text, element.w, textPx(element.size), 4).height));
      if (!text.trim()) {
        model.remove([element.id]);
        return;
      }
    }
    if (element.type === 'mind') Object.assign(patch, mindSize({ text, parent: element.parent }));
  }
  model.update(current.id, patch);
  if (element.type === 'mind') {
    const rootNode = mindRoot(model.index.value, element.id);
    if (rootNode) model.layoutMind(rootNode.id);
  }
  model.stopCapturing();
  root.value?.focus({ preventScroll: true });
}

/** Carte mentale : un enfant (Tab) ou un frère (Entrée) du nœud, prêt à écrire. */
/**
 * Déplace les nœuds choisis dans leur carte : Alt ↑ / Alt ↓ avant ou après leur frère, Alt → sous le frère du dessus
 * (un niveau plus bas), Alt ← à côté de leur parent (un niveau plus haut).
 */
function moveMindNodes(key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): void {
  const movers = mindMovers().sort((a, b) => (key === 'ArrowDown' ? b.y - a.y : a.y - b.y));
  const rightward = (node: MindElement) => node.direction !== 'left';
  const patches = new Map<string, Partial<MindElement>>();
  const roots = new Set<string>();
  const siblingsOf = (parentId: string) => elements.value.filter((element): element is MindElement => element.type === 'mind' && element.parent === parentId).sort((a, b) => a.y - b.y || a.z - b.z);
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    // Chaque fratrie est réordonnée d'un bloc : des nœuds voisins choisis ensemble montent ou descendent ensemble.
    const moving = new Set(movers.map((node) => node.id));
    for (const parentId of new Set(movers.map((node) => node.parent!))) {
      const order = siblingsOf(parentId);
      const up = key === 'ArrowUp';
      for (let step = 0; step < order.length; step += 1) {
        const position = up ? step : order.length - 1 - step;
        const neighbour = position + (up ? -1 : 1);
        if (moving.has(order[position]!.id) && order[neighbour] && !moving.has(order[neighbour]!.id)) {
          [order[position], order[neighbour]] = [order[neighbour]!, order[position]!];
        }
      }
      const base = order.reduce((min, node) => Math.min(min, node.y), Infinity);
      order.forEach((node, position) => patches.set(node.id, { y: base + position }));
      const root = mindRoot(index.value, parentId);
      if (root) roots.add(root.id);
    }
  }
  for (const node of key === 'ArrowUp' || key === 'ArrowDown' ? [] : movers) {
    const parent = index.value.get(node.parent!) as MindElement | undefined;
    if (!parent) continue;
    const siblings = siblingsOf(parent.id);
    const position = siblings.findIndex((entry) => entry.id === node.id);
    const outward = rightward(node) ? 'ArrowRight' : 'ArrowLeft';
    if (key === outward) {
      // Un niveau plus bas : enfant du frère du dessus.
      const above = siblings[position - 1];
      if (above) patches.set(node.id, { parent: above.id, y: above.y + above.h + 9999 });
    } else if (parent.parent) {
      // Un niveau plus haut : frère de son parent, juste après lui.
      patches.set(node.id, { parent: parent.parent, y: parent.y + 1 });
    }
    const root = mindRoot(index.value, node.id);
    if (root) roots.add(root.id);
  }
  if (!patches.size) return;
  model.stopCapturing();
  model.updateMany(patches);
  for (const root of roots) model.layoutMind(root);
}

/** Un geste est en cours (lu au rendu : `gesture` n'est pas réactif). */
const dragging = (): boolean => gesture !== null;

/** Boutons « + » d'un nœud de carte mentale choisi : un enfant à l'extérieur, un frère dessous. */
const mindPlus = computed(() => {
  const node = single.value;
  if (!editable.value || node?.type !== 'mind' || node.locked || editing.value) return null;
  const left = node.direction === 'left' && Boolean(node.parent);
  const side = toScreen({ x: left ? node.x : node.x + node.w, y: node.y + node.h / 2 });
  const below = toScreen({ x: node.x + node.w / 2, y: node.y + node.h });
  return { node, child: { x: side.x + (left ? -22 : 22), y: side.y }, sibling: node.parent ? { x: below.x, y: below.y + 18 } : null };
});

function addMindNode(of: MindElement, sibling: boolean): void {
  const parentId = sibling && of.parent ? of.parent : of.id;
  const parent = index.value.get(parentId) as MindElement | undefined;
  if (!parent) return;
  const siblings = elements.value.filter((element) => element.type === 'mind' && element.parent === parent.id);
  const color = parent.parent ? parent.color : MIND_COLORS[siblings.length % MIND_COLORS.length]!;
  const { w, h } = mindSize({ text: '', parent: parent.id });
  const node: MindElement = { id: newElementId(), type: 'mind', z: model.nextZ(), x: parent.x + parent.w + 56, y: (sibling ? of.y + of.h : parent.y) + 10, w, h, text: '', color, parent: parent.id, direction: parent.direction };
  model.stopCapturing();
  model.add([node]);
  const rootNode = mindRoot(model.index.value, node.id);
  if (rootNode) model.layoutMind(rootNode.id);
  select([node.id]);
  void startEdit(node.id, 'text', true);
}

function onEditKey(event: KeyboardEvent): void {
  event.stopPropagation();
  const element = editingElement.value;
  if (event.key === 'Escape') {
    event.preventDefault();
    commitEdit();
    return;
  }
  if (element?.type === 'mind' && (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey))) {
    event.preventDefault();
    commitEdit();
    const fresh = index.value.get(element.id) as MindElement | undefined;
    if (fresh) addMindNode(fresh, event.key === 'Enter');
    return;
  }
  if (event.key === 'Enter' && !event.shiftKey && (editing.value?.field !== 'text' || event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    commitEdit();
  }
}

// --- Clavier -------------------------------------------------------------------------------------------------------------

let clipboard: BoardElement[] = [];
const CLIP_MARK = 'fastboard-board';

function copySelection(cut = false): void {
  if (!selected.value.length) return;
  clipboard = selected.value.map((element) => structuredClone(element));
  const text = JSON.stringify({ [CLIP_MARK]: true, elements: clipboard });
  void navigator.clipboard?.writeText(text).catch(() => undefined);
  if (cut && editable.value) model.remove(selection.value);
}

function paste(text: string | null): void {
  if (!editable.value) return;
  let source = clipboard;
  if (text) {
    try {
      const parsed = JSON.parse(text) as { elements?: BoardElement[] } & Record<string, unknown>;
      if (parsed[CLIP_MARK] && Array.isArray(parsed.elements)) source = parsed.elements;
    } catch {
      if (/^\s*(```\s*mermaid|flowchart|graph\s|graph$|mindmap)/m.test(text)) {
        importMermaid(text);
        return;
      }
      if (text.trim()) {
        const center = toWorld(root.value!.getBoundingClientRect().left + size.width / 2, root.value!.getBoundingClientRect().top + size.height / 2);
        const kind: BoardTool = mode.value === 'sticky' ? 'sticky' : 'text';
        const element = createAt(kind, { x: center.x, y: center.y, w: 0, h: 0 }, false);
        if (element && 'text' in element) {
          element.text = text.slice(0, 5000);
          if (element.type === 'text') element.h = Math.max(32, Math.round(measureText(element.text, element.w, textPx(element.size), 4).height));
          model.stopCapturing();
          model.add([element]);
          select([element.id]);
        }
        return;
      }
    }
  }
  if (!source.length) return;
  model.stopCapturing();
  select(model.duplicate(source).map((element) => element.id));
}

function onPaste(event: ClipboardEvent): void {
  if (editing.value || (event.target as Element).closest?.('input, textarea, [contenteditable]')) return;
  if (!root.value?.contains(document.activeElement) && document.activeElement !== root.value) return;
  event.preventDefault();
  const images = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith('image/'));
  if (images.length && props.spaceId && editable.value) {
    void uploadAndPlace(images, viewCenter());
    return;
  }
  paste(event.clipboardData?.getData('text/plain') ?? null);
}

function nudge(dx: number, dy: number): void {
  const patches = new Map<string, Partial<BoardElement>>();
  for (const element of selected.value) {
    if (element.locked) continue;
    if (isPlaced(element)) patches.set(element.id, { x: element.x + dx, y: element.y + dy });
    else patches.set(element.id, { from: { ...element.from, x: element.from.x + dx, y: element.from.y + dy }, to: { ...element.to, x: element.to.x + dx, y: element.to.y + dy } });
  }
  model.updateMany(patches);
}

function onKeyDown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement;
  if (target.closest('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')) return;
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (event.key === ' ') {
    spaceDown.value = true;
    event.preventDefault();
    return;
  }
  if (mod && key === 'z') {
    event.preventDefault();
    if (event.shiftKey) model.redo();
    else model.undo();
    return;
  }
  if (mod && key === 'y') {
    event.preventDefault();
    model.redo();
    return;
  }
  if (mod && key === 'a') {
    event.preventDefault();
    select(elements.value.map((element) => element.id));
    return;
  }
  if (event.key === '/' && editable.value) {
    event.preventDefault();
    openQuick(lastPointer);
    return;
  }
  if (mod && key === 'c') return copySelection();
  if (mod && key === 'x') return copySelection(true);
  if (mod && key === 'd') {
    event.preventDefault();
    if (editable.value && selected.value.length) select(model.duplicate(selected.value).map((element) => element.id));
    return;
  }
  if (mod && (key === '=' || key === '+')) {
    event.preventDefault();
    zoomAt(view.zoom * 1.2, { x: size.width / 2, y: size.height / 2 });
    return;
  }
  if (mod && key === '-') {
    event.preventDefault();
    zoomAt(view.zoom / 1.2, { x: size.width / 2, y: size.height / 2 });
    return;
  }
  if (mod && key === '0') {
    event.preventDefault();
    zoomAt(1, { x: size.width / 2, y: size.height / 2 });
    return;
  }
  if (event.shiftKey && (key === '!' || event.code === 'Digit1')) {
    fit();
    return;
  }
  if (event.key === 'Escape') {
    select([]);
    tool.value = 'select';
    return;
  }
  if (!editable.value) return;
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    model.remove([...selection.value].filter((id) => !index.value.get(id)?.locked));
    return;
  }
  const node = single.value;
  if (node?.type === 'mind' && (event.key === 'Tab' || event.key === 'Enter')) {
    event.preventDefault();
    if (event.key === 'Enter' && event.shiftKey) void startEdit(node.id, 'text');
    else addMindNode(node, event.key === 'Enter');
    return;
  }
  if (event.key === 'Enter' && node && node.type !== 'path' && node.type !== 'fast') {
    event.preventDefault();
    if (node.type === 'table') editing.value = { id: node.id, field: 'cells' };
    else if (node.type === 'chart') chartEditing.value = node.id;
    else void startEdit(node.id, node.type === 'frame' ? 'title' : node.type === 'connector' ? 'label' : 'text');
    return;
  }
  if (event.altKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) && mindMovers().length) {
    event.preventDefault();
    moveMindNodes(event.key as 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight');
    return;
  }
  const step = event.shiftKey ? GRID * 4 : GRID / 4;
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (arrows[event.key] && selected.value.length) {
    event.preventDefault();
    nudge(...arrows[event.key]!);
    return;
  }
  if (!mod && !event.altKey) {
    const shortcut = MODE_TOOLS[mode.value].find((entry) => entry.key === key);
    if (shortcut) {
      // La lettre ne doit pas s'écrire dans le champ qui s'ouvre (Fast Element).
      event.preventDefault();
      tool.value = shortcut.tool;
      if (shortcut.tool === 'fast') {
        pickAt.value = null;
        pickerOpen.value = true;
      }
    }
  }
}

function onKeyUp(event: KeyboardEvent): void {
  if (event.key === ' ') spaceDown.value = false;
}

// --- Actions de la barre de sélection et du menu -----------------------------------------------------------------------

function patchSelection(patch: Record<string, unknown>, filter?: (element: BoardElement) => boolean): void {
  const patches = new Map<string, Record<string, unknown>>();
  for (const element of selected.value) {
    if (filter && !filter(element)) continue;
    const own = Object.fromEntries(Object.entries(patch).filter(([key]) => key in element));
    if (Object.keys(own).length) patches.set(element.id, own);
  }
  model.stopCapturing();
  model.updateMany(patches);
  // Une forme changée de type garde sa zone de texte : rien à recalculer ; une carte mentale si.
  for (const element of selected.value) {
    if (element.type === 'mind') {
      const rootNode = mindRoot(model.index.value, element.id);
      if (rootNode) model.layoutMind(rootNode.id);
    }
  }
}

function align(how: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'): void {
  const placed = selected.value.filter((element): element is PlacedElement => isPlaced(element) && !element.locked);
  const bounds = boundsOf(placed);
  if (!bounds || placed.length < 2) return;
  const patches = new Map<string, Partial<PlacedElement>>();
  for (const element of placed) {
    if (how === 'left') patches.set(element.id, { x: bounds.x });
    if (how === 'center') patches.set(element.id, { x: bounds.x + bounds.w / 2 - element.w / 2 });
    if (how === 'right') patches.set(element.id, { x: bounds.x + bounds.w - element.w });
    if (how === 'top') patches.set(element.id, { y: bounds.y });
    if (how === 'middle') patches.set(element.id, { y: bounds.y + bounds.h / 2 - element.h / 2 });
    if (how === 'bottom') patches.set(element.id, { y: bounds.y + bounds.h - element.h });
  }
  model.stopCapturing();
  model.updateMany(patches);
}

function distribute(axis: 'x' | 'y'): void {
  const placed = selected.value.filter((element): element is PlacedElement => isPlaced(element) && !element.locked).sort((a, b) => a[axis] - b[axis]);
  if (placed.length < 3) return;
  const length = axis === 'x' ? 'w' : 'h';
  const first = placed[0]!;
  const last = placed[placed.length - 1]!;
  const total = placed.reduce((sum, element) => sum + element[length], 0);
  const gap = (last[axis] + last[length] - first[axis] - total) / (placed.length - 1);
  let cursor = first[axis];
  const patches = new Map<string, Partial<PlacedElement>>();
  for (const element of placed) {
    patches.set(element.id, { [axis]: cursor });
    cursor += element[length] + gap;
  }
  model.stopCapturing();
  model.updateMany(patches);
}

function snapToGrid(): void {
  const patches = new Map<string, Partial<PlacedElement>>();
  for (const element of selected.value) if (isPlaced(element) && !element.locked) patches.set(element.id, { x: snap(element.x), y: snap(element.y), w: Math.max(GRID, snap(element.w)), h: Math.max(GRID, snap(element.h)) });
  model.stopCapturing();
  model.updateMany(patches);
}

/** Entoure la sélection d'une section. */
function wrapInSection(): void {
  const bounds = selectionBounds.value;
  if (!bounds) return;
  const frameElement: BoardElement = { id: newElementId(), type: 'frame', z: Math.min(...elements.value.map((element) => element.z)) - 1, x: snap(bounds.x - 32), y: snap(bounds.y - 40), w: snap(bounds.w + 64), h: snap(bounds.h + 72), title: t('Section'), color: 'gray' };
  place(frameElement);
}

function runAction(action: SelectionAction): void {
  const ids = selection.value;
  switch (action) {
    case 'make-template':
      askTemplate();
      return;
    case 'template-update':
      if (selectedInstance.value) void updateInstance(selectedInstance.value.inst);
      return;
    case 'template-apply':
      if (selectedInstance.value) void applyInstance(selectedInstance.value.inst);
      return;
    case 'template-open':
      if (selectedInstance.value) emit('open-template', selectedInstance.value.templateId);
      return;
    case 'template-detach':
      if (selectedInstance.value) detachInstance(selectedInstance.value.inst);
      return;
    case 'duplicate':
      select(model.duplicate(selected.value).map((element) => element.id));
      break;
    case 'delete':
      model.remove([...ids].filter((id) => !index.value.get(id)?.locked));
      break;
    case 'front':
      model.restack(ids, true);
      break;
    case 'back':
      model.restack(ids, false);
      break;
    case 'lock':
    case 'unlock':
      model.stopCapturing();
      model.updateMany(new Map([...ids].map((id) => [id, { locked: action === 'lock' }])));
      break;
    case 'mermaid':
      openExport();
      break;
    case 'section':
      wrapInSection();
      break;
    case 'add-row':
    case 'add-column': {
      const table = single.value;
      if (table?.type !== 'table') break;
      const rows = action === 'add-row' ? [...table.rows, table.rows[0]!.map(() => '')] : table.rows.map((row, position) => [...row, position === 0 ? t('Colonne {n}', { n: row.length + 1 }) : '']);
      model.update(table.id, action === 'add-row' ? { rows, h: table.h + 36 } : { rows, w: table.w + 120 });
      break;
    }
    case 'chart-from-table': {
      const table = single.value;
      if (table?.type !== 'table') break;
      const chart: ChartElement = { id: newElementId(), type: 'chart', z: model.nextZ(), x: table.x + table.w + 40, y: table.y, w: 380, h: 260, chart: 'bar', title: t('Graphique'), source: table.id, rows: [] };
      place(chart, false);
      break;
    }
    case 'chart-data':
      if (single.value?.type === 'chart') chartEditing.value = single.value.id;
      break;
    case 'edit-table':
      if (single.value?.type === 'table') editing.value = { id: single.value.id, field: 'cells' };
      break;
  }
}

const menu = ref<InstanceType<typeof ContextMenu> | null>(null);
const menuItems = ref<MenuItem[]>([]);
const menuPoint = ref<Point>({ x: 0, y: 0 });

function onContextMenu(event: MouseEvent): void {
  if ((event.target as Element).closest('.board-ui, .edit-overlay, .board-table.editing')) return;
  event.preventDefault();
  if (editing.value) commitEdit();
  menuPoint.value = toWorld(event.clientX, event.clientY);
  const hit = (event.target as Element).closest<SVGElement | HTMLElement>('[data-id]');
  const element = hit ? index.value.get(hit.dataset.id!) : undefined;
  if (element && !selection.value.has(element.id)) select([element.id]);
  const has = selected.value.length > 0;
  const write = editable.value;
  const locked = selected.value.some((entry) => entry.locked);
  menuItems.value = has
    ? [
        ...(write ? [{ label: t('Couper'), icon: 'pi pi-times', command: () => copySelection(true) }] : []),
        { label: t('Copier'), icon: 'pi pi-copy', command: () => copySelection() },
        ...(write
          ? [
              { label: t('Coller'), icon: 'pi pi-clipboard', command: () => void readClipboard() },
              { label: t('Dupliquer'), icon: 'pi pi-clone', command: () => runAction('duplicate') },
              { label: t('Supprimer'), icon: 'pi pi-trash', command: () => runAction('delete') },
              { separator: true },
            ]
          : []),
        { label: t('Exporter en Mermaid'), icon: 'pi pi-share-alt', command: openExport },
        ...(write && templatesOn.value
          ? [
              { separator: true },
              { label: t('Créer un modèle…'), icon: 'pi pi-clone', command: askTemplate },
              ...(selectedInstance.value
                ? [
                    { label: t('Revenir au modèle à jour'), icon: 'pi pi-replay', command: () => runAction('template-update') },
                    { label: t('Ouvrir le modèle'), icon: 'pi pi-external-link', disabled: selectedInstance.value.state === 'missing', command: () => runAction('template-open') },
                    { label: t('Détacher du modèle'), icon: 'pi pi-link', command: () => runAction('template-detach') },
                  ]
                : []),
            ]
          : []),
        ...(write
          ? [
              { separator: true },
              {
                label: t('Organiser'),
                icon: 'pi pi-clone',
                items: [
                  { label: t('Premier plan'), icon: 'pi pi-angle-double-up', command: () => runAction('front') },
                  { label: t('Arrière-plan'), icon: 'pi pi-angle-double-down', command: () => runAction('back') },
                ],
              },
              {
                label: t('Aligner'),
                icon: 'pi pi-align-left',
                disabled: selected.value.filter(isPlaced).length < 2,
                items: [
                  { label: t('À gauche'), icon: 'pi pi-align-left', command: () => align('left') },
                  { label: t('Au centre'), icon: 'pi pi-align-center', command: () => align('center') },
                  { label: t('À droite'), icon: 'pi pi-align-right', command: () => align('right') },
                  { separator: true },
                  { label: t('En haut'), icon: 'pi pi-arrow-up', command: () => align('top') },
                  { label: t('Au milieu'), icon: 'pi pi-minus', command: () => align('middle') },
                  { label: t('En bas'), icon: 'pi pi-arrow-down', command: () => align('bottom') },
                  { separator: true },
                  { label: t('Répartir horizontalement'), icon: 'pi pi-arrows-h', disabled: selected.value.filter(isPlaced).length < 3, command: () => distribute('x') },
                  { label: t('Répartir verticalement'), icon: 'pi pi-arrows-v', disabled: selected.value.filter(isPlaced).length < 3, command: () => distribute('y') },
                ],
              },
              { separator: true },
              locked ? { label: t('Déverrouiller'), icon: 'pi pi-lock-open', command: () => runAction('unlock') } : { label: t('Verrouiller'), icon: 'pi pi-lock', command: () => runAction('lock') },
              { label: t('Placer dans une section'), icon: 'pi pi-th-large', command: wrapInSection },
              { label: t('Aligner sur la grille'), icon: 'pi pi-table', command: snapToGrid },
            ]
          : []),
      ]
    : [
        ...(write
          ? [
              { label: t('Ajouter un élément…'), icon: 'pi pi-plus', command: () => openQuick(menuPoint.value) },
              { label: t('Ajouter une icône…'), icon: 'pi pi-face-smile', command: () => openQuick(menuPoint.value, 'icons') },
              ...(props.spaceId ? [{ label: t('Ajouter une image…'), icon: 'pi pi-image', command: () => openQuick(menuPoint.value, 'images') }] : []),
              ...(templatesOn.value
                ? [
                    {
                      label: t('Insérer un modèle'),
                      icon: 'pi pi-clone',
                      disabled: !props.templates?.length,
                      items: (props.templates ?? []).map((node) => ({ label: node.path, command: () => void insertTemplate(node.id, menuPoint.value) })),
                    },
                  ]
                : []),
              { separator: true },
              { label: t('Coller'), icon: 'pi pi-clipboard', command: () => void readClipboard() },
              { label: t('Importer du Mermaid…'), icon: 'pi pi-download', command: openImport },
              { separator: true },
            ]
          : []),
        { label: t('Tout sélectionner'), icon: 'pi pi-check-square', command: () => select(elements.value.map((entry) => entry.id)) },
        { label: t('Ajuster à l’écran'), icon: 'pi pi-expand', command: () => fit() },
        { label: t('Exporter le tableau en Mermaid'), icon: 'pi pi-share-alt', disabled: !elements.value.length, command: openExport },
      ];
  menu.value?.show(event);
}

async function readClipboard(): Promise<void> {
  try {
    paste(await navigator.clipboard.readText());
  } catch {
    paste(null);
  }
}

// --- Mermaid -------------------------------------------------------------------------------------------------------------

const mermaidOpen = ref(false);
const mermaidMode = ref<'import' | 'export'>('export');
const mermaidText = ref('');

function openExport(): void {
  const ids = selection.value.size ? new Set(selection.value) : undefined;
  const text = exportMermaid(elements.value, ids);
  if (!text.trim()) {
    notify('warn', t('Rien à exporter : choisissez des formes, des post-it ou une carte mentale.'));
    return;
  }
  mermaidText.value = text;
  mermaidMode.value = 'export';
  mermaidOpen.value = true;
}

function openImport(): void {
  mermaidText.value = '';
  mermaidMode.value = 'import';
  mermaidOpen.value = true;
}

/** Pose un organigramme ou une carte mentale Mermaid au centre de la vue. */
function importMermaid(text: string): boolean {
  try {
    const rect = root.value!.getBoundingClientRect();
    // À droite de ce qui existe déjà, sinon au centre de la vue.
    const existing = boundsOf(elements.value, index.value);
    const origin = existing ? { x: existing.x + existing.w + 120, y: existing.y } : toWorld(rect.left + size.width * 0.3, rect.top + size.height * 0.25);
    const created = mermaidToElements(text, { x: snap(origin.x), y: snap(origin.y) }, { zStart: model.nextZ() });
    if (!created.length) return false;
    model.stopCapturing();
    model.add(created);
    model.stopCapturing();
    select(created.map((element) => element.id));
    fit(created);
    return true;
  } catch (error) {
    notify('error', t(error instanceof Error ? error.message : 'Mermaid illisible.'));
    return false;
  }
}

// --- Fast Element et graphiques -------------------------------------------------------------------------------------------

const pickerOpen = ref(false);
const pickAt = ref<Point | null>(null);

function onPick(pick: FastPick): void {
  const rect = root.value!.getBoundingClientRect();
  const at = pickAt.value ?? toWorld(rect.left + size.width / 2, rect.top + size.height / 2);
  const height = pick.kind === 'board' ? 240 : pick.kind === 'folder' ? 220 : 170;
  const element: FastElement = { id: newElementId(), type: 'fast', z: model.nextZ(), x: snap(at.x - 160), y: snap(at.y - height / 2), w: 320, h: height, ref: { kind: pick.kind, id: pick.id }, label: pick.label };
  place(element, false);
  pickAt.value = null;
}

// --- Ajout rapide, icônes et images ------------------------------------------------------------------------------------

let lastPointer: Point | null = null;
const quick = ref<{ x: number; y: number; at: Point; tab: 'all' | 'icons' | 'images' | 'templates' } | null>(null);

function viewCenter(): Point {
  return { x: (size.width / 2 - view.x) / view.zoom, y: (size.height / 2 - view.y) / view.zoom };
}

/** Ouvre l'ajout rapide ; ce qui est choisi se pose en `at` (le centre de la vue par défaut). */
function openQuick(at: Point | null = null, tab: 'all' | 'icons' | 'images' | 'templates' = 'all'): void {
  if (!editable.value) return;
  const point = at ?? viewCenter();
  const screen = toScreen(point);
  quick.value = { x: screen.x, y: screen.y, at: point, tab };
}

/** Taille naturelle d'une image, ramenée à au plus `max` de côté. */
function imageBox(url: string, max = 360): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const probe = new Image();
    probe.onload = () => {
      const width = probe.naturalWidth || max;
      const height = probe.naturalHeight || max;
      const ratio = Math.min(1, max / Math.max(width, height));
      resolve({ w: Math.max(24, Math.round(width * ratio)), h: Math.max(24, Math.round(height * ratio)) });
    };
    probe.onerror = () => resolve({ w: 240, h: 160 });
    probe.src = url;
  });
}

async function placeImage(asset: BoardAssetDTO, at: Point, offset = 0): Promise<void> {
  const box = await imageBox(boardAssetUrl(asset.key));
  const element: ImageElement = { id: newElementId(), type: 'image', z: model.nextZ(), x: snap(at.x - box.w / 2 + offset), y: snap(at.y - box.h / 2 + offset), ...box, asset: asset.key, name: asset.name };
  place(element, false);
}

/** Images glissées ou collées : envoyées dans l'espace, puis posées. */
async function uploadAndPlace(files: File[], at: Point): Promise<void> {
  if (!props.spaceId) return;
  let offset = 0;
  for (const file of files) {
    try {
      const { asset } = await api.boardUploadAsset(props.spaceId, file);
      await placeImage(asset, at, offset);
      offset += 24;
    } catch (error) {
      notifyError(error, t('Image non envoyée'));
    }
  }
}

function onDrop(event: DragEvent): void {
  const files = [...(event.dataTransfer?.files ?? [])].filter((file) => file.type.startsWith('image/') || file.name.toLowerCase().endsWith('.svg'));
  if (!files.length || !editable.value || !props.spaceId) return;
  event.preventDefault();
  void uploadAndPlace(files, toWorld(event.clientX, event.clientY));
}

async function addQuick(pick: QuickPick): Promise<void> {
  const at = quick.value?.at ?? viewCenter();
  quick.value = null;
  root.value?.focus();
  if (!editable.value) return;
  switch (pick.kind) {
    case 'element': {
      if (pick.tool === 'fast') {
        pickAt.value = at;
        pickerOpen.value = true;
        return;
      }
      if (pick.shape) shapeKind.value = pick.shape;
      const element = createAt(pick.tool, { x: at.x, y: at.y, w: 0, h: 0 }, false);
      if (element) place(element);
      return;
    }
    case 'mermaid':
      openImport();
      return;
    case 'icon': {
      const element: IconElement = { id: newElementId(), type: 'icon', z: model.nextZ(), x: snap(at.x - 32), y: snap(at.y - 32), w: 64, h: 64, icon: pick.icon, color: 'default', stroke: 2 };
      place(element, false);
      return;
    }
    case 'image':
      await placeImage(pick.asset, at);
      return;
    case 'template':
      await insertTemplate(pick.id, at);
  }
}

// Une icône de la bibliothèque sur le tableau : on charge la bibliothèque.
watch(
  () => elements.value.some((element) => element.type === 'icon' && element.icon.startsWith('lucide:')),
  (needed) => {
    if (needed && !iconLibrary.value) void loadIconLibrary();
  },
  { immediate: true },
);

const iconStroke = (element: IconElement): string => (element.color === 'default' ? 'var(--board-default-text)' : `var(--board-${element.color}-stroke)`);
const customIconUrl = (element: IconElement): string => boardIconUrl(Number(element.icon.slice('custom:'.length)));

// --- Modèles (façon « prefab ») ------------------------------------------------------------------------------------

/** Les modèles ne sont proposés que dans un espace (pas aux visiteurs), et pas à l'intérieur d'un modèle. */
const templatesOn = computed(() => Boolean(props.templates && props.spaceId) && !props.isTemplate);
const templatesById = computed(() => new Map((props.templates ?? []).map((node) => [node.id, node])));
const instances = computed(() => (templatesOn.value ? instancesOf(elements.value) : new Map<string, BoardElement[]>()));

/** Éléments d'un modèle, gardés tant qu'il ne change pas. */
const templateCache = new Map<number, { version: string; elements: BoardElement[]; print: string }>();
const templateData = shallowRef(new Map<number, { version: string; print: string }>());

async function templateElements(id: number): Promise<{ version: string; elements: BoardElement[] }> {
  const known = templatesById.value.get(id)?.updatedAt;
  const cached = templateCache.get(id);
  if (cached && cached.version === known) return cached;
  const read = await api.board(id);
  const entry = { version: read.node.updatedAt, elements: read.elements, print: fingerprint(read.elements, (element) => element.id) };
  templateCache.set(id, entry);
  templateData.value = new Map(templateData.value).set(id, { version: entry.version, print: entry.print });
  return entry;
}

// Les modèles utilisés sur ce tableau sont relus quand ils changent, pour dire si les copies sont à jour.
watch(
  () =>
    [...new Set([...instances.value.values()].map((group) => group[0]!.tpl!.id))]
      .filter((id) => templatesById.value.has(id))
      .map((id) => `${id}:${templatesById.value.get(id)!.updatedAt}`)
      .join(','),
  (keys) => {
    for (const key of keys.split(',').filter(Boolean)) void templateElements(Number(key.split(':')[0])).catch(() => undefined);
  },
  { immediate: true },
);

function stateOf(group: readonly BoardElement[]): InstanceState {
  const link = group[0]?.tpl;
  const node = link ? templatesById.value.get(link.id) : undefined;
  if (!link || !node) return 'missing';
  const data = templateData.value.get(link.id);
  if (!data) return 'checking';
  if (fingerprint(group, templateKey) === data.print) return 'current';
  // Copiée d'une version plus ancienne : le modèle a changé depuis ; sinon, c'est la copie qui a changé.
  return group.some((element) => element.tpl?.v !== node.updatedAt) ? 'outdated' : 'modified';
}

const instanceStates = computed(() => new Map([...instances.value.entries()].map(([inst, group]) => [inst, stateOf(group)])));

/** Les éléments à sélectionner d'un clic : toute la copie d'un modèle, sinon l'élément seul. */
function groupOf(element: BoardElement): string[] {
  const group = element.tpl ? instances.value.get(element.tpl.inst) : undefined;
  return group ? group.map((entry) => entry.id) : [element.id];
}

/** La sélection est exactement une copie de modèle. */
const selectedInstance = computed(() => {
  const first = selected.value[0];
  const inst = first?.tpl?.inst;
  const group = inst ? instances.value.get(inst) : undefined;
  if (!group || group.length !== selected.value.length || !selected.value.every((element) => element.tpl?.inst === inst)) return null;
  const templateId = first!.tpl!.id;
  return { inst: inst!, templateId, name: templatesById.value.get(templateId)?.path ?? t('Modèle supprimé'), state: instanceStates.value.get(inst!) ?? 'checking' };
});

/** Repères des copies : leur nom au survol ou à la sélection, un point quand le modèle a changé. */
const instanceMarks = computed(() =>
  [...instances.value.entries()].flatMap(([inst, group]) => {
    const frame = frameOf(group);
    if (!frame) return [];
    const state = instanceStates.value.get(inst) ?? 'checking';
    const shown = group.some((element) => selection.value.has(element.id) || hoverId.value === element.id);
    if (!shown && state !== 'outdated') return [];
    return [{ inst, frame, state, shown, name: templatesById.value.get(group[0]!.tpl!.id)?.path ?? t('Modèle supprimé') }];
  }),
);
const STATE_LABELS: Record<InstanceState, string> = { current: 'à jour', outdated: 'nouvelle version', modified: 'modifiée', missing: 'modèle supprimé', checking: '…' };

async function insertTemplate(id: number, at: Point): Promise<void> {
  if (!editable.value) return;
  try {
    const { version, elements: source } = await templateElements(id);
    const frame = frameOf(source);
    if (!frame) {
      notify('info', t('Ce modèle est vide'), t('Ouvrez-le pour y dessiner.'));
      return;
    }
    const copies = instantiate(source, { templateId: id, version, at: { x: snap(at.x - frame.w / 2), y: snap(at.y - frame.h / 2) }, z: model.nextZ() });
    model.stopCapturing();
    model.add(copies);
    select(copies.map((element) => element.id));
    tool.value = 'select';
  } catch (error) {
    notifyError(error, t('Modèle inaccessible'));
  }
}

/** Remet une copie à l'image de la dernière version du modèle, à la même place (ses identifiants sont gardés). */
async function updateInstance(inst: string): Promise<void> {
  const group = instances.value.get(inst);
  const link = group?.[0]?.tpl;
  const frame = group ? frameOf(group) : null;
  if (!group || !link || !frame) return;
  try {
    templateCache.delete(link.id);
    const { version, elements: source } = await templateElements(link.id);
    const reuse = new Map(group.map((element) => [element.tpl!.key, element.id]));
    const copies = instantiate(source, { templateId: link.id, version, at: { x: frame.x, y: frame.y }, z: Math.min(...group.map((element) => element.z)), inst, reuse });
    const kept = new Set(copies.map((element) => element.id));
    model.stopCapturing();
    model.transact(() => {
      model.remove(group.filter((element) => !kept.has(element.id)).map((element) => element.id));
      model.add(copies);
    });
    select(copies.map((element) => element.id));
    notify('success', t('Copie mise à jour'), t('Elle reprend la dernière version du modèle.'));
  } catch (error) {
    notifyError(error, t('Modèle inaccessible'));
  }
}

/** Enregistre la copie (avec ses changements) comme nouvelle version du modèle. */
async function applyInstance(inst: string): Promise<void> {
  const group = instances.value.get(inst);
  const link = group?.[0]?.tpl;
  if (!group || !link) return;
  const keys = new Map(group.map((element) => [element.id, element.tpl!.key]));
  const source = templateSource(group).map((element): BoardElement => {
    const id = keys.get(element.id)!;
    if (element.type === 'connector') {
      const end = (side: typeof element.from) => ({ ...side, id: side.id ? (keys.get(side.id) ?? null) : null });
      return { ...element, id, from: end(element.from), to: end(element.to) };
    }
    if (element.type === 'mind') return { ...element, id, parent: element.parent ? (keys.get(element.parent) ?? null) : null };
    if (element.type === 'chart') return { ...element, id, source: element.source ? (keys.get(element.source) ?? null) : null };
    return { ...element, id };
  });
  try {
    await api.boardSaveElements(link.id, source);
    templateCache.delete(link.id);
    const { version } = await templateElements(link.id);
    model.stopCapturing();
    model.updateMany(new Map(group.map((element) => [element.id, { tpl: { ...element.tpl!, v: version } }])));
    notify('success', t('Modèle mis à jour'), t('Les autres copies proposent maintenant de se mettre à jour.'));
  } catch (error) {
    notifyError(error, t('Modèle non enregistré'));
  }
}

function detachInstance(inst: string): void {
  const group = instances.value.get(inst);
  if (!group) return;
  model.stopCapturing();
  model.add(group.map((element) => unlinked(element)));
}

// Création d'un modèle depuis la sélection : on le nomme, la sélection en devient une copie.
const templateName = ref<string | null>(null);
const savingTemplate = ref(false);

function askTemplate(): void {
  if (!selected.value.length || !props.spaceId) return;
  templateName.value = '';
}

async function createTemplate(): Promise<void> {
  const name = templateName.value?.trim();
  if (!name || !props.spaceId) return;
  const chosen = selected.value;
  savingTemplate.value = true;
  try {
    const { node } = await api.boardCreateNode(props.spaceId, name, 'template', templateSource(chosen));
    const inst = newElementId();
    model.stopCapturing();
    model.updateMany(new Map(chosen.map((element) => [element.id, { tpl: { id: node.id, inst, key: element.id, v: node.updatedAt } }])));
    templateName.value = null;
    notify('success', t('Modèle « {name} » créé', { name: node.path }), t('Insérez-le depuis le clic droit ; ses copies suivent ses changements.'));
  } catch (error) {
    notifyError(error, t('Modèle non créé'));
  } finally {
    savingTemplate.value = false;
  }
}

const chartEditing = ref<string | null>(null);
const chartElement = computed(() => (chartEditing.value ? (index.value.get(chartEditing.value) as ChartElement | undefined) : undefined));
const chartSource = computed(() => (chartElement.value?.source ? (index.value.get(chartElement.value.source) as TableElement | undefined) : undefined));

function saveChart(patch: Partial<ChartElement>): void {
  if (!chartElement.value) return;
  model.stopCapturing();
  model.update(chartElement.value.id, patch);
}

function saveTable(id: string, rows: string[][]): void {
  model.update(id, { rows });
}

// --- Cycle de vie --------------------------------------------------------------------------------------------------------

let observer: ResizeObserver | null = null;

onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    if (!entry) return;
    size.width = entry.contentRect.width;
    size.height = entry.contentRect.height;
  });
  if (root.value) observer.observe(root.value);
  document.addEventListener('paste', onPaste);
  root.value?.focus({ preventScroll: true });
});

onBeforeUnmount(() => {
  observer?.disconnect();
  document.removeEventListener('paste', onPaste);
  props.session.awareness.off('change', readPeers);
  window.clearTimeout(viewTimer);
  window.clearTimeout(pointerTimer);
  cancelAnimationFrame(frame);
  model.destroy();
});

// --- Divers pour le gabarit ------------------------------------------------------------------------------------------------

const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
function handlePoint(rect: Rect, handle: string): Point {
  return {
    x: handle.includes('w') ? rect.x : handle.includes('e') ? rect.x + rect.w : rect.x + rect.w / 2,
    y: handle.includes('n') ? rect.y : handle.includes('s') ? rect.y + rect.h : rect.y + rect.h / 2,
  };
}
const sides: Side[] = ['top', 'right', 'bottom', 'left'];
const dotPoint = (element: PlacedElement, side: Side): Point => {
  const point = anchor(element, side);
  const offset = 16 / view.zoom;
  return { x: point.x + (side === 'right' ? offset : side === 'left' ? -offset : 0), y: point.y + (side === 'bottom' ? offset : side === 'top' ? -offset : 0) };
};
const hovered = computed(() => {
  const element = hoverId.value ? index.value.get(hoverId.value) : undefined;
  return element && connectable(element) && editable.value && (tool.value === 'select' || tool.value === 'connector') && !gesture && !element.locked ? (element as PlacedElement) : null;
});
const myVote = (element: StickyElement): boolean => auth.user !== null && element.votes.includes(auth.user.id);
const selectionBar = ref<InstanceType<typeof BoardSelectionBar> | null>(null);
const barWidth = ref(360);
watch(
  () => selected.value.map((element) => element.type).join(),
  async () => {
    await nextTick();
    const element = selectionBar.value?.$el as HTMLElement | undefined;
    if (element?.offsetWidth) barWidth.value = element.offsetWidth;
  },
);
/** Au-dessus de la sélection, sans passer sous la barre d'outils ni sortir du tableau. */
const toolbarScreen = computed(() => {
  const bounds = selectionBounds.value;
  if (!bounds || editing.value?.field === 'cells') return null;
  const top = toScreen({ x: bounds.x + bounds.w / 2, y: bounds.y });
  const half = barWidth.value / 2;
  const below = toScreen({ x: 0, y: bounds.y + bounds.h }).y + 12;
  return { x: Math.max(80 + half, Math.min(top.x, size.width - half - 8)), y: top.y - 60 >= 8 ? top.y - 60 : Math.min(below, size.height - 56) };
});
const editStyle = computed(() => {
  const rect = editRect.value;
  if (!rect) return null;
  return { width: `${rect.w}px`, minHeight: `${rect.h}px`, transform: `translate(${view.x + rect.x * view.zoom}px, ${view.y + rect.y * view.zoom}px) scale(${view.zoom})` };
});
const cursorClass = computed(() => {
  if (spaceDown.value || tool.value === 'hand') return 'cursor-grab';
  if (['shape', 'text', 'sticky', 'frame', 'table', 'chart', 'mind', 'connector', 'fast'].includes(tool.value)) return 'cursor-cross';
  if (tool.value === 'pen' || tool.value === 'highlighter') return 'cursor-pen';
  if (tool.value === 'eraser') return 'cursor-erase';
  return '';
});
const percent = computed(() => `${Math.round(view.zoom * 100)} %`);
const zoomIn = () => zoomAt(view.zoom * 1.2, { x: size.width / 2, y: size.height / 2 });
const zoomOut = () => zoomAt(view.zoom / 1.2, { x: size.width / 2, y: size.height / 2 });

defineExpose({ fit, openImport });
</script>

<template>
  <div
    ref="root"
    class="board"
    :class="[cursorClass, { readonly: !editable }]"
    tabindex="0"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @pointerleave="sharePointer(null)"
    @wheel="onWheel"
    @dblclick="onDoubleClick"
    @contextmenu="onContextMenu"
    @dragover.prevent
    @drop="onDrop"
    @keydown="onKeyDown"
    @keyup="onKeyUp"
  >
    <svg class="board-svg" :width="size.width" :height="size.height">
      <defs>
        <pattern id="board-dots" :width="gridPattern.step" :height="gridPattern.step" patternUnits="userSpaceOnUse" :x="gridPattern.x" :y="gridPattern.y">
          <circle :cx="1" :cy="1" r="1" class="dot" />
        </pattern>
        <marker v-for="color in ['default', 'gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink']" :id="`arrow-${color}`" :key="color" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0,1 L10,5 L0,9 z" :class="`arrow c-${color}`" />
        </marker>
      </defs>
      <rect class="canvas" :width="size.width" :height="size.height" fill="url(#board-dots)" />

      <g :transform="`translate(${view.x},${view.y}) scale(${view.zoom})`">
        <!-- Sections, toujours derrière -->
        <g v-for="element in frames" :key="element.id" :data-id="element.id" class="el frame" :class="[`c-${element.color}`, { selected: selection.has(element.id) }]">
          <template v-if="element.type === 'frame'">
            <rect class="frame-body" :x="element.x" :y="element.y" :width="element.w" :height="element.h" rx="14" />
            <foreignObject v-if="editingId !== element.id" :x="element.x" :y="element.y - 32" :width="Math.max(160, element.w)" height="30">
              <div class="frame-title">{{ element.title || $t('Section') }}</div>
            </foreignObject>
          </template>
        </g>

        <!-- Liens des cartes mentales -->
        <path v-for="link in mindLinks" :key="`l${link.id}`" :d="link.d" class="mind-link" :class="`c-${link.color}`" />
        <path v-for="link in mindDropLinks" :key="`d${link.id}`" :d="link.d" class="mind-drop-link" />

        <template v-for="element in others" :key="element.id">
          <g v-if="element.type === 'connector'" :data-id="element.id" class="el connector" :class="[`c-${element.color}`, { selected: selection.has(element.id), dashed: element.dashed }]">
            <path class="hit" :d="geometry(element).d" />
            <path class="line" :d="geometry(element).d" :marker-end="element.arrowEnd ? `url(#arrow-${element.color})` : undefined" :marker-start="element.arrowStart ? `url(#arrow-${element.color})` : undefined" />
            <foreignObject v-if="element.label && editingId !== element.id" :x="geometry(element).mid.x - 90" :y="geometry(element).mid.y - 14" width="180" height="28">
              <div class="connector-label"><span>{{ element.label }}</span></div>
            </foreignObject>
          </g>

          <g v-else-if="element.type === 'shape'" :data-id="element.id" class="el shape" :class="[`c-${element.color}`, `fill-${element.fill}`, { selected: selection.has(element.id), hover: hoverId === element.id }]" :transform="`translate(${element.x},${element.y})`">
            <path class="body" :d="shapePath(element.shape, element.w, element.h)" />
            <foreignObject v-if="editingId !== element.id" :x="box(element).x" :y="box(element).y" :width="box(element).w" :height="box(element).h">
              <div class="label" :class="`size-${element.size}`">{{ element.text }}</div>
            </foreignObject>
          </g>

          <g v-else-if="element.type === 'sticky'" :data-id="element.id" class="el sticky" :class="[`c-${element.color}`, { selected: selection.has(element.id), hover: hoverId === element.id }]" :transform="`translate(${element.x},${element.y})`">
            <rect class="sticky-body" :width="element.w" :height="element.h" rx="6" />
            <foreignObject v-if="editingId !== element.id" x="0" y="0" :width="element.w" :height="element.h">
              <div class="sticky-text">{{ element.text }}</div>
            </foreignObject>
            <g v-if="element.votes.length || mode === 'sticky'" class="votes" :class="{ mine: myVote(element) }" :transform="`translate(${element.w - 54},${element.h - 30})`" @pointerdown.stop="editable && toggleVote(element)">
              <rect width="46" height="22" rx="11" />
              <text x="23" y="15" text-anchor="middle">👍 {{ element.votes.length }}</text>
            </g>
          </g>

          <g v-else-if="element.type === 'text'" :data-id="element.id" class="el text" :class="[`c-${element.color}`, { selected: selection.has(element.id) }]">
            <foreignObject v-if="editingId !== element.id" :x="element.x" :y="element.y" :width="element.w" :height="element.h">
              <div class="free-text" :class="[`size-${element.size}`, `align-${element.align}`]">{{ element.text }}</div>
            </foreignObject>
            <rect v-else :x="element.x" :y="element.y" :width="element.w" :height="element.h" fill="transparent" />
          </g>

          <g v-else-if="element.type === 'mind'" :data-id="element.id" class="el mind" :class="[`c-${element.color}`, { selected: selection.has(element.id), root: !element.parent, drop: dropTarget === element.id }]" :transform="`translate(${element.x},${element.y})`">
            <rect class="mind-body" :width="element.w" :height="element.h" :rx="Math.min(20, element.h / 2)" />
            <foreignObject v-if="editingId !== element.id" x="0" y="0" :width="element.w" :height="element.h">
              <div class="mind-text">{{ element.text || '…' }}</div>
            </foreignObject>
          </g>

          <g v-else-if="element.type === 'path'" :data-id="element.id" class="el path" :class="[`c-${element.color}`, { selected: selection.has(element.id), erasing: erasing.has(element.id), highlighter: element.highlighter }]">
            <polyline class="hit" :points="pathPoints(element)" />
            <polyline class="stroke" :points="pathPoints(element)" :stroke-width="element.width" />
          </g>

          <g v-else-if="element.type === 'fast'" :data-id="element.id" class="el fast" :class="{ selected: selection.has(element.id) }">
            <foreignObject :x="element.x" :y="element.y" :width="element.w" :height="element.h">
              <BoardFastCard :element="element" />
            </foreignObject>
          </g>

          <g v-else-if="element.type === 'table'" :data-id="element.id" class="el table" :class="[`c-${element.color}`, { selected: selection.has(element.id) }]">
            <foreignObject :x="element.x" :y="element.y" :width="element.w" :height="element.h">
              <BoardTable :rows="element.rows" :color="element.color" :editing="editingId === element.id" @change="(rows) => saveTable(element.id, rows)" @done="editing = null" />
            </foreignObject>
          </g>

          <g v-else-if="element.type === 'chart'" :data-id="element.id" class="el chart" :class="{ selected: selection.has(element.id) }">
            <foreignObject :x="element.x" :y="element.y" :width="element.w" :height="element.h">
              <BoardChart :element="element" :rows="chartRows(element)" />
            </foreignObject>
          </g>

          <g v-else-if="element.type === 'icon'" :data-id="element.id" class="el icon" :class="{ selected: selection.has(element.id) }">
            <rect class="hit" :x="element.x" :y="element.y" :width="element.w" :height="element.h" />
            <!-- eslint-disable-next-line vue/no-v-html -- icône de la bibliothèque intégrée (attributs échappés). -->
            <svg v-if="element.icon.startsWith('lucide:')" :x="element.x" :y="element.y" :width="element.w" :height="element.h" viewBox="0 0 24 24" fill="none" :stroke="iconStroke(element)" :stroke-width="element.stroke" stroke-linecap="round" stroke-linejoin="round" v-html="libraryMarkup(element.icon)"></svg>
            <image v-else-if="element.color === 'default'" :href="customIconUrl(element)" :x="element.x" :y="element.y" :width="element.w" :height="element.h" preserveAspectRatio="xMidYMid meet" />
            <foreignObject v-else :x="element.x" :y="element.y" :width="element.w" :height="element.h">
              <div class="icon-mask" :style="{ maskImage: `url(${customIconUrl(element)})`, WebkitMaskImage: `url(${customIconUrl(element)})`, backgroundColor: iconStroke(element) }"></div>
            </foreignObject>
          </g>

          <g v-else-if="element.type === 'image'" :data-id="element.id" class="el image" :class="{ selected: selection.has(element.id) }">
            <rect class="image-back" :x="element.x" :y="element.y" :width="element.w" :height="element.h" rx="4" />
            <image :href="boardAssetUrl(element.asset)" :x="element.x" :y="element.y" :width="element.w" :height="element.h" preserveAspectRatio="xMidYMid meet" />
          </g>
        </template>

        <!-- Copies de modèles : nom au survol, point quand le modèle a changé -->
        <g v-for="mark in instanceMarks" :key="`i${mark.inst}`" class="instance-mark" :class="mark.state">
          <rect v-if="mark.shown" class="instance-frame" :x="mark.frame.x - 10 / view.zoom" :y="mark.frame.y - 10 / view.zoom" :width="mark.frame.w + 20 / view.zoom" :height="mark.frame.h + 20 / view.zoom" :rx="6 / view.zoom" :stroke-width="1.5 / view.zoom" :stroke-dasharray="`${5 / view.zoom} ${4 / view.zoom}`" />
          <foreignObject v-if="mark.shown" :x="mark.frame.x - 10 / view.zoom" :y="mark.frame.y + mark.frame.h + 12 / view.zoom" :width="320 / view.zoom" :height="24 / view.zoom">
            <div class="instance-tag" :style="{ transform: `scale(${1 / view.zoom})` }"><i class="pi pi-clone"></i> {{ mark.name }} · {{ $t(STATE_LABELS[mark.state]) }}</div>
          </foreignObject>
          <circle v-if="mark.state === 'outdated'" class="instance-dot" :cx="mark.frame.x + mark.frame.w + 10 / view.zoom" :cy="mark.frame.y - 10 / view.zoom" :r="5 / view.zoom" />
        </g>

        <!-- Brouillons : création, lien, trait, cadre de sélection -->
        <rect v-if="creating" class="draft-box" :x="creating.x" :y="creating.y" :width="creating.w" :height="creating.h" rx="6" />
        <line v-if="draft" class="draft-link" :x1="draft.from.x" :y1="draft.from.y" :x2="draft.to.x" :y2="draft.to.y" marker-end="url(#arrow-default)" />
        <polyline v-if="drawing" class="draft-path" :class="{ highlighter: tool === 'highlighter' }" :points="drawing.map((point) => `${point.x},${point.y}`).join(' ')" :stroke-width="tool === 'highlighter' ? 16 : 3" />
        <rect v-if="marquee" class="marquee" :x="marquee.x" :y="marquee.y" :width="marquee.w" :height="marquee.h" />

        <!-- Sélection -->
        <template v-if="selectionBounds && !editing">
          <rect class="selection-box" :x="selectionBounds.x - 4 / view.zoom" :y="selectionBounds.y - 4 / view.zoom" :width="selectionBounds.w + 8 / view.zoom" :height="selectionBounds.h + 8 / view.zoom" :stroke-width="1.5 / view.zoom" />
          <template v-if="single && single.type !== 'connector' && editable && !single.locked && single.type !== 'path'">
            <rect
              v-for="handle in handles"
              :key="handle"
              class="handle"
              :class="`h-${handle}`"
              :data-handle="handle"
              :x="handlePoint(single, handle).x - 5 / view.zoom"
              :y="handlePoint(single, handle).y - 5 / view.zoom"
              :width="10 / view.zoom"
              :height="10 / view.zoom"
              :stroke-width="1.5 / view.zoom"
              :rx="2 / view.zoom"
            />
          </template>
          <template v-if="single?.type === 'connector' && editable">
            <circle class="end-handle" data-end="from" :cx="geometry(single).start.x" :cy="geometry(single).start.y" :r="6 / view.zoom" :stroke-width="2 / view.zoom" />
            <circle class="end-handle" data-end="to" :cx="geometry(single).end.x" :cy="geometry(single).end.y" :r="6 / view.zoom" :stroke-width="2 / view.zoom" />
          </template>
        </template>

        <!-- Points d'accroche au survol -->
        <template v-if="hovered">
          <circle v-for="side in sides" :key="side" class="link-dot" :data-dot="side" :data-of="hovered.id" :cx="dotPoint(hovered, side).x" :cy="dotPoint(hovered, side).y" :r="6 / view.zoom" :stroke-width="2 / view.zoom" />
        </template>

        <!-- Sélections des autres -->
        <g v-for="chosen in peerSelections" :key="`s${chosen.clientId}`" class="peer-selection">
          <rect
            :x="chosen.bounds.x - 6 / view.zoom"
            :y="chosen.bounds.y - 6 / view.zoom"
            :width="chosen.bounds.w + 12 / view.zoom"
            :height="chosen.bounds.h + 12 / view.zoom"
            :rx="4 / view.zoom"
            :stroke="chosen.color"
            :stroke-width="2 / view.zoom"
          />
          <foreignObject :x="chosen.bounds.x - 6 / view.zoom" :y="chosen.bounds.y - 6 / view.zoom - 20 / view.zoom" :width="200 / view.zoom" :height="20 / view.zoom">
            <div class="peer-tag" :style="{ backgroundColor: chosen.color, transform: `scale(${1 / view.zoom})` }">{{ chosen.name }}</div>
          </foreignObject>
        </g>

        <!-- Pointeurs des autres : ils glissent d'une position à la suivante -->
        <g v-for="peer in pointers" :key="peer.clientId" class="peer" :style="{ transform: `translate(${peer.pointer.x}px, ${peer.pointer.y}px) scale(${1 / view.zoom})` }">
          <path d="M0,0 L0,16 L4.5,12 L8,19 L10.5,18 L7,11 L13,11 Z" :fill="peer.color" stroke="#fff" stroke-width="1.2" />
          <foreignObject x="12" y="16" width="160" height="24">
            <div class="peer-name" :style="{ backgroundColor: peer.color }">{{ peer.name }}</div>
          </foreignObject>
        </g>
      </g>
    </svg>

    <div v-if="editStyle" class="edit-overlay" :class="editClass" :style="editStyle">
      <div ref="editBox" class="edit-text" contenteditable="plaintext-only" spellcheck="true" @keydown="onEditKey" @blur="commitEdit" @pointerdown.stop></div>
    </div>

    <BoardToolbar v-model:mode="mode" v-model:tool="tool" v-model:shape="shapeKind" v-model:sticky-color="stickyColor" v-model:pen-color="penColor" class="board-ui" :editable="editable" @import="openImport" @fast="pickerOpen = true" @quick="(tab) => openQuick(null, tab)" />

    <BoardSelectionBar
      v-if="toolbarScreen && selected.length && !gesture"
      ref="selectionBar"
      class="board-ui"
      :style="{ left: `${toolbarScreen.x}px`, top: `${toolbarScreen.y}px` }"
      :elements="selected"
      :editable="editable"
      :template="selectedInstance"
      :can-template="templatesOn"
      @patch="patchSelection"
      @action="runAction"
    />

    <template v-if="mindPlus && !dragging()">
      <button v-tooltip.top="$t('Ajouter un enfant (Tab)')" type="button" class="mind-plus board-ui" :style="{ left: `${mindPlus.child.x}px`, top: `${mindPlus.child.y}px` }" :aria-label="$t('Ajouter un enfant')" @pointerdown.stop @click="addMindNode(mindPlus.node, false)">
        <i class="pi pi-plus"></i>
      </button>
      <button v-if="mindPlus.sibling" v-tooltip.bottom="$t('Ajouter un frère (Entrée)')" type="button" class="mind-plus small board-ui" :style="{ left: `${mindPlus.sibling.x}px`, top: `${mindPlus.sibling.y}px` }" :aria-label="$t('Ajouter un frère')" @pointerdown.stop @click="addMindNode(mindPlus.node, true)">
        <i class="pi pi-plus"></i>
      </button>
    </template>

    <BoardQuickAdd
      v-if="quick"
      class="board-ui"
      :x="quick.x"
      :y="quick.y"
      :area="size"
      :initial="quick.tab"
      :templates="templatesOn ? (templates ?? []) : []"
      :space-id="spaceId ?? null"
      :can-upload="editable && Boolean(spaceId)"
      @pick="addQuick"
      @close="quick = null; root?.focus()"
    />

    <Dialog :visible="templateName !== null" modal :header="$t('Créer un modèle')" :style="{ width: 'min(26rem, calc(100vw - 2rem))' }" @update:visible="(open) => !open && (templateName = null)">
      <form class="template-form" @submit.prevent="createTemplate">
        <p class="muted small">{{ $t('La sélection devient le modèle et sa première copie. Les autres copies se posent par clic droit ou par l’ajout rapide, et proposent de se mettre à jour quand le modèle change.') }}</p>
        <InputText v-if="templateName !== null" v-model="templateName" autofocus fluid maxlength="120" :placeholder="$t('Nom du modèle')" :aria-label="$t('Nom du modèle')" />
      </form>
      <template #footer>
        <Button :label="$t('Annuler')" severity="secondary" text @click="templateName = null" />
        <Button :label="$t('Créer le modèle')" icon="pi pi-clone" :loading="savingTemplate" :disabled="!templateName?.trim()" @click="createTemplate" />
      </template>
    </Dialog>

    <div class="zoom board-ui">
      <button v-tooltip.top="$t('Annuler (Ctrl Z)')" type="button" :disabled="!model.canUndo.value || !editable" :aria-label="$t('Annuler')" @click="model.undo()"><i class="pi pi-undo"></i></button>
      <button v-tooltip.top="$t('Rétablir (Ctrl Y)')" type="button" :disabled="!model.canRedo.value || !editable" :aria-label="$t('Rétablir')" @click="model.redo()"><i class="pi pi-refresh"></i></button>
      <span class="sep"></span>
      <button v-tooltip.top="$t('Dézoomer')" type="button" :aria-label="$t('Dézoomer')" @click="zoomOut"><i class="pi pi-minus"></i></button>
      <button v-tooltip.top="$t('Zoom à 100 %')" type="button" class="percent" @click="zoomAt(1, { x: size.width / 2, y: size.height / 2 })">{{ percent }}</button>
      <button v-tooltip.top="$t('Zoomer')" type="button" :aria-label="$t('Zoomer')" @click="zoomIn"><i class="pi pi-plus"></i></button>
      <button v-tooltip.top="$t('Ajuster à l’écran (Maj 1)')" type="button" :aria-label="$t('Ajuster à l’écran')" @click="fit()"><i class="pi pi-expand"></i></button>
    </div>

    <div v-if="!session.synced.value" class="loading board-ui"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</div>
    <div v-else-if="!elements.length && editable" class="empty-hint">
      <p>{{ mode === 'sticky' ? $t('Double-cliquez pour poser un post-it.') : mode === 'mind' ? $t('Double-cliquez pour commencer une carte mentale, puis Tab pour un enfant et Entrée pour un frère.') : mode === 'draw' ? $t('Choisissez le crayon pour dessiner à main levée.') : $t('Double-cliquez pour créer une forme, tirez ses points bleus pour la relier.') }}</p>
      <p class="muted small">{{ $t('Collez un diagramme Mermaid pour l’importer.') }}</p>
    </div>

    <ContextMenu ref="menu" :model="menuItems" />
    <BoardMermaidDialog v-model:visible="mermaidOpen" :mode="mermaidMode" :text="mermaidText" :title="boardTitle" @import="(text) => importMermaid(text) && (mermaidOpen = false)" />
    <BoardFastPicker v-model:visible="pickerOpen" @pick="onPick" />
    <BoardChartDialog v-if="chartElement" :element="chartElement" :source="chartSource ?? null" :editable="editable" @close="chartEditing = null" @save="saveChart" @save-source="(rows) => chartSource && saveTable(chartSource.id, rows)" />
  </div>
</template>

<style scoped>
.board {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--board-canvas);
  outline: none;
  touch-action: none;
  user-select: none;
}
.board.cursor-grab {
  cursor: grab;
}
.board.cursor-cross {
  cursor: crosshair;
}
.board.cursor-pen {
  cursor: crosshair;
}
.board.cursor-erase {
  cursor: cell;
}
.board-svg {
  display: block;
}
.dot {
  fill: var(--board-dot);
}

/* Éléments */
.el {
  cursor: default;
}
.shape .body {
  fill: var(--el-fill);
  stroke: var(--el-stroke);
  stroke-width: 1.6;
  vector-effect: non-scaling-stroke;
}
.shape.fill-outline .body {
  fill: var(--board-canvas);
}
.shape.fill-none .body {
  fill: transparent;
  stroke: transparent;
}
.shape.fill-none.hover .body,
.shape.fill-none.selected .body {
  stroke: var(--el-stroke);
  stroke-dasharray: 4 4;
}
.label,
.free-text,
.mind-text,
.sticky-text {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
  color: var(--el-text);
  line-height: 1.35;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.label {
  align-items: center;
  justify-content: center;
  padding: 4px 10px;
  text-align: center;
}
.free-text {
  align-items: flex-start;
  padding: 2px 4px;
}
.free-text.align-center {
  justify-content: center;
  text-align: center;
}
.free-text.align-right {
  justify-content: flex-end;
  text-align: right;
}
.size-s {
  font-size: 12px;
}
.size-m {
  font-size: 15px;
}
.size-l {
  font-size: 20px;
  font-weight: 600;
}
.size-xl {
  font-size: 28px;
  font-weight: 700;
}
.sticky-body {
  fill: var(--el-sticky);
  filter: drop-shadow(0 2px 3px rgb(0 0 0 / 0.18));
}
.sticky-text {
  align-items: flex-start;
  padding: 14px;
  color: #1f2937;
  font-size: 15px;
}
.votes rect {
  fill: rgb(255 255 255 / 0.75);
  stroke: rgb(0 0 0 / 0.1);
}
.votes text {
  fill: #1f2937;
  font-size: 12px;
  font-weight: 600;
}
.votes {
  cursor: pointer;
}
.votes.mine rect {
  fill: #2563eb;
}
.votes.mine text {
  fill: #fff;
}
.frame-body {
  fill: var(--el-fill);
  fill-opacity: 0.45;
  stroke: var(--el-stroke);
  stroke-opacity: 0.45;
  stroke-width: 1.4;
  vector-effect: non-scaling-stroke;
}
.frame-title {
  overflow: hidden;
  padding: 4px 6px;
  color: var(--el-text);
  font-size: 15px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: default;
}
.mind-body {
  fill: var(--board-default-fill);
  stroke: var(--el-stroke);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}
.mind.root .mind-body {
  fill: var(--el-fill);
  stroke-width: 2.5;
}
.mind.drop .mind-body {
  stroke: var(--board-select);
  stroke-width: 3;
  stroke-dasharray: 5 4;
}
.mind-text {
  align-items: center;
  justify-content: center;
  padding: 4px 12px;
  font-size: 14px;
  text-align: center;
}
.mind.root .mind-text {
  font-size: 17px;
  font-weight: 700;
}
.mind-drop-link {
  fill: none;
  stroke: var(--board-select);
  stroke-width: 2.5;
  stroke-dasharray: 6 5;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
  pointer-events: none;
}
.mind-link {
  fill: none;
  stroke: var(--el-stroke);
  stroke-width: 2;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}
.connector .line {
  fill: none;
  stroke: var(--el-stroke);
  stroke-width: 1.8;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}
.connector.dashed .line {
  stroke-dasharray: 6 5;
}
.connector .hit,
.path .hit {
  fill: none;
  stroke: transparent;
  stroke-width: 14;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}
.connector.selected .line {
  stroke: var(--board-select);
}
.arrow {
  fill: var(--el-stroke);
}
.connector-label {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}
.connector-label span {
  max-width: 100%;
  overflow: hidden;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--board-canvas);
  color: var(--board-default-text);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.path .stroke {
  fill: none;
  stroke: var(--el-stroke);
  stroke-linecap: round;
  stroke-linejoin: round;
}
.path.highlighter .stroke {
  stroke-opacity: 0.35;
}
.path.erasing {
  opacity: 0.2;
}
.path.selected .stroke {
  filter: drop-shadow(0 0 2px var(--board-select));
}

/* Couleurs */
.c-default {
  --el-fill: var(--board-default-fill);
  --el-stroke: var(--board-default-stroke);
  --el-text: var(--board-default-text);
  --el-sticky: var(--board-default-sticky);
}
.c-gray {
  --el-fill: var(--board-gray-fill);
  --el-stroke: var(--board-gray-stroke);
  --el-text: var(--board-gray-text);
  --el-sticky: var(--board-gray-sticky);
}
.c-red {
  --el-fill: var(--board-red-fill);
  --el-stroke: var(--board-red-stroke);
  --el-text: var(--board-red-text);
  --el-sticky: var(--board-red-sticky);
}
.c-orange {
  --el-fill: var(--board-orange-fill);
  --el-stroke: var(--board-orange-stroke);
  --el-text: var(--board-orange-text);
  --el-sticky: var(--board-orange-sticky);
}
.c-yellow {
  --el-fill: var(--board-yellow-fill);
  --el-stroke: var(--board-yellow-stroke);
  --el-text: var(--board-yellow-text);
  --el-sticky: var(--board-yellow-sticky);
}
.c-green {
  --el-fill: var(--board-green-fill);
  --el-stroke: var(--board-green-stroke);
  --el-text: var(--board-green-text);
  --el-sticky: var(--board-green-sticky);
}
.c-blue {
  --el-fill: var(--board-blue-fill);
  --el-stroke: var(--board-blue-stroke);
  --el-text: var(--board-blue-text);
  --el-sticky: var(--board-blue-sticky);
}
.c-purple {
  --el-fill: var(--board-purple-fill);
  --el-stroke: var(--board-purple-stroke);
  --el-text: var(--board-purple-text);
  --el-sticky: var(--board-purple-sticky);
}
.c-pink {
  --el-fill: var(--board-pink-fill);
  --el-stroke: var(--board-pink-stroke);
  --el-text: var(--board-pink-text);
  --el-sticky: var(--board-pink-sticky);
}

/* Sélection et poignées */
.shape.selected .body,
.sticky.selected .sticky-body,
.mind.selected .mind-body {
  stroke: var(--board-select);
}
.selection-box {
  fill: none;
  stroke: var(--board-select);
  stroke-dasharray: 4 3;
  pointer-events: none;
}
.handle {
  fill: #fff;
  stroke: var(--board-select);
}
.h-nw,
.h-se {
  cursor: nwse-resize;
}
.h-ne,
.h-sw {
  cursor: nesw-resize;
}
.h-n,
.h-s {
  cursor: ns-resize;
}
.h-e,
.h-w {
  cursor: ew-resize;
}
.end-handle {
  fill: #fff;
  stroke: var(--board-select);
  cursor: move;
}
.link-dot {
  fill: var(--board-select);
  stroke: #fff;
  cursor: crosshair;
  opacity: 0.9;
}
.link-dot:hover {
  opacity: 1;
  r: 8;
}
.marquee {
  fill: color-mix(in srgb, var(--board-select) 10%, transparent);
  stroke: var(--board-select);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.draft-box {
  fill: color-mix(in srgb, var(--board-select) 8%, transparent);
  stroke: var(--board-select);
  stroke-dasharray: 5 4;
  vector-effect: non-scaling-stroke;
}
.draft-link {
  stroke: var(--board-select);
  stroke-width: 2;
  stroke-dasharray: 6 4;
  vector-effect: non-scaling-stroke;
}
.draft-path {
  fill: none;
  stroke: var(--board-default-stroke);
  stroke-linecap: round;
  stroke-linejoin: round;
}
.draft-path.highlighter {
  stroke: var(--board-yellow-stroke);
  stroke-opacity: 0.35;
}
.mind-plus {
  position: absolute;
  z-index: 3;
  display: grid;
  place-items: center;
  width: 1.6rem;
  height: 1.6rem;
  padding: 0;
  border: 2px solid var(--board-canvas);
  border-radius: 999px;
  background: var(--fb-accent);
  color: #fff;
  font-size: 0.7rem;
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.25);
  transform: translate(-50%, -50%);
  cursor: pointer;
}
.mind-plus:hover {
  filter: brightness(1.12);
}
.mind-plus.small {
  width: 1.25rem;
  height: 1.25rem;
  font-size: 0.55rem;
  opacity: 0.85;
}
.icon .hit {
  fill: transparent;
}
.icon-mask {
  width: 100%;
  height: 100%;
  mask-position: center;
  mask-repeat: no-repeat;
  mask-size: contain;
  -webkit-mask-position: center;
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-size: contain;
}
.image-back {
  fill: transparent;
}
.image.selected .image-back {
  fill: var(--board-select);
  fill-opacity: 0.06;
}
.instance-mark {
  pointer-events: none;
}
.instance-frame {
  fill: none;
  stroke: #a855f7;
}
.instance-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 1px 7px;
  border-radius: 999px;
  background: #a855f7;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  transform-origin: 0 0;
}
.instance-mark.outdated .instance-tag {
  background: #f59e0b;
}
.instance-mark.modified .instance-tag {
  background: #6366f1;
}
.instance-tag .pi {
  font-size: 9px;
}
.instance-dot {
  fill: #f59e0b;
  stroke: var(--board-canvas);
}
.template-form {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.template-form p {
  margin: 0;
}
.peer {
  pointer-events: none;
  transition: transform 0.12s linear;
}
.peer-selection {
  pointer-events: none;
}
.peer-selection rect {
  fill: none;
}
.peer-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px 4px 4px 0;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  transform-origin: 0 0;
}
.peer-name {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

/* Écriture */
.edit-overlay {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  transform-origin: 0 0;
}
.edit-text {
  width: 100%;
  min-height: 1.35em;
  outline: none;
  color: var(--el-text, var(--board-default-text));
  line-height: 1.35;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  cursor: text;
  user-select: text;
}
.edit-el-shape .edit-text {
  padding: 4px 10px;
  text-align: center;
}
.edit-el-sticky {
  align-items: flex-start;
}
.edit-el-sticky .edit-text {
  min-height: 100%;
  padding: 14px;
  color: #1f2937;
  font-size: 15px;
}
.edit-el-text {
  align-items: flex-start;
}
.edit-el-text .edit-text {
  padding: 2px 4px;
}
.edit-el-mind .edit-text {
  padding: 4px 12px;
  font-size: 14px;
  text-align: center;
}
.edit-title .edit-text {
  padding: 4px 6px;
  font-size: 15px;
  font-weight: 700;
}
.edit-label .edit-text {
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--board-canvas);
  font-size: 12px;
  text-align: center;
}
.edit-overlay.align-center .edit-text {
  text-align: center;
}
.edit-overlay.align-right .edit-text {
  text-align: right;
}

/* Commandes posées sur le tableau */
.zoom {
  position: absolute;
  right: 0.75rem;
  bottom: 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.1rem;
  padding: 0.25rem;
  border: 1px solid var(--fb-border);
  border-radius: 10px;
  background: var(--fb-panel);
  box-shadow: var(--fb-shadow-md, 0 4px 14px rgb(0 0 0 / 0.12));
}
.zoom button {
  display: grid;
  place-items: center;
  min-width: 2rem;
  height: 2rem;
  padding: 0 0.35rem;
  border: 0;
  border-radius: 7px;
  background: none;
  color: var(--fb-text);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
.zoom button:hover:not(:disabled) {
  background: var(--fb-panel-alt);
}
.zoom button:disabled {
  opacity: 0.4;
  cursor: default;
}
.zoom .percent {
  min-width: 3.4rem;
  font-variant-numeric: tabular-nums;
}
.zoom .sep {
  width: 1px;
  height: 1.2rem;
  margin: 0 0.2rem;
  background: var(--fb-border);
}
.loading {
  position: absolute;
  top: 1rem;
  left: 50%;
  padding: 0.4rem 0.8rem;
  border-radius: 999px;
  background: var(--fb-panel);
  box-shadow: var(--fb-shadow-md, 0 4px 14px rgb(0 0 0 / 0.12));
  transform: translateX(-50%);
}
.empty-hint {
  position: absolute;
  top: 40%;
  left: 50%;
  max-width: 26rem;
  color: var(--fb-muted);
  text-align: center;
  pointer-events: none;
  transform: translate(-50%, -50%);
}
.empty-hint p {
  margin: 0.25rem 0;
}
</style>
