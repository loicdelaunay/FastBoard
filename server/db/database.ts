import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';

export type SqlParam = SQLInputValue;

/** Petite surcouche synchrone autour de `node:sqlite` : cache de requêtes préparées et transactions. */
export class Db {
  readonly raw: DatabaseSync;
  readonly #statements = new Map<string, StatementSync>();
  #depth = 0;

  constructor(file: string) {
    if (file !== ':memory:') {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL');
    this.raw.exec('PRAGMA foreign_keys = ON');
    this.raw.exec('PRAGMA busy_timeout = 5000');
    this.raw.exec('PRAGMA synchronous = NORMAL');
  }

  #prepare(sql: string): StatementSync {
    let statement = this.#statements.get(sql);
    if (!statement) {
      statement = this.raw.prepare(sql);
      this.#statements.set(sql, statement);
    }
    return statement;
  }

  /** Compteurs cumulés depuis le démarrage (lus par la supervision). */
  readonly stats = { queries: 0, totalMs: 0, slow: 0 };
  /** Appelé pour chaque requête plus lente que `slowQueryMs`. */
  onSlowQuery: ((sql: string, ms: number) => void) | null = null;
  slowQueryMs = 100;

  #timed<T>(sql: string, fn: () => T): T {
    const start = performance.now();
    try {
      return fn();
    } finally {
      const ms = performance.now() - start;
      this.stats.queries += 1;
      this.stats.totalMs += ms;
      if (ms >= this.slowQueryMs) {
        this.stats.slow += 1;
        this.onSlowQuery?.(sql, ms);
      }
    }
  }

  all<T>(sql: string, ...params: SqlParam[]): T[] {
    return this.#timed(sql, () => this.#prepare(sql).all(...params) as unknown as T[]);
  }

  get<T>(sql: string, ...params: SqlParam[]): T | undefined {
    return this.#timed(sql, () => this.#prepare(sql).get(...params) as unknown as T | undefined);
  }

  run(sql: string, ...params: SqlParam[]): { changes: number; lastInsertRowid: number } {
    const result = this.#timed(sql, () => this.#prepare(sql).run(...params));
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /** Exécute `fn` dans une transaction (les appels imbriqués rejoignent la transaction en cours). */
  transaction<T>(fn: () => T): T {
    if (this.#depth > 0) {
      return fn();
    }
    this.raw.exec('BEGIN IMMEDIATE');
    this.#depth++;
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      return result;
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    } finally {
      this.#depth--;
    }
  }

  close(): void {
    this.#statements.clear();
    this.raw.close();
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
