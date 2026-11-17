import * as Y from 'yjs';
import {
  BOARD_COLORS,
  BOARD_LIMITS,
  CHART_KINDS,
  CONNECTOR_ROUTES,
  FILL_STYLES,
  SHAPE_KINDS,
  TEXT_SIZES,
  type BoardColor,
  type BoardElement,
  type ConnectorEnd,
  type FastRefKind,
  type Side,
  type TemplateLink,
} from '../../shared/boards.ts';

/**
 * Éléments d'un tableau tels que le serveur les accepte : tout ce qui arrive (API, document Yjs écrit par un
 * navigateur) est relu ici, borné et nettoyé. Un élément illisible est écarté plutôt que de bloquer le tableau.
 */

type Raw = Record<string, unknown>;

const COORD = 1_000_000;
const num = (value: unknown, fallback: number, min = -COORD, max = COORD): number => {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, Math.round(number * 100) / 100));
};
const text = (value: unknown, max: number = BOARD_LIMITS.textMax): string => (typeof value === 'string' ? value.slice(0, max) : '');
const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
const color = (value: unknown): BoardColor => pick(value, BOARD_COLORS, 'default');
const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];
const FAST_KINDS: readonly FastRefKind[] = ['ticket', 'note', 'folder', 'space', 'board'];

function grid(value: unknown): string[][] {
  if (!Array.isArray(value)) return [['']];
  const rows = value.slice(0, 200).map((row) => (Array.isArray(row) ? row.slice(0, 50).map((cell) => text(cell, 500)) : ['']));
  const width = Math.max(1, ...rows.map((row) => row.length));
  if (rows.length * width > BOARD_LIMITS.tableCells) return [['']];
  return rows.length ? rows.map((row) => [...row, ...Array<string>(width - row.length).fill('')]) : [['']];
}

function end(value: unknown): ConnectorEnd {
  const raw = (value && typeof value === 'object' ? value : {}) as Raw;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 40) : null,
    side: SIDES.includes(raw.side as Side) ? (raw.side as Side) : null,
    x: num(raw.x, 0),
    y: num(raw.y, 0),
  };
}

const shortId = (value: unknown): string => (typeof value === 'string' ? value.slice(0, 40) : '');

/** Lien d'une copie avec son modèle ; absent s'il est incomplet. */
function templateLink(value: unknown): { tpl: TemplateLink } | Record<string, never> {
  if (!value || typeof value !== 'object') return {};
  const raw = value as Raw;
  const link = { id: raw.id, inst: shortId(raw.inst), key: shortId(raw.key), v: shortId(raw.v) };
  return Number.isInteger(link.id) && (link.id as number) > 0 && link.inst && link.key ? { tpl: link as TemplateLink } : {};
}

/** `lucide:nom` ou `custom:12`. */
const ICON_ID = /^(lucide:[a-z0-9-]{1,80}|custom:\d{1,9})$/;
/** Clé d'une image d'espace. */
const ASSET_KEY = /^[A-Za-z0-9_-]{16,64}$/;

/** Élément nettoyé, ou `null` s'il n'est pas reconnu. */
export function sanitizeElement(value: unknown): BoardElement | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Raw;
  const id = typeof raw.id === 'string' ? raw.id.slice(0, 40) : '';
  if (!id) return null;
  const z = num(raw.z, 0, -1e9, 1e9);
  const locked = { ...(raw.locked === true ? { locked: true } : {}), ...templateLink(raw.tpl) };
  if (raw.type === 'connector') {
    return {
      id,
      type: 'connector',
      z,
      from: end(raw.from),
      to: end(raw.to),
      label: text(raw.label, 500),
      route: pick(raw.route, CONNECTOR_ROUTES, 'elbow'),
      dashed: raw.dashed === true,
      arrowStart: raw.arrowStart === true,
      arrowEnd: raw.arrowEnd !== false,
      color: color(raw.color),
      ...locked,
    };
  }
  const box = { id, z, x: num(raw.x, 0), y: num(raw.y, 0), w: num(raw.w, 160, 4, 20_000), h: num(raw.h, 80, 4, 20_000), ...locked };
  switch (raw.type) {
    case 'shape':
      return { ...box, type: 'shape', shape: pick(raw.shape, SHAPE_KINDS, 'rect'), text: text(raw.text), color: color(raw.color), fill: pick(raw.fill, FILL_STYLES, 'solid'), size: pick(raw.size, TEXT_SIZES, 'm') };
    case 'text':
      return { ...box, type: 'text', text: text(raw.text), color: color(raw.color), size: pick(raw.size, TEXT_SIZES, 'm'), align: pick(raw.align, ['left', 'center', 'right'] as const, 'left') };
    case 'sticky':
      return { ...box, type: 'sticky', text: text(raw.text), color: pick(raw.color, BOARD_COLORS, 'yellow'), votes: Array.isArray(raw.votes) ? [...new Set(raw.votes.filter((vote): vote is number => Number.isInteger(vote)))].slice(0, 500) : [] };
    case 'frame':
      return { ...box, type: 'frame', title: text(raw.title, 200), color: color(raw.color) };
    case 'mind':
      return { ...box, type: 'mind', text: text(raw.text, 2000), color: color(raw.color), parent: typeof raw.parent === 'string' && raw.parent ? raw.parent.slice(0, 40) : null, direction: raw.direction === 'left' ? 'left' : 'right' };
    case 'path': {
      const points = Array.isArray(raw.points) ? raw.points.slice(0, BOARD_LIMITS.pathPoints * 2).map((point) => num(point, 0)) : [];
      return { ...box, type: 'path', points: points.length % 2 ? points.slice(0, -1) : points, color: color(raw.color), width: num(raw.width, 3, 1, 60), highlighter: raw.highlighter === true };
    }
    case 'fast': {
      const ref = (raw.ref && typeof raw.ref === 'object' ? raw.ref : {}) as Raw;
      if (!FAST_KINDS.includes(ref.kind as FastRefKind) || !Number.isInteger(ref.id)) return null;
      return { ...box, type: 'fast', ref: { kind: ref.kind as FastRefKind, id: ref.id as number }, label: text(raw.label, 300) };
    }
    case 'table':
      return { ...box, type: 'table', rows: grid(raw.rows), color: color(raw.color) };
    case 'icon': {
      const icon = typeof raw.icon === 'string' ? raw.icon : '';
      if (!ICON_ID.test(icon)) return null;
      return { ...box, type: 'icon', icon, color: color(raw.color), stroke: num(raw.stroke, 2, 0.5, 4) };
    }
    case 'image': {
      const asset = typeof raw.asset === 'string' ? raw.asset : '';
      if (!ASSET_KEY.test(asset)) return null;
      return { ...box, type: 'image', asset, name: text(raw.name, 200) };
    }
    case 'chart':
      return {
        ...box,
        type: 'chart',
        chart: pick(raw.chart, CHART_KINDS, 'bar'),
        title: text(raw.title, 200),
        source: typeof raw.source === 'string' && raw.source ? raw.source.slice(0, 40) : null,
        rows: grid(raw.rows),
      };
    default:
      return null;
  }
}

/** L'élément sans son lien de copie de modèle. */
export function withoutTemplateLink(element: BoardElement): BoardElement {
  if (!element.tpl) return element;
  const { tpl: _tpl, ...rest } = element;
  return rest as BoardElement;
}

/** Éléments nettoyés, dans l'ordre d'empilement, sans doublon d'identifiant et dans la limite. */
export function sanitizeElements(values: readonly unknown[]): BoardElement[] {
  const seen = new Set<string>();
  const elements: BoardElement[] = [];
  for (const value of values) {
    const element = sanitizeElement(value);
    if (!element || seen.has(element.id)) continue;
    seen.add(element.id);
    elements.push(element);
    if (elements.length >= BOARD_LIMITS.elements) break;
  }
  return elements.sort((a, b) => a.z - b.z);
}

// --- Document Yjs ------------------------------------------------------------------------------------------------------

export const ELEMENTS_KEY = 'elements';

/** Éléments d'un document Yjs (carte id → élément). */
export function elementsOf(doc: Y.Doc): BoardElement[] {
  const map = doc.getMap<unknown>(ELEMENTS_KEY);
  return sanitizeElements([...map.values()]);
}

/** Remplace les éléments d'un document en ne touchant que ce qui change. */
export function replaceElements(doc: Y.Doc, elements: readonly BoardElement[], origin: unknown): void {
  const map = doc.getMap<unknown>(ELEMENTS_KEY);
  const next = new Map(elements.map((element) => [element.id, element]));
  doc.transact(() => {
    for (const key of [...map.keys()]) if (!next.has(key)) map.delete(key);
    for (const [id, element] of next) {
      if (JSON.stringify(map.get(id)) !== JSON.stringify(element)) map.set(id, element);
    }
  }, origin);
}

/** Document Yjs d'un tableau : son état enregistré, sinon ses éléments (tableau créé par l'API ou dupliqué). */
export function boardDoc(state: Uint8Array | null, elements: readonly BoardElement[]): Y.Doc {
  const doc = new Y.Doc();
  if (state?.length) Y.applyUpdate(doc, new Uint8Array(state));
  else if (elements.length) replaceElements(doc, elements, 'server');
  return doc;
}

/** État Yjs à enregistrer pour une liste d'éléments. */
export function stateOf(elements: readonly BoardElement[]): Uint8Array {
  const doc = boardDoc(null, elements);
  const state = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return state;
}
