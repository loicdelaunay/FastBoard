import { LIMITS } from '../../shared/constants.ts';
import type { HistoryEntryDTO, NameRef, TicketDTO } from '../../shared/types.ts';
import type { Actor, AppContext } from '../context.ts';
import { nowIso, type Db } from '../db/database.ts';
import { badRequest, notFound } from '../http/errors.ts';
import { addHistory } from './history.ts';
import { watchTicket } from './notifications.ts';
import type { PartRow } from './rows.ts';
import { splitPlan } from '../../shared/partSplit.ts';
import { assertMembers, createTicket, getTicketDTO, insertPart, POSITION_STEP, publishTicketChange, reconcileStatus, requireTicket, touchTicket, truncate, userRef } from './tickets.ts';
import { getProjectSettings } from './projectSettings.ts';

/** Lignes d'avancement d'un ticket : un texte, une personne facultative, un pourcentage. À 100 %, la ligne est terminée. */

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
    // Terminée et 100 %, c'est tout un : un pourcentage donné décide, et une ligne rouverte quitte les 100 %.
    const done = patch.progress !== undefined ? patch.progress >= 100 : (patch.done ?? row.done === 1);
    const progress = patch.progress ?? (!done && row.progress >= 100 ? 0 : row.progress);
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

/**
 * « Découper en sous-tickets » : chaque ligne d'avancement devient un sous-ticket du ticket (voir `splitPlan`), qui
 * reprend sa personne, son avancement, et la catégorie, la priorité, la livraison, les composants et les dates du
 * ticket. Les lignes quittent le ticket, dont l'avancement suit ensuite celui de ses sous-tickets. Tout ou rien.
 */
export function splitPartsIntoTickets(ctx: AppContext, actor: Actor, ticketId: number): { ticket: TicketDTO; children: TicketDTO[] } {
  const { db } = ctx;
  const parent = requireTicket(db, ticketId);
  if (parent.parent_id !== null) throw badRequest('Ce ticket est déjà un sous-ticket : ses lignes ne peuvent pas devenir des sous-tickets (un seul niveau).');
  const parts = db.all<PartRow>('SELECT * FROM ticket_parts WHERE ticket_id = ? ORDER BY position, id', ticketId);
  if (!parts.length) throw badRequest('Ce ticket n’a aucune ligne d’avancement à découper.');
  const settings = getProjectSettings(db, parent.project_id);
  const available = (status: string): boolean => !settings.columns.find((column) => column.status === status)?.hidden;
  const shared = getTicketDTO(db, ticketId);
  const history: HistoryEntryDTO[] = [];
  const children: TicketDTO[] = [];

  db.transaction(() => {
    const before = peopleOf(db, ticketId);
    for (const part of parts) {
      const user = part.user_id === null ? null : userRef(db, part.user_id);
      const plan = splitPlan({ note: part.note, done: part.done === 1, progress: part.progress }, { title: parent.title, status: parent.status }, user?.name ?? null, available);
      const child = createTicket(ctx, actor, parent.project_id, {
        title: plan.title,
        description: plan.description || undefined,
        status: plan.status,
        categoryId: shared.categoryId,
        priorityId: shared.priorityId,
        deliveryId: shared.deliveryId,
        componentIds: shared.componentIds,
        startDate: shared.startDate,
        endDate: shared.endDate,
        progress: part.user_id === null ? (part.done === 1 ? 100 : part.progress) : 0,
        assigneeIds: part.user_id === null ? [] : [part.user_id],
        parentId: ticketId,
      });
      // La ligne de la personne garde son avancement (et sa fin).
      if (part.user_id !== null && (part.progress > 0 || part.done === 1)) {
        db.run('UPDATE ticket_parts SET progress = ?, done = ?, done_at = ? WHERE ticket_id = ? AND user_id = ?', part.done === 1 ? 100 : part.progress, part.done, part.done_at, child.id, part.user_id);
      }
      children.push(child);
      history.push(addHistory(db, ticketId, actor, { kind: 'part', action: 'removed', user, line: truncate(`${plan.title} → sous-ticket`, 200) }));
    }
    db.run('DELETE FROM ticket_parts WHERE ticket_id = ?', ticketId);
    db.run('UPDATE tickets SET progress_from_children = 1 WHERE id = ?', ticketId);
    touchTicket(db, ticketId);
    recordPeopleChange(db, actor, ticketId, before, history);
  });
  // Les sous-tickets dont la ligne avait avancé, tels qu'ils sont maintenant.
  const fresh = children.map((child) => publishTicketChange(ctx, actor, child.id, []));
  return { ticket: publishTicketChange(ctx, actor, ticketId, history), children: fresh };
}
