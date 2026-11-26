import type { Rect } from './boardGeometry.ts';

/**
 * Magnétisme du tableau blanc, façon Whimsical. En déplaçant ou en redimensionnant, les bords et le centre de ce qui
 * bouge s'alignent sur ceux des éléments voisins, et un élément se cale à égale distance de ses voisins (au milieu de
 * deux, ou au même écart que celui qui sépare les deux précédents) ; des traits de guidage le montrent. Sans alignement
 * à portée, la grille prend le relais.
 */

/** Trait de guidage, dans les coordonnées du tableau : `align` relie des bords ou des centres alignés, `gap` mesure un écart. */
export interface SnapGuide {
  kind: 'align' | 'gap';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SnapOptions {
  /** Distance d'attraction, en unités du tableau (quelques pixels à l'écran, divisés par le zoom). */
  threshold: number;
  /** Pas de la grille quand rien ne s'aligne ; 0 : pas de grille. */
  grid: number;
}

export const SNAP_LIMITS = {
  /** Distance d'attraction à l'écran, en pixels. */
  thresholdPx: 6,
  /** Seuls les éléments dans l'écran, élargi de cette proportion, servent de repères. */
  viewportMargin: 0.5,
} as const;

type Axis = 'x' | 'y';

const EPSILON = 0.5;
const start = (rect: Rect, axis: Axis): number => (axis === 'x' ? rect.x : rect.y);
const size = (rect: Rect, axis: Axis): number => (axis === 'x' ? rect.w : rect.h);
const end = (rect: Rect, axis: Axis): number => start(rect, axis) + size(rect, axis);
const lines = (rect: Rect, axis: Axis): number[] => [start(rect, axis), start(rect, axis) + size(rect, axis) / 2, end(rect, axis)];
const other = (axis: Axis): Axis => (axis === 'x' ? 'y' : 'x');
/** Les deux rectangles se recouvrent sur cet axe (ils sont « en face » l'un de l'autre sur l'axe opposé). */
const facing = (a: Rect, b: Rect, axis: Axis): boolean => start(a, axis) < end(b, axis) && start(b, axis) < end(a, axis);

interface Candidate {
  /** Décalage à ajouter à la position brute. */
  offset: number;
  /** Écarts égaux trouvés : les segments à mesurer. */
  gaps?: Array<{ from: number; to: number }>;
}

/** Meilleur alignement d'une des lignes qui bougent sur une ligne d'un voisin, à portée. */
function alignment(moving: number[], others: readonly Rect[], axis: Axis, threshold: number): Candidate | null {
  let best: Candidate | null = null;
  for (const rect of others) {
    for (const target of lines(rect, axis)) {
      for (const line of moving) {
        const offset = target - line;
        if (Math.abs(offset) <= threshold && (!best || Math.abs(offset) < Math.abs(best.offset))) best = { offset };
      }
    }
  }
  return best;
}

/** Voisin le plus proche avant (`-1`) ou après (`1`) la boîte, en face d'elle sur l'autre axe. */
function neighbour(box: Rect, others: readonly Rect[], axis: Axis, side: -1 | 1, slack: number): Rect | null {
  let best: Rect | null = null;
  for (const rect of others) {
    if (!facing(rect, box, other(axis))) continue;
    if (side < 0 ? end(rect, axis) <= start(box, axis) + slack && (!best || end(rect, axis) > end(best, axis)) : start(rect, axis) >= end(box, axis) - slack && (!best || start(rect, axis) < start(best, axis))) best = rect;
  }
  return best;
}

/** Écart égal : au milieu des deux voisins, ou au même écart que celui qui sépare un voisin du suivant. */
function spacing(box: Rect, others: readonly Rect[], axis: Axis, threshold: number): Candidate | null {
  const before = neighbour(box, others, axis, -1, threshold);
  const after = neighbour(box, others, axis, 1, threshold);
  const candidates: Candidate[] = [];
  if (before && after) {
    const gap = (start(after, axis) - end(before, axis) - size(box, axis)) / 2;
    if (gap >= 0) {
      const at = end(before, axis) + gap;
      candidates.push({ offset: at - start(box, axis), gaps: [{ from: end(before, axis), to: at }, { from: at + size(box, axis), to: start(after, axis) }] });
    }
  }
  if (before) {
    const previous = neighbour(before, others.filter((rect) => rect !== before), axis, -1, 0);
    const gap = previous ? start(before, axis) - end(previous, axis) : -1;
    if (previous && gap >= 0) {
      const at = end(before, axis) + gap;
      candidates.push({ offset: at - start(box, axis), gaps: [{ from: end(previous, axis), to: start(before, axis) }, { from: end(before, axis), to: at }] });
    }
  }
  if (after) {
    const next = neighbour(after, others.filter((rect) => rect !== after), axis, 1, 0);
    const gap = next ? start(next, axis) - end(after, axis) : -1;
    if (next && gap >= 0) {
      const at = start(after, axis) - gap - size(box, axis);
      candidates.push({ offset: at - start(box, axis), gaps: [{ from: at + size(box, axis), to: start(after, axis) }, { from: end(after, axis), to: start(next, axis) }] });
    }
  }
  let best: Candidate | null = null;
  for (const candidate of candidates) if (Math.abs(candidate.offset) <= threshold && (!best || Math.abs(candidate.offset) < Math.abs(best.offset))) best = candidate;
  return best;
}

/** Traits des alignements exacts d'une boîte avec ses voisins (lignes `which` de la boîte : début, centre, fin). */
function alignGuides(box: Rect, others: readonly Rect[], axis: Axis, which: readonly number[] = [0, 1, 2]): SnapGuide[] {
  const across = other(axis);
  const guides: SnapGuide[] = [];
  const moving = lines(box, axis);
  for (const index of which) {
    const line = moving[index]!;
    let from = start(box, across);
    let to = end(box, across);
    let found = false;
    for (const rect of others) {
      if (!lines(rect, axis).some((target) => Math.abs(target - line) < EPSILON)) continue;
      found = true;
      from = Math.min(from, start(rect, across));
      to = Math.max(to, end(rect, across));
    }
    if (found) guides.push(axis === 'x' ? { kind: 'align', x1: line, y1: from, x2: line, y2: to } : { kind: 'align', x1: from, y1: line, x2: to, y2: line });
  }
  return guides;
}

/** Traits des écarts égaux, au milieu de la boîte sur l'autre axe. */
function gapGuides(box: Rect, axis: Axis, gaps: Array<{ from: number; to: number }>): SnapGuide[] {
  const middle = start(box, other(axis)) + size(box, other(axis)) / 2;
  return gaps.map(({ from, to }) => (axis === 'x' ? { kind: 'gap', x1: from, y1: middle, x2: to, y2: middle } : { kind: 'gap', x1: middle, y1: from, x2: middle, y2: to }));
}

const gridded = (value: number, grid: number): number => (grid > 0 ? Math.round(value / grid) * grid : value);

/**
 * Déplacement de `box` (ce qui bouge, à sa position de départ) de `dx`, `dy` : le déplacement retenu (aligné sur un
 * voisin, à écart égal, ou sur la grille) et les traits à montrer.
 */
export function snapMove(box: Rect, dx: number, dy: number, others: readonly Rect[], options: SnapOptions): { dx: number; dy: number; guides: SnapGuide[] } {
  const result = { dx, dy };
  const gaps: Partial<Record<Axis, Array<{ from: number; to: number }>>> = {};
  // Là où le pointeur amène la boîte, sur les deux axes : les voisins « en face » se cherchent depuis cette place.
  const moved = { ...box, x: box.x + dx, y: box.y + dy };
  for (const axis of ['x', 'y'] as const) {
    const raw = axis === 'x' ? dx : dy;
    const align = alignment(lines(moved, axis), others, axis, options.threshold);
    const space = spacing(moved, others, axis, options.threshold);
    // À distance égale, l'alignement l'emporte sur l'écart.
    const best = align && (!space || Math.abs(align.offset) <= Math.abs(space.offset)) ? align : space;
    const value = best ? raw + best.offset : gridded(raw, options.grid);
    if (best?.gaps) gaps[axis] = best.gaps;
    if (axis === 'x') result.dx = value;
    else result.dy = value;
  }
  const final = { ...box, x: box.x + result.dx, y: box.y + result.dy };
  const guides = [...alignGuides(final, others, 'x'), ...alignGuides(final, others, 'y')];
  if (gaps.x) guides.push(...gapGuides(final, 'x', gaps.x));
  if (gaps.y) guides.push(...gapGuides(final, 'y', gaps.y));
  return { ...result, guides };
}

/**
 * Redimensionnement par la poignée `handle` (`n`, `se`…) : `rect` est la taille brute demandée ; les bords qui bougent
 * s'alignent sur les voisins (ou la grille), sans descendre sous `min`.
 */
export function snapResize(rect: Rect, handle: string, others: readonly Rect[], options: SnapOptions & { min: number }): { rect: Rect; guides: SnapGuide[] } {
  const next = { ...rect };
  const aligned: Array<{ axis: Axis; which: number }> = [];
  for (const axis of ['x', 'y'] as const) {
    const low = axis === 'x' ? handle.includes('w') : handle.includes('n');
    const high = axis === 'x' ? handle.includes('e') : handle.includes('s');
    const key = axis === 'x' ? ('x' as const) : ('y' as const);
    const span = axis === 'x' ? ('w' as const) : ('h' as const);
    if (!low && !high) {
      next[key] = gridded(next[key], options.grid);
      next[span] = gridded(next[span], options.grid);
      continue;
    }
    const edge = low ? next[key] : next[key] + next[span];
    const align = alignment([edge], others, axis, options.threshold);
    let snapped = align ? edge + align.offset : null;
    // Sans voisin à portée : la grille, comme avant.
    if (snapped === null) {
      next[key] = gridded(next[key], options.grid);
      next[span] = gridded(next[span], options.grid);
      if (low) next[span] = Math.max(options.min, gridded(rect[key] + rect[span], options.grid) - next[key]);
      continue;
    }
    const opposite = low ? next[key] + next[span] : next[key];
    if (Math.abs(opposite - snapped) < options.min) snapped = null;
    if (snapped === null) continue;
    if (low) {
      next[key] = snapped;
      next[span] = opposite - snapped;
    } else {
      next[span] = snapped - next[key];
    }
    aligned.push({ axis, which: low ? 0 : 2 });
  }
  return { rect: next, guides: aligned.flatMap(({ axis, which }) => alignGuides(next, others, axis, [which])) };
}
