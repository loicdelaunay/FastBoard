import type { HistoryData, HistoryEntryDTO } from '../../shared/types.ts';
import type { Db } from '../db/database.ts';
import { nowIso } from '../db/database.ts';
import { toHistoryDTO, type HistoryRow } from './rows.ts';

export function addHistory(db: Db, ticketId: number, userId: number | null, data: HistoryData): HistoryEntryDTO {
  const createdAt = nowIso();
  const { lastInsertRowid } = db.run(
    'INSERT INTO ticket_history (ticket_id, user_id, data, created_at) VALUES (?, ?, ?, ?)',
    ticketId,
    userId,
    JSON.stringify(data),
    createdAt,
  );
  return { id: lastInsertRowid, ticketId, userId, data, createdAt };
}

export function listHistory(db: Db, ticketId: number): HistoryEntryDTO[] {
  return db
    .all<HistoryRow>('SELECT * FROM ticket_history WHERE ticket_id = ? ORDER BY id DESC', ticketId)
    .map(toHistoryDTO);
}
