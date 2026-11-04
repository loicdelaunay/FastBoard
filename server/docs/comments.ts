import type { DocCommentDTO, DocQuote } from '../../shared/docComments.ts';
import { docRoleAtLeast, docTitle, type DocRole } from '../../shared/docs.ts';
import type { Actor, AppContext } from '../context.ts';
import { nowIso, type Db } from '../db/database.ts';
import { badRequest, forbidden, notFound } from '../http/errors.ts';
import { getAuthUser } from '../services/access.ts';
import { mentionedUserIds, notifyDocMention } from '../services/notifications.ts';
import { docRole, requireNode, type NodeRow } from './store.ts';

/** Commentaires d'une note : posés sur un passage, avec des réponses, et marqués « résolus » une fois traités. */

interface CommentRow {
  id: number;
  node_id: number;
  parent_id: number | null;
  user_id: number | null;
  body: string;
  quote: string;
  before_text: string;
  after_text: string;
  resolved_at: string | null;
  resolved_by: number | null;
  created_at: string;
}

function toDTO(row: CommentRow): DocCommentDTO {
  return {
    id: row.id,
    nodeId: row.node_id,
    parentId: row.parent_id,
    userId: row.user_id,
    body: row.body,
    quote: row.quote,
    before: row.before_text,
    after: row.after_text,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    createdAt: row.created_at,
  };
}

export function listComments(db: Db, nodeId: number): DocCommentDTO[] {
  return db.all<CommentRow>('SELECT * FROM doc_comments WHERE node_id = ? ORDER BY id', nodeId).map(toDTO);
}

function requireComment(db: Db, commentId: number): CommentRow {
  const row = db.get<CommentRow>('SELECT * FROM doc_comments WHERE id = ?', commentId);
  if (!row) throw notFound('Commentaire introuvable.');
  return row;
}

/** Note d'un commentaire, et son espace : de quoi vérifier l'accès avant d'y toucher. */
export function commentNode(db: Db, commentId: number): NodeRow {
  return requireNode(db, requireComment(db, commentId).node_id);
}

function publish(ctx: AppContext, node: NodeRow): void {
  ctx.docRooms.publishComments(node.space_id, node.id, listComments(ctx.db, node.id));
}

export function createComment(ctx: AppContext, actor: Actor, node: NodeRow, input: DocQuote & { body: string; parentId?: number | undefined }): DocCommentDTO {
  const { db } = ctx;
  const parent = input.parentId === undefined ? null : requireComment(db, input.parentId);
  if (parent && parent.node_id !== node.id) throw badRequest('Ce commentaire appartient à une autre note.');
  if (!parent && !input.quote) throw badRequest('Sélectionnez le passage à commenter.');
  // Une réponse suit le fil de son premier commentaire.
  const threadId = parent ? (parent.parent_id ?? parent.id) : null;
  const { lastInsertRowid } = db.run(
    'INSERT INTO doc_comments (node_id, parent_id, user_id, body, quote, before_text, after_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    node.id,
    threadId,
    actor.userId,
    input.body,
    parent ? '' : input.quote,
    parent ? '' : input.before,
    parent ? '' : input.after,
    nowIso(),
  );
  for (const userId of mentionedUserIds(input.body)) {
    if (userId === actor.userId) continue;
    const account = getAuthUser(db, userId);
    if (account?.isActive && docRole(db, account, node.space_id)) notifyDocMention(ctx, actor, userId, node.id, docTitle(node.path), input.body);
  }
  publish(ctx, node);
  return toDTO(requireComment(db, lastInsertRowid));
}

export function resolveComment(ctx: AppContext, actor: Actor, commentId: number, resolved: boolean): DocCommentDTO {
  const { db } = ctx;
  const row = requireComment(db, commentId);
  if (row.parent_id !== null) throw badRequest('Seul le premier commentaire d’un fil se résout.');
  db.run('UPDATE doc_comments SET resolved_at = ?, resolved_by = ? WHERE id = ?', resolved ? nowIso() : null, resolved ? actor.userId : null, commentId);
  publish(ctx, requireNode(db, row.node_id));
  return toDTO(requireComment(db, commentId));
}

/** Son auteur ou un propriétaire de l'espace ; les réponses partent avec le premier commentaire. */
export function deleteComment(ctx: AppContext, actor: Actor, commentId: number, role: DocRole): void {
  const { db } = ctx;
  const row = requireComment(db, commentId);
  if (row.user_id !== actor.userId && !docRoleAtLeast(role, 'owner')) throw forbidden();
  db.run('DELETE FROM doc_comments WHERE id = ?', commentId);
  publish(ctx, requireNode(db, row.node_id));
}
