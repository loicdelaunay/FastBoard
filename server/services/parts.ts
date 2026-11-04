import { LIMITS } from '../../shared/constants.ts';
import type { HistoryEntryDTO, NameRef, TicketDTO } from '../../shared/types.ts';
import type { Actor, AppContext } from '../context.ts';
import { nowIso, type Db } from '../db/database.ts';
import { badRequest, notFound } from '../http/errors.ts';
import { addHistory } from './history.ts';
import { watchTicket } from './notifications.ts';
import type { PartRow } from './rows.ts';
import { assertMembers, insertPart, POSITION_STEP, publishTicketChange, reconcileStatus, requireTicket, touchTicket, truncate, userRef } from './tickets.ts';

/** Lignes d'avancement d'un ticket : un texte, une personne facultative, un pourcentage, terminée ou non. */

export interface PartCreate {
  note?: string;
  userId?: number | null;
}

export interface PartPatch extends PartCreate {
  done?: boolean;
  progress?: number;
  /** Nouveau rang dans la liste (0 = première). */
  position?: number;
}

const EMPTY_LINE = 'Une ligne a besoin d’un texte ou d’une personne.';

export function requirePart(db: Db, partId: number): PartRow {
  const row = db.get<PartRow>('SELECT * FROM ticket_parts WHERE id = ?', partId);
  if (!row) throw notFound('Ligne d’avancement introuvable.');
  return row;
}

function peopleOf(db: Db, ticketId: number): Set<number> {
  return new Set(db.all<{ user_id: number }>('SELECT DISTINCT user_id FROM ticket_parts WHERE ticket_id = ? AND user_id IS NOT NULL', ticketId).map((row) => row.user_id));
}

/** Une personne arrivée sur le ticket ou qui l'a quitté : assignation à l'historique, et suivi du ticket pour qui arrive. */
function recordPeopleChange(db: Db, actor: Actor, ticketId: number, before: Set<number>, history: HistoryEntryDTO[]): void {
  const after = peopleOf(db, ticketId);
  const added = [...after].filter((id) => !before.has(id));
  const removed = [...before].filter((id) => !after.has(id));
  if (!added.length && !removed.length) return;
  for (const id of added) watchTicket(db, ticketId, id);
  const refs = (ids: number[]): NameRef[] => ids.map((id) => userRef(db, id));
  history.push(addHistory(db, ticketId, actor, { kind: 'assignees', added: refs(added), removed: refs(removed) }));
}

export function createPart(ctx: AppContext, actor: Actor, ticketId: number, input: PartCreate): TicketDTO {
  const { db } = ctx;
  const history: HistoryEntryDTO[] = [];
  const note = (input.note ?? '').trim();
  const userId = input.userId ?? null;
  if (!note && userId === null) throw badRequest(EMPTY_LINE);
  db.transaction(() => {
    const ticket = requireTicket(db, ticketId);
    const count = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ticket_parts WHERE ticket_id = ?', ticketId)?.n ?? 0;
    if (count >= LIMITS.partsPerTicket) throw badRequest(`Un ticket ne peut pas avoir plus de ${LIMITS.partsPerTicket} lignes d’avancement.`);
    if (userId !== null) assertMembers(db, ticket.project_id, [userId]);
    const before = peopleOf(db, ticketId);
    insertPart(db, ticketId, userId, note);
    touchTicket(db, ticketId);
    history.push(addHistory(db, ticketId, actor, { kind: 'part', action: 'added', user: userId === null ? null : userRef(db, userId), line: truncate(note, 200) }));
    recordPeopleChange(db, actor, ticketId, before, history);
    // Une ligne de plus à faire rouvre un ticket terminé automatiquement.
    reconcileStatus(db, actor, ticketId, { events: [], history }, { reopened: true });
  });
  return publishTicketChange(ctx, actor, ticketId, history);
}

/** Replace la ligne au rang voulu et renumérote les autres ; retourne sa nouvelle position. */
function reorder(db: Db, row: PartRow, rank: number): number {
  const siblings = db.all<{ id: number; position: number }>('SELECT id, position FROM ticket_parts WHERE ticket_id = ? AND id != ? ORDER BY position, id', row.ticket_id, row.id);
  const ordered = [...siblings];
  ordered.splice(Math.max(0, Math.min(rank, siblings.length)), 0, { id: row.id, position: 0 });
  let position = row.position;
  ordered.forEach((entry, index) => {
    const next = (index + 1) * POSITION_STEP;
    if (entry.id === row.id) position = next;
    else if (entry.position !== next) db.run('UPDATE ticket_parts SET position = ? WHERE id = ?', next, entry.id);
  });
  return position;
}

export function updatePart(ctx: AppContext, actor: Actor, partId: number, patch: PartPatch): TicketDTO {
  const { db } = ctx;
  const history: HistoryEntryDTO[] = [];
  const row = requirePart(db, partId);
  db.transaction(() => {
    const ticket = requireTicket(db, row.ticket_id);
    const note = patch.note !== undefined ? patch.note.trim() : row.note;
    const userId = patch.userId !== undefined ? patch.userId : row.user_id;
    if (!note && userId === null) throw badRequest(EMPTY_LINE);
    const userChanged = userId !== row.user_id;
    if (userChanged && userId !== null) assertMembers(db, ticket.project_id, [userId]);
    const done = patch.done ?? row.done === 1;
    const progress = patch.progress ?? row.progress;
    const doneChanged = done !== (row.done === 1);
    const before = peopleOf(db, row.ticket_id);
    const position = patch.position === undefined ? row.position : reorder(db, row, patch.position);
    db.run(
      'UPDATE ticket_parts SET note = ?, user_id = ?, done = ?, progress = ?, position = ?, done_at = ? WHERE id = ?',
      note,
      userId,
      done ? 1 : 0,
      progress,
      position,
      doneChanged ? (done ? nowIso() : null) : row.done_at,
      partId,
    );
    const noteChanged = note !== row.note;
    if (!noteChanged && !userChanged && !doneChanged && progress === row.progress && position === row.position) return;
    touchTicket(db, row.ticket_id);

    const user = userId === null ? null : userRef(db, userId);
    const line = truncate(note, 200);
    if (userChanged) history.push(addHistory(db, row.ticket_id, actor, { kind: 'part', action: 'assigned', user, line }));
    if (noteChanged) history.push(addHistory(db, row.ticket_id, actor, { kind: 'part', user, line, note: line }));
    recordPeopleChange(db, actor, row.ticket_id, before, history);
    if (doneChanged) {
      history.push(addHistory(db, row.ticket_id, actor, { kind: 'part', user, line, done }));
      reconcileStatus(db, actor, row.ticket_id, { events: [], history }, { reopened: !done });
    } else if (progress !== row.progress) {
      history.push(addHistory(db, row.ticket_id, actor, { kind: 'part', user, line, progress }));
    }
  });
  return publishTicketChange(ctx, actor, row.ticket_id, history);
}

export function deletePart(ctx: AppContext, actor: Actor, partId: number): TicketDTO {
  const { db } = ctx;
  const row = requirePart(db, partId);
  const history: HistoryEntryDTO[] = [];
  db.transaction(() => {
    const before = peopleOf(db, row.ticket_id);
    const user = row.user_id === null ? null : userRef(db, row.user_id);
    db.run('DELETE FROM ticket_parts WHERE id = ?', partId);
    touchTicket(db, row.ticket_id);
    history.push(addHistory(db, row.ticket_id, actor, { kind: 'part', action: 'removed', user, line: truncate(row.note, 200) }));
    recordPeopleChange(db, actor, row.ticket_id, before, history);
    reconcileStatus(db, actor, row.ticket_id, { events: [], history }, { reopened: false });
  });
  return publishTicketChange(ctx, actor, row.ticket_id, history);
}
