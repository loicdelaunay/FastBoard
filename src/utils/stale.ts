import type { ProjectSettingsDTO } from '@shared/settings';
import type { TicketDTO } from '@shared/types';

export interface StaleInfo {
  /** Jours entiers passés dans la colonne actuelle. */
  days: number;
  /** `fresh` : sous le seuil ; `stale` : seuil atteint ; `critical` : deux fois le seuil. */
  level: 'fresh' | 'stale' | 'critical';
  /** Remplissage de l'indicateur (0–1), plein à deux fois le seuil. */
  ratio: number;
}

/** Inactivité d'un ticket (temps passé sans changer de colonne) ; `null` si l'indicateur est désactivé ou le ticket terminé. */
export function staleInfo(ticket: Pick<TicketDTO, 'status' | 'statusChangedAt'>, settings: ProjectSettingsDTO, now = Date.now()): StaleInfo | null {
  if (!settings.staleIndicator || ticket.status === 'done') return null;
  const days = Math.max(0, Math.floor((now - Date.parse(ticket.statusChangedAt)) / 86_400_000));
  const threshold = Math.max(1, settings.staleDays);
  return {
    days,
    level: days >= threshold * 2 ? 'critical' : days >= threshold ? 'stale' : 'fresh',
    ratio: Math.min(1, days / (threshold * 2)),
  };
}
