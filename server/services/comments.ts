import type { CommentDTO } from '../../shared/types.ts';
import type { Actor, AppContext } from '../context.ts';
import { nowIso, type Db } from '../db/database.ts';
import { badRequest, forbidden, notFound } from '../http/errors.ts';
import { logActivity } from './activity.ts';
import { toCommentDTO, type CommentRow } from './rows.ts';
import { requireTicket, ticketKeyOf } from './tickets.ts';

function excerptOf(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > 160 ? flat.slice(0, 159) + '…' : flat;
}

function countComments(db: Db, ticketId: number): number {
  return db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ticket_comments WHERE ticket_id = ? AND deleted_at IS NULL', ticketId)?.n ?? 0;
}

export function listComments(db: Db, ticketId: number): CommentDTO[] {
  return db
    .all<CommentRow>('SELECT * FROM ticket_comments WHERE ticket_id = ? ORDER BY id', ticketId)
    .map(toCommentDTO);
}

export function requireComment(db: Db, commentId: number): CommentRow {
  const comment = db.get<CommentRow>('SELECT * FROM ticket_comments WHERE id = ?', commentId);
  if (!comment) {
    throw notFound('Commentaire introuvable.');
  }
  return comment;
}

export function createComment(
  ctx: AppContext,
  actor: Actor,
  ticketId: number,
  input: { body: string; parentId?: number | null },
): CommentDTO {
  const { db } = ctx;
  const ticket = requireTicket(db, ticketId);
  if (input.parentId != null) {
    const parent = requireComment(db, input.parentId);
    if (parent.ticket_id !== ticketId || parent.deleted_at !== null) {
      throw badRequest('Le message auquel vous répondez est introuvable.');
    }
  }
  const { lastInsertRowid } = db.run(
    'INSERT INTO ticket_comments (ticket_id, user_id, parent_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
    ticketId,
    actor.userId,
    input.parentId ?? null,
    input.body,
    nowIso(),
  );
  const comment = toCommentDTO(requireComment(db, lastInsertRowid));
  ctx.hub.publish(ticket.project_id, [{ type: 'comment.created', comment, commentCount: countComments(db, ticketId) }], actor);
  logActivity(ctx, actor, ticket.project_id, {
    kind: 'comment',
    action: 'created',
    ticketId,
    ticketKey: ticketKeyOf(db, ticket),
    ticketTitle: ticket.title,
    excerpt: excerptOf(input.body),
    reply: input.parentId != null,
  });
  return comment;
}

export function updateComment(ctx: AppContext, actor: Actor, commentId: number, body: string): CommentDTO {
  const { db } = ctx;
  const row = requireComment(db, commentId);
  if (row.deleted_at !== null) {
    throw notFound('Commentaire introuvable.');
  }
  if (row.user_id !== actor.userId) {
    throw forbidden('Vous ne pouvez modifier que vos propres messages.');
  }
  db.run('UPDATE ticket_comments SET body = ?, updated_at = ? WHERE id = ?', body, nowIso(), commentId);
  const ticket = requireTicket(db, row.ticket_id);
  const comment = toCommentDTO(requireComment(db, commentId));
  ctx.hub.publish(ticket.project_id, [{ type: 'comment.updated', comment, commentCount: countComments(db, row.ticket_id) }], actor);
  return comment;
}

/** Suppression logique : les réponses restent visibles sous un message « supprimé ». */
export function deleteComment(ctx: AppContext, actor: Actor, commentId: number, canModerate: boolean): CommentDTO {
  const { db } = ctx;
  const row = requireComment(db, commentId);
  if (row.deleted_at !== null) {
    throw notFound('Commentaire introuvable.');
  }
  if (row.user_id !== actor.userId && !canModerate) {
    throw forbidden('Vous ne pouvez supprimer que vos propres messages.');
  }
  db.run('UPDATE ticket_comments SET deleted_at = ? WHERE id = ?', nowIso(), commentId);
  const ticket = requireTicket(db, row.ticket_id);
  const comment = toCommentDTO(requireComment(db, commentId));
  ctx.hub.publish(ticket.project_id, [{ type: 'comment.deleted', comment, commentCount: countComments(db, row.ticket_id) }], actor);
  logActivity(ctx, actor, ticket.project_id, {
    kind: 'comment',
    action: 'deleted',
    ticketId: row.ticket_id,
    ticketKey: ticketKeyOf(db, ticket),
    ticketTitle: ticket.title,
    excerpt: excerptOf(row.body),
    reply: row.parent_id !== null,
  });
  return comment;
}
