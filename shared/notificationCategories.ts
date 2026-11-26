import type { NotificationDTO } from './types.ts';

/**
 * Catégories des notifications, pour les trier : on vous mentionne, on vous assigne un ticket, on commente un ticket
 * que vous suivez, ou un de ces tickets change (statut, dates, livraison…).
 */
export const NOTIFICATION_CATEGORIES = ['mention', 'assigned', 'comment', 'change'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const isNotificationCategory = (value: unknown): value is NotificationCategory => (NOTIFICATION_CATEGORIES as readonly unknown[]).includes(value);

export function notificationCategory(item: Pick<NotificationDTO, 'type' | 'activity'>): NotificationCategory {
  if (item.type === 'mention') return 'mention';
  if (item.type === 'assigned') return 'assigned';
  return item.activity?.kind === 'comment' ? 'comment' : 'change';
}

/** Nombre de notifications par catégorie, et combien ne sont pas lues. */
export type NotificationCounts = Record<NotificationCategory, { total: number; unread: number }>;

export const emptyNotificationCounts = (): NotificationCounts => ({
  mention: { total: 0, unread: 0 },
  assigned: { total: 0, unread: 0 },
  comment: { total: 0, unread: 0 },
  change: { total: 0, unread: 0 },
});
