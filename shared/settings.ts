/** Réglages d'un projet : automatisations et personnalisation des colonnes du Kanban. */

import { STATUS_META, TICKET_STATUSES, isTicketStatus, type TicketStatus } from './constants.ts';
import { defaultTicketFields, normalizeCustomFields, normalizeTicketFields, type CustomFieldDef, type TicketFieldKey } from './ticketFields.ts';

export const COLUMN_LABEL_MAX = 30;

/** Champs proposés pour le tri automatique d'une colonne du Kanban. */
export const SORT_FIELDS = ['priority', 'dueDate', 'title', 'number', 'createdAt', 'updatedAt', 'progress'] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export interface ColumnSort {
  field: SortField;
  direction: 'asc' | 'desc';
}

export interface ColumnConfig {
  /** Statut des tickets de la colonne (fixe : il porte les règles d'avancement). */
  status: TicketStatus;
  label: string;
  /** Couleur #RRGGBB. */
  color: string;
  /** Colonne masquée du Kanban et des choix de statut (impossible si elle contient des tickets, ou pour « Terminé »). */
  hidden: boolean;
}

export interface ProjectSettingsDTO {
  /** Quand toutes les parts sont terminées, le ticket passe tout seul dans la colonne « Terminé ». */
  autoMoveDone: boolean;
  /** Une part rouverte sur un ticket terminé le ramène « En cours ». */
  autoReopen: boolean;
  /** Pluie de confettis quand un ticket arrive dans « Terminé ». */
  confetti: boolean;
  /** Indicateur d'inactivité sur les tickets restés longtemps dans la même colonne (à la manière de Jira). */
  staleIndicator: boolean;
  /** Nombre de jours sans changement de colonne à partir duquel un ticket est signalé. */
  staleDays: number;
  /** Colonnes dans lesquelles un ticket compte pour 100 % d'avancement (« Terminé » en fait toujours partie). */
  completeStatuses: TicketStatus[];
  /** Tri automatique des cartes, par colonne ; une colonne absente garde l'ordre manuel (glisser-déposer). */
  columnSort: Partial<Record<TicketStatus, ColumnSort>>;
  /** Pastille colorée sur les tickets non terminés dont la livraison approche. */
  deliveryAlert: boolean;
  /** Jours avant la fin de la livraison à partir desquels la pastille devient orange… */
  deliveryWarnDays: number;
  /** … puis rouge. */
  deliveryDangerDays: number;
  /** Onglet « Ticket » : la barre d'avancement n'apparaît pas sur les cartes des tickets à 0 %. */
  hideZeroProgress: boolean;
  /** Onglet « Ticket » : champs standard affichés (faux = masqué, les valeurs sont conservées). */
  ticketFields: Record<TicketFieldKey, boolean>;
  /** Onglet « Ticket » : champs personnalisés du projet. */
  customFields: CustomFieldDef[];
  /** Les personnes qui modifient les tickets peuvent créer un composant depuis un ticket. */
  allowNewComponents: boolean;
  /** Analyseur, charge par personne : les tickets terminés sans assigné ne sont pas comptés dans « Non assigné ». */
  hideDoneUnassigned: boolean;
  /** Les six colonnes, dans l'ordre d'affichage. */
  columns: ColumnConfig[];
}

export function defaultColumns(): ColumnConfig[] {
  return TICKET_STATUSES.map((status) => ({ status, label: STATUS_META[status].label, color: STATUS_META[status].color, hidden: false }));
}

export function defaultSettings(): ProjectSettingsDTO {
  return {
    autoMoveDone: true,
    autoReopen: true,
    confetti: true,
    staleIndicator: false,
    staleDays: 3,
    completeStatuses: ['done'],
    columnSort: {},
    deliveryAlert: true,
    deliveryWarnDays: 7,
    deliveryDangerDays: 2,
    hideZeroProgress: false,
    ticketFields: defaultTicketFields(),
    customFields: [],
    allowNewComponents: false,
    hideDoneUnassigned: true,
    columns: defaultColumns(),
  };
}

const isColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);

/**
 * Complète et corrige des réglages lus en base ou reçus du client : toutes les colonnes présentes une seule fois,
 * libellés et couleurs valides, « Terminé » jamais masquée.
 */
export function normalizeSettings(raw: unknown): ProjectSettingsDTO {
  const defaults = defaultSettings();
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const flag = (key: 'autoMoveDone' | 'autoReopen' | 'confetti' | 'staleIndicator' | 'deliveryAlert' | 'hideZeroProgress' | 'allowNewComponents' | 'hideDoneUnassigned'): boolean => (typeof source[key] === 'boolean' ? source[key] : defaults[key]);

  const seen = new Set<TicketStatus>();
  const columns: ColumnConfig[] = [];
  for (const entry of Array.isArray(source.columns) ? source.columns : []) {
    const candidate = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    if (!isTicketStatus(candidate.status) || seen.has(candidate.status)) {
      continue;
    }
    seen.add(candidate.status);
    const fallback = STATUS_META[candidate.status];
    const label = typeof candidate.label === 'string' ? candidate.label.trim().slice(0, COLUMN_LABEL_MAX) : '';
    columns.push({
      status: candidate.status,
      label: label || fallback.label,
      color: isColor(candidate.color) ? candidate.color : fallback.color,
      hidden: candidate.status !== 'done' && candidate.hidden === true,
    });
  }
  for (const column of defaults.columns) {
    if (!seen.has(column.status)) {
      columns.push(column);
    }
  }
  const staleDays = typeof source.staleDays === 'number' && Number.isInteger(source.staleDays) && source.staleDays >= 1 && source.staleDays <= 365 ? source.staleDays : defaults.staleDays;
  const days = (key: 'deliveryWarnDays' | 'deliveryDangerDays'): number =>
    typeof source[key] === 'number' && Number.isInteger(source[key]) && (source[key] as number) >= 0 && (source[key] as number) <= 365 ? (source[key] as number) : defaults[key];
  const completeStatuses = new Set<TicketStatus>(['done']);
  for (const status of Array.isArray(source.completeStatuses) ? source.completeStatuses : []) {
    if (isTicketStatus(status)) completeStatuses.add(status);
  }
  const columnSort: Partial<Record<TicketStatus, ColumnSort>> = {};
  const rawSort = (source.columnSort && typeof source.columnSort === 'object' ? source.columnSort : {}) as Record<string, unknown>;
  for (const [status, value] of Object.entries(rawSort)) {
    const sort = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    if (isTicketStatus(status) && (SORT_FIELDS as readonly unknown[]).includes(sort.field)) {
      columnSort[status] = { field: sort.field as SortField, direction: sort.direction === 'desc' ? 'desc' : 'asc' };
    }
  }
  const warn = days('deliveryWarnDays');
  return {
    autoMoveDone: flag('autoMoveDone'),
    autoReopen: flag('autoReopen'),
    confetti: flag('confetti'),
    staleIndicator: flag('staleIndicator'),
    staleDays,
    completeStatuses: TICKET_STATUSES.filter((status) => completeStatuses.has(status)),
    columnSort,
    deliveryAlert: flag('deliveryAlert'),
    deliveryWarnDays: warn,
    deliveryDangerDays: Math.min(days('deliveryDangerDays'), warn),
    hideZeroProgress: flag('hideZeroProgress'),
    ticketFields: normalizeTicketFields(source.ticketFields),
    customFields: normalizeCustomFields(source.customFields),
    allowNewComponents: flag('allowNewComponents'),
    hideDoneUnassigned: flag('hideDoneUnassigned'),
    columns,
  };
}
