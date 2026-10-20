import { LIMITS } from '../../shared/constants.ts';
import type { HistoryEntryDTO, TicketDTO } from '../../shared/types.ts';
import type { Actor, AppContext } from '../context.ts';
import { nowIso, type Db } from '../db/database.ts';
import { badRequest, conflict, notFound } from '../http/errors.ts';
import { addHistory } from './history.ts';
import type { LinkRow, TicketRow } from './rows.ts';
import { publishTicketChange, requireTicket, ticketKeyOf, touchTicket } from './tickets.ts';

export interface LinkInput {
  targetId: number;
  /** Raison choisie dans `LINK_REASONS` ou saisie librement. */
  reason: string;
}

export function requireLink(db: Db, linkId: number): LinkRow {
  const row = db.get<LinkRow>('SELECT * FROM ticket_links WHERE id = ?', linkId);
  if (!row) {
    throw notFound('Dépendance introuvable.');
  }
  return row;
}

function targetRef(db: Db, target: TicketRow): { id: number; key: string; title: string } {
  return { id: target.id, key: ticketKeyOf(db, target), title: target.title };
}

/** Ajoute une dépendance vers un autre ticket du même projet. */
export function createLink(ctx: AppContext, actor: Actor, ticketId: number, input: LinkInput): TicketDTO {
  const { db } = ctx;
  const history: HistoryEntryDTO[] = [];
  db.transaction(() => {
    const ticket = requireTicket(db, ticketId);
    if (input.targetId === ticketId) {
      throw badRequest('Un ticket ne peut pas dépendre de lui-même.');
    }
    const target = db.get<TicketRow>('SELECT * FROM tickets WHERE id = ?', input.targetId);
    if (!target || target.project_id !== ticket.project_id) {
      throw badRequest("Le ticket lié doit appartenir au même projet.");
    }
    const count = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ticket_links WHERE ticket_id = ?', ticketId)?.n ?? 0;
    if (count >= LIMITS.linksPerTicket) {
      throw badRequest(`Un ticket ne peut pas avoir plus de ${LIMITS.linksPerTicket} dépendances.`);
    }
    if (db.get('SELECT 1 FROM ticket_links WHERE ticket_id = ? AND target_id = ? AND reason = ?', ticketId, input.targetId, input.reason)) {
      throw conflict('Cette dépendance existe déjà.');
    }
    db.run(
      'INSERT INTO ticket_links (ticket_id, target_id, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
      ticketId,
      input.targetId,
      input.reason,
      actor.userId,
      nowIso(),
    );
    touchTicket(db, ticketId);
    history.push(addHistory(db, ticketId, actor, { kind: 'link', action: 'added', reason: input.reason, target: targetRef(db, target) }));
  });
  return publishTicketChange(ctx, actor, ticketId, history);
}

export function deleteLink(ctx: AppContext, actor: Actor, linkId: number): TicketDTO {
  const { db } = ctx;
  const row = requireLink(db, linkId);
  const history: HistoryEntryDTO[] = [];
  db.transaction(() => {
    const target = requireTicket(db, row.target_id);
    db.run('DELETE FROM ticket_links WHERE id = ?', linkId);
    touchTicket(db, row.ticket_id);
    history.push(addHistory(db, row.ticket_id, actor, { kind: 'link', action: 'removed', reason: row.reason, target: targetRef(db, target) }));
  });
  return publishTicketChange(ctx, actor, row.ticket_id, history);
}
