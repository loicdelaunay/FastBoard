import type { HistoryData, HistoryEntryDTO } from '../../shared/types.ts';
import type { Actor } from '../context.ts';
import type { Db } from '../db/database.ts';
import { nowIso } from '../db/database.ts';
import { toHistoryDTO, type HistoryRow } from './rows.ts';

/** Inscrit une entrée dans l'historique du ticket, avec son auteur et, pour une action faite via l'API, le jeton utilisé. */
export function addHistory(db: Db, ticketId: number, actor: Pick<Actor, 'userId' | 'via'>, data: HistoryData): HistoryEntryDTO {
  const createdAt = nowIso();
  const via = actor.via ?? null;
  const { lastInsertRowid } = db.run(
    'INSERT INTO ticket_history (ticket_id, user_id, via, data, created_at) VALUES (?, ?, ?, ?, ?)',
    ticketId,
    actor.userId,
    via,
    JSON.stringify(data),
    createdAt,
  );
  return { id: lastInsertRowid, ticketId, userId: actor.userId, via, data, createdAt };
}

export function listHistory(db: Db, ticketId: number): HistoryEntryDTO[] {
  return db
    .all<HistoryRow>('SELECT * FROM ticket_history WHERE ticket_id = ? ORDER BY id DESC', ticketId)
    .map(toHistoryDTO);
}
