import type { ActivityData } from '@shared/types';
import { SUBTASK_ACTIONS } from '@/utils/historyFormat';

import { t } from '@/i18n';
export interface ActivitySummary {
  icon: string;
  text: string;
  ticketKey?: string;
  ticketId?: number;
  title?: string;
}

/** Résumé court d'une action (page utilisateur, notifications) : icône, verbe et ticket concerné. */
export function describeActivity(data: ActivityData): ActivitySummary {
  switch (data.kind) {
    case 'ticket': {
      const entry = data.entry;
      const base = { ticketKey: data.ticketKey, ticketId: data.ticketId, title: data.ticketTitle };
      if (entry.kind === 'created') return { icon: 'pi pi-plus-circle', text: t('a créé'), ...base };
      if (entry.kind === 'updated' && entry.changes.some((change) => change.field === 'status')) return { icon: 'pi pi-arrow-right-arrow-left', text: t('a déplacé'), ...base };
      if (entry.kind === 'updated') return { icon: 'pi pi-pencil', text: t('a modifié'), ...base };
      if (entry.kind === 'assignees') return { icon: 'pi pi-users', text: t('a changé les assignés de'), ...base };
      if (entry.kind === 'part') return { icon: 'pi pi-check-circle', text: t('a mis à jour une part de'), ...base };
      if (entry.kind === 'attachment') return { icon: 'pi pi-paperclip', text: entry.action === 'added' ? t('a joint un fichier à') : t('a retiré un fichier de'), ...base };
      if (entry.kind === 'transferred') return { icon: 'pi pi-folder', text: t('a déplacé vers un autre projet'), ...base };
      if (entry.kind === 'subtask') return { icon: 'pi pi-list-check', text: `${SUBTASK_ACTIONS[entry.action]} « ${entry.title} » ${t('sur')}`, ...base };
      return { icon: 'pi pi-link', text: t('a modifié les dépendances de'), ...base };
    }
    case 'ticket_transferred':
      return { icon: 'pi pi-folder', text: data.direction === 'out' ? t('a déplacé vers un autre projet') : t('a fait venir'), ticketKey: data.ticketKey, ticketId: data.ticketId ?? undefined, title: data.ticketTitle };
    case 'ticket_deleted':
      return { icon: 'pi pi-trash', text: t('a supprimé'), ticketKey: data.ticketKey, title: data.ticketTitle };
    case 'comment':
      return { icon: 'pi pi-comment', text: data.action === 'created' ? t('a commenté') : t('a supprimé un commentaire sur'), ticketKey: data.ticketKey, ticketId: data.ticketId, title: data.ticketTitle };
    case 'member':
      return { icon: 'pi pi-user-plus', text: t('a modifié les membres du projet') };
    default:
      return { icon: 'pi pi-cog', text: t('a modifié la configuration du projet') };
  }
}
