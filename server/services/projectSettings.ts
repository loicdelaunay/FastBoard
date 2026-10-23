import { STATUS_META, type TicketStatus } from '../../shared/constants.ts';
import { normalizeSettings, type ProjectSettingsDTO } from '../../shared/settings.ts';
import type { Db } from '../db/database.ts';
import { badRequest } from '../http/errors.ts';
import { parseSettings } from './rows.ts';

export function getProjectSettings(db: Db, projectId: number): ProjectSettingsDTO {
  return parseSettings(db.get<{ settings: string }>('SELECT settings FROM projects WHERE id = ?', projectId)?.settings);
}

export type SettingsPatch = Partial<Omit<ProjectSettingsDTO, 'columns' | 'ticketFields'>> & { columns?: ProjectSettingsDTO['columns']; ticketFields?: Partial<ProjectSettingsDTO['ticketFields']> };

/**
 * Fusionne un patch avec les réglages actuels et le valide : les six statuts doivent être présents une fois,
 * « Terminé » ne se masque pas, une colonne qui contient des tickets non plus.
 */
export function mergeSettings(db: Db, projectId: number, patch: SettingsPatch): ProjectSettingsDTO {
  const current = getProjectSettings(db, projectId);
  if (patch.columns) {
    const statuses = new Set(patch.columns.map((column) => column.status));
    if (statuses.size !== patch.columns.length) {
      throw badRequest('Chaque statut doit apparaître une seule fois dans les colonnes.');
    }
    const done = patch.columns.find((column) => column.status === 'done');
    if (done?.hidden) {
      throw badRequest('La colonne « Terminé » ne peut pas être masquée.');
    }
    for (const column of patch.columns.filter((entry) => entry.hidden)) {
      const count = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tickets WHERE project_id = ? AND status = ?', projectId, column.status)?.n ?? 0;
      if (count > 0) {
        throw badRequest(`La colonne « ${column.label} » contient ${count} ticket${count > 1 ? 's' : ''} : déplacez-les avant de la masquer.`);
      }
    }
  }
  return normalizeSettings({ ...current, ...patch, columns: patch.columns ?? current.columns, ticketFields: { ...current.ticketFields, ...patch.ticketFields } });
}

/** Refuse un statut dont la colonne est masquée (création, modification ou déplacement d'un ticket). */
export function assertStatusAvailable(db: Db, projectId: number, status: TicketStatus): void {
  const column = getProjectSettings(db, projectId).columns.find((entry) => entry.status === status);
  if (column?.hidden) {
    throw badRequest(`La colonne « ${column.label || STATUS_META[status].label} » est masquée dans ce projet.`);
  }
}

/** Résumé lisible des réglages modifiés, pour le journal d'activité. */
export function describeSettingsChange(before: ProjectSettingsDTO, after: ProjectSettingsDTO): string {
  const parts: string[] = [];
  const toggle = (label: string, was: boolean, now: boolean): void => {
    if (was !== now) parts.push(`${label} : ${now ? 'activé' : 'désactivé'}`);
  };
  toggle('déplacement automatique vers Terminé', before.autoMoveDone, after.autoMoveDone);
  toggle('réouverture automatique', before.autoReopen, after.autoReopen);
  toggle('confettis', before.confetti, after.confetti);
  toggle("indicateur d'inactivité", before.staleIndicator, after.staleIndicator);
  if (before.staleDays !== after.staleDays) parts.push(`inactivité après ${after.staleDays} j`);
  if (before.completeStatuses.join() !== after.completeStatuses.join()) parts.push('colonnes à 100 %');
  if (JSON.stringify(before.columnSort) !== JSON.stringify(after.columnSort)) parts.push('tri automatique des colonnes');
  toggle('alerte de livraison', before.deliveryAlert, after.deliveryAlert);
  toggle('avancement masqué à 0 %', before.hideZeroProgress, after.hideZeroProgress);
  if (JSON.stringify(before.ticketFields) !== JSON.stringify(after.ticketFields)) parts.push('champs affichés des tickets');
  if (JSON.stringify(before.customFields) !== JSON.stringify(after.customFields)) parts.push('champs personnalisés');
  if (before.deliveryWarnDays !== after.deliveryWarnDays || before.deliveryDangerDays !== after.deliveryDangerDays) parts.push('seuils d’alerte de livraison');
  if (JSON.stringify(before.columns) !== JSON.stringify(after.columns)) {
    parts.push('colonnes du Kanban');
  }
  return parts.join(', ');
}
