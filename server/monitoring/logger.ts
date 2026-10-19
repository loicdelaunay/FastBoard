import type { StatementSync } from 'node:sqlite';
import { LOG_LEVELS, type LogEntryDTO, type LogLevel } from '../../shared/monitoring.ts';
import type { Db, SqlParam } from '../db/database.ts';

const RETENTION_DAYS = 14;
const MAX_ROWS = 50_000;
const MAX_MESSAGE = 500;
const MAX_DATA = 8_000;
const FLUSH_MS = 1_000;

interface PendingLog {
  ts: string;
  level: LogLevel;
  source: string;
  message: string;
  userId: number | null;
  requestId: string | null;
  data: string | null;
}

export interface LoggerOptions {
  /** Niveau minimal conservé (les niveaux inférieurs sont ignorés). */
  minLevel: LogLevel;
  /** Recopie les alertes et erreurs (et les infos) sur la console du serveur. */
  toConsole: boolean;
}

const rank = (level: LogLevel): number => LOG_LEVELS.indexOf(level);

function serializeData(data: unknown): string | null {
  if (data === undefined || data === null) {
    return null;
  }
  try {
    const json = JSON.stringify(data);
    return json.length > MAX_DATA ? JSON.stringify({ truncated: json.slice(0, MAX_DATA) }) : json;
  } catch {
    return null;
  }
}

/**
 * Journal applicatif : les entrées sont tamponnées puis écrites en base par lots (jamais pendant une transaction
 * en cours, pour ne pas être perdues par un retour arrière).
 */
export class Logger {
  readonly #db: Db;
  readonly #options: LoggerOptions;
  #buffer: PendingLog[] = [];
  #insert: StatementSync | null = null;
  #timer: NodeJS.Timeout | null = null;
  #pruneTimer: NodeJS.Timeout | null = null;

  constructor(db: Db, options: LoggerOptions) {
    this.#db = db;
    this.#options = options;
  }

  start(): void {
    this.#timer = setInterval(() => this.flush(), FLUSH_MS);
    this.#timer.unref();
    this.#pruneTimer = setInterval(() => this.prune(), 60 * 60 * 1000);
    this.#pruneTimer.unref();
    this.prune();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    if (this.#pruneTimer) clearInterval(this.#pruneTimer);
    this.#timer = null;
    this.#pruneTimer = null;
    this.flush();
  }

  log(level: LogLevel, source: string, message: string, data?: unknown, userId?: number | null, requestId?: string | null): void {
    if (rank(level) < rank(this.#options.minLevel)) {
      return;
    }
    const entry: PendingLog = {
      ts: new Date().toISOString(),
      level,
      source,
      message: message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE - 1)}…` : message,
      userId: userId ?? null,
      requestId: requestId ?? null,
      data: serializeData(data),
    };
    this.#buffer.push(entry);
    if (this.#options.toConsole && level !== 'debug') {
      const line = `[${entry.ts.slice(11, 19)}] ${level.toUpperCase().padEnd(5)} ${source} — ${entry.message}`;
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
    }
    if (this.#buffer.length >= 2_000) {
      this.flush();
    }
  }

  debug = (source: string, message: string, data?: unknown, userId?: number | null, requestId?: string | null): void =>
    this.log('debug', source, message, data, userId, requestId);
  info = (source: string, message: string, data?: unknown, userId?: number | null, requestId?: string | null): void =>
    this.log('info', source, message, data, userId, requestId);
  warn = (source: string, message: string, data?: unknown, userId?: number | null, requestId?: string | null): void =>
    this.log('warn', source, message, data, userId, requestId);
  error = (source: string, message: string, data?: unknown, userId?: number | null, requestId?: string | null): void =>
    this.log('error', source, message, data, userId, requestId);

  /** Écrit les entrées en attente. À appeler hors transaction (la minuterie et l'arrêt du serveur s'en chargent). */
  flush(): void {
    if (this.#buffer.length === 0) {
      return;
    }
    const batch = this.#buffer;
    this.#buffer = [];
    try {
      this.#insert ??= this.#db.raw.prepare(
        'INSERT INTO app_logs (ts, level, source, message, user_id, request_id, data) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      const insert = this.#insert;
      this.#db.raw.exec('BEGIN');
      try {
        for (const entry of batch) {
          insert.run(entry.ts, entry.level, entry.source, entry.message, entry.userId, entry.requestId, entry.data);
        }
        this.#db.raw.exec('COMMIT');
      } catch (error) {
        this.#db.raw.exec('ROLLBACK');
        throw error;
      }
    } catch (error) {
      // Base fermée ou occupée : on ne fait jamais échouer l'application à cause d'un journal.
      if (this.#options.toConsole) {
        console.error('[journal] écriture impossible :', error);
      }
    }
  }

  /** Supprime les entrées trop anciennes et plafonne la taille de la table. */
  prune(): void {
    try {
      const limit = new Date(Date.now() - RETENTION_DAYS * 24 * 3600_000).toISOString();
      this.#db.raw.prepare('DELETE FROM app_logs WHERE ts < ?').run(limit);
      this.#db.raw
        .prepare('DELETE FROM app_logs WHERE id <= (SELECT id FROM app_logs ORDER BY id DESC LIMIT 1 OFFSET ?)')
        .run(MAX_ROWS);
    } catch {
      /* base indisponible */
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------------------------------------------------

export interface LogQuery {
  limit: number;
  /** Curseur : uniquement les entrées antérieures à cet identifiant (pagination vers le passé). */
  before?: number;
  /** Uniquement les entrées postérieures à cet identifiant (suivi en direct). */
  after?: number;
  levels?: LogLevel[];
  sources?: string[];
  userId?: number;
  q?: string;
  since?: string;
  until?: string;
  requestId?: string;
}

interface LogRow {
  id: number;
  ts: string;
  level: LogLevel;
  source: string;
  message: string;
  user_id: number | null;
  user_name: string | null;
  request_id: string | null;
  data: string | null;
}

function toDTO(row: LogRow): LogEntryDTO {
  let data: unknown = null;
  if (row.data) {
    try {
      data = JSON.parse(row.data);
    } catch {
      data = row.data;
    }
  }
  return { id: row.id, ts: row.ts, level: row.level, source: row.source, message: row.message, userId: row.user_id, userName: row.user_name, requestId: row.request_id, data };
}

export function queryLogs(db: Db, query: LogQuery): { logs: LogEntryDTO[]; nextBefore: number | null } {
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (query.before !== undefined) {
    where.push('l.id < ?');
    params.push(query.before);
  }
  if (query.after !== undefined) {
    where.push('l.id > ?');
    params.push(query.after);
  }
  if (query.levels?.length) {
    where.push(`l.level IN (${query.levels.map(() => '?').join(', ')})`);
    params.push(...query.levels);
  }
  if (query.sources?.length) {
    where.push(`l.source IN (${query.sources.map(() => '?').join(', ')})`);
    params.push(...query.sources);
  }
  if (query.userId !== undefined) {
    where.push('l.user_id = ?');
    params.push(query.userId);
  }
  if (query.requestId) {
    where.push('l.request_id = ?');
    params.push(query.requestId);
  }
  if (query.since) {
    where.push('l.ts >= ?');
    params.push(query.since);
  }
  if (query.until) {
    where.push('l.ts <= ?');
    params.push(query.until);
  }
  if (query.q) {
    const like = `%${query.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    where.push("(l.message LIKE ? ESCAPE '\\' OR l.data LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  const rows = db.all<LogRow>(
    `SELECT l.id, l.ts, l.level, l.source, l.message, l.user_id, u.name AS user_name, l.request_id, l.data
       FROM app_logs l LEFT JOIN users u ON u.id = l.user_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY l.id DESC LIMIT ?`,
    ...params,
    query.limit + 1,
  );
  const page = rows.slice(0, query.limit);
  return { logs: page.map(toDTO), nextBefore: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null };
}

/** Nombre d'entrées par niveau depuis une date. */
export function countLogsSince(db: Db, sinceIso: string): Record<LogLevel, number> {
  const counts: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };
  for (const row of db.all<{ level: LogLevel; n: number }>('SELECT level, COUNT(*) AS n FROM app_logs WHERE ts >= ? GROUP BY level', sinceIso)) {
    counts[row.level] = row.n;
  }
  return counts;
}
