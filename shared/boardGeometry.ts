import type { BoardElement, ConnectorElement, ConnectorEnd, ConnectorJump, ConnectorWeight, MindElement, PlacedElement, ShapeKind, Side } from './boards.ts';
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

/** Point d'accroche sur un côté : au milieu, ou à la position `t` (de 0, en haut ou à gauche, à 1). */
export function anchor(rect: Rect, side: Side, t = 0.5): Point {
  switch (side) {
    case 'top':
      return { x: rect.x + rect.w * t, y: rect.y };
    case 'right':
      return { x: rect.x + rect.w, y: rect.y + rect.h * t };
    case 'bottom':
      return { x: rect.x + rect.w * t, y: rect.y + rect.h };
    case 'left':
      return { x: rect.x, y: rect.y + rect.h * t };
  }
}

/** Accroche sur le contour réel d'une ellipse ou d'un losange (sinon, sur le cadre). */
export function anchorOf(element: PlacedElement, side: Side, t = 0.5): Point {
  const point = anchor(element, side, t);
  if (element.type !== 'shape' || (element.shape !== 'ellipse' && element.shape !== 'diamond') || t === 0.5) return point;
  const c = center(element);
  const dx = point.x - c.x;
  const dy = point.y - c.y;
  const a = element.w / 2 || 1;
  const b = element.h / 2 || 1;
  const k = element.shape === 'ellipse' ? 1 / Math.sqrt((dx / a) ** 2 + (dy / b) ** 2 || 1) : 1 / (Math.abs(dx) / a + Math.abs(dy) / b || 1);
  return { x: c.x + dx * k, y: c.y + dy * k };
}

/**
 * Accroche précise sous le pointeur, comme dans Whimsical : près d'un bord, le côté et la position le long de ce côté
 * (aimantée au milieu) ; au cœur de la forme, `null` (le lien choisit seul son côté).
 */
export function attachAt(rect: Rect, point: Point, snap = 10): { side: Side; t: number } | null {
  const u = (point.x - rect.x) / Math.max(rect.w, 1);
  const v = (point.y - rect.y) / Math.max(rect.h, 1);
  if (u > 0.25 && u < 0.75 && v > 0.25 && v < 0.75) return null;
  const distances: Array<[Side, number]> = [
    ['top', Math.abs(point.y - rect.y)],
    ['bottom', Math.abs(point.y - (rect.y + rect.h))],
    ['left', Math.abs(point.x - rect.x)],
    ['right', Math.abs(point.x - (rect.x + rect.w))],
  ];
  const side = distances.sort((a, b) => a[1] - b[1])[0]![0];
  const along = side === 'top' || side === 'bottom' ? u : v;
  const length = side === 'top' || side === 'bottom' ? rect.w : rect.h;
  let t = Math.min(0.98, Math.max(0.02, along));
  if (Math.abs(t - 0.5) * length < snap) t = 0.5;
  return { side, t: Math.round(t * 1000) / 1000 };
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
  return { point: anchorOf(element, side, end.side ? (end.t ?? 0.5) : 0.5), side };
}

/** Centre visé par l'autre extrémité (pour choisir le côté le plus proche). */
function aim(end: ConnectorEnd, index: ElementIndex): Point {
  const element = placedOf(index, end.id);
  return element ? center(element) : { x: end.x, y: end.y };
}

export interface ConnectorGeometry {
  d: string;
  /** Points qui englobent le tracé (sommets, et points de contrôle des courbes). */
  points: Point[];
  /** Le tracé en ligne brisée (une courbe est échantillonnée) : croisements, milieu, longueur. */
  line: Point[];
  /** Courbes de Bézier du tracé, pour un lien courbe. */
  curves: Array<[Point, Point, Point, Point]> | null;
  /** Points fixés par les formes (départ, arrivée et leur sortie) : rangs dans `line`, pour un lien droit ou coudé. */
  fixed: number[];
  /** Milieu du tracé (étiquette). */
  mid: Point;
  start: Point;
  end: Point;
  /** Angle (radians) de la pointe d'arrivée et de départ. */
  endAngle: number;
  startAngle: number;
}

const STUB = 24;
const isHorizontal = (side: Side): boolean => side === 'left' || side === 'right';

/** Tracé d'un lien : droit, coudé (angles droits) ou courbe, passant par ses points de passage. */
export function connectorGeometry(connector: ConnectorElement, index: ElementIndex): ConnectorGeometry {
  const via = connector.waypoints ?? [];
  const fromAim = via[0] ?? aim(connector.to, index);
  const toAim = via[via.length - 1] ?? aim(connector.from, index);
  const from = endPoint(connector.from, fromAim, index);
  const to = endPoint(connector.to, toAim, index);
  const start = from.point;
  const end = to.point;
  if (connector.route === 'curve') {
    const stops = [start, ...via, end];
    const tangents = stops.map((point, position): Point => {
      if (position === 0) {
        const length = Math.hypot(stops[1]!.x - point.x, stops[1]!.y - point.y);
        const n = from.side ? NORMALS[from.side] : unit(point, stops[1]!);
        // Sans point de passage, le même tracé qu'avant : une poignée à 1/2,5 de la distance (40 au moins).
        const reach = via.length ? length * 1.2 : Math.max(40, length / 2.5) * 3;
        return { x: n.x * reach, y: n.y * reach };
      }
      if (position === stops.length - 1) {
        const previous = stops[position - 1]!;
        const length = Math.hypot(point.x - previous.x, point.y - previous.y);
        const n = to.side ? NORMALS[to.side] : unit(point, previous);
        const reach = via.length ? length * 1.2 : Math.max(40, length / 2.5) * 3;
        return { x: -n.x * reach, y: -n.y * reach };
      }
      const previous = stops[position - 1]!;
      const next = stops[position + 1]!;
      return { x: (next.x - previous.x) / 2, y: (next.y - previous.y) / 2 };
    });
    const curves = stops.slice(1).map((point, position): [Point, Point, Point, Point] => {
      const a = stops[position]!;
      const ta = tangents[position]!;
      const tb = tangents[position + 1]!;
      return [a, { x: a.x + ta.x / 3, y: a.y + ta.y / 3 }, { x: point.x - tb.x / 3, y: point.y - tb.y / 3 }, point];
    });
    const line = sampleCurves(curves);
    const first = curves[0]!;
    const last = curves[curves.length - 1]!;
    return {
      d: curvesPath(curves),
      points: curves.flatMap((curve, position) => (position ? curve.slice(1) : curve)),
      line,
      curves,
      fixed: [0, line.length - 1],
      mid: curves.length === 1 ? cubicPoint(first[0], first[1], first[2], first[3], 0.5) : polylineMid(line),
      start,
      end,
      endAngle: Math.atan2(end.y - last[2].y, end.x - last[2].x),
      startAngle: Math.atan2(start.y - first[1].y, start.x - first[1].x),
    };
  }
  const points = connector.route === 'elbow' ? (via.length ? elbowThrough(start, from.side, via, end, to.side) : elbow(start, from.side, end, to.side)) : [start, ...via, end];
  const fixed = [0, points.length - 1];
  if (connector.route === 'elbow') {
    if (from.side && points.length > 2) fixed.push(1);
    if (to.side && points.length > 2) fixed.push(points.length - 2);
  }
  const last = points[points.length - 2]!;
  return {
    d: points.map((point, position) => `${position ? 'L' : 'M'}${round(point.x)},${round(point.y)}`).join(' '),
    points,
    line: points,
    curves: null,
    fixed: [...new Set(fixed)].sort((a, b) => a - b),
    mid: polylineMid(points),
    start,
    end,
    endAngle: Math.atan2(end.y - last.y, end.x - last.x),
    startAngle: Math.atan2(start.y - points[1]!.y, start.x - points[1]!.x),
  };
}

const curvesPath = (curves: ReadonlyArray<readonly [Point, Point, Point, Point]>): string =>
  curves
    .map(([a, b, c, d], position) => `${position ? '' : `M${round(a.x)},${round(a.y)} `}C${round(b.x)},${round(b.y)} ${round(c.x)},${round(c.y)} ${round(d.x)},${round(d.y)}`)
    .join(' ');

function sampleCurves(curves: ReadonlyArray<readonly [Point, Point, Point, Point]>): Point[] {
  const line: Point[] = [curves[0]![0]];
  for (const [a, b, c, d] of curves) for (let step = 1; step <= 16; step += 1) line.push(cubicPoint(a, b, c, d, step / 16));
  return line;
}

/** Itinéraire à angles droits qui passe par des points choisis : un coude là où deux points ne sont pas alignés. */
function elbowThrough(start: Point, startSide: Side | null, via: ReadonlyArray<Point>, end: Point, endSide: Side | null): Point[] {
  const s1 = startSide ? { x: start.x + NORMALS[startSide].x * STUB, y: start.y + NORMALS[startSide].y * STUB } : null;
  const e1 = endSide ? { x: end.x + NORMALS[endSide].x * STUB, y: end.y + NORMALS[endSide].y * STUB } : null;
  const route: Point[] = [start];
  if (s1) route.push(s1);
  let horizontal: boolean | null = startSide ? isHorizontal(startSide) : null;
  const goTo = (target: Point, arriveHorizontal: boolean | null): void => {
    const from = route[route.length - 1]!;
    const aligned = Math.abs(target.x - from.x) < 0.5 || Math.abs(target.y - from.y) < 0.5;
    if (!aligned) {
      // Arrivée imposée (sortie de la forme d'arrivée), sinon on tourne par rapport au segment précédent.
      const vertical = arriveHorizontal === null ? horizontal === true : !arriveHorizontal;
      route.push(vertical ? { x: from.x, y: target.y } : { x: target.x, y: from.y });
    }
    const previous = route[route.length - 1]!;
    horizontal = Math.abs(target.y - previous.y) < 0.5;
    route.push(target);
  };
  for (const point of via) goTo(point, null);
  if (e1) goTo(e1, !isHorizontal(endSide!));
  goTo(end, null);
  return simplify(route);
}

/** Retire les points en double et ceux alignés entre leurs voisins. */
function simplify(points: Point[]): Point[] {
  const distinct = points.filter((point, position) => {
    const previous = points[position - 1];
    return !previous || Math.abs(previous.x - point.x) > 0.5 || Math.abs(previous.y - point.y) > 0.5;
  });
  return distinct.filter((point, position) => {
    if (position === 0 || position === distinct.length - 1) return true;
    const a = distinct[position - 1]!;
    const b = distinct[position + 1]!;
    return Math.abs((point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x)) > 0.5;
  });
}

/**
 * Décale un segment d'un lien coudé (comme dans Whimsical) : renvoie les nouveaux points de passage. Un bout fixé par
 * une forme reste en place et un coude le relie au segment déplacé.
 */
export function shiftSegment(geometry: ConnectorGeometry, segment: number, offset: number): Array<{ x: number; y: number }> {
  const line = geometry.line;
  const a = line[segment]!;
  const b = line[segment + 1]!;
  const horizontal = Math.abs(a.y - b.y) < 0.5;
  const move = (point: Point): Point => (horizontal ? { x: point.x, y: point.y + offset } : { x: point.x + offset, y: point.y });
  const fixed = new Set(geometry.fixed);
  const shifted = [...line.slice(0, segment), ...(fixed.has(segment) ? [a, move(a)] : [move(a)]), ...(fixed.has(segment + 1) ? [move(b), b] : [move(b)]), ...line.slice(segment + 2)];
  // Les points fixés (départ, arrivée et leurs sorties) se recalculent : seuls restent les points libres.
  const headFixed = geometry.fixed.filter((position) => position <= segment).length;
  const tailFixed = geometry.fixed.filter((position) => position > segment + 1).length;
  const free = shifted.slice(headFixed, shifted.length - tailFixed);
  return simplify([line[0]!, ...free, line[line.length - 1]!])
    .slice(1, -1)
    .map((point) => ({ x: round(point.x), y: round(point.y) }));
}

/** Point de passage ajouté sur un segment (lien droit ou courbe) : son rang dans la liste des points de passage. */
export function waypointRank(connector: ConnectorElement, geometry: ConnectorGeometry, point: Point): number {
  const stops = [geometry.start, ...(connector.waypoints ?? []), geometry.end];
  let best = 0;
  let bestDistance = Infinity;
  for (let position = 0; position + 1 < stops.length; position += 1) {
    const distance = distanceToSegment(point, stops[position]!, stops[position + 1]!);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = position;
    }
  }
  return best;
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

/** Longueur d'une ligne brisée. */
export function lineLength(line: ReadonlyArray<Point>): number {
  let total = 0;
  for (let position = 1; position < line.length; position += 1) total += Math.hypot(line[position]!.x - line[position - 1]!.x, line[position]!.y - line[position - 1]!.y);
  return total;
}

/** Croisements d'un tracé avec d'autres : pour chaque segment, les distances depuis son début. */
export function crossingsOf(line: ReadonlyArray<Point>, others: ReadonlyArray<ReadonlyArray<Point>>): Map<number, number[]> {
  const found = new Map<number, number[]>();
  for (let position = 0; position + 1 < line.length; position += 1) {
    const a = line[position]!;
    const b = line[position + 1]!;
    for (const other of others) {
      for (let index = 0; index + 1 < other.length; index += 1) {
        const hit = segmentIntersection(a, b, other[index]!, other[index + 1]!);
        if (hit === null) continue;
        const list = found.get(position) ?? [];
        list.push(hit * Math.hypot(b.x - a.x, b.y - a.y));
        found.set(position, list);
      }
    }
  }
  for (const list of found.values()) list.sort((x, y) => x - y);
  return found;
}

/** Position (0 à 1 sur ab) du croisement franc de ab et cd, ou `null`. */
function segmentIntersection(a: Point, b: Point, c: Point, d: Point): number | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denominator = r.x * s.y - r.y * s.x;
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denominator;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denominator;
  return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999 ? t : null;
}

/** Épaisseur du trait et taille des pointes (longueur, demi-largeur), en unités du tableau. */
export const CONNECTOR_WEIGHT_SPECS: Record<ConnectorWeight, { line: number; head: number; half: number; outline: number }> = {
  s: { line: 1.2, head: 9, half: 4, outline: 0 },
  m: { line: 1.8, head: 13, half: 5.5, outline: 0 },
  l: { line: 3.5, head: 18, half: 8, outline: 0 },
  xl: { line: 6, head: 26, half: 12, outline: 0 },
  block: { line: 16, head: 30, half: 20, outline: 2 },
};

export interface ConnectorStroke {
  /** Tracé raccourci aux pointes, pour que le trait épais ne dépasse pas de leur sommet ; avec ses sauts. */
  d: string;
  /** Pointes (triangles), en liste de points SVG. */
  heads: string[];
  line: number;
  outline: number;
}

/**
 * Ce qu'on dessine d'un lien : le trait et ses pointes, selon son épaisseur ; `crossings` (voir `crossingsOf`) place
 * les sauts d'un lien droit ou coudé qui en demande.
 */
export function connectorStroke(connector: ConnectorElement, geometry: ConnectorGeometry, crossings?: Map<number, number[]>): ConnectorStroke {
  const spec = CONNECTOR_WEIGHT_SPECS[connector.weight ?? 'm'];
  const trim = spec.head * (spec.outline ? 0.92 : 0.75);
  const heads: string[] = [];
  const head = (tip: Point, angle: number): string => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const base = { x: tip.x - cos * spec.head, y: tip.y - sin * spec.head };
    return [tip, { x: base.x - sin * spec.half, y: base.y + cos * spec.half }, { x: base.x + sin * spec.half, y: base.y - cos * spec.half }].map((point) => `${round(point.x)},${round(point.y)}`).join(' ');
  };
  if (connector.arrowEnd) heads.push(head(geometry.end, geometry.endAngle));
  if (connector.arrowStart) heads.push(head(geometry.start, geometry.startAngle));
  const startTrim = connector.arrowStart ? trim : 0;
  const endTrim = connector.arrowEnd ? trim : 0;
  const jumps = connector.jump && crossings?.size && !geometry.curves ? { style: connector.jump, crossings, radius: Math.max(6, spec.line * 1.8 + 4) } : null;
  return { d: trimmedPath(geometry, startTrim, endTrim, jumps), heads, line: spec.line, outline: spec.outline };
}

/** Le tracé d'un lien, raccourci de `startTrim` au départ et de `endTrim` à l'arrivée, avec ses sauts. */
function trimmedPath(geometry: ConnectorGeometry, startTrim: number, endTrim: number, jumps: { style: ConnectorJump; crossings: Map<number, number[]>; radius: number } | null): string {
  if (!startTrim && !endTrim && !jumps) return geometry.d;
  const point = (p: Point): string => `${round(p.x)},${round(p.y)}`;
  if (geometry.curves) {
    const curves = geometry.curves.map((curve) => curve.map((p) => ({ ...p })) as [Point, Point, Point, Point]);
    const first = curves[0]!;
    const last = curves[curves.length - 1]!;
    const a = Math.min(startTrim, Math.hypot(first[3].x - first[0].x, first[3].y - first[0].y) / 2.5);
    const b = Math.min(endTrim, Math.hypot(last[3].x - last[0].x, last[3].y - last[0].y) / 2.5);
    first[0] = { x: first[0].x - Math.cos(geometry.startAngle) * a, y: first[0].y - Math.sin(geometry.startAngle) * a };
    last[3] = { x: last[3].x - Math.cos(geometry.endAngle) * b, y: last[3].y - Math.sin(geometry.endAngle) * b };
    return curvesPath(curves);
  }
  const points = geometry.line.map((p) => ({ ...p }));
  const pull = (from: Point, toward: Point, distance: number): number => {
    const length = Math.hypot(toward.x - from.x, toward.y - from.y);
    const t = length ? Math.min(distance, length - 0.5) / length : 0;
    if (t <= 0) return 0;
    from.x += (toward.x - from.x) * t;
    from.y += (toward.y - from.y) * t;
    return t * length;
  };
  let pulledStart = 0;
  if (points.length >= 2) {
    if (startTrim) pulledStart = pull(points[0]!, points[1]!, startTrim);
    if (endTrim) pull(points[points.length - 1]!, points[points.length - 2]!, endTrim);
  }
  if (!jumps) return points.map((p, position) => `${position ? 'L' : 'M'}${point(p)}`).join(' ');
  const r = jumps.radius;
  let d = `M${point(points[0]!)}`;
  for (let position = 0; position + 1 < points.length; position += 1) {
    const a = points[position]!;
    const b = points[position + 1]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const dir = length ? { x: (b.x - a.x) / length, y: (b.y - a.y) / length } : { x: 1, y: 0 };
    // Bosse vers le haut sur un segment horizontal, vers la droite sur un segment vertical.
    const up = Math.abs(dir.x) > 0.01 ? (dir.x > 0 ? { x: dir.y, y: -dir.x } : { x: -dir.y, y: dir.x }) : { x: 1, y: 0 };
    const sweep = up.x * dir.y - up.y * dir.x > 0 ? 1 : 0;
    let cursor = -Infinity;
    for (const raw of jumps.crossings.get(position) ?? []) {
      const at = raw - (position === 0 ? pulledStart : 0);
      if (at - r < Math.max(cursor, 0) + 1 || at + r > length - 1) continue;
      const before = { x: a.x + dir.x * (at - r), y: a.y + dir.y * (at - r) };
      const after = { x: a.x + dir.x * (at + r), y: a.y + dir.y * (at + r) };
      if (jumps.style === 'arc') d += ` L${point(before)} A${round(r)},${round(r)} 0 0 ${sweep} ${point(after)}`;
      else if (jumps.style === 'gap') d += ` L${point(before)} M${point(after)}`;
      else d += ` L${point(before)} L${point({ x: a.x + dir.x * at + up.x * r * 1.2, y: a.y + dir.y * at + up.y * r * 1.2 })} L${point(after)}`;
      cursor = at + r;
    }
    d += ` L${point(b)}`;
  }
  return d;
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
