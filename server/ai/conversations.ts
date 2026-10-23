import { AI_LIMITS, type AiContext, type AiConversationDTO, type AiConversationSummaryDTO } from '../../shared/ai.ts';
import { nowIso, type Db } from '../db/database.ts';
import { HttpError, notFound } from '../http/errors.ts';

/** Conversations de l'assistant IA : chaque personne retrouve ses 50 dernières, dans le panneau ou la page dédiée. */

interface ConversationRow {
  id: string;
  user_id: number;
  title: string;
  context: string;
  turns: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

function summary(row: Omit<ConversationRow, 'turns' | 'context'>): AiConversationSummaryDTO {
  return { id: row.id, title: row.title, messageCount: row.message_count, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function listConversations(db: Db, userId: number): AiConversationSummaryDTO[] {
  return db
    .all<ConversationRow>('SELECT id, user_id, title, message_count, created_at, updated_at FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?', userId, AI_LIMITS.conversations)
    .map(summary);
}

function requireOwn(db: Db, userId: number, id: string): ConversationRow {
  const row = db.get<ConversationRow>('SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?', id, userId);
  if (!row) throw notFound('Conversation introuvable.');
  return row;
}

export function getConversation(db: Db, userId: number, id: string): AiConversationDTO {
  const row = requireOwn(db, userId, id);
  return { ...summary(row), context: JSON.parse(row.context) as AiContext, turns: JSON.parse(row.turns) as unknown[] };
}

export interface ConversationInput {
  title: string;
  context: AiContext;
  turns: unknown[];
}

/** Crée ou remplace une conversation, puis ne garde que les 50 plus récentes de la personne. */
export function saveConversation(db: Db, userId: number, id: string, input: ConversationInput): AiConversationSummaryDTO {
  const turns = JSON.stringify(input.turns);
  if (turns.length > AI_LIMITS.conversationChars) {
    throw new HttpError(413, 'Conversation trop longue pour être enregistrée : commencez-en une nouvelle.', 'too_large');
  }
  const owner = db.get<{ user_id: number }>('SELECT user_id FROM ai_conversations WHERE id = ?', id);
  if (owner && owner.user_id !== userId) throw notFound('Conversation introuvable.');
  const now = nowIso();
  const messageCount = input.turns.filter((turn) => (turn as { role?: string } | null)?.role === 'user').length;
  db.transaction(() => {
    if (owner) {
      db.run('UPDATE ai_conversations SET title = ?, context = ?, turns = ?, message_count = ?, updated_at = ? WHERE id = ?', input.title, JSON.stringify(input.context), turns, messageCount, now, id);
    } else {
      db.run(
        'INSERT INTO ai_conversations (id, user_id, title, context, turns, message_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        id,
        userId,
        input.title,
        JSON.stringify(input.context),
        turns,
        messageCount,
        now,
        now,
      );
    }
    db.run(
      'DELETE FROM ai_conversations WHERE user_id = ? AND id NOT IN (SELECT id FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?)',
      userId,
      userId,
      AI_LIMITS.conversations,
    );
  });
  return summary(requireOwn(db, userId, id));
}

export function deleteConversation(db: Db, userId: number, id: string): void {
  requireOwn(db, userId, id);
  db.run('DELETE FROM ai_conversations WHERE id = ?', id);
}
