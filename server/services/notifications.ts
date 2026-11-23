import { DEFAULT_NOTIFICATION_LEVEL, NOTIFICATION_LEVELS, type NotificationLevel } from '../../shared/constants.ts';
import { hasPermission } from '../../shared/permissions.ts';
import type { ActivityData, NotificationDTO, NotificationSettingDTO, NotificationType } from '../../shared/types.ts';
import type { Actor, AppContext } from '../context.ts';
import { nowIso, type Db, type SqlParam } from '../db/database.ts';
import { getAuthUser, resolveProjectAccess, type AuthUser } from './access.ts';
import { getTicketDTO } from './tickets.ts';

const MENTION = /@\[[^\]\n]{1,80}\]\(user:(\d+)\)/g;
const RETENTION_DAYS = 90;

/** Identifiants des personnes mentionnées dans un texte (`@[Nom](user:12)`). */
export function mentionedUserIds(text: string): Set<number> {
  return new Set([...text.matchAll(MENTION)].map((match) => Number(match[1])));
}

/** Extrait autour de la première mention, sans le balisage des mentions. */
function excerptAround(text: string, userId: number): string {
  const plain = text.replace(/@\[([^\]\n]{1,80})\]\((?:user|ticket|doc|board):\d+(?:#[a-z]{1,12})?\)/g, '@$1').replace(/\s+/g, ' ').trim();
  const marker = text.match(new RegExp(`@\\[([^\\]\\n]{1,80})\\]\\(user:${userId}\\)`))?.[1];
  const index = marker ? plain.indexOf(`@${marker}`) : 0;
  const start = Math.max(0, index - 60);
  const slice = plain.slice(start, start + 180);
  return `${start > 0 ? '…' : ''}${slice}${start + 180 < plain.length ? '…' : ''}`;
}

// --- Abonnements -----------------------------------------------------------------------------------------------------

/** Abonne une personne au ticket ; `true` si elle ne le suivait pas encore. */
export function watchTicket(db: Db, ticketId: number, userId: number): boolean {
  return db.run('INSERT OR IGNORE INTO ticket_watchers (ticket_id, user_id, created_at) VALUES (?, ?, ?)', ticketId, userId, nowIso()).changes > 0;
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

// --- Réglages par projet -----------------------------------------------------------------------------------------------

/** Les niveaux qui reçoivent l'activité des tickets suivis. */
const RECEIVES_ACTIVITY: ReadonlySet<NotificationLevel> = new Set(['all', 'participating']);
/** Les niveaux qui reçoivent les assignations (« Mentions et assignations » compris). */
const RECEIVES_ASSIGNMENTS: ReadonlySet<NotificationLevel> = new Set(['all', 'participating', 'mentions']);

function toLevel(value: string | null | undefined): NotificationLevel {
  return (NOTIFICATION_LEVELS as readonly string[]).includes(value ?? '') ? (value as NotificationLevel) : DEFAULT_NOTIFICATION_LEVEL;
}

/** Niveau de notification d'une personne dans un projet (le défaut, « Ma participation », s'il n'a pas été choisi). */
export function notificationLevel(db: Db, userId: number, projectId: number): NotificationLevel {
  return toLevel(db.get<{ level: string }>('SELECT level FROM notification_settings WHERE user_id = ? AND project_id = ?', userId, projectId)?.level);
}

/** Niveaux choisis dans un projet (les personnes absentes ont le niveau par défaut). */
function projectLevels(db: Db, projectId: number): Map<number, NotificationLevel> {
  const rows = db.all<{ user_id: number; level: string }>('SELECT user_id, level FROM notification_settings WHERE project_id = ?', projectId);
  return new Map(rows.map((row) => [row.user_id, toLevel(row.level)]));
}

interface SettingRow {
  id: number;
  key: string;
  name: string;
  archived: number;
  level: string | null;
}

function toSettingDTO(row: SettingRow): NotificationSettingDTO {
  return { projectId: row.id, projectKey: row.key, projectName: row.name, archived: row.archived === 1, level: toLevel(row.level) };
}

/** Réglages de la personne pour chacun des projets qu'elle voit (projets archivés en dernier). */
export function listNotificationSettings(db: Db, user: AuthUser): NotificationSettingDTO[] {
  const seesAll = hasPermission(user.permissions, 'projects.view_all') || hasPermission(user.permissions, 'projects.manage_all');
  const rows = db.all<SettingRow>(
    `SELECT p.id, p.key, p.name, p.archived, s.level
       FROM projects p
       ${seesAll ? '' : 'JOIN project_members m ON m.project_id = p.id AND m.user_id = ?'}
       LEFT JOIN notification_settings s ON s.project_id = p.id AND s.user_id = ?
      ORDER BY p.archived, p.name COLLATE NOCASE`,
    ...(seesAll ? [user.id] : [user.id, user.id]),
  );
  const allowed = user.token?.projectIds ?? null;
  return rows.filter((row) => allowed === null || allowed.includes(row.id)).map(toSettingDTO);
}

/** Choisit le niveau de notification d'un projet (l'accès au projet est vérifié par la route) ; prévient les autres onglets. */
export function setNotificationLevel(ctx: AppContext, userId: number, projectId: number, level: NotificationLevel): NotificationSettingDTO {
  if (level === DEFAULT_NOTIFICATION_LEVEL) {
    ctx.db.run('DELETE FROM notification_settings WHERE user_id = ? AND project_id = ?', userId, projectId);
  } else {
    ctx.db.run(
      `INSERT INTO notification_settings (user_id, project_id, level, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, project_id) DO UPDATE SET level = excluded.level, updated_at = excluded.updated_at`,
      userId,
      projectId,
      level,
      nowIso(),
    );
  }
  ctx.hub.sendToUser(userId, { t: 'notifications.settings', projectId, level });
  const row = ctx.db.get<SettingRow>('SELECT id, key, name, archived, ? AS level FROM projects WHERE id = ?', level, projectId)!;
  return toSettingDTO(row);
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
  const data = JSON.parse(row.data) as { activity: ActivityData | null; excerpt: string | null; doc?: { nodeId: number; title: string } };
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
    doc: data.doc ?? null,
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

/** Prévient une personne qu'elle vient d'être mentionnée dans un fichier de documentation. */
export function notifyDocMention(ctx: AppContext, actor: Actor, userId: number, nodeId: number, title: string, content: string): void {
  const { lastInsertRowid } = ctx.db.run(
    "INSERT INTO notifications (user_id, type, actor_id, via, data, created_at) VALUES (?, 'mention', ?, ?, ?, ?)",
    userId,
    actor.userId,
    actor.via ?? null,
    JSON.stringify({ activity: null, excerpt: excerptAround(content, userId), doc: { nodeId, title } }),
    nowIso(),
  );
  const row = ctx.db.get<NotificationRow>(`${SELECT} WHERE n.id = ?`, lastInsertRowid);
  if (row) ctx.hub.sendToUser(userId, { t: 'notification', notification: toDTO(row), unread: unreadCount(ctx.db, userId) });
}

/**
 * Notifie les personnes concernées par un évènement du journal d'activité, selon le niveau choisi par chacune pour le
 * projet (jamais l'auteur de l'action) :
 * - mentions : notification « mention », sauf au niveau « Aucune » ; la personne mentionnée suit ensuite le ticket ;
 * - assignations : tous les niveaux sauf « Aucune » ;
 * - changements des tickets suivis : niveaux « Tout » et « Ma participation » (par défaut) ;
 * - changements des autres tickets du projet : niveau « Tout ».
 * Met aussi à jour les abonnements automatiques (créateur, assignés, commentateurs, personnes mentionnées) ; une action
 * faite avec un jeton d'API (agent, script) n'abonne pas la personne du jeton.
 */
export function notifyActivity(ctx: AppContext, actor: Actor, projectId: number, data: ActivityData, options: { mentionsOnly?: boolean } = {}): void {
  const ticketId = data.kind === 'ticket' || data.kind === 'comment' ? data.ticketId : null;
  if (ticketId === null || (data.kind === 'comment' && data.action === 'deleted')) return;
  const { db } = ctx;
  if (!db.get('SELECT 1 FROM tickets WHERE id = ?', ticketId)) return;

  let followed = false;
  const assigned = new Set<number>();
  if (actor.userId !== null && !actor.token && ((data.kind === 'ticket' && data.entry.kind === 'created') || (data.kind === 'comment' && data.action === 'created'))) {
    followed = watchTicket(db, ticketId, actor.userId) || followed;
  }
  if (data.kind === 'ticket' && data.entry.kind === 'assignees') {
    for (const user of data.entry.added) assigned.add(user.id);
  }
  if (data.kind === 'ticket' && data.entry.kind === 'created') {
    for (const user of data.entry.assignees ?? []) assigned.add(user.id);
  }
  for (const userId of assigned) followed = watchTicket(db, ticketId, userId) || followed;

  const mentions = pendingMentions.get(ticketId) ?? new Map<number, string>();
  pendingMentions.delete(ticketId);
  const levels = projectLevels(db, projectId);
  const levelOf = (userId: number): NotificationLevel => levels.get(userId) ?? DEFAULT_NOTIFICATION_LEVEL;
  const done = new Set<number>(actor.userId !== null ? [actor.userId] : []);

  for (const [userId, excerpt] of mentions) {
    if (done.has(userId) || !canSee(db, userId, projectId)) continue;
    done.add(userId);
    // Être mentionné, c'est participer : la personne suit le ticket (elle peut ne plus le suivre).
    followed = watchTicket(db, ticketId, userId) || followed;
    if (levelOf(userId) !== 'none') insert(ctx, userId, 'mention', projectId, ticketId, actor, data, excerpt);
  }
  if (!options.mentionsOnly) {
    for (const userId of assigned) {
      if (done.has(userId) || !RECEIVES_ASSIGNMENTS.has(levelOf(userId)) || !canSee(db, userId, projectId)) continue;
      insert(ctx, userId, 'assigned', projectId, ticketId, actor, data, null);
      done.add(userId);
    }
    const watchers = db.all<{ user_id: number }>('SELECT user_id FROM ticket_watchers WHERE ticket_id = ?', ticketId).map((row) => row.user_id);
    const everything = [...levels].filter(([, level]) => level === 'all').map(([userId]) => userId);
    for (const userId of [...watchers, ...everything]) {
      if (done.has(userId) || !RECEIVES_ACTIVITY.has(levelOf(userId)) || !canSee(db, userId, projectId)) continue;
      insert(ctx, userId, 'activity', projectId, ticketId, actor, data, null);
      done.add(userId);
    }
  }
  // Nouveaux abonnés : les écrans ouverts sur le ticket mettent à jour le bouton « Suivre ».
  if (followed) ctx.hub.publish(projectId, [{ type: 'ticket.updated', ticket: getTicketDTO(db, ticketId) }], actor);
}

/**
 * Mentions dans un commentaire du journal d'activité : chaque personne nouvellement mentionnée (qui voit le projet et
 * n'a pas coupé ses notifications pour ce projet) reçoit une notification « mention » rattachée à l'évènement commenté
 * (et à son ticket, s'il y en a un).
 */
export function notifyActivityCommentMentions(ctx: AppContext, actor: Actor, projectId: number, activity: ActivityData, text: string, previous: string): void {
  const before = mentionedUserIds(previous);
  const ticketId = 'ticketId' in activity && typeof activity.ticketId === 'number' && ctx.db.get('SELECT 1 FROM tickets WHERE id = ?', activity.ticketId) ? activity.ticketId : null;
  for (const userId of mentionedUserIds(text)) {
    if (before.has(userId) || userId === actor.userId || !canSee(ctx.db, userId, projectId)) continue;
    if (notificationLevel(ctx.db, userId, projectId) === 'none') continue;
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
