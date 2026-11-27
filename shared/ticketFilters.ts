import { TICKET_STATUSES, type TicketStatus } from './constants.ts';

/**
 * Filtres des vues Liste, Kanban et Gantt : leurs valeurs, leur forme dans l'adresse de la page (pour partager une vue
 * filtrée par un lien) et les filtres enregistrés d'un projet (les siens, ou partagés avec tout le projet).
 */

/** Identifiant filtré, ou `none` : « Sans catégorie », « Sans livraison », « Non assigné ». */
export type FilterId = number | 'none';

export interface TicketFilterValues {
  search: string;
  categoryIds: FilterId[];
  deliveryIds: FilterId[];
  assigneeIds: FilterId[];
  statuses: TicketStatus[];
  overdueOnly: boolean;
  mineOnly: boolean;
  /** « Mon tableau » seulement : projets montrés (vide : tous). */
  projectIds: number[];
}

export function emptyTicketFilters(): TicketFilterValues {
  return { search: '', categoryIds: [], deliveryIds: [], assigneeIds: [], statuses: [], overdueOnly: false, mineOnly: false, projectIds: [] };
}

/** Paramètres de l'adresse, en clair : `?q=paiement&categories=3,sans&statuts=todo,in_progress&retard=1`. */
export const TICKET_FILTER_PARAMS = {
  search: 'q',
  categoryIds: 'categories',
  deliveryIds: 'livraisons',
  assigneeIds: 'personnes',
  statuses: 'statuts',
  overdueOnly: 'retard',
  mineOnly: 'mes',
  projectIds: 'projets',
} as const satisfies Record<keyof TicketFilterValues, string>;

const NONE = 'sans';
export const TICKET_FILTER_LIMITS = { searchMax: 200, idsMax: 200 } as const;

const ids = (values: readonly FilterId[]): string => values.map((value) => (value === 'none' ? NONE : String(value))).join(',');

/** Paramètres d'adresse des filtres actifs (les autres n'y figurent pas). */
export function filtersToQuery(values: TicketFilterValues): Record<string, string> {
  const query: Record<string, string> = {};
  const search = values.search.trim();
  if (search) query[TICKET_FILTER_PARAMS.search] = search;
  if (values.categoryIds.length) query[TICKET_FILTER_PARAMS.categoryIds] = ids(values.categoryIds);
  if (values.deliveryIds.length) query[TICKET_FILTER_PARAMS.deliveryIds] = ids(values.deliveryIds);
  if (values.assigneeIds.length) query[TICKET_FILTER_PARAMS.assigneeIds] = ids(values.assigneeIds);
  if (values.statuses.length) query[TICKET_FILTER_PARAMS.statuses] = values.statuses.join(',');
  if (values.overdueOnly) query[TICKET_FILTER_PARAMS.overdueOnly] = '1';
  if (values.mineOnly) query[TICKET_FILTER_PARAMS.mineOnly] = '1';
  if (values.projectIds.length) query[TICKET_FILTER_PARAMS.projectIds] = values.projectIds.join(',');
  return query;
}

const first = (value: unknown): string => (Array.isArray(value) ? String(value[0] ?? '') : typeof value === 'string' ? value : '');

function parseIds(value: unknown, allowNone: boolean): FilterId[] {
  const result: FilterId[] = [];
  for (const raw of first(value).split(',')) {
    const part = raw.trim().toLowerCase();
    if (allowNone && (part === NONE || part === 'none')) {
      if (!result.includes('none')) result.push('none');
      continue;
    }
    const id = Number(part);
    if (part && Number.isInteger(id) && id > 0 && !result.includes(id)) result.push(id);
  }
  return result.slice(0, TICKET_FILTER_LIMITS.idsMax);
}

/** Filtres lus dans l'adresse ; ce qui est illisible est ignoré. */
export function filtersFromQuery(query: Readonly<Record<string, unknown>>): TicketFilterValues {
  const statuses = first(query[TICKET_FILTER_PARAMS.statuses])
    .split(',')
    .map((part) => part.trim())
    .filter((part): part is TicketStatus => (TICKET_STATUSES as readonly string[]).includes(part));
  const flag = (value: unknown): boolean => ['1', 'true', 'oui'].includes(first(value).toLowerCase());
  return {
    search: first(query[TICKET_FILTER_PARAMS.search]).slice(0, TICKET_FILTER_LIMITS.searchMax),
    categoryIds: parseIds(query[TICKET_FILTER_PARAMS.categoryIds], true),
    deliveryIds: parseIds(query[TICKET_FILTER_PARAMS.deliveryIds], true),
    assigneeIds: parseIds(query[TICKET_FILTER_PARAMS.assigneeIds], true),
    statuses: [...new Set(statuses)],
    overdueOnly: flag(query[TICKET_FILTER_PARAMS.overdueOnly]),
    mineOnly: flag(query[TICKET_FILTER_PARAMS.mineOnly]),
    projectIds: parseIds(query[TICKET_FILTER_PARAMS.projectIds], false) as number[],
  };
}

/** L'adresse contient-elle des filtres ? */
export function hasFilterQuery(query: Readonly<Record<string, unknown>>): boolean {
  return Object.values(TICKET_FILTER_PARAMS).some((name) => first(query[name]) !== '');
}

/** Paramètres de l'adresse sans ceux des filtres (pour les remplacer). */
export function withoutFilterQuery<T>(query: Readonly<Record<string, T>>): Record<string, T> {
  const names = new Set<string>(Object.values(TICKET_FILTER_PARAMS));
  return Object.fromEntries(Object.entries(query).filter(([key]) => !names.has(key)));
}

const sameSet = <T>(a: readonly T[], b: readonly T[]): boolean => a.length === b.length && a.every((value) => b.includes(value));

/** Mêmes filtres, à l'ordre des valeurs près. */
export function sameFilters(a: TicketFilterValues, b: TicketFilterValues): boolean {
  return (
    a.search.trim() === b.search.trim() &&
    sameSet(a.categoryIds, b.categoryIds) &&
    sameSet(a.deliveryIds, b.deliveryIds) &&
    sameSet(a.assigneeIds, b.assigneeIds) &&
    sameSet(a.statuses, b.statuses) &&
    a.overdueOnly === b.overdueOnly &&
    a.mineOnly === b.mineOnly &&
    sameSet(a.projectIds, b.projectIds)
  );
}

// --- Filtres enregistrés ---

export const SAVED_FILTER_LIMITS = { nameMax: 80, descriptionMax: 500, perUser: 100 } as const;

/** Filtre enregistré d'un projet : à soi, ou partagé avec tout le projet (avec le nom de qui l'a créé). */
export interface SavedFilterDTO {
  id: number;
  projectId: number;
  name: string;
  description: string;
  filters: TicketFilterValues;
  /** Partagé : tout le projet le voit et peut l'utiliser. */
  shared: boolean;
  createdBy: number | null;
  /** Nom de qui l'a créé (null : compte supprimé). */
  createdByName: string | null;
  /** La personne peut le modifier et le supprimer (son auteur, ou qui gère le projet). */
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
}
