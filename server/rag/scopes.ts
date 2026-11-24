import type { RagScope } from '../../shared/rag.ts';
import type { Db } from '../db/database.ts';

/** Projets et espaces où le RAG est activé (table `rag_scopes` ; aucun par défaut). */
export function ragScopeIds(db: Db, scope: RagScope): number[] {
  return db.all<{ container_id: number }>('SELECT container_id FROM rag_scopes WHERE scope = ?', scope).map((row) => row.container_id);
}

export function ragScopeEnabled(db: Db, scope: RagScope, containerId: number): boolean {
  return Boolean(db.get('SELECT 1 AS found FROM rag_scopes WHERE scope = ? AND container_id = ?', scope, containerId));
}
