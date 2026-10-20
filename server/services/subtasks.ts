import { LIMITS } from '../../shared/constants.ts';
import type { HistoryEntryDTO, TicketDTO } from '../../shared/types.ts';
import type { Actor, AppContext } from '../context.ts';
import { nowIso, type Db } from '../db/database.ts';
import { badRequest, notFound } from '../http/errors.ts';
import { addHistory } from './history.ts';
import type { SubtaskRow } from './rows.ts';
import { assertMembers, publishTicketChange, requireTicket, touchTicket } from './tickets.ts';

const POSITION_STEP = 1024;

export interface SubtaskInput {
  title: string;
  assigneeId?: number | null;
}

export interface SubtaskPatch {
  title?: string;
  done?: boolean;
  assigneeId?: number | null;
  /** Nouveau rang dans la liste des sous-tâches (0 = première). */
  position?: number;
}

export function requireSubtask(db: Db, subtaskId: number): SubtaskRow {
  const row = db.get<SubtaskRow>('SELECT * FROM ticket_subtasks WHERE id = ?', subtaskId);
  if (!row) {
    throw notFound('Sous-tâche introuvable.');
  }
  return row;
}

function assertAssignee(db: Db, projectId: number, assigneeId: number | null | undefined): void {
  if (assigneeId != null) {
    assertMembers(db, projectId, [assigneeId]);
  }
}

export function createSubtask(ctx: AppContext, actor: Actor, ticketId: number, input: SubtaskInput): TicketDTO {
  const { db } = ctx;
  const history: HistoryEntryDTO[] = [];
  db.transaction(() => {
    const ticket = requireTicket(db, ticketId);
    const count = db.get<{ n: number; max: number | null }>('SELECT COUNT(*) AS n, MAX(position) AS max FROM ticket_subtasks WHERE ticket_id = ?', ticketId);
    if ((count?.n ?? 0) >= LIMITS.subtasksPerTicket) {
      throw badRequest(`Un ticket ne peut pas avoir plus de ${LIMITS.subtasksPerTicket} sous-tâches.`);
    }
    assertAssignee(db, ticket.project_id, input.assigneeId);
    db.run(
      'INSERT INTO ticket_subtasks (ticket_id, title, done, position, assignee_id, created_by, created_at) VALUES (?, ?, 0, ?, ?, ?, ?)',
      ticketId,
      input.title,
      (count?.max ?? 0) + POSITION_STEP,
      input.assigneeId ?? null,
      actor.userId,
      nowIso(),
    );
    touchTicket(db, ticketId);
    history.push(addHistory(db, ticketId, actor, { kind: 'subtask', action: 'added', title: input.title }));
  });
  return publishTicketChange(ctx, actor, ticketId, history);
}

export function updateSubtask(ctx: AppContext, actor: Actor, subtaskId: number, patch: SubtaskPatch): TicketDTO {
  const { db } = ctx;
  const history: HistoryEntryDTO[] = [];
  const row = requireSubtask(db, subtaskId);
  db.transaction(() => {
    const ticket = requireTicket(db, row.ticket_id);
    const title = patch.title ?? row.title;
    const done = patch.done ?? row.done === 1;
    const assigneeId = patch.assigneeId !== undefined ? patch.assigneeId : row.assignee_id;
    if (patch.assigneeId !== undefined && patch.assigneeId !== row.assignee_id) {
      assertAssignee(db, ticket.project_id, patch.assigneeId);
    }
    let position = row.position;
    if (patch.position !== undefined) {
      const siblings = db.all<{ id: number; position: number }>(
        'SELECT id, position FROM ticket_subtasks WHERE ticket_id = ? AND id != ? ORDER BY position, id',
        row.ticket_id,
        subtaskId,
      );
      const ordered = [...siblings];
      ordered.splice(Math.max(0, Math.min(patch.position, siblings.length)), 0, { id: subtaskId, position: 0 });
      ordered.forEach((entry, index) => {
        const next = (index + 1) * POSITION_STEP;
        if (entry.id === subtaskId) position = next;
        else if (entry.position !== next) db.run('UPDATE ticket_subtasks SET position = ? WHERE id = ?', next, entry.id);
      });
    }
    const doneChanged = done !== (row.done === 1);
    db.run(
      'UPDATE ticket_subtasks SET title = ?, done = ?, assignee_id = ?, position = ?, done_at = ? WHERE id = ?',
      title,
      done ? 1 : 0,
      assigneeId,
      position,
      doneChanged ? (done ? nowIso() : null) : row.done_at,
      subtaskId,
    );
    touchTicket(db, row.ticket_id);
    if (title !== row.title) {
      history.push(addHistory(db, row.ticket_id, actor, { kind: 'subtask', action: 'renamed', title, previousTitle: row.title }));
    }
    if (doneChanged) {
      history.push(addHistory(db, row.ticket_id, actor, { kind: 'subtask', action: done ? 'done' : 'reopened', title }));
    }
  });
  return publishTicketChange(ctx, actor, row.ticket_id, history);
}

export function deleteSubtask(ctx: AppContext, actor: Actor, subtaskId: number): TicketDTO {
  const { db } = ctx;
  const row = requireSubtask(db, subtaskId);
  const history: HistoryEntryDTO[] = [];
  db.transaction(() => {
    db.run('DELETE FROM ticket_subtasks WHERE id = ?', subtaskId);
    touchTicket(db, row.ticket_id);
    history.push(addHistory(db, row.ticket_id, actor, { kind: 'subtask', action: 'removed', title: row.title }));
  });
  return publishTicketChange(ctx, actor, row.ticket_id, history);
}
