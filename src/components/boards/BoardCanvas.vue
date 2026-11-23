<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import Button from 'primevue/button';
import ContextMenu from 'primevue/contextmenu';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import type { MenuItem } from 'primevue/menuitem';
import FollowPill from '@/components/common/FollowPill.vue';
import { anchor, anchorOf, attachAt, boundsOf, connectorGeometry, connectorStroke, crossingsOf, lineLength, shiftSegment, waypointRank, intersects, mindLink, mindRoot, shapePath, sideToward, textBox, type ConnectorGeometry, type Point, type Rect } from '@shared/boardGeometry';
import { exportMermaid, mermaidToElements } from '@shared/boardMermaid';
import { drawioImageData, drawioImageName, looksLikeDrawio, type DrawioImage } from '@shared/boardDrawio';
import { MOCKUP_SPECS, mockupSvg } from '@shared/boardMockup';
import {
  BOARD_ASSET_LIMITS,
  boardAssetUrl,
  boardIconUrl,
  elementGroup,
  isPlaced,
  newElementId,
  shiftConnector,
  withGroup,
  type AnimationSpeed,
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
  type MockupElement,
  type MockupKind,
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
import type { BoardSessionLike } from '@/realtime/boardSession';
import { useAuthStore } from '@/stores/auth';
import { notify, notifyError } from '@/utils/notify';
import BoardChart from './BoardChart.vue';
import BoardChartDialog from './BoardChartDialog.vue';
import BoardDrawioDialog from './BoardDrawioDialog.vue';
import BoardExportDialog from './BoardExportDialog.vue';
import BoardFastCard from './BoardFastCard.vue';
import BoardFastPicker from './BoardFastPicker.vue';
import BoardMermaidDialog from './BoardMermaidDialog.vue';
import BoardQuickAdd from './BoardQuickAdd.vue';
import BoardSelectionBar from './BoardSelectionBar.vue';
import BoardTable from './BoardTable.vue';
import BoardToolbar from './BoardToolbar.vue';
import { BoardModel, measureText, mindSize, textPx } from './editor/model';
import { buildExportSvg, download, exportFileName, rasterize, toPdf, type ExportFormat } from './editor/exportImage';
import { iconLibrary, libraryMarkup, loadIconLibrary } from './editor/icons';
import { fingerprint, frameOf, instancesOf, instantiate, templateKey, templateSource, unlinked, type InstanceState } from './editor/templates';
import { MIND_COLORS, MODE_TOOLS, type BoardMode, type BoardTool, type FastPick, type QuickPick, type SelectionAction } from './editor/tools';

/**
 * Éditeur de tableau blanc, à la manière de Whimsical : plan infini qu'on déplace et zoome, formes, liens, post-it,
 * sections, cartes mentales, dessin, Fast Elements, tableaux et graphiques ; tout est partagé en direct.
 */
const props = defineProps<{
  session: BoardSessionLike;
  canEdit: boolean;
  users: UserSummaryDTO[];
  boardTitle: string;
  /** Espace du tableau : ses images et ses modèles (absent pour un visiteur d'un tableau partagé). */
  spaceId?: number | null;
  /** Modèles de l'espace ; absent : pas de modèles (visiteur). */
  templates?: BoardNodeDTO[];
  /** Le tableau ouvert est lui-même un modèle. */
  isTemplate?: boolean;
  /** Montre le bouton « Historique » à côté d'Annuler (membres de l'espace). */
  history?: boolean;
  /** Mode historique : éléments ajoutés ou modifiés par la version affichée, à entourer. */
  changes?: { added: ReadonlySet<string>; changed: ReadonlySet<string> } | null;
}>();
const emit = defineEmits<{ 'open-template': [id: number]; history: [] }>();
/** Personne suivie (son identifiant) : la vue montre ce qu'elle regarde, jusqu'à notre première action. */
const follow = defineModel<number | null>('follow', { default: null });

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
    return value === 'sticky' || value === 'mind' || value === 'draw' || value === 'mockup' ? value : 'diagram';
  } catch {
    return 'diagram';
  }
};
const mode = ref<BoardMode>(storedMode());
const tool = ref<BoardTool>('select');
const shapeKind = ref<ShapeKind>('rounded');
const mockupKind = ref<MockupKind>('button');
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

// --- Groupes (façon Whimsical) -----------------------------------------------------------------------------------------

/** Groupes du tableau, d'au moins deux éléments (un groupe resté seul ne compte plus). */
const groupMembers = computed(() => {
  const groups = new Map<string, BoardElement[]>();
  for (const element of elements.value) {
    const group = elementGroup(element);
    if (!group) continue;
    const members = groups.get(group);
    if (members) members.push(element);
    else groups.set(group, [element]);
  }
  for (const [group, members] of groups) if (members.length < 2) groups.delete(group);
  return groups;
});
const groupKeyOf = (element: BoardElement | undefined): string | null => {
  const group = element ? elementGroup(element) : null;
  return group && groupMembers.value.has(group) ? group : null;
};

/** Groupe ouvert par un double-clic : ses éléments se choisissent un à un, jusqu'à un clic en dehors. */
const entered = ref<string | null>(null);
// On sort d'un groupe ouvert dès que plus rien de lui n'est sélectionné (ou qu'il est défait).
watch(
  () => entered.value !== null && [...selection.value].some((id) => groupKeyOf(index.value.get(id)) === entered.value),
  (inside) => {
    if (!inside) entered.value = null;
  },
);

/**
 * Ce qu'un clic sur un élément sélectionne : tout son groupe (sauf le groupe ouvert) et toute sa copie de modèle, de
 * proche en proche.
 */
function unitOf(element: BoardElement): string[] {
  const found = new Set<string>([element.id]);
  const queue = [element];
  while (queue.length) {
    const current = queue.pop()!;
    const group = groupKeyOf(current);
    const mates = [...(group && group !== entered.value ? groupMembers.value.get(group)! : []), ...(current.tpl ? (instances.value.get(current.tpl.inst) ?? []) : [])];
    for (const mate of mates) {
      if (found.has(mate.id)) continue;
      found.add(mate.id);
      queue.push(mate);
    }
  }
  return [...found];
}

/** Ces éléments et tous ceux qui vont avec eux. */
function withUnits(ids: Iterable<string>): Set<string> {
  const result = new Set<string>();
  for (const id of ids) {
    if (result.has(id)) continue;
    const element = index.value.get(id);
    if (element) for (const member of unitOf(element)) result.add(member);
  }
  return result;
}

function selectAll(): void {
  entered.value = null;
  select(elements.value.map((element) => element.id));
}

/** Groupes sélectionnés en entier (hors groupe ouvert) : un seul cadre les montre, sans contour par élément. */
const selectedGroups = computed(() => {
  const groups = new Set<string>();
  for (const [group, members] of groupMembers.value) {
    if (group !== entered.value && members.every((member) => selection.value.has(member.id))) groups.add(group);
  }
  return groups;
});
/** Éléments qui montrent leur propre contour de sélection. */
const outlined = computed(() => {
  // Pendant une capture (export, aperçu), rien n'est dessiné comme choisi.
  if (exporting.value) return new Set<string>();
  const groups = selectedGroups.value;
  if (!groups.size) return selection.value;
  return new Set(
    [...selection.value].filter((id) => {
      const group = groupKeyOf(index.value.get(id));
      return !group || !groups.has(group);
    }),
  );
});
/**
 * Ce que la sélection permet : grouper (deux éléments au moins, hors cartes mentales, qui ne forment pas déjà un seul
 * groupe ou une seule copie de modèle), dégrouper.
 */
const grouping = computed(() => {
  const groupable = selected.value.filter((element) => element.type !== 'mind');
  const keys = new Set(groupable.map(groupKeyOf));
  const only = keys.size === 1 ? [...keys][0] : null;
  const alreadyOne = Boolean(only && groupMembers.value.get(only)!.length === groupable.length) || (keys.size === 1 && only === null && selectedInstance.value !== null);
  return { canGroup: groupable.length > 1 && !alreadyOne, canUngroup: selected.value.some((element) => groupKeyOf(element) !== null) };
});

/** Range la sélection dans un nouveau groupe ; ceux de ses éléments déjà groupés quittent leur ancien groupe. */
function groupSelection(): void {
  if (!editable.value) return;
  if (selected.value.some((element) => element.type === 'mind')) notify('info', t('Les nœuds de carte mentale ne se groupent pas : leur carte les range.'));
  if (!grouping.value.canGroup) return;
  model.stopCapturing();
  model.regroup(
    selected.value.filter((element) => element.type !== 'mind').map((element) => element.id),
    newElementId(),
  );
  model.stopCapturing();
  entered.value = null;
}

/** Défait les groupes de la sélection ; leurs éléments restent sélectionnés. */
function ungroupSelection(): void {
  const groups = new Set(selected.value.map(groupKeyOf).filter((group): group is string => group !== null));
  if (!editable.value || !groups.size) return;
  model.stopCapturing();
  model.regroup(
    elements.value.filter((element) => groups.has(elementGroup(element) ?? '')).map((element) => element.id),
    null,
  );
  model.stopCapturing();
  entered.value = null;
}

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
/** Tracés des liens, calculés une fois par changement du tableau. */
const geometries = computed(() => {
  const map = new Map<string, ConnectorGeometry>();
  for (const element of elements.value) if (element.type === 'connector') map.set(element.id, connectorGeometry(element, index.value));
  return map;
});
const geometry = (connector: ConnectorElement): ConnectorGeometry => geometries.value.get(connector.id) ?? connectorGeometry(connector, index.value);
/** Croisements des liens qui sautent par-dessus ceux placés dessous (draw.io : « line jumps »). */
const crossings = computed(() => {
  const connectors = elements.value.filter((element): element is ConnectorElement => element.type === 'connector');
  const map = new Map<string, Map<number, number[]>>();
  for (const connector of connectors) {
    if (!connector.jump) continue;
    const below = connectors.filter((other) => other.id !== connector.id && other.z < connector.z).map((other) => geometry(other).line);
    if (below.length) map.set(connector.id, crossingsOf(geometry(connector).line, below));
  }
  return map;
});
const strokeOf = (connector: ConnectorElement) => connectorStroke(connector, geometry(connector), crossings.value.get(connector.id));
const ANIMATION_PACE: Record<AnimationSpeed, number> = { slow: 50, normal: 110, fast: 240 };
/** Durée d'un tour d'animation, selon la vitesse et la longueur du lien. */
function animationTiming(connector: ConnectorElement): { duration: number; dash: number } {
  const pace = ANIMATION_PACE[connector.animationSpeed ?? 'normal'];
  const length = lineLength(geometry(connector).line);
  const width = connectorStroke(connector, geometry(connector)).line;
  return { duration: Math.min(14, Math.max(0.6, length / pace)), dash: Math.max(6, width * 3) };
}
/** Poignées de segment du lien choisi : décaler un segment (coudé) ou y ajouter un point de passage (droit, courbe). */
const segmentHandles = computed(() => {
  const connector = single.value;
  if (connector?.type !== 'connector' || connector.locked || !editable.value) return [];
  const shape = geometry(connector);
  const minimum = 28 / view.zoom;
  if (connector.route === 'elbow') {
    const fixed = new Set(shape.fixed);
    return shape.line.slice(1).flatMap((b, position) => {
      const a = shape.line[position]!;
      if ((fixed.has(position) && fixed.has(position + 1)) || Math.hypot(b.x - a.x, b.y - a.y) < minimum) return [];
      return [{ index: position, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, mode: 'shift' as const, horizontal: Math.abs(a.y - b.y) < 0.5 }];
    });
  }
  const stops = [shape.start, ...(connector.waypoints ?? []), shape.end];
  return stops.slice(1).flatMap((b, position) => {
    const a = stops[position]!;
    if (Math.hypot(b.x - a.x, b.y - a.y) < minimum) return [];
    const curve = shape.curves?.[position];
    const middle = curve ? cubicMiddle(curve) : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return [{ index: position, ...middle, mode: 'add' as const, horizontal: false }];
  });
});
const cubicMiddle = ([a, b, c, d]: readonly [Point, Point, Point, Point]): Point => ({ x: (a.x + 3 * b.x + 3 * c.x + d.x) / 8, y: (a.y + 3 * b.y + 3 * c.y + d.y) / 8 });
/** Accroche précise visée pendant qu'on tire un lien ou son extrémité. */
const attachMark = ref<Point | null>(null);
/** Dessin d'un composant de maquette, aux couleurs du thème (variables CSS). */
const mockupMarkup = (element: MockupElement): string =>
  mockupSvg(element, {
    ink: 'var(--board-default-text)',
    muted: 'var(--board-gray-stroke)',
    line: 'var(--board-gray-stroke)',
    surface: 'var(--board-default-fill)',
    soft: 'var(--board-gray-fill)',
    accent: `var(--board-${element.color}-stroke)`,
    accentSoft: `var(--board-${element.color}-fill)`,
    onAccent: '#ffffff',
  });
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
  userId: number | null;
  name: string;
  color: string;
  pointer: Point | null;
  /** Éléments que la personne a sélectionnés (ou qu'elle écrit). */
  selection: string[];
  /** Ce qu'elle regarde : la partie du tableau visible chez elle, et quand elle a bougé pour la dernière fois. */
  view: (Rect & { at: number }) | null;
}
function readView(value: unknown): Peer['view'] {
  const rect = value as Partial<Rect & { at: number }> | null | undefined;
  const numbers = [rect?.x, rect?.y, rect?.w, rect?.h];
  if (!rect || !numbers.every((number) => typeof number === 'number' && Number.isFinite(number)) || rect.w! <= 0 || rect.h! <= 0) return null;
  return { x: rect.x!, y: rect.y!, w: rect.w!, h: rect.h!, at: typeof rect.at === 'number' ? rect.at : 0 };
}
const peers = shallowRef<Peer[]>([]);
function readPeers(): void {
  const list: Peer[] = [];
  props.session.awareness.getStates().forEach((state, clientId) => {
    if (clientId === props.session.doc.clientID) return;
    const user = state.user as { id?: number; name?: string; color?: string } | undefined;
    const pointer = state.pointer as Point | null | undefined;
    const chosen = Array.isArray(state.selection) ? (state.selection as unknown[]).filter((id): id is string => typeof id === 'string') : [];
    if (user) list.push({ clientId, userId: typeof user.id === 'number' ? user.id : null, name: user.name ?? '', color: user.color ?? '#4f8cff', pointer: pointer ?? null, selection: chosen, view: readView(state.view) });
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

// --- Suivre quelqu'un : notre vue cadre ce qu'il regarde ---------------------------------------------------------------

let viewSharedAt = 0;
let viewShareTimer = 0;
/** Publie la partie du tableau visible ici (12 fois par seconde au plus) : ceux qui nous suivent la cadrent chez eux. */
function shareView(): void {
  window.clearTimeout(viewShareTimer);
  const wait = 80 - (Date.now() - viewSharedAt);
  if (wait > 0) {
    viewShareTimer = window.setTimeout(shareView, wait);
    return;
  }
  viewSharedAt = Date.now();
  const round = (value: number): number => Math.round(value * 10) / 10;
  props.session.awareness.setLocalStateField('view', { x: round(-view.x / view.zoom), y: round(-view.y / view.zoom), w: round(size.width / view.zoom), h: round(size.height / view.zoom), at: viewSharedAt });
}
watch(() => [view.x, view.y, view.zoom, size.width, size.height], shareView, { immediate: true });

/** La personne suivie ; avec plusieurs onglets ouverts, celui dont la vue a bougé en dernier. */
const followed = computed(() => (follow.value === null ? null : (peers.value.filter((peer) => peer.userId === follow.value).sort((a, b) => (b.view?.at ?? 0) - (a.view?.at ?? 0))[0] ?? null)));
let followFrame = 0;
/** Rapproche notre vue de celle de la personne suivie (son écran tient en entier dans le nôtre), image par image. */
function followStep(): void {
  followFrame = 0;
  const rect = followed.value?.view;
  if (!rect) return;
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(size.width / rect.w, size.height / rect.h)));
  const target = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  const center = { x: (size.width / 2 - view.x) / view.zoom, y: (size.height / 2 - view.y) / view.zoom };
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const arrived = still || (Math.abs(Math.log(zoom / view.zoom)) < 0.002 && Math.abs(target.x - center.x) * zoom < 0.5 && Math.abs(target.y - center.y) * zoom < 0.5);
  const ease = 0.3;
  const nextZoom = arrived ? zoom : view.zoom * Math.exp(Math.log(zoom / view.zoom) * ease);
  const next = arrived ? target : { x: center.x + (target.x - center.x) * ease, y: center.y + (target.y - center.y) * ease };
  view.zoom = nextZoom;
  view.x = size.width / 2 - next.x * nextZoom;
  view.y = size.height / 2 - next.y * nextZoom;
  if (!arrived) followFrame = requestAnimationFrame(followStep);
}
watch([() => followed.value?.view, () => size.width, () => size.height], () => {
  if (followed.value?.view && !followFrame) followFrame = requestAnimationFrame(followStep);
});
// Le clavier revient au tableau : Échap (comme toute action) arrête le suivi.
watch(follow, (id) => {
  if (id !== null) root.value?.focus({ preventScroll: true });
});

/** Notre première action dans le tableau (clic, molette, touche) nous rend la main. */
function onUserAction(event: Event): void {
  if (follow.value === null) return;
  if (event instanceof KeyboardEvent && ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
  follow.value = null;
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
    case 'mockup': {
      const kind = mockupKind.value;
      const spec = MOCKUP_SPECS[kind];
      // Un écran (navigateur, téléphone) se pose derrière ce qui existe, comme une section : il peut entourer une maquette.
      const back = kind === 'browser' || kind === 'mobile';
      return {
        id,
        type: 'mockup',
        z: back ? Math.min(0, ...elements.value.map((element) => element.z)) - 1 : z,
        ...at(spec.w, spec.h),
        kind,
        // Texte de départ traduit, sauf ce qui n'est pas du français (l'heure d'un téléphone, un nombre de pages).
        text: /[a-zà-ÿ]/i.test(spec.text) ? t(spec.text) : spec.text,
        color: kind === 'button' || kind === 'badge' || kind === 'alert' ? 'blue' : 'default',
        variant: 'primary',
        checked: spec.checked ?? false,
        value: spec.value ?? 50,
        size: 'm',
      };
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
  | { kind: 'move'; start: Point; originals: Map<string, Point>; free: Map<string, ConnectorElement>; moved: boolean; mindRoots: Set<string>; mindNodes: string[] }
  | { kind: 'resize'; id: string; handle: string; start: Point; original: Rect }
  | { kind: 'marquee'; start: Point; base: Set<string> }
  | { kind: 'connect'; from: { id: string | null; side: Side | null; point: Point } }
  | { kind: 'end'; id: string; which: 'from' | 'to' }
  | { kind: 'waypoint'; id: string; index: number }
  | { kind: 'segment'; id: string; index: number; start: Point; geometry: ConnectorGeometry; horizontal: boolean }
  | { kind: 'create'; tool: BoardTool; start: Point }
  | { kind: 'draw'; points: Point[] }
  | { kind: 'erase'; ids: Set<string> };

let gesture: Gesture | null = null;
/**
 * Un geste est en cours : la version réactive de `gesture`, pour ce qui s'affiche selon lui (les bulles de liaison).
 * Sans elle, une forme déplacée gardait ses bulles cachées jusqu'au changement d'outil.
 */
const busy = ref(false);
let frame = 0;
let pendingMove: (() => void) | null = null;
const marquee = ref<Rect | null>(null);
const draft = ref<{ from: Point; to: Point } | null>(null);
const drawing = ref<Point[] | null>(null);
const creating = ref<Rect | null>(null);
const erasing = shallowRef<Set<string>>(new Set());
const hoverId = ref<string | null>(null);
/**
 * Élément dont on montre les bulles de liaison au survol. Il suit `hoverId` avec un délai dès que des bulles sont déjà
 * affichées : entre deux formes qui se chevauchent, on a le temps d'aller sur une bulle avant qu'elle ne laisse la place
 * à celles de la forme d'à côté (ou ne disparaisse).
 */
const dotsId = ref<string | null>(null);
const DOTS_DELAY_MS = 450;
let dotsTimer = 0;
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
  const free = new Map<string, ConnectorElement>();
  const mindRoots = new Set<string>();
  // Un ou plusieurs nœuds glissent avec leur branche ; posés sur un autre nœud, ils en deviennent les enfants.
  const movers = mindMovers();
  const moverIds = new Set(movers.map((node) => node.id));
  for (const element of selected.value) {
    if (element.locked) continue;
    if (element.type === 'connector') {
      free.set(element.id, element);
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
  // Un lien dont les deux formes bougent emporte ses points de passage.
  for (const element of elements.value) {
    if (element.type === 'connector' && element.waypoints?.length && !free.has(element.id) && element.from.id && element.to.id && originals.has(element.from.id) && originals.has(element.to.id)) free.set(element.id, element);
  }
  gesture = { kind: 'move', start: world, originals, free, moved: false, mindRoots, mindNodes: movers.map((node) => node.id) };
}

function onPointerDown(event: PointerEvent): void {
  startGesture(event);
  busy.value = gesture !== null;
}

function startGesture(event: PointerEvent): void {
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
  const waypointHandle = target.closest<SVGElement>('[data-wp]');
  if (waypointHandle && single.value?.type === 'connector' && editable.value) {
    model.stopCapturing();
    gesture = { kind: 'waypoint', id: single.value.id, index: Number(waypointHandle.dataset.wp) };
    return;
  }
  const segmentHandle = target.closest<SVGElement>('[data-seg]');
  if (segmentHandle && single.value?.type === 'connector' && editable.value) {
    const connector = single.value;
    const handle = segmentHandles.value.find((entry) => entry.index === Number(segmentHandle.dataset.seg));
    if (!handle) return;
    model.stopCapturing();
    if (handle.mode === 'shift') {
      gesture = { kind: 'segment', id: connector.id, index: handle.index, start: world, geometry: geometry(connector), horizontal: handle.horizontal };
    } else {
      // Tirer le milieu d'un segment y ajoute un point de passage, qu'on déplace aussitôt.
      const points = [...(connector.waypoints ?? [])];
      const rank = waypointRank(connector, geometry(connector), world);
      points.splice(rank, 0, { x: Math.round(world.x), y: Math.round(world.y) });
      model.update(connector.id, { waypoints: points });
      gesture = { kind: 'waypoint', id: connector.id, index: rank };
    }
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
      // Un clic hors du groupe ouvert le referme.
      if (entered.value && groupKeyOf(element) !== entered.value) entered.value = null;
      const unit = unitOf(element);
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        const next = new Set(selection.value);
        const on = !next.has(element.id);
        for (const id of unit) {
          if (on) next.add(id);
          else next.delete(id);
        }
        select(next);
      } else if (!selection.value.has(element.id)) {
        select(unit);
      }
      if (editable.value && selection.value.has(element.id)) {
        model.stopCapturing();
        startMove(world);
      }
      return;
    }
    entered.value = null;
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

/** Le pointeur est autour de cette forme, assez près pour atteindre ses bulles de liaison. */
function nearElement(id: string | null, world: Point): boolean {
  const element = id ? index.value.get(id) : undefined;
  if (!element || !isPlaced(element)) return false;
  const margin = 30 / view.zoom;
  return world.x >= element.x - margin && world.x <= element.x + element.w + margin && world.y >= element.y - margin && world.y <= element.y + element.h + margin;
}

/** Plus rien n'est survolé, et les bulles du survol partent tout de suite (fin d'un geste, capture d'image). */
function clearHover(): void {
  window.clearTimeout(dotsTimer);
  hoverId.value = null;
  dotsId.value = null;
}

/** L'élément sous le pointeur devient l'élément survolé, celui dont on montre les bulles de liaison. */
function updateHover(target: Element | null, world: Point): void {
  if (tool.value !== 'select' && tool.value !== 'connector') return;
  let id = target?.closest<SVGElement>('[data-id]')?.dataset.id ?? null;
  // Les bulles de liaison sont un peu à l'extérieur de la forme : elle reste survolée tant que le pointeur en est proche,
  // même au-dessus d'un lien qui part déjà de ce côté (ou d'un trait, d'une section) : on peut atteindre la bulle.
  const under = id ? index.value.get(id) : undefined;
  if (!under || !connectable(under)) id = [dotsId.value, hoverId.value].find((kept) => kept && nearElement(kept, world)) ?? id;
  // Sur une bulle, c'est sa forme qui est survolée : ses bulles ne laissent pas la place à celles d'une autre.
  const dot = target?.closest<SVGElement>('[data-dot]');
  if (dot) id = dot.dataset.of ?? hoverId.value;
  if (id !== hoverId.value) hoverId.value = id;
}

function onPointerMove(event: PointerEvent): void {
  const world = toWorld(event.clientX, event.clientY);
  lastPointer = world;
  sharePointer(world);
  if (!gesture) {
    updateHover(event.target as Element, world);
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
        for (const [id, original] of current.free) {
          const connector = index.value.get(id) as ConnectorElement | undefined;
          if (!connector) continue;
          const shifted = shiftConnector(original, dx, dy);
          // Lien emporté avec ses formes : ses extrémités accrochées ne bougent pas d'elles-mêmes.
          patches.set(id, selection.value.has(id) ? shifted : { waypoints: shifted.waypoints });
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
      const touched = new Set(gesture.base);
      for (const element of elements.value) {
        if (isPlaced(element)) {
          if (element.type === 'frame' ? rect.x <= element.x && rect.y <= element.y && rect.x + rect.w >= element.x + element.w && rect.y + rect.h >= element.y + element.h : intersects(rect, element)) touched.add(element.id);
        }
      }
      // Un élément touché emmène tout son groupe (et sa copie de modèle).
      const ids = withUnits(touched);
      for (const element of elements.value) {
        if (element.type !== 'connector' || ids.has(element.id)) continue;
        const bounds = boundsOf([element], index.value);
        if (bounds && intersects(rect, bounds) && (!element.from.id || ids.has(element.from.id)) && (!element.to.id || ids.has(element.to.id))) ids.add(element.id);
      }
      select(withUnits(ids));
      break;
    }
    case 'connect': {
      const target = elementAt(event.clientX, event.clientY, (candidate) => connectable(candidate) && candidate.id !== (gesture as { from: { id: string | null } }).from.id);
      hoverId.value = target?.id ?? null;
      const placed = target && isPlaced(target) ? target : null;
      const spot = placed ? attachAt(placed, world, 10 / view.zoom) : null;
      attachMark.value = placed && spot ? anchorOf(placed, spot.side, spot.t) : null;
      draft.value = { from: gesture.from.point, to: placed ? (attachMark.value ?? anchor(placed, sideToward(placed, gesture.from.point))) : world };
      break;
    }
    case 'waypoint': {
      const current = gesture;
      const connector = index.value.get(current.id) as ConnectorElement | undefined;
      if (!connector?.waypoints?.[current.index]) break;
      const free = !event.altKey;
      const points = connector.waypoints.map((point, position) => (position === current.index ? { x: snap(world.x, free), y: snap(world.y, free) } : point));
      throttle(() => model.update(current.id, { waypoints: points }));
      break;
    }
    case 'segment': {
      const current = gesture;
      const offset = snap(current.horizontal ? world.y - current.start.y : world.x - current.start.x, !event.altKey);
      throttle(() => model.update(current.id, { waypoints: shiftSegment(current.geometry, current.index, offset) }));
      break;
    }
    case 'end': {
      const current = gesture;
      const connector = index.value.get(current.id) as ConnectorElement | undefined;
      if (!connector) break;
      const other = connector[current.which === 'from' ? 'to' : 'from'];
      const target = elementAt(event.clientX, event.clientY, (candidate) => connectable(candidate) && candidate.id !== other.id);
      hoverId.value = target?.id ?? null;
      const placed = target && isPlaced(target) ? target : null;
      // Près d'un bord : accroche précise (côté et position) ; au cœur de la forme : le lien choisit son côté.
      const spot = placed ? attachAt(placed, world, 10 / view.zoom) : null;
      attachMark.value = placed && spot ? anchorOf(placed, spot.side, spot.t) : null;
      const end = placed ? { id: placed.id, side: spot?.side ?? null, ...(spot && spot.t !== 0.5 ? { t: spot.t } : {}), x: world.x, y: world.y } : { id: null, side: null, x: world.x, y: world.y };
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
  busy.value = false;
  attachMark.value = null;
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
      clearHover();
      model.stopCapturing();
      break;
    case 'waypoint':
    case 'segment':
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
  clearHover();
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
    const spot = attachAt(target, world, 10 / view.zoom);
    const link = connector({ id: target.id, side: spot?.side ?? null, ...(spot && spot.t !== 0.5 ? { t: spot.t } : {}), x: world.x, y: world.y });
    model.add([link]);
    select([link.id]);
  } else if (source && isPlaced(source) && (source.type === 'shape' || source.type === 'sticky') && Math.hypot(world.x - from.point.x, world.y - from.point.y) > 40) {
    // Comme dans Whimsical : tirer dans le vide crée la forme suivante, déjà reliée (hors du groupe et du modèle de l'original).
    const copy = { ...unlinked(withGroup(source, null)), id: newElementId(), z: model.nextZ(), x: snap(world.x - source.w / 2), y: snap(world.y - source.h / 2), text: '' } as PlacedElement;
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
  // Le tableau a bougé sous le pointeur immobile : l'élément survolé (et ses bulles de liaison) suit, une fois redessiné.
  if (gesture) return;
  const { clientX, clientY } = event;
  cancelAnimationFrame(wheelHover);
  wheelHover = requestAnimationFrame(() => updateHover(document.elementFromPoint(clientX, clientY), toWorld(clientX, clientY)));
}
let wheelHover = 0;

function onDoubleClick(event: MouseEvent): void {
  if ((event.target as Element).closest('.board-ui, .edit-overlay')) return;
  // Double-clic sur un point de passage : il disparaît.
  const waypointHandle = document.elementFromPoint(event.clientX, event.clientY)?.closest<SVGElement>('[data-wp]');
  if (waypointHandle && single.value?.type === 'connector' && editable.value) {
    const connector = single.value;
    const points = (connector.waypoints ?? []).filter((_, position) => position !== Number(waypointHandle.dataset.wp));
    model.stopCapturing();
    model.update(connector.id, { waypoints: points.length ? points : undefined });
    return;
  }
  // Poignées et bulles de liaison : rien à éditer ni à créer.
  if (document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-handle], [data-dot], [data-end], [data-seg]')) return;
  // Avec la capture du pointeur, le double-clic peut viser le tableau lui-même : on regarde ce qui est sous le pointeur.
  const hit = (event.target as Element).closest<SVGElement | HTMLElement>('[data-id]');
  const element = (hit ? index.value.get(hit.dataset.id!) : undefined) ?? elementAt(event.clientX, event.clientY, () => true) ?? undefined;
  // Comme dans Whimsical, un double-clic entre dans le groupe et n'en prend que cet élément ; le suivant l'édite.
  const group = groupKeyOf(element);
  if (element && group && entered.value !== group && (!editable.value || tool.value === 'select')) {
    entered.value = group;
    select(unitOf(element));
    return;
  }
  if (!editable.value) return;
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
    if (element.type === 'mockup' && !MOCKUP_SPECS[element.kind].edit) return;
    void startEdit(element.id, element.type === 'frame' ? 'title' : element.type === 'connector' ? 'label' : 'text');
    return;
  }
  // Double-clic dans le vide : l'élément de base du mode, prêt à écrire.
  const world = toWorld(event.clientX, event.clientY);
  const kind: BoardTool = mode.value === 'sticky' ? 'sticky' : mode.value === 'mind' ? 'mind' : mode.value === 'draw' ? 'text' : mode.value === 'mockup' ? 'mockup' : 'shape';
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
  if (element.type === 'frame') return { x: element.x, y: element.y - 32 / view.zoom, w: Math.max(160, element.w * view.zoom), h: 30 };
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
      // XML de draw.io (copié dans draw.io ou depuis un fichier) : l'import le convertit.
      if (looksLikeDrawio(text)) {
        openDrawio(text);
        return;
      }
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
    else patches.set(element.id, shiftConnector(element, dx, dy));
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
    selectAll();
    return;
  }
  // Ctrl G groupe, Ctrl Maj G dégroupe (le navigateur n'en fait pas une recherche).
  if (mod && key === 'g') {
    event.preventDefault();
    if (event.shiftKey) ungroupSelection();
    else groupSelection();
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
    // Dans un groupe ouvert : on en sort, le groupe entier sélectionné.
    const inside = entered.value ? groupMembers.value.get(entered.value) : undefined;
    entered.value = null;
    select(inside ? withUnits(inside.map((element) => element.id)) : []);
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

/** Réglages facultatifs, absents des éléments qui ont la valeur habituelle. */
const OPTIONAL_FIELDS: Partial<Record<BoardElement['type'], string[]>> = { icon: ['fill'], connector: ['weight', 'waypoints', 'jump', 'animation', 'animationReverse', 'animationColor', 'animationSpeed'] };

function patchSelection(patch: Record<string, unknown>, filter?: (element: BoardElement) => boolean): void {
  const patches = new Map<string, Record<string, unknown>>();
  for (const element of selected.value) {
    if (filter && !filter(element)) continue;
    const own = Object.fromEntries(Object.entries(patch).filter(([key]) => key in element || OPTIONAL_FIELDS[element.type]?.includes(key)));
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

/** Bloc à aligner : un élément seul, ou tout un groupe (ou une copie de modèle) qui bouge d'un bloc. */
interface Block {
  members: BoardElement[];
  box: Rect;
}

/** Blocs de la sélection ; une sélection d'un seul bloc aligne les éléments qui le composent. */
function alignBlocks(): Block[] {
  const movable = selected.value.filter((element) => !element.locked);
  const chosen = new Map(movable.map((element) => [element.id, element]));
  const seen = new Set<string>();
  const blocks: Block[] = [];
  for (const element of movable) {
    if (seen.has(element.id) || !isPlaced(element)) continue;
    const members = unitOf(element)
      .map((id) => chosen.get(id))
      .filter((member): member is BoardElement => member !== undefined);
    for (const member of members) seen.add(member.id);
    const box = boundsOf(members.filter(isPlaced));
    if (box) blocks.push({ members, box });
  }
  if (blocks.length !== 1) return blocks;
  return movable.filter(isPlaced).map((element) => ({ members: [element], box: { x: element.x, y: element.y, w: element.w, h: element.h } }));
}

/** Décale tout un bloc (les liens libres du bloc suivent). */
function shiftBlock(block: Block, dx: number, dy: number, patches: Map<string, Partial<BoardElement>>): void {
  for (const element of block.members) {
    if (isPlaced(element)) patches.set(element.id, { x: element.x + dx, y: element.y + dy });
    else patches.set(element.id, shiftConnector(element, dx, dy));
  }
}

function align(how: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'): void {
  const blocks = alignBlocks();
  if (blocks.length < 2) return;
  const left = Math.min(...blocks.map(({ box }) => box.x));
  const top = Math.min(...blocks.map(({ box }) => box.y));
  const right = Math.max(...blocks.map(({ box }) => box.x + box.w));
  const bottom = Math.max(...blocks.map(({ box }) => box.y + box.h));
  const patches = new Map<string, Partial<BoardElement>>();
  for (const block of blocks) {
    const { box } = block;
    const x = how === 'left' ? left : how === 'center' ? (left + right) / 2 - box.w / 2 : how === 'right' ? right - box.w : box.x;
    const y = how === 'top' ? top : how === 'middle' ? (top + bottom) / 2 - box.h / 2 : how === 'bottom' ? bottom - box.h : box.y;
    shiftBlock(block, x - box.x, y - box.y, patches);
  }
  model.stopCapturing();
  model.updateMany(patches);
}

function distribute(axis: 'x' | 'y'): void {
  const blocks = alignBlocks().sort((a, b) => a.box[axis] - b.box[axis]);
  if (blocks.length < 3) return;
  const length = axis === 'x' ? 'w' : 'h';
  const first = blocks[0]!.box;
  const last = blocks[blocks.length - 1]!.box;
  const total = blocks.reduce((sum, { box }) => sum + box[length], 0);
  const gap = (last[axis] + last[length] - first[axis] - total) / (blocks.length - 1);
  let cursor = first[axis];
  const patches = new Map<string, Partial<BoardElement>>();
  for (const block of blocks) {
    const offset = cursor - block.box[axis];
    shiftBlock(block, axis === 'x' ? offset : 0, axis === 'y' ? offset : 0, patches);
    cursor += block.box[length] + gap;
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
    case 'group':
      groupSelection();
      break;
    case 'ungroup':
      ungroupSelection();
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
  if (element && !selection.value.has(element.id)) {
    if (entered.value && groupKeyOf(element) !== entered.value) entered.value = null;
    select(unitOf(element));
  }
  const has = selected.value.length > 0;
  const write = editable.value;
  const locked = selected.value.some((entry) => entry.locked);
  const blocks = write && has ? alignBlocks().length : 0;
  const { canGroup, canUngroup } = grouping.value;
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
        { label: t('Exporter la sélection…'), icon: 'pi pi-image', command: openExportImage },
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
                disabled: blocks < 2,
                items: [
                  { label: t('À gauche'), icon: 'pi pi-align-left', command: () => align('left') },
                  { label: t('Au centre'), icon: 'pi pi-align-center', command: () => align('center') },
                  { label: t('À droite'), icon: 'pi pi-align-right', command: () => align('right') },
                  { separator: true },
                  { label: t('En haut'), icon: 'pi pi-arrow-up', command: () => align('top') },
                  { label: t('Au milieu'), icon: 'pi pi-minus', command: () => align('middle') },
                  { label: t('En bas'), icon: 'pi pi-arrow-down', command: () => align('bottom') },
                  { separator: true },
                  { label: t('Répartir horizontalement'), icon: 'pi pi-arrows-h', disabled: blocks < 3, command: () => distribute('x') },
                  { label: t('Répartir verticalement'), icon: 'pi pi-arrows-v', disabled: blocks < 3, command: () => distribute('y') },
                ],
              },
              ...(canGroup || canUngroup ? [{ separator: true }] : []),
              ...(canGroup ? [{ label: t('Grouper (Ctrl G)'), icon: 'pi pi-box', command: groupSelection }] : []),
              ...(canUngroup ? [{ label: t('Dégrouper (Ctrl Maj G)'), icon: 'pi pi-objects-column', command: ungroupSelection }] : []),
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
              {
                label: t('Importer'),
                icon: 'pi pi-download',
                items: [
                  { label: t('Depuis Mermaid…'), icon: 'pi pi-share-alt', command: openImport },
                  { label: t('Depuis draw.io (XML)…'), icon: 'pi pi-sitemap', command: () => openDrawio('', menuPoint.value) },
                ],
              },
              { separator: true },
            ]
          : []),
        { label: t('Tout sélectionner'), icon: 'pi pi-check-square', command: selectAll },
        { label: t('Ajuster à l’écran'), icon: 'pi pi-expand', command: () => fit() },
        { separator: true },
        { label: t('Exporter le tableau…'), icon: 'pi pi-image', disabled: !elements.value.length, command: openExportImage },
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
// --- Import draw.io --------------------------------------------------------------------------------------------------------

const drawioOpen = ref(false);
const drawioText = ref('');
/** Point du clic droit qui a ouvert l'import : le diagramme s'y pose. */
const drawioAt = ref<Point | null>(null);

function openDrawio(text = '', at: Point | null = null): void {
  drawioText.value = text;
  drawioAt.value = at ? { ...at } : null;
  drawioOpen.value = true;
}

/** Pose le diagramme importé, centré sur le point du clic droit (ou à droite de ce qui existe). */
const drawioBusy = ref(false);

/**
 * Fichier d'une image d'un diagramme draw.io, quand elle est intégrée au fichier (adresse `data:`). Une image hébergée
 * ailleurs n'est pas téléchargée (FastBoard ne se connecte pas à d'autres sites) : `null`.
 */
function drawioImageFile(image: DrawioImage): File | null {
  const data = drawioImageData(image.source);
  return data ? new File([data.bytes as BlobPart], drawioImageName(image.name, data.mime), { type: data.mime }) : null;
}

/**
 * Envoie les images du diagramme dans l'espace et donne leur clé aux éléments `image`. Une image qu'on ne peut pas
 * envoyer (pas d'espace, image hébergée ailleurs, fichier trop lourd) laisse un cadre à son nom : les liens restent accrochés.
 */
async function withDrawioImages(created: BoardElement[], images: DrawioImage[]): Promise<{ elements: BoardElement[]; missing: number }> {
  const keys = new Map<string, string>();
  for (const image of images.slice(0, 60)) {
    if (!props.spaceId) break;
    try {
      const file = drawioImageFile(image);
      if (!file || file.size > BOARD_ASSET_LIMITS.bytes) continue;
      keys.set(image.elementId, (await api.boardUploadAsset(props.spaceId, file)).asset.key);
    } catch {
      // Image illisible ou refusée : son cadre la remplace.
    }
  }
  let missing = 0;
  const elements = created.map((element): BoardElement => {
    if (element.type !== 'image' || element.asset) return element;
    const key = keys.get(element.id);
    if (key) return { ...element, asset: key };
    missing += 1;
    const { asset: _asset, name, ...box } = element;
    return { ...box, type: 'shape', shape: 'rect', text: name, color: 'gray', fill: 'outline', size: 's' };
  });
  return { elements, missing };
}

async function importDrawio(raw: BoardElement[], images: DrawioImage[] = []): Promise<void> {
  drawioBusy.value = true;
  let created = raw;
  try {
    const result = await withDrawioImages(raw, images);
    created = result.elements;
    if (result.missing) notify('warn', t('Images non importées'), t('{n} image n’a pas pu être importée : un cadre à son nom la remplace.|{n} images n’ont pas pu être importées : un cadre à leur nom les remplace.', { n: result.missing }));
  } finally {
    drawioBusy.value = false;
  }
  const bounds = boundsOf(created, new Map(created.map((element) => [element.id, element])));
  if (!bounds) return;
  const rect = root.value!.getBoundingClientRect();
  const existing = boundsOf(elements.value, index.value);
  const target = drawioAt.value ?? (existing ? { x: existing.x + existing.w + 120 + bounds.w / 2, y: existing.y + bounds.h / 2 } : toWorld(rect.left + size.width / 2, rect.top + size.height / 2));
  const dx = snap(target.x - (bounds.x + bounds.w / 2));
  const dy = snap(target.y - (bounds.y + bounds.h / 2));
  let z = model.nextZ();
  const placed = created.map((element): BoardElement => (element.type === 'connector' ? { ...element, ...shiftConnector(element, dx, dy), z: z++ } : { ...element, x: element.x + dx, y: element.y + dy, z: z++ }));
  model.stopCapturing();
  model.add(placed);
  model.stopCapturing();
  select(placed.map((element) => element.id));
  fit(placed);
  drawioOpen.value = false;
}

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
      if (pick.mockup) mockupKind.value = pick.mockup;
      const element = createAt(pick.tool, { x: at.x, y: at.y, w: 0, h: 0 }, false);
      if (element) place(element);
      return;
    }
    case 'mermaid':
      openImport();
      return;
    case 'icon': {
      const element: IconElement = { id: newElementId(), type: 'icon', z: model.nextZ(), x: snap(at.x - 32), y: snap(at.y - 32), w: 64, h: 64, icon: pick.icon, color: pick.color ?? 'default', stroke: 2, ...(pick.fill && pick.icon.startsWith('lucide:') ? { fill: pick.fill } : {}) };
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
    // Les groupes de la copie sur ce tableau restent ; si elle était groupée d'un bloc, ses nouveaux éléments y entrent.
    const previous = new Map(group.map((element) => [element.id, elementGroup(element)]));
    const shared = new Set(previous.values());
    const whole = shared.size === 1 ? [...shared][0]! : null;
    const copies = instantiate(source, { templateId: link.id, version, at: { x: frame.x, y: frame.y }, z: Math.min(...group.map((element) => element.z)), inst, reuse }).map((copy) =>
      previous.has(copy.id) ? withGroup(copy, previous.get(copy.id)!) : whole ? withGroup(copy, whole) : copy,
    );
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
  const source = templateSource(group, elements.value).map((element): BoardElement => {
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
    const { node } = await api.boardCreateNode(props.spaceId, name, 'template', templateSource(chosen, elements.value));
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
  barObserver?.disconnect();
  cancelAnimationFrame(wheelHover);
  document.removeEventListener('paste', onPaste);
  props.session.awareness.off('change', readPeers);
  window.clearTimeout(viewTimer);
  window.clearTimeout(pointerTimer);
  window.clearTimeout(viewShareTimer);
  window.clearTimeout(dotsTimer);
  cancelAnimationFrame(followFrame);
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
/** Cette forme peut montrer ses bulles de liaison (pour tirer un lien depuis l'un de ses côtés). */
const offersDots = (element: BoardElement | null | undefined): element is PlacedElement =>
  Boolean(element && connectable(element) && editable.value && (tool.value === 'select' || tool.value === 'connector') && !busy.value && !element.locked);
/** La forme sélectionnée garde ses bulles affichées, même quand le pointeur passe sur une forme voisine. */
const pinned = computed(() => (offersDots(single.value) ? single.value : null));
const hovered = computed(() => {
  const element = dotsId.value ? index.value.get(dotsId.value) : undefined;
  return offersDots(element) && element.id !== pinned.value?.id ? element : null;
});
watch(hoverId, (id) => {
  window.clearTimeout(dotsTimer);
  if (id === dotsId.value) return;
  // Aucune bulle à l'écran (ou un geste en cours, qui les cache) : rien à attendre.
  const shown = Boolean(pinned.value) || offersDots(dotsId.value ? index.value.get(dotsId.value) : undefined);
  if (!shown) dotsId.value = id;
  else dotsTimer = window.setTimeout(() => (dotsId.value = hoverId.value), DOTS_DELAY_MS);
});
/**
 * Cadres en pointillés des groupes : sélectionné avec d'autres éléments (seul, le cadre de la sélection est le sien),
 * ouvert par un double-clic, ou survolé.
 */
const groupBoxes = computed(() => {
  const chosen = selectedGroups.value;
  const hoveredGroup = groupKeyOf(hoverId.value ? index.value.get(hoverId.value) : undefined);
  const alone = chosen.size === 1 && [...selection.value].every((id) => chosen.has(groupKeyOf(index.value.get(id)) ?? ''));
  return [...groupMembers.value].flatMap(([group, members]) => {
    const state = group === entered.value ? 'entered' : chosen.has(group) ? (alone ? null : 'selected') : group === hoveredGroup ? 'hover' : null;
    const bounds = state ? boundsOf(members, index.value) : null;
    return state && bounds ? [{ group, state, bounds }] : [];
  });
});
const myVote = (element: StickyElement): boolean => auth.user !== null && element.votes.includes(auth.user.id);
const selectionBar = ref<InstanceType<typeof BoardSelectionBar> | null>(null);
const barWidth = ref(360);
const barHeight = ref(44);
/** La barre change de taille avec la sélection (réglages propres à chaque élément) : on la mesure à chaque fois. */
let barObserver: ResizeObserver | null = null;
watch(
  () => selectionBar.value?.$el as HTMLElement | undefined,
  (element) => {
    barObserver?.disconnect();
    if (!element || typeof ResizeObserver === 'undefined') return;
    barObserver = new ResizeObserver(() => {
      if (element.offsetWidth) barWidth.value = element.offsetWidth;
      if (element.offsetHeight) barHeight.value = element.offsetHeight;
    });
    barObserver.observe(element);
  },
  { flush: 'post' },
);
const BAR_GAP = 38;
/** Au-dessus de la sélection, sans passer sous la barre d'outils ni sortir du tableau. */
const toolbarScreen = computed(() => {
  const bounds = selectionBounds.value;
  if (!bounds || editing.value?.field === 'cells') return null;
  const top = toScreen({ x: bounds.x + bounds.w / 2, y: bounds.y });
  const half = barWidth.value / 2;
  // Assez loin pour laisser libre la bulle de liaison du haut (ou du bas), à 16 px de la forme.
  const below = toScreen({ x: 0, y: bounds.y + bounds.h }).y + BAR_GAP;
  const gap = barHeight.value + BAR_GAP;
  return { x: Math.max(80 + half, Math.min(top.x, size.width - half - 8)), y: top.y - gap >= 8 ? top.y - gap : Math.min(below, size.height - barHeight.value - 12) };
});
const editStyle = computed(() => {
  const rect = editRect.value;
  if (!rect) return null;
  // Le titre d'une section s'écrit à sa taille d'écran, comme il s'affiche.
  const scale = editing.value?.field === 'title' ? 1 : view.zoom;
  return { width: `${rect.w}px`, minHeight: `${rect.h}px`, transform: `translate(${view.x + rect.x * view.zoom}px, ${view.y + rect.y * view.zoom}px) scale(${scale})` };
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

// --- Export en image -----------------------------------------------------------------------------------------------------

/** Cadres des éléments ajoutés ou modifiés par la version de l'historique affichée. */
const changeMarks = computed(() => {
  const changes = props.changes;
  if (!changes) return [];
  return elements.value.flatMap((element) => {
    const kind = changes.added.has(element.id) ? 'added' : changes.changed.has(element.id) ? 'changed' : null;
    const bounds = kind ? boundsOf([element], index.value) : null;
    return kind && bounds ? [{ id: element.id, kind, bounds }] : [];
  });
});
const worldContent = ref<SVGGElement | null>(null);
/** Échelle du titre des sections : l'inverse du zoom, pour qu'il reste lisible. */
const titleScale = computed(() => (exporting.value ? 1 : 1 / view.zoom));
/** Capture en cours : les animations s'arrêtent et les repères de l'éditeur se cachent. */
const exporting = ref(false);
const imageExportOpen = ref(false);
const exportBusy = ref(false);

function openExportImage(): void {
  imageExportOpen.value = true;
}

/** L'image du tableau (ou de la sélection), sans sélection ni survol affichés le temps de la capture. */
async function captureSvg(onlySelection: boolean, transparent: boolean): Promise<{ svg: string; width: number; height: number } | null> {
  const chosen = onlySelection ? selected.value : elements.value;
  const bounds = boundsOf(chosen, index.value);
  const content = worldContent.value;
  if (!bounds || !content) return null;
  const ids = onlySelection ? new Set(chosen.map((element) => element.id)) : null;
  if (editing.value) commitEdit();
  clearHover();
  captures += 1;
  exporting.value = true;
  await nextTick();
  try {
    const background = transparent ? null : getComputedStyle(root.value!).getPropertyValue('--board-canvas').trim() || '#ffffff';
    return await buildExportSvg(content, bounds, ids, background);
  } finally {
    captures -= 1;
    if (!captures) exporting.value = false;
  }
}
let captures = 0;

/** Aperçu de l'export dans la fenêtre : l'image de ce qui sera enregistré, et sa taille. */
const exportPreview = ref<{ url: string; width: number; height: number } | null>(null);
let previewRun = 0;
async function previewExport(options: { transparent: boolean; selection: boolean }): Promise<void> {
  const run = ++previewRun;
  try {
    const captured = await captureSvg(options.selection, options.transparent);
    if (run !== previewRun) return;
    if (exportPreview.value) URL.revokeObjectURL(exportPreview.value.url);
    exportPreview.value = captured ? { url: URL.createObjectURL(new Blob([captured.svg], { type: 'image/svg+xml;charset=utf-8' })), width: captured.width, height: captured.height } : null;
  } catch {
    if (run === previewRun) exportPreview.value = null;
  }
}
watch(imageExportOpen, (open) => {
  if (open || !exportPreview.value) return;
  URL.revokeObjectURL(exportPreview.value.url);
  exportPreview.value = null;
});

async function exportImage(options: { format: ExportFormat; scale: number; transparent: boolean; selection: boolean }): Promise<void> {
  exportBusy.value = true;
  try {
    const captured = await captureSvg(options.selection, options.transparent);
    if (!captured) return;
    const name = exportFileName(props.boardTitle || t('Tableau blanc'), options.format);
    if (options.format === 'svg') {
      download(new Blob([captured.svg], { type: 'image/svg+xml;charset=utf-8' }), name);
    } else {
      const image =
        options.format === 'pdf'
          ? await toPdf(captured.svg, captured.width, captured.height, options.scale)
          : await rasterize(captured.svg, captured.width, captured.height, options.scale, options.format === 'webp' ? 'image/webp' : 'image/png');
      download(image.blob, name);
      if (image.reduced) notify('info', t('Image réduite'), t('Le tableau est trop grand pour cette échelle : l’image a été réduite pour que le navigateur puisse la créer.'));
    }
    imageExportOpen.value = false;
  } catch (error) {
    notifyError(error, t('Export impossible'));
  } finally {
    exportBusy.value = false;
  }
}

async function copyImage(options: { scale: number; transparent: boolean; selection: boolean }): Promise<void> {
  exportBusy.value = true;
  try {
    const captured = await captureSvg(options.selection, options.transparent);
    if (!captured) return;
    const image = await rasterize(captured.svg, captured.width, captured.height, options.scale, 'image/png');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': image.blob })]);
    notify('success', t('Image copiée'), t('Collez-la dans un message, un document ou une présentation.'));
    imageExportOpen.value = false;
  } catch (error) {
    notifyError(error, t('Copie impossible'));
  } finally {
    exportBusy.value = false;
  }
}

defineExpose({ fit, openImport, openDrawio, openExportImage });
</script>

<template>
  <div
    ref="root"
    class="board"
    :class="[cursorClass, { readonly: !editable }]"
    tabindex="0"
    @pointerdown.capture="onUserAction"
    @wheel.capture="onUserAction"
    @keydown.capture="onUserAction"
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
        <!-- Pointe du lien en cours de tracé (les liens posés dessinent les leurs, à leur épaisseur). -->
        <marker id="arrow-default" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0,1 L10,5 L0,9 z" class="arrow c-default" />
        </marker>
      </defs>
      <rect class="canvas" :width="size.width" :height="size.height" fill="url(#board-dots)" />

      <g :transform="`translate(${view.x},${view.y}) scale(${view.zoom})`">
        <!-- Le dessin du tableau (ce que l'export reprend), sans les repères de l'éditeur -->
        <g ref="worldContent">
        <!-- Sections, toujours derrière -->
        <g v-for="element in frames" :key="element.id" :data-id="element.id" class="el frame" :class="[`c-${element.color}`, { selected: outlined.has(element.id) }]">
          <template v-if="element.type === 'frame'">
            <rect class="frame-body" :x="element.x" :y="element.y" :width="element.w" :height="element.h" rx="14" />
            <!-- Le titre garde sa taille à l'écran, quel que soit le zoom (taille réelle dans un export). -->
            <foreignObject v-if="editingId !== element.id" :x="element.x" :y="element.y - 32 * titleScale" :width="Math.max(160 * titleScale, element.w)" :height="30 * titleScale">
              <div class="frame-title" :style="{ width: `${Math.max(160, element.w / titleScale)}px`, transform: `scale(${titleScale})` }">{{ element.title || $t('Section') }}</div>
            </foreignObject>
          </template>
        </g>

        <!-- Liens des cartes mentales -->
        <path v-for="link in mindLinks" :key="`l${link.id}`" :d="link.d" :data-child="link.id" class="mind-link" :class="`c-${link.color}`" />
        <path v-for="link in mindDropLinks" :key="`d${link.id}`" :d="link.d" class="mind-drop-link" />

        <template v-for="element in others" :key="element.id">
          <g v-if="element.type === 'connector'" :data-id="element.id" class="el connector" :class="[`c-${element.color}`, { selected: outlined.has(element.id), dashed: element.dashed }]">
            <path class="hit" :d="geometry(element).d" />
            <template v-for="stroke in [strokeOf(element)]" :key="0">
              <template v-if="stroke.outline">
                <!-- Grosse flèche : un contour (trait large et pointes cerclées), rempli par-dessus. -->
                <path class="block-outline" :d="stroke.d" :stroke-width="stroke.line + stroke.outline * 2" />
                <polygon v-for="(head, at) in stroke.heads" :key="`o${at}`" class="block-outline head" :points="head" :stroke-width="stroke.outline * 2" />
                <path class="block-fill" :d="stroke.d" :stroke-width="stroke.line" />
                <polygon v-for="(head, at) in stroke.heads" :key="`f${at}`" class="block-fill head" :points="head" />
              </template>
              <template v-else>
                <path
                  class="line"
                  :class="{ scaled: stroke.line > 2, flowing: element.animation === 'flow' && !exporting }"
                  :d="stroke.d"
                  :style="{ strokeWidth: stroke.line, strokeDasharray: (element.dashed || (element.animation === 'flow' && exporting)) && stroke.line > 2 ? `${stroke.line * 2.2} ${stroke.line * 1.8}` : element.animation === 'flow' && exporting ? '6 5' : undefined }"
                />
                <polygon v-for="(head, at) in stroke.heads" :key="at" class="arrow-head" :points="head" />
              </template>
              <!-- Animation : tirets qui défilent, points qui circulent, pulsation ou comète, dans un sens ou dans l'autre -->
              <g v-if="element.animation && !exporting" class="connector-anim" :class="`c-${element.animationColor ?? element.color}`">
                <template v-for="timing in [animationTiming(element)]" :key="0">
                  <path v-if="element.animation === 'flow'" class="anim-flow" :d="stroke.d" :stroke-width="stroke.outline ? stroke.line * 0.35 : stroke.line" :stroke-dasharray="`${timing.dash} ${timing.dash}`">
                    <animate attributeName="stroke-dashoffset" :from="0" :to="element.animationReverse ? timing.dash * 2 : -timing.dash * 2" :dur="`${(timing.dash * 2) / ANIMATION_PACE[element.animationSpeed ?? 'normal']}s`" repeatCount="indefinite" />
                  </path>
                  <template v-else-if="element.animation === 'dots'">
                    <circle v-for="dot in 3" :key="dot" class="anim-dot" :r="Math.max(3, stroke.line * 1.3 + 1.5)">
                      <animateMotion :path="stroke.d" :dur="`${timing.duration}s`" :begin="`-${((dot - 1) * timing.duration) / 3}s`" repeatCount="indefinite" :keyPoints="element.animationReverse ? '1;0' : '0;1'" keyTimes="0;1" calcMode="linear" />
                    </circle>
                  </template>
                  <path v-else-if="element.animation === 'comet'" class="anim-comet" :d="stroke.d" pathLength="100" stroke-dasharray="12 88" :stroke-width="stroke.line + 3">
                    <animate attributeName="stroke-dashoffset" from="0" :to="element.animationReverse ? 100 : -100" :dur="`${timing.duration}s`" repeatCount="indefinite" />
                  </path>
                  <path v-else class="anim-pulse" :d="stroke.d" :stroke-width="stroke.line + 8">
                    <animate attributeName="stroke-opacity" values="0;0.45;0" :dur="`${Math.max(0.8, 2.4 * (110 / ANIMATION_PACE[element.animationSpeed ?? 'normal']) ** 0.5)}s`" repeatCount="indefinite" />
                  </path>
                </template>
              </g>
            </template>
            <foreignObject v-if="element.label && editingId !== element.id" :x="geometry(element).mid.x - 90" :y="geometry(element).mid.y - 14" width="180" height="28">
              <div class="connector-label"><span>{{ element.label }}</span></div>
            </foreignObject>
          </g>

          <g v-else-if="element.type === 'shape'" :data-id="element.id" class="el shape" :class="[`c-${element.color}`, `fill-${element.fill}`, { selected: outlined.has(element.id), hover: hoverId === element.id }]" :transform="`translate(${element.x},${element.y})`">
            <path class="body" :d="shapePath(element.shape, element.w, element.h)" />
            <foreignObject v-if="editingId !== element.id" :x="box(element).x" :y="box(element).y" :width="box(element).w" :height="box(element).h">
              <div class="label" :class="`size-${element.size}`">{{ element.text }}</div>
            </foreignObject>
          </g>

          <g v-else-if="element.type === 'sticky'" :data-id="element.id" class="el sticky" :class="[`c-${element.color}`, { selected: outlined.has(element.id), hover: hoverId === element.id }]" :transform="`translate(${element.x},${element.y})`">
            <rect class="sticky-body" :width="element.w" :height="element.h" rx="6" />
            <foreignObject v-if="editingId !== element.id" x="0" y="0" :width="element.w" :height="element.h">
              <div class="sticky-text">{{ element.text }}</div>
            </foreignObject>
            <g v-if="element.votes.length || mode === 'sticky'" class="votes" :class="{ mine: myVote(element) }" :transform="`translate(${element.w - 54},${element.h - 30})`" @pointerdown.stop="editable && toggleVote(element)">
              <rect width="46" height="22" rx="11" />
              <text x="23" y="15" text-anchor="middle">👍 {{ element.votes.length }}</text>
            </g>
          </g>

          <g v-else-if="element.type === 'text'" :data-id="element.id" class="el text" :class="[`c-${element.color}`, { selected: outlined.has(element.id) }]">
            <foreignObject v-if="editingId !== element.id" :x="element.x" :y="element.y" :width="element.w" :height="element.h">
              <div class="free-text" :class="[`size-${element.size}`, `align-${element.align}`]">{{ element.text }}</div>
            </foreignObject>
            <rect v-else :x="element.x" :y="element.y" :width="element.w" :height="element.h" fill="transparent" />
          </g>

          <g v-else-if="element.type === 'mind'" :data-id="element.id" class="el mind" :class="[`c-${element.color}`, { selected: outlined.has(element.id), root: !element.parent, drop: dropTarget === element.id }]" :transform="`translate(${element.x},${element.y})`">
            <rect class="mind-body" :width="element.w" :height="element.h" :rx="Math.min(20, element.h / 2)" />
            <foreignObject v-if="editingId !== element.id" x="0" y="0" :width="element.w" :height="element.h">
              <div class="mind-text">{{ element.text || '…' }}</div>
            </foreignObject>
          </g>

          <g v-else-if="element.type === 'path'" :data-id="element.id" class="el path" :class="[`c-${element.color}`, { selected: outlined.has(element.id), erasing: erasing.has(element.id), highlighter: element.highlighter }]">
            <polyline class="hit" :points="pathPoints(element)" />
            <polyline class="stroke" :points="pathPoints(element)" :stroke-width="element.width" />
          </g>

          <g v-else-if="element.type === 'fast'" :data-id="element.id" class="el fast" :class="{ selected: outlined.has(element.id) }">
            <foreignObject :x="element.x" :y="element.y" :width="element.w" :height="element.h">
              <BoardFastCard :element="element" />
            </foreignObject>
          </g>

          <g v-else-if="element.type === 'table'" :data-id="element.id" class="el table" :class="[`c-${element.color}`, { selected: outlined.has(element.id) }]">
            <foreignObject :x="element.x" :y="element.y" :width="element.w" :height="element.h">
              <BoardTable :rows="element.rows" :color="element.color" :editing="editingId === element.id" @change="(rows) => saveTable(element.id, rows)" @done="editing = null" />
            </foreignObject>
          </g>

          <g v-else-if="element.type === 'chart'" :data-id="element.id" class="el chart" :class="{ selected: outlined.has(element.id) }">
            <foreignObject :x="element.x" :y="element.y" :width="element.w" :height="element.h">
              <BoardChart :element="element" :rows="chartRows(element)" />
            </foreignObject>
          </g>

          <g v-else-if="element.type === 'icon'" :data-id="element.id" class="el icon" :class="{ selected: outlined.has(element.id) }">
            <rect class="hit" :x="element.x" :y="element.y" :width="element.w" :height="element.h" />
            <!-- eslint-disable-next-line vue/no-v-html -- icône de la bibliothèque intégrée (attributs échappés). -->
            <svg v-if="element.icon.startsWith('lucide:')" :x="element.x" :y="element.y" :width="element.w" :height="element.h" viewBox="0 0 24 24" :fill="element.fill ? iconStroke(element) : 'none'" :fill-opacity="element.fill === 'tint' ? 0.22 : undefined" :stroke="iconStroke(element)" :stroke-width="element.stroke" stroke-linecap="round" stroke-linejoin="round" v-html="libraryMarkup(element.icon)"></svg>
            <image v-else-if="element.color === 'default'" :href="customIconUrl(element)" :x="element.x" :y="element.y" :width="element.w" :height="element.h" preserveAspectRatio="xMidYMid meet" />
            <foreignObject v-else :x="element.x" :y="element.y" :width="element.w" :height="element.h">
              <div class="icon-mask" :style="{ maskImage: `url(${customIconUrl(element)})`, WebkitMaskImage: `url(${customIconUrl(element)})`, backgroundColor: iconStroke(element) }"></div>
            </foreignObject>
          </g>

          <g v-else-if="element.type === 'mockup'" :data-id="element.id" class="el mockup" :class="{ selected: outlined.has(element.id), hover: hoverId === element.id }" :transform="`translate(${element.x},${element.y})`">
            <rect class="mockup-hit" :width="element.w" :height="element.h" />
            <!-- eslint-disable-next-line vue/no-v-html -- dessin construit par mockupSvg, textes échappés. -->
            <g v-if="editingId !== element.id || !MOCKUP_SPECS[element.kind].edit" class="mockup-body" v-html="mockupMarkup(element)"></g>
          </g>

          <g v-else-if="element.type === 'image'" :data-id="element.id" class="el image" :class="{ selected: outlined.has(element.id) }">
            <rect class="image-back" :x="element.x" :y="element.y" :width="element.w" :height="element.h" rx="4" />
            <image :href="boardAssetUrl(element.asset)" :x="element.x" :y="element.y" :width="element.w" :height="element.h" preserveAspectRatio="xMidYMid meet" />
          </g>
        </template>

        </g>

        <!-- Historique : ce que la version affichée ajoute (vert) ou modifie (orange) -->
        <rect
          v-for="mark in changeMarks"
          :key="`c${mark.id}`"
          class="change-mark"
          :class="mark.kind"
          :x="mark.bounds.x - 6 / view.zoom"
          :y="mark.bounds.y - 6 / view.zoom"
          :width="mark.bounds.w + 12 / view.zoom"
          :height="mark.bounds.h + 12 / view.zoom"
          :rx="8 / view.zoom"
          :stroke-width="2 / view.zoom"
        />

        <!-- Copies de modèles : nom au survol, point quand le modèle a changé -->
        <g v-for="mark in instanceMarks" :key="`i${mark.inst}`" class="instance-mark" :class="mark.state">
          <rect v-if="mark.shown" class="instance-frame" :x="mark.frame.x - 10 / view.zoom" :y="mark.frame.y - 10 / view.zoom" :width="mark.frame.w + 20 / view.zoom" :height="mark.frame.h + 20 / view.zoom" :rx="6 / view.zoom" :stroke-width="1.5 / view.zoom" :stroke-dasharray="`${5 / view.zoom} ${4 / view.zoom}`" />
          <foreignObject v-if="mark.shown" :x="mark.frame.x - 10 / view.zoom" :y="mark.frame.y + mark.frame.h + 12 / view.zoom" :width="320 / view.zoom" :height="24 / view.zoom">
            <div class="instance-tag" :style="{ transform: `scale(${1 / view.zoom})` }"><i class="pi pi-clone"></i> {{ mark.name }} · {{ $t(STATE_LABELS[mark.state]) }}</div>
          </foreignObject>
          <circle v-if="mark.state === 'outdated'" class="instance-dot" :cx="mark.frame.x + mark.frame.w + 10 / view.zoom" :cy="mark.frame.y - 10 / view.zoom" :r="5 / view.zoom" />
        </g>

        <!-- Groupes : un cadre autour de tout le groupe -->
        <template v-if="!editing">
          <rect
            v-for="mark in groupBoxes"
            :key="`g${mark.group}`"
            class="group-box"
            :class="mark.state"
            :x="mark.bounds.x - 8 / view.zoom"
            :y="mark.bounds.y - 8 / view.zoom"
            :width="mark.bounds.w + 16 / view.zoom"
            :height="mark.bounds.h + 16 / view.zoom"
            :rx="6 / view.zoom"
            :stroke-width="1.5 / view.zoom"
            :stroke-dasharray="`${6 / view.zoom} ${4 / view.zoom}`"
          />
        </template>

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
            <rect
              v-for="handle in segmentHandles"
              :key="`s${handle.index}`"
              v-tooltip.top="handle.mode === 'shift' ? $t('Glisser pour décaler ce segment') : $t('Glisser pour ajouter un point de passage')"
              class="segment-handle"
              :class="[handle.mode, { horizontal: handle.horizontal }]"
              :data-seg="handle.index"
              :x="handle.x - 5 / view.zoom"
              :y="handle.y - 5 / view.zoom"
              :width="10 / view.zoom"
              :height="10 / view.zoom"
              :rx="handle.mode === 'add' ? 5 / view.zoom : 2 / view.zoom"
              :stroke-width="1.5 / view.zoom"
            />
            <circle
              v-for="(point, at) in single.waypoints ?? []"
              :key="`w${at}`"
              v-tooltip.top="$t('Point de passage : glisser pour le déplacer, double-clic pour le retirer')"
              class="waypoint-handle"
              :data-wp="at"
              :cx="point.x"
              :cy="point.y"
              :r="5.5 / view.zoom"
              :stroke-width="2 / view.zoom"
            />
            <circle class="end-handle" data-end="from" :cx="geometry(single).start.x" :cy="geometry(single).start.y" :r="6 / view.zoom" :stroke-width="2 / view.zoom" />
            <circle class="end-handle" data-end="to" :cx="geometry(single).end.x" :cy="geometry(single).end.y" :r="6 / view.zoom" :stroke-width="2 / view.zoom" />
          </template>
        </template>

        <!-- Accroche précise visée -->
        <circle v-if="attachMark" class="attach-mark" :cx="attachMark.x" :cy="attachMark.y" :r="5 / view.zoom" :stroke-width="2 / view.zoom" />

        <!-- Points d'accroche au survol -->
        <template v-if="hovered">
          <circle v-for="side in sides" :key="side" class="link-dot" :data-dot="side" :data-of="hovered.id" :cx="dotPoint(hovered, side).x" :cy="dotPoint(hovered, side).y" :r="6 / view.zoom" :stroke-width="2 / view.zoom" />
        </template>
        <!-- Ceux de la forme sélectionnée restent affichés, par-dessus ceux du survol -->
        <template v-if="pinned">
          <circle v-for="side in sides" :key="side" class="link-dot pinned" :data-dot="side" :data-of="pinned.id" :cx="dotPoint(pinned, side).x" :cy="dotPoint(pinned, side).y" :r="6 / view.zoom" :stroke-width="2 / view.zoom" />
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

    <BoardToolbar v-model:mode="mode" v-model:tool="tool" v-model:shape="shapeKind" v-model:mockup="mockupKind" v-model:sticky-color="stickyColor" v-model:pen-color="penColor" class="board-ui" :editable="editable" @import="openImport" @fast="pickerOpen = true" @quick="(tab) => openQuick(null, tab)" @pick="addQuick" />

    <BoardSelectionBar
      v-if="toolbarScreen && selected.length && !busy"
      ref="selectionBar"
      class="board-ui"
      :style="{ left: `${toolbarScreen.x}px`, top: `${toolbarScreen.y}px` }"
      :elements="selected"
      :editable="editable"
      :template="selectedInstance"
      :can-template="templatesOn"
      :can-group="grouping.canGroup"
      :can-ungroup="grouping.canUngroup"
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

    <!-- Suivi d'une personne : cadre à sa couleur et rappel, tant que l'on ne reprend pas la main -->
    <template v-if="followed">
      <div class="follow-frame" :style="{ '--follow': followed.color }"></div>
      <FollowPill class="follow-banner board-ui" :name="followed.name" :color="followed.color" @stop="follow = null" />
    </template>

    <div class="zoom board-ui">
      <button v-tooltip.top="$t('Annuler (Ctrl Z)')" type="button" :disabled="!model.canUndo.value || !editable" :aria-label="$t('Annuler')" @click="model.undo()"><i class="pi pi-undo"></i></button>
      <button v-tooltip.top="$t('Rétablir (Ctrl Y)')" type="button" :disabled="!model.canRedo.value || !editable" :aria-label="$t('Rétablir')" @click="model.redo()"><i class="pi pi-refresh"></i></button>
      <button v-if="history" v-tooltip.top="$t('Historique : parcourir les versions du tableau')" type="button" :aria-label="$t('Historique')" @click="emit('history')"><i class="pi pi-history"></i></button>
      <span class="sep"></span>
      <button v-tooltip.top="$t('Dézoomer')" type="button" :aria-label="$t('Dézoomer')" @click="zoomOut"><i class="pi pi-minus"></i></button>
      <button v-tooltip.top="$t('Zoom à 100 %')" type="button" class="percent" @click="zoomAt(1, { x: size.width / 2, y: size.height / 2 })">{{ percent }}</button>
      <button v-tooltip.top="$t('Zoomer')" type="button" :aria-label="$t('Zoomer')" @click="zoomIn"><i class="pi pi-plus"></i></button>
      <button v-tooltip.top="$t('Ajuster à l’écran (Maj 1)')" type="button" :aria-label="$t('Ajuster à l’écran')" @click="fit()"><i class="pi pi-expand"></i></button>
    </div>

    <div v-if="!session.synced.value" class="loading board-ui"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</div>
    <div v-else-if="!elements.length && editable" class="empty-hint">
      <p>{{ mode === 'sticky' ? $t('Double-cliquez pour poser un post-it.') : mode === 'mind' ? $t('Double-cliquez pour commencer une carte mentale, puis Tab pour un enfant et Entrée pour un frère.') : mode === 'draw' ? $t('Choisissez le crayon pour dessiner à main levée.') : mode === 'mockup' ? $t('Choisissez un composant (W) puis cliquez pour le poser : écrans, boutons, champs, onglets…') : $t('Double-cliquez pour créer une forme, tirez ses points bleus pour la relier.') }}</p>
      <p class="muted small">{{ $t('Collez un diagramme Mermaid pour l’importer.') }}</p>
    </div>

    <ContextMenu ref="menu" :model="menuItems" />
    <BoardDrawioDialog v-model:visible="drawioOpen" :text="drawioText" :z-start="model.nextZ()" :busy="drawioBusy" :can-upload="Boolean(spaceId)" @import="importDrawio" />
    <BoardExportDialog
      v-model:visible="imageExportOpen"
      :selection-count="selected.length"
      :busy="exportBusy"
      :preview="exportPreview"
      @preview="previewExport"
      @export="exportImage"
      @copy="copyImage"
      @mermaid="
        imageExportOpen = false;
        openExport();
      "
    />
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
  box-sizing: border-box;
  height: 30px;
  transform-origin: 0 0;
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
.connector .line.scaled {
  vector-effect: none;
}
.connector.dashed .line {
  stroke-dasharray: 6 5;
}
.arrow-head {
  fill: var(--el-stroke);
}
.connector .line.flowing {
  stroke-opacity: 0.25;
}
.connector-anim {
  pointer-events: none;
}
.anim-flow,
.anim-comet,
.anim-pulse {
  fill: none;
  stroke: var(--el-stroke);
  stroke-linecap: round;
}
.anim-pulse {
  stroke-opacity: 0;
}
.anim-dot {
  fill: var(--el-stroke);
}
@media (prefers-reduced-motion: reduce) {
  .connector-anim {
    display: none;
  }
  .connector .line.flowing {
    stroke-opacity: 1;
  }
}
.change-mark {
  fill: none;
  pointer-events: none;
}
.change-mark.added {
  stroke: #16a34a;
  fill: rgb(22 163 74 / 0.08);
}
.change-mark.changed {
  stroke: #f59e0b;
  stroke-dasharray: 6 4;
}
.segment-handle {
  fill: var(--board-canvas);
  stroke: var(--board-select);
  cursor: move;
}
.segment-handle.shift {
  cursor: ew-resize;
}
.segment-handle.shift.horizontal {
  cursor: ns-resize;
}
.segment-handle.add {
  fill: var(--board-select);
  fill-opacity: 0.35;
  cursor: copy;
}
.waypoint-handle {
  fill: var(--board-select);
  stroke: var(--board-canvas);
  cursor: move;
}
.attach-mark {
  fill: var(--board-select);
  stroke: var(--board-canvas);
  pointer-events: none;
}
.connector.selected .arrow-head {
  fill: var(--board-select);
}
.block-outline {
  fill: var(--el-stroke);
  stroke: var(--el-stroke);
  stroke-linejoin: round;
}
path.block-outline,
path.block-fill {
  fill: none;
}
.block-fill {
  fill: var(--el-fill);
  stroke: var(--el-fill);
  stroke-linejoin: round;
}
polygon.block-fill {
  stroke: none;
}
.connector.selected .block-outline {
  fill: var(--board-select);
  stroke: var(--board-select);
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
.follow-frame {
  position: absolute;
  inset: 0;
  z-index: 6;
  border: 3px solid var(--follow);
  pointer-events: none;
}
.follow-banner {
  position: absolute;
  top: 0.6rem;
  left: 50%;
  z-index: 7;
  width: max-content;
  transform: translateX(-50%);
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
.mockup-hit {
  fill: transparent;
}
.mockup.selected .mockup-hit,
.mockup.hover .mockup-hit {
  stroke: var(--board-select);
  stroke-width: 1.5;
  stroke-dasharray: 4 3;
  vector-effect: non-scaling-stroke;
}
.mockup.selected .mockup-hit {
  stroke-dasharray: none;
}
.mockup-body {
  pointer-events: none;
}
.image.selected .image-back {
  fill: var(--board-select);
  fill-opacity: 0.06;
}
.group-box {
  fill: none;
  stroke: var(--board-select);
  pointer-events: none;
}
.group-box.entered {
  opacity: 0.55;
}
.group-box.hover {
  opacity: 0.4;
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
.edit-el-mockup {
  align-items: flex-start;
  border: 1px dashed var(--board-select);
  border-radius: 6px;
  background: var(--board-default-fill);
}
.edit-el-mockup .edit-text {
  padding: 6px 10px;
  font-size: 14px;
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
