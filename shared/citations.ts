/**
 * Citations précises dans une mention : des lignes d'une note (`@[Guide](doc:12#L4-9)`, `#L4-9,15`) ou des éléments
 * d'un tableau blanc (`@[Architecture](board:7#el:a1b2c3,d4e5f6)`). Le suffixe se lit après le `#` de la mention ;
 * dans une adresse, il devient `?lines=4-9,15` ou `?elements=a1b2c3,d4e5f6`.
 */

export interface LineRange {
  from: number;
  to: number;
}

export const CITATION_LIMITS = {
  ranges: 20,
  line: 1_000_000,
  elements: 50,
} as const;

const RANGE = /^(\d{1,7})(?:-L?(\d{1,7}))?$/;
const ELEMENT = /^[A-Za-z0-9_-]{1,40}$/;

/** Plages de lignes, triées et fusionnées ; `null` si le texte n'en décrit aucune valide. */
function rangesOf(parts: string[]): LineRange[] | null {
  const ranges: LineRange[] = [];
  for (const part of parts.slice(0, CITATION_LIMITS.ranges)) {
    const match = RANGE.exec(part.trim());
    if (!match) return null;
    const a = Number(match[1]);
    const b = match[2] ? Number(match[2]) : a;
    if (a < 1 || b < 1 || a > CITATION_LIMITS.line || b > CITATION_LIMITS.line) return null;
    ranges.push({ from: Math.min(a, b), to: Math.max(a, b) });
  }
  if (!ranges.length) return null;
  ranges.sort((x, y) => x.from - y.from);
  const merged: LineRange[] = [ranges[0]!];
  for (const range of ranges.slice(1)) {
    const last = merged.at(-1)!;
    if (range.from <= last.to + 1) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

/** Lignes citées par le suffixe d'une mention de note (`L12`, `L12-18`, `L3-5,9`), ou `null`. */
export function citedLinesOf(suffix: string | null | undefined): LineRange[] | null {
  const match = /^L(.+)$/.exec(suffix ?? '');
  return match ? rangesOf(match[1]!.split(',')) : null;
}

/** Lignes citées d'après une adresse (`?lines=12-18,30`), ou `null`. */
export function citedLinesFromQuery(value: unknown): LineRange[] | null {
  return typeof value === 'string' && value ? rangesOf(value.split(',')) : null;
}

/** Écriture compacte des plages : `12-18,30`. */
export function linesParam(ranges: readonly LineRange[]): string {
  return ranges.map((range) => (range.from === range.to ? `${range.from}` : `${range.from}-${range.to}`)).join(',');
}

/** Écriture lisible des plages : `12–18, 30`. */
export function linesLabel(ranges: readonly LineRange[]): string {
  return ranges.map((range) => (range.from === range.to ? `${range.from}` : `${range.from}–${range.to}`)).join(', ');
}

/** Vrai si la ligne `line` (à partir de 1) est citée. */
export function lineCited(ranges: readonly LineRange[], line: number): boolean {
  return ranges.some((range) => line >= range.from && line <= range.to);
}

function elementsOf(parts: string[]): string[] | null {
  const ids = [...new Set(parts.map((part) => part.trim()).filter(Boolean))].slice(0, CITATION_LIMITS.elements);
  return ids.length && ids.every((id) => ELEMENT.test(id)) ? ids : null;
}

/** Éléments cités par le suffixe d'une mention de tableau (`el:a1b2c3,d4e5f6`), ou `null`. */
export function citedElementsOf(suffix: string | null | undefined): string[] | null {
  const match = /^el:(.+)$/.exec(suffix ?? '');
  return match ? elementsOf(match[1]!.split(',')) : null;
}

/** Éléments cités d'après une adresse (`?elements=a1b2c3,d4e5f6`), ou `null`. */
export function citedElementsFromQuery(value: unknown): string[] | null {
  return typeof value === 'string' && value ? elementsOf(value.split(',')) : null;
}

/** Version étiquetée citée (`@[Guide · v1.0](doc:12#v:345)`) : l'identifiant de la version, ou `null`. */
export function citedVersionOf(suffix: string | null | undefined): number | null {
  const match = /^v:(\d{1,12})$/.exec(suffix ?? '');
  return match ? Number(match[1]) : null;
}

/** Version demandée par une adresse (`?version=345`), ou `null`. */
export function versionFromQuery(value: unknown): number | null {
  const number = typeof value === 'string' && /^\d{1,12}$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
