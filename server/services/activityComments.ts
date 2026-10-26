import type { ActivityCommentDTO, ActivityData } from '../../shared/types.ts';
import type { Actor, AppContext } from '../context.ts';
import { nowIso, type Db } from '../db/database.ts';
import { badRequest, forbidden, notFound } from '../http/errors.ts';
import { notifyActivityCommentMentions } from './notifications.ts';

/** Commentaires sur les évènements du journal d'activité (avec mentions @), diffusés en direct. */

interface ActivityCommentRow {
  id: number;
  activity_id: number;
  project_id: number;
  user_id: number | null;
  body: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export const ACTIVITY_COMMENT_MAX = 2_000;

function toDTO(row: ActivityCommentRow): ActivityCommentDTO {
  return {
    id: row.id,
    activityId: row.activity_id,
    userId: row.user_id,
    body: row.deleted_at ? '' : row.body,
    deleted: row.deleted_at !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Commentaires de plusieurs évènements, par évènement (pour une page du journal). */
export function commentsByActivity(db: Db, activityIds: number[]): Map<number, ActivityCommentDTO[]> {
  const map = new Map<number, ActivityCommentDTO[]>();
  if (!activityIds.length) return map;
  const rows = db.all<ActivityCommentRow>(`SELECT * FROM activity_comments WHERE activity_id IN (${activityIds.map(() => '?').join(', ')}) ORDER BY id`, ...activityIds);
  for (const row of rows) {
    const list = map.get(row.activity_id) ?? [];
    list.push(toDTO(row));
    map.set(row.activity_id, list);
  }
  return map;
}

export function requireActivity(db: Db, activityId: number): { id: number; project_id: number; data: string } {
  const row = db.get<{ id: number; project_id: number; data: string }>('SELECT id, project_id, data FROM activities WHERE id = ?', activityId);
  if (!row) throw notFound('Évènement introuvable.');
  return row;
}

export function requireActivityComment(db: Db, commentId: number): ActivityCommentRow {
  const row = db.get<ActivityCommentRow>('SELECT * FROM activity_comments WHERE id = ?', commentId);
  if (!row) throw notFound('Commentaire introuvable.');
  return row;
}

function publish(ctx: AppContext, actor: Actor, row: ActivityCommentRow): ActivityCommentDTO {
  const comment = toDTO(row);
  ctx.hub.publish(row.project_id, [{ type: 'activity.comment', comment }], actor);
  return comment;
}

function cleanBody(body: string): string {
  const text = body.trim();
  if (!text) throw badRequest('Le commentaire est vide.');
  return text.slice(0, ACTIVITY_COMMENT_MAX);
}

export function createActivityComment(ctx: AppContext, actor: Actor, activityId: number, body: string): ActivityCommentDTO {
  const activity = requireActivity(ctx.db, activityId);
  const text = cleanBody(body);
  const now = nowIso();
  const { lastInsertRowid } = ctx.db.run(
    'INSERT INTO activity_comments (activity_id, project_id, user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    activityId,
    activity.project_id,
    actor.userId,
    text,
    now,
    now,
  );
  const comment = publish(ctx, actor, requireActivityComment(ctx.db, lastInsertRowid));
  notifyActivityCommentMentions(ctx, actor, activity.project_id, JSON.parse(activity.data) as ActivityData, text, '');
  return comment;
}

/** Seule l'autrice ou l'auteur modifie son commentaire. */
export function updateActivityComment(ctx: AppContext, actor: Actor, commentId: number, body: string): ActivityCommentDTO {
  const row = requireActivityComment(ctx.db, commentId);
  if (row.deleted_at) throw badRequest('Ce commentaire a été supprimé.');
  if (row.user_id === null || row.user_id !== actor.userId) throw forbidden('Vous ne pouvez modifier que vos propres commentaires.');
  const text = cleanBody(body);
  ctx.db.run('UPDATE activity_comments SET body = ?, updated_at = ? WHERE id = ?', text, nowIso(), commentId);
  const comment = publish(ctx, actor, requireActivityComment(ctx.db, commentId));
  const activity = requireActivity(ctx.db, row.activity_id);
  notifyActivityCommentMentions(ctx, actor, row.project_id, JSON.parse(activity.data) as ActivityData, text, row.body);
  return comment;
}

/** Suppression logique : son autrice ou auteur, ou une personne qui modère les commentaires. */
export function deleteActivityComment(ctx: AppContext, actor: Actor, commentId: number, canModerate: boolean): ActivityCommentDTO {
  const row = requireActivityComment(ctx.db, commentId);
  if (!canModerate && (row.user_id === null || row.user_id !== actor.userId)) throw forbidden('Vous ne pouvez supprimer que vos propres commentaires.');
  if (!row.deleted_at) ctx.db.run('UPDATE activity_comments SET deleted_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), commentId);
  return publish(ctx, actor, requireActivityComment(ctx.db, commentId));
}
