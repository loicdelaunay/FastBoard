import { isTicketStatus } from '@shared/constants';
import { formatDateShort } from '@shared/dates';
import type { HistoryChange, HistoryData } from '@shared/types';
import { useProjectStore } from '@/stores/project';
import { plainText } from '@/utils/mentions';

import { t } from '@/i18n';
/** Libellés partagés par l'historique d'un ticket et le journal d'activité du projet. */
export const FIELD_LABELS: Record<HistoryChange['field'], string> = {
  title: t('le titre'),
  description: t('la description'),
  status: t('le statut'),
  category: t('la catégorie'),
  priority: t('la priorité'),
  components: t('les composants'),
  delivery: t('la livraison'),
  startDate: t('la date de début'),
  endDate: t('la date de fin'),
  progress: t("l'avancement"),
  parent: t('le ticket parent'),
  custom: t('un champ personnalisé'),
};

/** Libellé du champ modifié (« le titre », ou « Budget » pour un champ personnalisé). */
export function fieldLabel(change: HistoryChange): string {
  return change.field === 'custom' && change.label ? `« ${change.label} »` : FIELD_LABELS[change.field];
}

/** Valeur lisible (avant / après) d'une modification. */
export function formatChangeValue(change: HistoryChange, side: 'from' | 'to'): string {
  const value = change[side];
  if (value === null || value === '') {
    return t('aucun');
  }
  switch (change.field) {
    case 'status':
      return isTicketStatus(value) ? useProjectStore().statusMeta(value).label : String(value);
    case 'startDate':
    case 'endDate':
      return formatDateShort(String(value), true);
    case 'progress':
      return `${value} %`;
    case 'description':
      return plainText(String(value));
    case 'custom':
      if (change.customType === 'checkbox') return value === 'true' ? t('coché') : t('non coché');
      if (change.customType === 'date') return formatDateShort(String(value), true);
      return String(value);
    default:
      return String(value);
  }
}

/** Icône PrimeIcons d'une entrée d'historique. */
export function historyIcon(data: HistoryData): string {
  switch (data.kind) {
    case 'created':
      return 'pi pi-plus-circle';
    case 'assignees':
      return 'pi pi-users';
    case 'attachment':
      return 'pi pi-paperclip';
    case 'subtask':
      return data.action === 'done' ? 'pi pi-check-square' : 'pi pi-list-check';
    case 'link':
      return 'pi pi-link';
    case 'transferred':
      return 'pi pi-folder';
    case 'part':
      if (data.note !== undefined) {
        return 'pi pi-flag';
      }
      return data.done === false ? 'pi pi-replay' : 'pi pi-check-circle';
    case 'updated':
      return data.auto ? 'pi pi-bolt' : 'pi pi-pencil';
  }
}

/** Verbes des actions sur les sous-tâches (historique et activité). */
export const SUBTASK_ACTIONS: Record<'added' | 'done' | 'reopened' | 'renamed' | 'removed', string> = {
  added: t('a ajouté la sous-tâche'),
  done: t('a terminé la sous-tâche'),
  reopened: t('a rouvert la sous-tâche'),
  renamed: t('a renommé la sous-tâche'),
  removed: t('a supprimé la sous-tâche'),
};

/** Raison d'une dépendance, traduite quand c'est une raison proposée. */
export function linkReasonLabel(reason: string): string {
  return t(reason);
}
