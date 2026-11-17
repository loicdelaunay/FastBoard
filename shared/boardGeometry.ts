import type { BoardElement, ConnectorElement, ConnectorEnd, MindElement, PlacedElement, ShapeKind, Side } from './boards.ts';
import { isPlaced } from './boards.ts';

/** Géométrie des tableaux blancs, commune à l'éditeur et à l'aperçu rendu par le serveur. */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const round = (value: number): number => Math.round(value * 10) / 10;

/** Contour d'une forme dans un rectangle w × h, en chemin SVG relatif à son coin. */
export function shapePath(shape: ShapeKind, w: number, h: number): string {
  switch (shape) {
    case 'rect':
      return `M0,0 H${w} V${h} H0 Z`;
    case 'rounded': {
      const r = round(Math.min(14, h / 3, w / 3));
      return `M${r},0 H${w - r} A${r},${r} 0 0 1 ${w},${r} V${h - r} A${r},${r} 0 0 1 ${w - r},${h} H${r} A${r},${r} 0 0 1 0,${h - r} V${r} A${r},${r} 0 0 1 ${r},0 Z`;
    }
    case 'ellipse':
      return `M0,${h / 2} A${w / 2},${h / 2} 0 1 1 ${w},${h / 2} A${w / 2},${h / 2} 0 1 1 0,${h / 2} Z`;
    case 'diamond':
      return `M${w / 2},0 L${w},${h / 2} L${w / 2},${h} L0,${h / 2} Z`;
    case 'parallelogram': {
      const skew = round(Math.min(w * 0.2, h * 0.6));
      return `M${skew},0 L${w},0 L${w - skew},${h} L0,${h} Z`;
    }
    case 'hexagon': {
      const inset = round(Math.min(w * 0.2, h * 0.5));
      return `M${inset},0 L${w - inset},0 L${w},${h / 2} L${w - inset},${h} L${inset},${h} L0,${h / 2} Z`;
    }
    case 'cylinder': {
      const ry = round(Math.min(h * 0.15, 14));
      return `M0,${ry} A${w / 2},${ry} 0 0 1 ${w},${ry} V${h - ry} A${w / 2},${ry} 0 0 1 0,${h - ry} Z M0,${ry} A${w / 2},${ry} 0 0 0 ${w},${ry}`;
    }
    case 'triangle':
      return `M${w / 2},0 L${w},${h} L0,${h} Z`;
  }
}

/** Zone où s'écrit le texte d'une forme (en retrait pour les losanges, triangles…). */
export function textBox(shape: ShapeKind, w: number, h: number): Rect {
  switch (shape) {
    case 'diamond':
      return { x: w * 0.2, y: h * 0.2, w: w * 0.6, h: h * 0.6 };
    case 'triangle':
      return { x: w * 0.22, y: h * 0.4, w: w * 0.56, h: h * 0.55 };
    case 'parallelogram':
    case 'hexagon':
      return { x: w * 0.15, y: 0, w: w * 0.7, h };
    case 'cylinder':
      return { x: 0, y: Math.min(h * 0.15, 14) * 2, w, h: h - Math.min(h * 0.15, 14) * 3 };
    case 'ellipse':
      return { x: w * 0.12, y: h * 0.12, w: w * 0.76, h: h * 0.76 };
    default:
      return { x: 0, y: 0, w, h };
  }
}

export const center = (rect: Rect): Point => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });

/** Point d'accroche au milieu d'un côté. */
export function anchor(rect: Rect, side: Side): Point {
  switch (side) {
    case 'top':
      return { x: rect.x + rect.w / 2, y: rect.y };
    case 'right':
      return { x: rect.x + rect.w, y: rect.y + rect.h / 2 };
    case 'bottom':
      return { x: rect.x + rect.w / 2, y: rect.y + rect.h };
    case 'left':
      return { x: rect.x, y: rect.y + rect.h / 2 };
  }
}

const NORMALS: Record<Side, Point> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };

/** Côté d'un rectangle tourné vers un point. */
export function sideToward(rect: Rect, toward: Point): Side {
  const c = center(rect);
  const dx = (toward.x - c.x) / Math.max(rect.w, 1);
  const dy = (toward.y - c.y) / Math.max(rect.h, 1);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

export type ElementIndex = ReadonlyMap<string, BoardElement>;

const placedOf = (index: ElementIndex, id: string | null): PlacedElement | null => {
  const element = id ? index.get(id) : undefined;
  return element && isPlaced(element) ? element : null;
};

/** Point de départ ou d'arrivée d'un lien, et le côté par lequel il sort. */
export function endPoint(end: ConnectorEnd, other: Point, index: ElementIndex): { point: Point; side: Side | null } {
  const element = placedOf(index, end.id);
  if (!element) return { point: { x: end.x, y: end.y }, side: null };
  const side = end.side ?? sideToward(element, other);
  return { point: anchor(element, side), side };
}

/** Centre visé par l'autre extrémité (pour choisir le côté le plus proche). */
function aim(end: ConnectorEnd, index: ElementIndex): Point {
  const element = placedOf(index, end.id);
  return element ? center(element) : { x: end.x, y: end.y };
}

export interface ConnectorGeometry {
  d: string;
  points: Point[];
  /** Milieu du tracé (étiquette). */
  mid: Point;
  start: Point;
  end: Point;
  /** Angle (radians) de la pointe d'arrivée et de départ. */
  endAngle: number;
  startAngle: number;
}

const STUB = 24;

/** Tracé d'un lien : droit, coudé (angles droits) ou courbe. */
export function connectorGeometry(connector: ConnectorElement, index: ElementIndex): ConnectorGeometry {
  const fromAim = aim(connector.from, index);
  const toAim = aim(connector.to, index);
  const from = endPoint(connector.from, toAim, index);
  const to = endPoint(connector.to, fromAim, index);
  const start = from.point;
  const end = to.point;
  if (connector.route === 'curve') {
    const distance = Math.max(40, Math.hypot(end.x - start.x, end.y - start.y) / 2.5);
    const n1 = from.side ? NORMALS[from.side] : unit(start, end);
    const n2 = to.side ? NORMALS[to.side] : unit(end, start);
    const c1 = { x: start.x + n1.x * distance, y: start.y + n1.y * distance };
    const c2 = { x: end.x + n2.x * distance, y: end.y + n2.y * distance };
    const mid = cubicPoint(start, c1, c2, end, 0.5);
    return {
      d: `M${round(start.x)},${round(start.y)} C${round(c1.x)},${round(c1.y)} ${round(c2.x)},${round(c2.y)} ${round(end.x)},${round(end.y)}`,
      points: [start, c1, c2, end],
      mid,
      start,
      end,
      endAngle: Math.atan2(end.y - c2.y, end.x - c2.x),
      startAngle: Math.atan2(start.y - c1.y, start.x - c1.x),
    };
  }
  const points = connector.route === 'elbow' ? elbow(start, from.side, end, to.side) : [start, end];
  const last = points[points.length - 2]!;
  return {
    d: points.map((point, position) => `${position ? 'L' : 'M'}${round(point.x)},${round(point.y)}`).join(' '),
    points,
    mid: polylineMid(points),
    start,
    end,
    endAngle: Math.atan2(end.y - last.y, end.x - last.x),
    startAngle: Math.atan2(start.y - points[1]!.y, start.x - points[1]!.x),
  };
}

function unit(a: Point, b: Point): Point {
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
}

function cubicPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/** Itinéraire à angles droits : on sort de chaque côté, puis on rejoint par le milieu. */
function elbow(start: Point, startSide: Side | null, end: Point, endSide: Side | null): Point[] {
  const horizontal = (side: Side | null, a: Point, b: Point): boolean => (side ? side === 'left' || side === 'right' : Math.abs(b.x - a.x) >= Math.abs(b.y - a.y));
  const s1 = startSide ? { x: start.x + NORMALS[startSide].x * STUB, y: start.y + NORMALS[startSide].y * STUB } : start;
  const e1 = endSide ? { x: end.x + NORMALS[endSide].x * STUB, y: end.y + NORMALS[endSide].y * STUB } : end;
  const route: Point[] = [start];
  if (startSide) route.push(s1);
  if (horizontal(startSide, start, end) && horizontal(endSide, end, start)) {
    const midX = (s1.x + e1.x) / 2;
    route.push({ x: midX, y: s1.y }, { x: midX, y: e1.y });
  } else if (!horizontal(startSide, start, end) && !horizontal(endSide, end, start)) {
    const midY = (s1.y + e1.y) / 2;
    route.push({ x: s1.x, y: midY }, { x: e1.x, y: midY });
  } else if (horizontal(startSide, start, end)) {
    route.push({ x: e1.x, y: s1.y });
  } else {
    route.push({ x: s1.x, y: e1.y });
  }
  if (endSide) route.push(e1);
  route.push(end);
  // Points en double ou alignés : inutiles.
  return route.filter((point, position) => {
    const previous = route[position - 1];
    return !previous || Math.abs(previous.x - point.x) > 0.5 || Math.abs(previous.y - point.y) > 0.5;
  });
}

function polylineMid(points: Point[]): Point {
  const lengths = points.slice(1).map((point, position) => Math.hypot(point.x - points[position]!.x, point.y - points[position]!.y));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
  for (let position = 0; position < lengths.length; position += 1) {
    const length = lengths[position]!;
    if (remaining <= length) {
      const a = points[position]!;
      const b = points[position + 1]!;
      const t = length ? remaining / length : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= length;
  }
  return points[points.length - 1]!;
}

/** Rectangle qui englobe des éléments (liens compris), ou `null`. */
export function boundsOf(elements: readonly BoardElement[], index?: ElementIndex): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const all = index ?? new Map(elements.map((element) => [element.id, element]));
  for (const element of elements) {
    if (isPlaced(element)) {
      minX = Math.min(minX, element.x);
      minY = Math.min(minY, element.y);
      maxX = Math.max(maxX, element.x + element.w);
      maxY = Math.max(maxY, element.y + element.h);
    } else {
      for (const point of connectorGeometry(element, all).points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
    }
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;
}

export const intersects = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export const contains = (outer: Rect, inner: Rect): boolean => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

// ---------------------------------------------------------------------------------------------------------------------
// Cartes mentales
// ---------------------------------------------------------------------------------------------------------------------

export const MIND_GAP_X = 56;
export const MIND_GAP_Y = 14;

/**
 * Positions des nœuds d'une carte mentale : chaque enfant à droite (ou à gauche) de son parent, les sous-arbres
 * empilés et centrés sur lui. Renvoie les nœuds qui doivent bouger.
 */
export function layoutMind(elements: readonly BoardElement[], rootId: string): Map<string, Point> {
  const nodes = elements.filter((element): element is MindElement => element.type === 'mind');
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, MindElement[]>();
  for (const node of nodes) {
    if (!node.parent || !byId.has(node.parent)) continue;
    children.set(node.parent, [...(children.get(node.parent) ?? []), node]);
  }
  for (const list of children.values()) list.sort((a, b) => a.y - b.y || a.z - b.z);
  const root = byId.get(rootId);
  const moves = new Map<string, Point>();
  if (!root) return moves;
  const heights = new Map<string, number>();
  const measure = (node: MindElement, seen: Set<string>): number => {
    if (seen.has(node.id)) return node.h;
    seen.add(node.id);
    const kids = children.get(node.id) ?? [];
    const total = kids.reduce((sum, kid, position) => sum + measure(kid, seen) + (position ? MIND_GAP_Y : 0), 0);
    const height = Math.max(node.h, total);
    heights.set(node.id, height);
    return height;
  };
  measure(root, new Set());
  const place = (node: MindElement, x: number, y: number, direction: 'right' | 'left', seen: Set<string>): void => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    if (node.id !== rootId && (Math.abs(node.x - x) > 0.5 || Math.abs(node.y - y) > 0.5)) moves.set(node.id, { x, y });
    const kids = children.get(node.id) ?? [];
    const total = kids.reduce((sum, kid, position) => sum + (heights.get(kid.id) ?? kid.h) + (position ? MIND_GAP_Y : 0), 0);
    let top = y + node.h / 2 - total / 2;
    for (const kid of kids) {
      const height = heights.get(kid.id) ?? kid.h;
      const kidX = direction === 'right' ? x + node.w + MIND_GAP_X : x - MIND_GAP_X - kid.w;
      place(kid, kidX, top + height / 2 - kid.h / 2, direction, seen);
      top += height + MIND_GAP_Y;
    }
  };
  place(root, root.x, root.y, root.direction, new Set());
  return moves;
}

/** Racine de la carte mentale d'un nœud. */
export function mindRoot(elements: ReadonlyMap<string, BoardElement>, id: string): MindElement | null {
  let node = elements.get(id);
  const seen = new Set<string>();
  while (node?.type === 'mind' && node.parent && !seen.has(node.id)) {
    seen.add(node.id);
    const parent = elements.get(node.parent);
    if (parent?.type !== 'mind') break;
    node = parent;
  }
  return node?.type === 'mind' ? node : null;
}

/** Tracé du lien d'un nœud de carte mentale vers son parent. */
export function mindLink(parent: MindElement, child: MindElement): string {
  const right = child.x >= parent.x + parent.w / 2;
  const start = right ? { x: parent.x + parent.w, y: parent.y + parent.h / 2 } : { x: parent.x, y: parent.y + parent.h / 2 };
  const end = right ? { x: child.x, y: child.y + child.h / 2 } : { x: child.x + child.w, y: child.y + child.h / 2 };
  const bend = (end.x - start.x) / 2;
  return `M${round(start.x)},${round(start.y)} C${round(start.x + bend)},${round(start.y)} ${round(end.x - bend)},${round(end.y)} ${round(end.x)},${round(end.y)}`;
}
