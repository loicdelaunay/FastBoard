import type { RouteLocationRaw } from 'vue-router';
import type { NotificationLevel } from '@shared/constants';
import type { NotificationCategory } from '@shared/notificationCategories';
import type { NotificationDTO } from '@shared/types';
import { describeActivity } from '@/utils/activitySummary';

import { t } from '@/i18n';

/** Phrase qui suit le nom de l'auteur (« vous a assigné », « a déplacé… »). */
export function notificationSentence(item: NotificationDTO): string {
  if (item.doc) return t('vous a mentionné dans');
  if (item.type === 'mention') return item.ticketKey ? t('vous a mentionné sur') : t('vous a mentionné dans l’activité du projet');
  if (item.type === 'assigned') return t('vous a assigné');
  return item.activity ? describeActivity(item.activity).text : t('a modifié');
}

export function notificationIcon(item: NotificationDTO): string {
  if (item.type === 'mention') return 'pi pi-at';
  if (item.type === 'assigned') return 'pi pi-user-plus';
  return item.activity ? describeActivity(item.activity).icon : 'pi pi-bell';
}

/** Écran à ouvrir pour une notification : ticket, note de documentation ou journal d'activité du projet. */
export function notificationRoute(item: NotificationDTO): RouteLocationRaw | null {
  if (item.doc) return { name: 'doc-file', params: { nodeId: item.doc.nodeId } };
  if (item.projectId && item.ticketId) return { name: 'project', params: { projectId: item.projectId }, query: { ticket: String(item.ticketId) } };
  // Mention dans un commentaire du journal d'activité.
  if (item.projectId && item.type === 'mention') return { name: 'activity', params: { projectId: item.projectId } };
  return null;
}

export interface NotificationLevelOption {
  value: NotificationLevel;
  label: string;
  hint: string;
  icon: string;
}

/** Niveaux de notification d'un projet, du plus bavard au plus silencieux. */
export function notificationLevelOptions(): NotificationLevelOption[] {
  return [
    { value: 'all', label: t('Tout'), hint: t('Toute l’activité des tickets du projet, suivis ou non.'), icon: 'pi pi-eye' },
    { value: 'participating', label: t('Ma participation'), hint: t('Les tickets que vous suivez (créés, assignés, commentés, où l’on vous mentionne ou suivis avec « Suivre »), vos assignations et les mentions.'), icon: 'pi pi-bell' },
    { value: 'mentions', label: t('Mentions et assignations'), hint: t('Quand on vous mentionne avec @, ou qu’on vous assigne un ticket.'), icon: 'pi pi-at' },
    { value: 'none', label: t('Aucune'), hint: t('Aucune notification pour ce projet, mentions comprises.'), icon: 'pi pi-bell-slash' },
  ];
}

export interface NotificationCategoryOption {
  value: NotificationCategory | null;
  label: string;
  icon: string;
}

/** Filtres des notifications par catégorie (`null` : toutes). */
export function notificationCategoryOptions(): NotificationCategoryOption[] {
  return [
    { value: null, label: t('Toutes'), icon: 'pi pi-inbox' },
    { value: 'mention', label: t('Mentions'), icon: 'pi pi-at' },
    { value: 'assigned', label: t('Assignations'), icon: 'pi pi-user-plus' },
    { value: 'comment', label: t('Commentaires'), icon: 'pi pi-comments' },
    { value: 'change', label: t('Changements'), icon: 'pi pi-sync' },
  ];
}
