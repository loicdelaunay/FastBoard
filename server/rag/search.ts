import { boardTitle } from '../../shared/boards.ts';
import { docTitle } from '../../shared/docs.ts';
import { applyRagTemplate, RAG_LIMITS, type RagHitDTO, type RagKind } from '../../shared/rag.ts';
import type { AppContext } from '../context.ts';
import { boardRole, boardsEnabled } from '../boards/store.ts';
import { docRole, docsEnabled } from '../docs/store.ts';
import { badRequest } from '../http/errors.ts';
import { resolveProjectAccess, type AuthUser } from '../services/access.ts';
import { ticketKeyOf } from '../services/tickets.ts';
import { embed, similarity } from './embeddings.ts';
import { ragIndexCurrent, ragRuntime } from './index.ts';
import { ragScopeIds } from './scopes.ts';
import { ragConfig } from './settings.ts';

/**
 * Recherche sémantique dans l'index, avec les droits de la personne qui la demande : seuls comptent les projets où elle
 * peut interroger l'IA (`ai.read`) et les espaces de documentation et de tableaux dont elle est membre, parmi ceux où le
 * RAG est activé. Chaque résultat est revérifié (élément supprimé, déplacé) avant d'être rendu.
 */

interface CachedVector {
  id: number;
  kind: RagKind;
  sourceId: number;
  containerId: number;
  vector: Float32Array;
}

const caches = new WeakMap<AppContext, { version: number; vectors: CachedVector[] }>();

/** Vecteurs de l'index, gardés en mémoire jusqu'à la prochaine écriture. */
function vectorsOf(ctx: AppContext): CachedVector[] {
  const version = ragRuntime(ctx).version;
  const cached = caches.get(ctx);
  if (cached && cached.version === version) return cached.vectors;
  const vectors = ctx.db
    .all<{ id: number; kind: RagKind; source_id: number; container_id: number; embedding: Uint8Array }>('SELECT id, kind, source_id, container_id, embedding FROM rag_chunks')
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      sourceId: row.source_id,
      containerId: row.container_id,
      vector: new Float32Array(row.embedding.buffer.slice(row.embedding.byteOffset, row.embedding.byteOffset + row.embedding.byteLength)),
    }));
  caches.set(ctx, { version, vectors });
  return vectors;
}

/** Projets et espaces que cette personne peut interroger par le RAG. */
export function ragAllowed(ctx: AppContext, user: AuthUser): Record<RagKind, Set<number>> {
  const { db } = ctx;
  const projects = ragScopeIds(db, 'project').filter((id) => resolveProjectAccess(db, user, id)?.permissions.has('ai.read'));
  const docs = docsEnabled(db) ? ragScopeIds(db, 'docs').filter((id) => docRole(db, user, id) !== null) : [];
  const boards = boardsEnabled(db) ? ragScopeIds(db, 'boards').filter((id) => boardRole(db, user, id) !== null) : [];
  return { ticket: new Set(projects), doc: new Set(docs), board: new Set(boards) };
}

interface ChunkRow {
  id: number;
  kind: RagKind;
  source_id: number;
  container_id: number;
  title: string;
  text: string;
  line_from: number | null;
  line_to: number | null;
  elements: string | null;
}

/** Titre à jour de l'élément, ou `null` s'il n'existe plus là où l'index l'a vu. */
function liveTitle(ctx: AppContext, row: ChunkRow): string | null {
  const { db } = ctx;
  if (row.kind === 'ticket') {
    const ticket = db.get<{ project_id: number; number: number; title: string }>('SELECT project_id, number, title FROM tickets WHERE id = ?', row.source_id);
    return ticket && ticket.project_id === row.container_id ? `${ticketKeyOf(db, ticket)} — ${ticket.title}` : null;
  }
  if (row.kind === 'doc') {
    const note = db.get<{ space_id: number; path: string }>("SELECT space_id, path FROM doc_nodes WHERE id = ? AND kind = 'markdown' AND deleted_at IS NULL", row.source_id);
    return note && note.space_id === row.container_id ? docTitle(note.path) : null;
  }
  const board = db.get<{ space_id: number; path: string }>("SELECT space_id, path FROM board_nodes WHERE id = ? AND kind = 'board' AND deleted_at IS NULL", row.source_id);
  return board && board.space_id === row.container_id ? boardTitle(board.path) : null;
}

export interface RagSearchResult {
  hits: RagHitDTO[];
  /** Projets et espaces interrogés (après les droits). */
  searched: number;
  indexedAt: string | null;
}

export async function ragSearch(ctx: AppContext, user: AuthUser, query: string, options: { kinds?: readonly RagKind[]; limit?: number; signal?: AbortSignal } = {}): Promise<RagSearchResult> {
  const config = ragConfig(ctx);
  if (!config) throw badRequest('La recherche sémantique (RAG) n’est pas activée.');
  const text = query.trim();
  if (!text) throw badRequest('Indiquez ce que vous cherchez.');
  if (!ragIndexCurrent(ctx, config)) throw badRequest('L’index de la recherche sémantique est en cours de reconstruction (nouveau modèle) : réessayez dans quelques minutes.');
  const allowed = ragAllowed(ctx, user);
  const kinds = new Set(options.kinds?.length ? options.kinds : (['ticket', 'doc', 'board'] as const));
  const searched = [...kinds].reduce((sum, kind) => sum + allowed[kind].size, 0);
  const indexedAt = ctx.db.get<{ at: string | null }>('SELECT MAX(indexed_at) AS at FROM rag_sources')?.at ?? null;
  const candidates = vectorsOf(ctx).filter((entry) => kinds.has(entry.kind) && allowed[entry.kind].has(entry.containerId));
  if (!candidates.length) return { hits: [], searched, indexedAt };

  const [question] = await embed(config, [applyRagTemplate(config.templates.query, text)], options.signal);
  const limit = Math.min(RAG_LIMITS.resultsMax, Math.max(1, Math.round(options.limit ?? RAG_LIMITS.resultsDefault)));
  const ranked = candidates.map((entry) => ({ entry, score: similarity(question!, entry.vector) })).sort((a, b) => b.score - a.score);

  const hits: RagHitDTO[] = [];
  const perSource = new Map<string, number>();
  for (const { entry, score } of ranked) {
    if (hits.length >= limit) break;
    const key = `${entry.kind}:${entry.sourceId}`;
    // Au plus trois passages d'un même élément : la place pour d'autres.
    if ((perSource.get(key) ?? 0) >= 3) continue;
    const row = ctx.db.get<ChunkRow>('SELECT id, kind, source_id, container_id, title, text, line_from, line_to, elements FROM rag_chunks WHERE id = ?', entry.id);
    const title = row ? liveTitle(ctx, row) : null;
    if (!row || title === null) continue;
    perSource.set(key, (perSource.get(key) ?? 0) + 1);
    hits.push({
      kind: row.kind,
      id: row.source_id,
      title,
      containerId: row.container_id,
      score: Math.round(score * 1000) / 1000,
      excerpt: row.text.slice(0, 1_500),
      ...(row.line_from !== null ? { lines: row.line_from === row.line_to ? `${row.line_from}` : `${row.line_from}-${row.line_to}` } : {}),
      ...(row.elements ? { elements: (JSON.parse(row.elements) as string[]).slice(0, RAG_LIMITS.elementsPerChunk) } : {}),
    });
  }
  return { hits, searched, indexedAt };
}
