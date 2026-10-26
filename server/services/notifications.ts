import type { ActivityData, NotificationDTO, NotificationType } from '../../shared/types.ts';
import type { Actor, AppContext } from '../context.ts';
import { nowIso, type Db, type SqlParam } from '../db/database.ts';
import { getAuthUser, resolveProjectAccess } from './access.ts';

const MENTION = /@\[[^\]\n]{1,80}\]\(user:(\d+)\)/g;
const RETENTION_DAYS = 90;

/** Identifiants des personnes mentionnées dans un texte (`@[Nom](user:12)`). */
export function mentionedUserIds(text: string): Set<number> {
  return new Set([...text.matchAll(MENTION)].map((match) => Number(match[1])));
}

/** Extrait autour de la première mention, sans le balisage des mentions. */
function excerptAround(text: string, userId: number): string {
  const plain = text.replace(/@\[([^\]\n]{1,80})\]\((?:user|ticket):\d+\)/g, '@$1').replace(/\s+/g, ' ').trim();
  const marker = text.match(new RegExp(`@\\[([^\\]\\n]{1,80})\\]\\(user:${userId}\\)`))?.[1];
  const index = marker ? plain.indexOf(`@${marker}`) : 0;
  const start = Math.max(0, index - 60);
  const slice = plain.slice(start, start + 180);
  return `${start > 0 ? '…' : ''}${slice}${start + 180 < plain.length ? '…' : ''}`;
}

// --- Abonnements -----------------------------------------------------------------------------------------------------

export function watchTicket(db: Db, ticketId: number, userId: number): void {
  db.run('INSERT OR IGNORE INTO ticket_watchers (ticket_id, user_id, created_at) VALUES (?, ?, ?)', ticketId, userId, nowIso());
}

export function unwatchTicket(db: Db, ticketId: number, userId: number): void {
  db.run('DELETE FROM ticket_watchers WHERE ticket_id = ? AND user_id = ?', ticketId, userId);
}

/**
 * Mentions en attente pour le prochain évènement d'un ticket : la personne mentionnée reçoit une notification
 * « mention » (avec l'extrait) au lieu de la notification d'activité ordinaire.
 */
const pendingMentions = new Map<number, Map<number, string>>();

/** À appeler avant l'inscription au journal : `text` est le nouveau texte, `previous` l'ancien (mentions déjà notifiées). */
export function queueMentions(ticketId: number, text: string, previous = ''): void {
  const before = mentionedUserIds(previous);
  const queue = pendingMentions.get(ticketId) ?? new Map<number, string>();
  for (const userId of mentionedUserIds(text)) {
    if (!before.has(userId)) queue.set(userId, excerptAround(text, userId));
  }
  if (queue.size) pendingMentions.set(ticketId, queue);
}

// --- Création ----------------------------------------------------------------------------------------------------------

interface NotificationRow {
  id: number;
  user_id: number;
  type: NotificationType;
  project_id: number | null;
  ticket_id: number | null;
  actor_id: number | null;
  via: string | null;
  data: string;
  created_at: string;
  read_at: string | null;
  project_key?: string | null;
  project_name?: string | null;
  actor_name?: string | null;
}

function toDTO(row: NotificationRow): NotificationDTO {
  const data = JSON.parse(row.data) as { activity: ActivityData | null; excerpt: string | null };
  const activity = data.activity;
  const ticket = activity && (activity.kind === 'ticket' || activity.kind === 'comment') ? activity : null;
  return {
    id: row.id,
    type: row.type,
    projectId: row.project_id,
    projectKey: row.project_key ?? null,
    projectName: row.project_name ?? null,
    ticketId: row.ticket_id,
    ticketKey: ticket?.ticketKey ?? null,
    ticketTitle: ticket?.ticketTitle ?? null,
    actorId: row.actor_id,
    actorName: row.actor_name ?? null,
    via: row.via,
    activity,
    excerpt: data.excerpt,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

const SELECT = `SELECT n.*, p.key AS project_key, p.name AS project_name, u.name AS actor_name
                  FROM notifications n
                  LEFT JOIN projects p ON p.id = n.project_id
                  LEFT JOIN users u ON u.id = n.actor_id`;

export function unreadCount(db: Db, userId: number): number {
  return db.get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', userId)?.n ?? 0;
}

function canSee(db: Db, userId: number, projectId: number): boolean {
  const user = getAuthUser(db, userId);
  return Boolean(user?.isActive && resolveProjectAccess(db, user, projectId));
}

function insert(ctx: AppContext, userId: number, type: NotificationType, projectId: number, ticketId: number | null, actor: Actor, activity: ActivityData, excerpt: string | null): void {
  const { lastInsertRowid } = ctx.db.run(
    'INSERT INTO notifications (user_id, type, project_id, ticket_id, actor_id, via, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    userId,
    type,
    projectId,
    ticketId,
    actor.userId,
    actor.via ?? null,
    JSON.stringify({ activity, excerpt }),
    nowIso(),
  );
  const row = ctx.db.get<NotificationRow>(`${SELECT} WHERE n.id = ?`, lastInsertRowid);
  if (row) ctx.hub.sendToUser(userId, { t: 'notification', notification: toDTO(row), unread: unreadCount(ctx.db, userId) });
}

/**
 * Notifie les personnes concernées par un évènement du journal d'activité : abonnés du ticket (hors auteur), personnes
 * assignées et personnes mentionnées. Met aussi à jour les abonnements automatiques (créateur, assignés, commentateurs).
 */
export function notifyActivity(ctx: AppContext, actor: Actor, projectId: number, data: ActivityData, options: { mentionsOnly?: boolean } = {}): void {
  const ticketId = data.kind === 'ticket' || data.kind === 'comment' ? data.ticketId : null;
  if (ticketId === null || (data.kind === 'comment' && data.action === 'deleted')) return;
  const { db } = ctx;
  if (!db.get('SELECT 1 FROM tickets WHERE id = ?', ticketId)) return;

  const assigned = new Set<number>();
  if (actor.userId !== null && ((data.kind === 'ticket' && data.entry.kind === 'created') || (data.kind === 'comment' && data.action === 'created'))) {
    watchTicket(db, ticketId, actor.userId);
  }
  if (data.kind === 'ticket' && data.entry.kind === 'assignees') {
    for (const user of data.entry.added) assigned.add(user.id);
  }
  if (data.kind === 'ticket' && data.entry.kind === 'created') {
    for (const user of data.entry.assignees ?? []) assigned.add(user.id);
  }
  for (const userId of assigned) watchTicket(db, ticketId, userId);

  const mentions = pendingMentions.get(ticketId) ?? new Map<number, string>();
  pendingMentions.delete(ticketId);
  const done = new Set<number>(actor.userId !== null ? [actor.userId] : []);

  for (const [userId, excerpt] of mentions) {
    if (done.has(userId) || !canSee(db, userId, projectId)) continue;
    insert(ctx, userId, 'mention', projectId, ticketId, actor, data, excerpt);
    done.add(userId);
  }
  if (options.mentionsOnly) return;
  for (const userId of assigned) {
    if (done.has(userId) || !canSee(db, userId, projectId)) continue;
    insert(ctx, userId, 'assigned', projectId, ticketId, actor, data, null);
    done.add(userId);
  }
  const watchers = db.all<{ user_id: number }>('SELECT user_id FROM ticket_watchers WHERE ticket_id = ?', ticketId).map((row) => row.user_id);
  for (const userId of watchers) {
    if (done.has(userId) || !canSee(db, userId, projectId)) continue;
    insert(ctx, userId, 'activity', projectId, ticketId, actor, data, null);
    done.add(userId);
  }
}

/**
 * Mentions dans un commentaire du journal d'activité : chaque personne nouvellement mentionnée (qui voit le projet)
 * reçoit une notification « mention » rattachée à l'évènement commenté (et à son ticket, s'il y en a un).
 */
export function notifyActivityCommentMentions(ctx: AppContext, actor: Actor, projectId: number, activity: ActivityData, text: string, previous: string): void {
  const before = mentionedUserIds(previous);
  const ticketId = 'ticketId' in activity && typeof activity.ticketId === 'number' && ctx.db.get('SELECT 1 FROM tickets WHERE id = ?', activity.ticketId) ? activity.ticketId : null;
  for (const userId of mentionedUserIds(text)) {
    if (before.has(userId) || userId === actor.userId || !canSee(ctx.db, userId, projectId)) continue;
    insert(ctx, userId, 'mention', projectId, ticketId, actor, activity, excerptAround(text, userId));
  }
}

// --- Lecture -----------------------------------------------------------------------------------------------------------

export function listNotifications(db: Db, userId: number, query: { limit: number; before?: number; unreadOnly?: boolean }): { notifications: NotificationDTO[]; unread: number; nextBefore: number | null } {
  const where = ['n.user_id = ?'];
  const params: SqlParam[] = [userId];
  if (query.before !== undefined) {
    where.push('n.id < ?');
    params.push(query.before);
  }
  if (query.unreadOnly) where.push('n.read_at IS NULL');
  const rows = db.all<NotificationRow>(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY n.id DESC LIMIT ?`, ...params, query.limit + 1);
  const page = rows.slice(0, query.limit);
  return { notifications: page.map(toDTO), unread: unreadCount(db, userId), nextBefore: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null };
}

/** Marque comme lues certaines notifications (ou toutes) ; prévient les autres onglets. */
export function markRead(ctx: AppContext, userId: number, ids: number[] | null): number {
  const now = nowIso();
  if (ids === null) {
    ctx.db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', now, userId);
  } else if (ids.length) {
    ctx.db.run(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${ids.map(() => '?').join(', ')})`, now, userId, ...ids);
  }
  const unread = unreadCount(ctx.db, userId);
  ctx.hub.sendToUser(userId, { t: 'notifications.read', unread });
  return unread;
}

/** Supprime les notifications de plus de 90 jours. */
export function purgeNotifications(db: Db): void {
  db.run('DELETE FROM notifications WHERE created_at < ?', new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString());
}
