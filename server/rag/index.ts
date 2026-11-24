import { createHash } from 'node:crypto';
import { boardTitle } from '../../shared/boards.ts';
import { docTitle } from '../../shared/docs.ts';
import { applyRagTemplate, RAG_LIMITS, RAG_SCOPE_OF, RAG_SCOPES, type RagKind, type RagScope, type RagStatusDTO } from '../../shared/rag.ts';
import type { AppContext } from '../context.ts';
import { nowIso, type Db } from '../db/database.ts';
import { readBoardElements } from '../boards/store.ts';
import { readText } from '../docs/store.ts';
import { readSetting, writeSetting } from '../services/appSettings.ts';
import { listComments } from '../services/comments.ts';
import { listTicketDTOs, ticketKeyOf } from '../services/tickets.ts';
import { boardChunks, docChunks, textChunks, type RagChunk } from './chunks.ts';
import { embed } from './embeddings.ts';
import { ragScopeEnabled, ragScopeIds } from './scopes.ts';
import { ragConfig, type RagConfig } from './settings.ts';

/**
 * Index du RAG : les tickets, notes et tableaux des projets et espaces où le RAG est activé, découpés en passages et
 * transformés en vecteurs. Une indexation ne recalcule que ce qui a changé (empreinte du contenu) ; elle repart de zéro
 * si le modèle, son format ou la taille des passages changent. Elle se lance d'elle-même tous les `intervalHours`,
 * quand on active un projet ou un espace, ou à la demande (administration).
 */

interface RagState {
  signature: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastDurationMs: number | null;
  dimensions: number | null;
}

const STATE_KEY = 'rag_state';

function readState(db: Db): RagState {
  const value = readSetting<Partial<RagState>>(db, STATE_KEY);
  return {
    signature: value?.signature ?? null,
    lastRunAt: value?.lastRunAt ?? null,
    lastSuccessAt: value?.lastSuccessAt ?? null,
    lastError: value?.lastError ?? null,
    lastDurationMs: value?.lastDurationMs ?? null,
    dimensions: value?.dimensions ?? null,
  };
}

interface Runtime {
  running: Promise<void> | null;
  progress: { done: number; total: number } | null;
  abort: AbortController | null;
  soon: NodeJS.Timeout | null;
  /** Change à chaque écriture de l'index : les vecteurs gardés en mémoire pour la recherche sont relus. */
  version: number;
}

const runtimes = new WeakMap<AppContext, Runtime>();
export function ragRuntime(ctx: AppContext): Runtime {
  let runtime = runtimes.get(ctx);
  if (!runtime) {
    runtime = { running: null, progress: null, abort: null, soon: null, version: 0 };
    runtimes.set(ctx, runtime);
  }
  return runtime;
}

// --- Projets et espaces où le RAG est activé ------------------------------------------------------------------------

export { ragScopeEnabled, ragScopeIds };

/** Retire de l'index tout ce qui vient d'un projet ou d'un espace. */
function forgetContainer(ctx: AppContext, scope: RagScope, containerId: number): void {
  const kind = (Object.keys(RAG_SCOPE_OF) as RagKind[]).find((entry) => RAG_SCOPE_OF[entry] === scope)!;
  ctx.db.run('DELETE FROM rag_chunks WHERE kind = ? AND container_id = ?', kind, containerId);
  ctx.db.run('DELETE FROM rag_sources WHERE kind = ? AND container_id = ?', kind, containerId);
  ragRuntime(ctx).version += 1;
}

/**
 * Active ou coupe le RAG d'un projet ou d'un espace. Coupé, son contenu quitte l'index aussitôt ; activé, il est
 * indexé dans les secondes qui suivent.
 */
export function setRagScope(ctx: AppContext, scope: RagScope, containerId: number, enabled: boolean, userId: number | null): void {
  if (enabled === ragScopeEnabled(ctx.db, scope, containerId)) return;
  if (enabled) {
    ctx.db.run('INSERT INTO rag_scopes (scope, container_id, enabled_by, enabled_at) VALUES (?, ?, ?, ?)', scope, containerId, userId, nowIso());
    requestRagRun(ctx);
  } else {
    ctx.db.run('DELETE FROM rag_scopes WHERE scope = ? AND container_id = ?', scope, containerId);
    forgetContainer(ctx, scope, containerId);
  }
  ctx.logger.info('ai', `RAG ${enabled ? 'activé' : 'désactivé'} : ${scope} ${containerId}`, { scope, containerId }, userId);
}

// --- Ce qui s'indexe ---------------------------------------------------------------------------------------------------

interface Source {
  kind: RagKind;
  id: number;
  containerId: number;
  hash: string;
  chunks: () => RagChunk[];
}

const hashOf = (...parts: string[]): string => createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 24);

function collectSources(ctx: AppContext, config: RagConfig): Source[] {
  const { db } = ctx;
  const sources: Source[] = [];
  const names = new Map(db.all<{ id: number; name: string }>('SELECT id, name FROM users').map((row) => [row.id, row.name]));
  // Projet ou espace supprimé : son activation part avec lui.
  for (const [scope, table] of [['project', 'projects'], ['docs', 'doc_spaces'], ['boards', 'board_spaces']] as const) {
    for (const id of ragScopeIds(db, scope)) if (!db.get(`SELECT 1 AS found FROM ${table} WHERE id = ?`, id)) db.run('DELETE FROM rag_scopes WHERE scope = ? AND container_id = ?', scope, id);
  }
  for (const projectId of ragScopeIds(db, 'project')) {
    for (const ticket of listTicketDTOs(db, projectId)) {
      const title = `${ticketKeyOf(db, { project_id: projectId, number: ticket.number })} — ${ticket.title}`;
      const comments = listComments(db, ticket.id)
        .filter((comment) => !comment.deleted)
        .map((comment) => `${(comment.userId ? names.get(comment.userId) : null) ?? '?'} : ${comment.body}`);
      const parts = ticket.parts.map((part) => part.note).filter(Boolean);
      const text = [ticket.description, parts.length ? `Avancement :\n${parts.map((note) => `- ${note}`).join('\n')}` : '', comments.length ? `Commentaires :\n\n${comments.join('\n\n')}` : '']
        .filter(Boolean)
        .join('\n\n')
        .slice(0, RAG_LIMITS.ticketChars);
      sources.push({ kind: 'ticket', id: ticket.id, containerId: projectId, hash: hashOf(title, text), chunks: () => textChunks(title, text || ticket.title, config.chunkChars) });
    }
  }
  for (const spaceId of ragScopeIds(db, 'docs')) {
    const notes = db.all<{ id: number; space_id: number; path: string; kind: 'markdown'; updated_at: string }>(
      "SELECT id, space_id, path, kind, updated_at FROM doc_nodes WHERE space_id = ? AND kind = 'markdown' AND deleted_at IS NULL",
      spaceId,
    );
    for (const note of notes) {
      const text = readText(ctx, note);
      const title = docTitle(note.path);
      sources.push({ kind: 'doc', id: note.id, containerId: spaceId, hash: hashOf(note.path, text), chunks: () => docChunks(title, text, config.chunkChars) });
    }
  }
  for (const spaceId of ragScopeIds(db, 'boards')) {
    const boards = db.all<{ id: number; path: string; updated_at: string }>("SELECT id, path, updated_at FROM board_nodes WHERE space_id = ? AND kind = 'board' AND deleted_at IS NULL", spaceId);
    for (const board of boards) {
      const elements = readBoardElements(ctx, board);
      const title = boardTitle(board.path);
      sources.push({ kind: 'board', id: board.id, containerId: spaceId, hash: hashOf(board.path, JSON.stringify(elements)), chunks: () => boardChunks(title, elements, config.chunkChars) });
    }
  }
  return sources;
}

/** Texte envoyé au modèle pour un passage : le gabarit du document (avec son titre, ou le titre en tête du texte). */
export function documentInput(config: Pick<RagConfig, 'templates'>, chunk: RagChunk): string {
  const template = config.templates.document;
  return template.includes('{title}') ? applyRagTemplate(template, chunk.text, chunk.title) : applyRagTemplate(template, `${chunk.title}\n\n${chunk.text}`);
}

function writeSource(db: Db, source: Source, chunks: RagChunk[], vectors: Float32Array[], signature: string): void {
  db.transaction(() => {
    db.run('DELETE FROM rag_chunks WHERE kind = ? AND source_id = ?', source.kind, source.id);
    chunks.forEach((chunk, position) => {
      const vector = vectors[position]!;
      db.run(
        'INSERT INTO rag_chunks (kind, source_id, container_id, position, title, text, line_from, line_to, elements, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        source.kind,
        source.id,
        source.containerId,
        position,
        chunk.title,
        chunk.text,
        chunk.lineFrom ?? null,
        chunk.lineTo ?? null,
        chunk.elements?.length ? JSON.stringify(chunk.elements) : null,
        new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength),
      );
    });
    db.run(
      `INSERT INTO rag_sources (kind, source_id, container_id, hash, signature, chunk_count, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (kind, source_id) DO UPDATE SET container_id = excluded.container_id, hash = excluded.hash, signature = excluded.signature,
         chunk_count = excluded.chunk_count, indexed_at = excluded.indexed_at`,
      source.kind,
      source.id,
      source.containerId,
      source.hash,
      signature,
      chunks.length,
      nowIso(),
    );
  });
}

/** Vide tout l'index (nouveau modèle, ou reconstruction demandée). */
function clearIndex(ctx: AppContext): void {
  ctx.db.run('DELETE FROM rag_chunks');
  ctx.db.run('DELETE FROM rag_sources');
  ragRuntime(ctx).version += 1;
}

/**
 * Indexe ce qui a changé (une seule indexation à la fois : un appel pendant l'indexation attend la même). `rebuild` :
 * tout recalculer.
 */
export function runRagIndex(ctx: AppContext, options: { rebuild?: boolean } = {}): Promise<void> {
  const runtime = ragRuntime(ctx);
  if (runtime.running) return runtime.running;
  const config = ragConfig(ctx);
  if (!config) return Promise.resolve();
  runtime.abort = new AbortController();
  runtime.running = indexAll(ctx, config, runtime, options.rebuild === true).finally(() => {
    runtime.running = null;
    runtime.progress = null;
    runtime.abort = null;
  });
  return runtime.running;
}

async function indexAll(ctx: AppContext, config: RagConfig, runtime: Runtime, rebuild: boolean): Promise<void> {
  const started = Date.now();
  const state = readState(ctx.db);
  const save = (patch: Partial<RagState>) => writeSetting(ctx.db, STATE_KEY, { ...readState(ctx.db), ...patch });
  save({ lastRunAt: nowIso() });
  try {
    if (rebuild || state.signature !== config.signature) {
      clearIndex(ctx);
      save({ signature: config.signature, dimensions: null });
    }
    const sources = collectSources(ctx, config);
    // Ce qui n'existe plus (supprimé, ou projet et espace coupés) quitte l'index.
    const wanted = new Set(sources.map((source) => `${source.kind}:${source.id}`));
    for (const row of ctx.db.all<{ kind: RagKind; source_id: number }>('SELECT kind, source_id FROM rag_sources')) {
      if (wanted.has(`${row.kind}:${row.source_id}`)) continue;
      ctx.db.run('DELETE FROM rag_chunks WHERE kind = ? AND source_id = ?', row.kind, row.source_id);
      ctx.db.run('DELETE FROM rag_sources WHERE kind = ? AND source_id = ?', row.kind, row.source_id);
      runtime.version += 1;
    }
    const known = new Map(ctx.db.all<{ kind: RagKind; source_id: number; hash: string; signature: string; container_id: number }>('SELECT kind, source_id, hash, signature, container_id FROM rag_sources').map((row) => [`${row.kind}:${row.source_id}`, row]));
    const todo = sources.filter((source) => {
      const row = known.get(`${source.kind}:${source.id}`);
      return !row || row.hash !== source.hash || row.signature !== config.signature || row.container_id !== source.containerId;
    });
    runtime.progress = { done: 0, total: todo.length };
    // Par lots : plusieurs petits éléments (tickets) partagent une requête d'embeddings.
    let batch: Array<{ source: Source; chunks: RagChunk[] }> = [];
    let size = 0;
    let dimensions = state.signature === config.signature ? state.dimensions : null;
    const flush = async () => {
      if (!batch.length) return;
      const inputs = batch.flatMap(({ chunks }) => chunks.map((chunk) => documentInput(config, chunk)));
      const vectors = inputs.length ? await embed(config, inputs, runtime.abort?.signal) : [];
      let offset = 0;
      for (const { source, chunks } of batch) {
        writeSource(ctx.db, source, chunks, vectors.slice(offset, offset + chunks.length), config.signature);
        offset += chunks.length;
      }
      dimensions = vectors[0]?.length ?? dimensions;
      runtime.version += 1;
      runtime.progress = { done: (runtime.progress?.done ?? 0) + batch.length, total: todo.length };
      batch = [];
      size = 0;
    };
    for (const source of todo) {
      if (runtime.abort?.signal.aborted) return;
      const chunks = source.chunks();
      batch.push({ source, chunks });
      size += chunks.length;
      if (size >= RAG_LIMITS.batch) await flush();
    }
    await flush();
    save({ lastSuccessAt: nowIso(), lastError: null, lastDurationMs: Date.now() - started, dimensions, signature: config.signature });
    if (todo.length) ctx.logger.info('ai', `RAG : ${todo.length} élément(s) indexé(s) en ${Math.round((Date.now() - started) / 100) / 10} s`, { sources: sources.length, model: config.model });
  } catch (error) {
    if ((error as Error).name === 'AbortError') return;
    save({ lastError: (error as Error).message, lastDurationMs: Date.now() - started });
    ctx.logger.warn('ai', `RAG : indexation interrompue (${(error as Error).message})`, { model: config.model });
  }
}

/** Une indexation dans les secondes qui suivent (plusieurs demandes rapprochées n'en font qu'une). */
export function requestRagRun(ctx: AppContext, delayMs = 3_000): void {
  const runtime = ragRuntime(ctx);
  if (runtime.soon) clearTimeout(runtime.soon);
  runtime.soon = setTimeout(() => {
    runtime.soon = null;
    void runRagIndex(ctx);
  }, delayMs);
  runtime.soon.unref();
}

/** Indexation périodique : vérifiée chaque minute, lancée quand l'intervalle réglé est écoulé. Renvoie de quoi l'arrêter. */
export function startRagScheduler(ctx: AppContext): () => void {
  const tick = () => {
    const config = ragConfig(ctx);
    if (!config || ragRuntime(ctx).running) return;
    const state = readState(ctx.db);
    const last = state.lastRunAt ? Date.parse(state.lastRunAt) : 0;
    if (state.signature !== config.signature || Date.now() - last >= config.intervalHours * 3_600_000) void runRagIndex(ctx);
  };
  const first = setTimeout(tick, 15_000);
  first.unref();
  const timer = setInterval(tick, 60_000);
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
    const runtime = ragRuntime(ctx);
    if (runtime.soon) clearTimeout(runtime.soon);
    runtime.abort?.abort();
  };
}

export function ragStatus(ctx: AppContext): RagStatusDTO {
  const config = ragConfig(ctx);
  const state = readState(ctx.db);
  const runtime = ragRuntime(ctx);
  const counts = ctx.db.all<{ kind: RagKind; sources: number; chunks: number }>('SELECT kind, COUNT(*) AS sources, SUM(chunk_count) AS chunks FROM rag_sources GROUP BY kind');
  const last = state.lastRunAt ? Date.parse(state.lastRunAt) : null;
  return {
    running: runtime.running !== null,
    progress: runtime.progress,
    lastRunAt: state.lastRunAt,
    lastSuccessAt: state.lastSuccessAt,
    lastError: state.lastError,
    lastDurationMs: state.lastDurationMs,
    nextRunAt: config ? new Date(last === null ? Date.now() : last + config.intervalHours * 3_600_000).toISOString() : null,
    dimensions: state.dimensions,
    stale: config !== null && state.signature !== null && state.signature !== config.signature,
    scopes: RAG_SCOPES.map((scope) => {
      const kind = (Object.keys(RAG_SCOPE_OF) as RagKind[]).find((entry) => RAG_SCOPE_OF[entry] === scope)!;
      const count = counts.find((row) => row.kind === kind);
      return { scope, enabled: ragScopeIds(ctx.db, scope).length, sources: count?.sources ?? 0, chunks: count?.chunks ?? 0 };
    }),
  };
}

/** L'index correspond-il aux réglages actuels (vecteurs comparables à une question) ? */
export function ragIndexCurrent(ctx: AppContext, config: RagConfig): boolean {
  return readState(ctx.db).signature === config.signature;
}
