import { boundsOf, type Rect } from '@shared/boardGeometry';
import { newElementId, type BoardElement, type TemplateLink } from '@shared/boards';

/**
 * Modèles des tableaux (façon « prefab ») : une copie est un groupe d'éléments qui portent le même `tpl.inst` ; chacun
 * se souvient de l'élément du modèle dont il vient (`tpl.key`). La copie se compare au modèle, et se remet à jour en
 * gardant ses identifiants (les liens accrochés de l'extérieur tiennent).
 */

export interface Point {
  x: number;
  y: number;
}

/** État d'une copie face à son modèle. */
export type InstanceState = 'current' | 'outdated' | 'modified' | 'missing' | 'checking';

const indexOf = (elements: readonly BoardElement[]) => new Map(elements.map((element) => [element.id, element]));

/** Cadre d'un ensemble d'éléments (liens compris). */
export function frameOf(elements: readonly BoardElement[]): Rect | null {
  return elements.length ? boundsOf(elements, indexOf(elements)) : null;
}

/** L'élément sans son lien de copie. */
export function unlinked<T extends BoardElement>(element: T): T {
  if (!element.tpl) return element;
  const { tpl: _tpl, ...rest } = element;
  return rest as T;
}

/**
 * Copie les éléments d'un modèle, son coin haut-gauche en `at`. `reuse` garde l'identifiant de l'élément déjà posé pour
 * une même clé (mise à jour d'une copie).
 */
export function instantiate(
  template: readonly BoardElement[],
  options: { templateId: number; version: string; at: Point; z: number; inst?: string; reuse?: ReadonlyMap<string, string> },
): BoardElement[] {
  const frame = frameOf(template);
  if (!frame) return [];
  const inst = options.inst ?? newElementId();
  const dx = options.at.x - frame.x;
  const dy = options.at.y - frame.y;
  const ids = new Map(template.map((element) => [element.id, options.reuse?.get(element.id) ?? newElementId()]));
  let z = options.z;
  return template.map((original): BoardElement => {
    const element = unlinked(original);
    const tpl: TemplateLink = { id: options.templateId, inst, key: original.id, v: options.version };
    const id = ids.get(original.id)!;
    if (element.type === 'connector') {
      const end = (side: typeof element.from) => ({ ...side, id: side.id ? (ids.get(side.id) ?? null) : null, x: side.x + dx, y: side.y + dy });
      return { ...element, id, z: z++, from: end(element.from), to: end(element.to), tpl };
    }
    const moved = { ...element, id, z: z++, x: element.x + dx, y: element.y + dy, tpl };
    if (moved.type === 'mind') return { ...moved, parent: moved.parent ? (ids.get(moved.parent) ?? null) : null };
    if (moved.type === 'chart') return { ...moved, source: moved.source ? (ids.get(moved.source) ?? null) : null };
    if (moved.type === 'sticky') return { ...moved, votes: [] };
    return moved;
  });
}

const round = (value: number): number => Math.round(value * 10) / 10;

/**
 * Empreinte d'un ensemble d'éléments, indépendante de sa position, des identifiants et de l'empilement : deux
 * ensembles qui ont la même empreinte se ressemblent à l'identique. `keyOf` donne la clé commune (celle du modèle).
 */
export function fingerprint(elements: readonly BoardElement[], keyOf: (element: BoardElement) => string): string {
  const frame = frameOf(elements);
  if (!frame) return '[]';
  const keys = new Map(elements.map((element) => [element.id, keyOf(element)]));
  const ref = (id: string | null): string | null => (id ? (keys.get(id) ?? `outside:${id}`) : null);
  const normalized = elements.map((original) => {
    const { id: _id, z: _z, tpl: _tpl, locked: _locked, ...rest } = original as BoardElement & Record<string, unknown>;
    const entry: Record<string, unknown> = { ...rest, key: keys.get(original.id) };
    if (original.type === 'connector') {
      const end = (side: typeof original.from) => ({ ...side, id: ref(side.id), x: round(side.x - frame.x), y: round(side.y - frame.y) });
      entry.from = end(original.from);
      entry.to = end(original.to);
    } else {
      entry.x = round(original.x - frame.x);
      entry.y = round(original.y - frame.y);
      entry.w = round(original.w);
      entry.h = round(original.h);
      if (original.type === 'mind') entry.parent = ref(original.parent);
      if (original.type === 'chart') entry.source = ref(original.source);
      if (original.type === 'sticky') delete entry.votes;
    }
    return entry;
  });
  normalized.sort((a, b) => String(a.key).localeCompare(String(b.key)));
  return JSON.stringify(canonical(normalized));
}

/** Valeur aux clés triées (l'ordre des champs varie entre le navigateur et le serveur), nombres arrondis. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => [key, canonical(record[key])]),
    );
  }
  return typeof value === 'number' ? round(value) : value;
}

/** Les copies présentes sur un tableau, par identifiant de copie. */
export function instancesOf(elements: readonly BoardElement[]): Map<string, BoardElement[]> {
  const groups = new Map<string, BoardElement[]>();
  for (const element of elements) {
    if (!element.tpl) continue;
    const group = groups.get(element.tpl.inst);
    if (group) group.push(element);
    else groups.set(element.tpl.inst, [element]);
  }
  return groups;
}

/** Les éléments à enregistrer comme modèle : sans lien, et sans lien vers l'extérieur de la sélection. */
export function templateSource(elements: readonly BoardElement[]): BoardElement[] {
  const ids = new Set(elements.map((element) => element.id));
  return elements.map((original) => {
    const element = unlinked(structuredClone(original));
    if (element.type === 'connector') {
      if (element.from.id && !ids.has(element.from.id)) element.from = { ...element.from, id: null, side: null };
      if (element.to.id && !ids.has(element.to.id)) element.to = { ...element.to, id: null, side: null };
    }
    if (element.type === 'mind' && element.parent && !ids.has(element.parent)) element.parent = null;
    if (element.type === 'sticky') element.votes = [];
    return element;
  });
}

/** Clé d'un élément de copie (ou son identifiant dans le modèle). */
export const templateKey = (element: BoardElement): string => element.tpl?.key ?? element.id;
