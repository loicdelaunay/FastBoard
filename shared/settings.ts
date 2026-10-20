/** Réglages d'un projet : automatisations et personnalisation des colonnes du Kanban. */

import { STATUS_META, TICKET_STATUSES, isTicketStatus, type TicketStatus } from './constants.ts';

export const COLUMN_LABEL_MAX = 30;

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
  /** Les six colonnes, dans l'ordre d'affichage. */
  columns: ColumnConfig[];
}

export function defaultColumns(): ColumnConfig[] {
  return TICKET_STATUSES.map((status) => ({ status, label: STATUS_META[status].label, color: STATUS_META[status].color, hidden: false }));
}

export function defaultSettings(): ProjectSettingsDTO {
  return { autoMoveDone: true, autoReopen: true, confetti: true, staleIndicator: false, staleDays: 3, columns: defaultColumns() };
}

const isColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);

/**
 * Complète et corrige des réglages lus en base ou reçus du client : toutes les colonnes présentes une seule fois,
 * libellés et couleurs valides, « Terminé » jamais masquée.
 */
export function normalizeSettings(raw: unknown): ProjectSettingsDTO {
  const defaults = defaultSettings();
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const flag = (key: 'autoMoveDone' | 'autoReopen' | 'confetti' | 'staleIndicator'): boolean => (typeof source[key] === 'boolean' ? source[key] : defaults[key]);

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
  return { autoMoveDone: flag('autoMoveDone'), autoReopen: flag('autoReopen'), confetti: flag('confetti'), staleIndicator: flag('staleIndicator'), staleDays, columns };
}
