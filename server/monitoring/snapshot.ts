import fs from 'node:fs';
import os from 'node:os';
import type { HealthDTO, MonitoringOverviewDTO, MonitoringRange, MonitoringSnapshotDTO, MonitoringSummaryDTO, TableCountDTO } from '../../shared/monitoring.ts';
import type { AppContext } from '../context.ts';
import { countLogsSince } from './logger.ts';

const MB = 1024 * 1024;
const round = (value: number, digits = 1): number => Math.round(value * 10 ** digits) / 10 ** digits;

/** Tables comptées dans « Contenu », par rubrique ; une requête SQL au lieu d'un nom de table pour un comptage filtré. */
const COUNTED: ReadonlyArray<{ group: string; name: string; sql: string }> = [
  ...(
    [
      ['projects', 'Projets'],
      ['tickets', 'Tickets'],
      ['ticket_comments', 'Commentaires'],
      ['ticket_attachments', 'Pièces jointes'],
      ['ticket_history', 'Historique des tickets'],
      ['activities', "Journal d'activité"],
    ] as const
  ).map(([table, name]) => ({ group: 'Projets et tickets', name, sql: `SELECT COUNT(*) AS n FROM ${table}` })),
  { group: 'Documentation', name: 'Espaces de documentation', sql: 'SELECT COUNT(*) AS n FROM doc_spaces' },
  { group: 'Documentation', name: 'Notes', sql: "SELECT COUNT(*) AS n FROM doc_nodes WHERE kind = 'markdown' AND deleted_at IS NULL" },
  { group: 'Documentation', name: 'Images de la documentation', sql: "SELECT COUNT(*) AS n FROM doc_nodes WHERE kind = 'image' AND deleted_at IS NULL" },
  { group: 'Documentation', name: 'Modèles de notes', sql: "SELECT COUNT(*) AS n FROM doc_nodes WHERE kind = 'template' AND deleted_at IS NULL" },
  { group: 'Documentation', name: 'Versions des notes', sql: 'SELECT COUNT(*) AS n FROM doc_versions' },
  { group: 'Documentation', name: 'Commentaires des notes', sql: 'SELECT COUNT(*) AS n FROM doc_comments' },
  { group: 'Documentation', name: 'Sites publiés', sql: 'SELECT COUNT(*) AS n FROM doc_sites' },
  { group: 'Tableaux blancs', name: 'Espaces de tableaux', sql: 'SELECT COUNT(*) AS n FROM board_spaces' },
  { group: 'Tableaux blancs', name: 'Tableaux blancs', sql: "SELECT COUNT(*) AS n FROM board_nodes WHERE kind = 'board' AND deleted_at IS NULL" },
  { group: 'Tableaux blancs', name: 'Modèles de tableaux', sql: "SELECT COUNT(*) AS n FROM board_nodes WHERE kind = 'template' AND deleted_at IS NULL" },
  { group: 'Tableaux blancs', name: 'Éléments des tableaux', sql: 'SELECT COALESCE(SUM(element_count), 0) AS n FROM board_nodes WHERE deleted_at IS NULL' },
  { group: 'Tableaux blancs', name: 'Versions des tableaux', sql: 'SELECT COUNT(*) AS n FROM board_versions' },
  { group: 'Tableaux blancs', name: 'Tableaux partagés par un lien', sql: 'SELECT COUNT(*) AS n FROM board_shares' },
  { group: 'Assistant IA', name: 'Conversations', sql: 'SELECT COUNT(*) AS n FROM ai_conversations' },
  { group: 'Assistant IA', name: 'Passages indexés (RAG)', sql: 'SELECT COUNT(*) AS n FROM rag_chunks' },
  ...(
    [
      ['users', 'Utilisateurs'],
      ['sessions', 'Sessions'],
      ['api_tokens', "Jetons d'API"],
      ['notifications', 'Notifications'],
      ['app_logs', 'Journaux serveur'],
      ['metrics_minutes', 'Indicateurs (minutes)'],
    ] as const
  ).map(([table, name]) => ({ group: 'Comptes et système', name, sql: `SELECT COUNT(*) AS n FROM ${table}` })),
];

function fileSize(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/** Les comptages de tables ne changent pas vite : on les met en cache pour ne pas les refaire à chaque rafraîchissement. */
const tableCache = new WeakMap<AppContext, { at: number; tables: TableCountDTO[]; storage: Omit<MonitoringOverviewDTO['storage'], 'attachments' | 'attachmentsMb'> }>();

/** Oublie les comptages en cache (tests). */
export function forgetContentCounts(ctx: AppContext): void {
  tableCache.delete(ctx);
}

/** Comptages et volumes stockés (cache de 15 s). */
function contentCounts(ctx: AppContext): { tables: TableCountDTO[]; storage: Omit<MonitoringOverviewDTO['storage'], 'attachments' | 'attachmentsMb'> } {
  const cached = tableCache.get(ctx);
  if (cached && Date.now() - cached.at < 15_000) {
    return cached;
  }
  const one = <T>(sql: string): T => ctx.db.raw.prepare(sql).get() as T;
  const tables = COUNTED.map(({ group, name, sql }) => ({ group, name, rows: Number(one<{ n: number }>(sql).n) }));
  const docs = one<{ notes: number; images: number; bytes: number }>(
    "SELECT COALESCE(SUM(kind = 'markdown'), 0) AS notes, COALESCE(SUM(kind = 'image'), 0) AS images, COALESCE(SUM(size), 0) AS bytes FROM doc_nodes WHERE deleted_at IS NULL AND kind != 'folder'",
  );
  const trash = one<{ n: number; bytes: number }>("SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM doc_nodes WHERE deleted_at IS NOT NULL AND kind != 'folder'");
  const assets = one<{ n: number; bytes: number }>('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM board_assets');
  const rag = one<{ n: number; bytes: number }>('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(embedding) + LENGTH(text)), 0) AS bytes FROM rag_chunks');
  const storage = {
    docNotes: docs.notes,
    docImages: docs.images,
    docFilesMb: round(docs.bytes / MB, 2),
    docTrash: trash.n,
    docTrashMb: round(trash.bytes / MB, 2),
    boardAssets: assets.n,
    boardAssetsMb: round(assets.bytes / MB, 2),
    ragChunks: rag.n,
    ragMb: round(rag.bytes / MB, 2),
  };
  const entry = { at: Date.now(), tables, storage };
  tableCache.set(ctx, entry);
  return entry;
}

export function buildOverview(ctx: AppContext): MonitoringOverviewDTO {
  const memory = process.memoryUsage();
  const files = ctx.db.raw.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM ticket_attachments').get() as { n: number; bytes: number };
  const logs = countLogsSince(ctx.db, new Date(Date.now() - 24 * 3600_000).toISOString());
  const queries = ctx.db.stats.queries;
  const content = contentCounts(ctx);
  const docRooms = ctx.docRooms?.stats() ?? { rooms: 0, peers: 0 };
  const boardRooms = ctx.boardRooms?.stats() ?? { rooms: 0, peers: 0, guests: 0 };
  return {
    startedAt: ctx.metrics.startedAt.toISOString(),
    uptimeSeconds: Math.round((Date.now() - ctx.metrics.startedAt.getTime()) / 1000),
    nodeVersion: process.version,
    platform: `${os.platform()} ${os.arch()}`,
    pid: process.pid,
    cpuCount: os.cpus().length,
    process: {
      rssMb: round(memory.rss / MB),
      heapUsedMb: round(memory.heapUsed / MB),
      heapTotalMb: round(memory.heapTotal / MB),
      externalMb: round(memory.external / MB),
      cpuPercent: round(ctx.metrics.last.cpu),
      lagMs: round(ctx.metrics.last.lag, 2),
    },
    system: { totalMemMb: Math.round(os.totalmem() / MB), freeMemMb: Math.round(os.freemem() / MB), loadAverage: os.loadavg().map((value) => round(value, 2)) },
    realtime: {
      clients: ctx.hub.clientCount,
      usersOnline: ctx.hub.onlineUserIds().length,
      messagesIn: ctx.hub.traffic.in,
      messagesOut: ctx.hub.traffic.out,
      docRooms: docRooms.rooms,
      docEditors: docRooms.peers,
      boardRooms: boardRooms.rooms,
      boardViewers: boardRooms.peers,
      boardGuests: boardRooms.guests,
    },
    database: {
      fileMb: round(fileSize(ctx.config.dbPath) / MB, 2),
      walMb: round(fileSize(`${ctx.config.dbPath}-wal`) / MB, 2),
      queries,
      avgQueryMs: queries ? round(ctx.db.stats.totalMs / queries, 3) : 0,
      slowQueries: ctx.db.stats.slow,
      tables: content.tables,
    },
    storage: { attachments: files.n, attachmentsMb: round(files.bytes / MB, 2), ...content.storage },
    logs: { errors24h: logs.error, warnings24h: logs.warn },
  };
}

/** Évalue la santé du serveur sur les 15 dernières minutes. */
export function assessHealth(summary: MonitoringSummaryDTO, lagMs: number): HealthDTO {
  const reasons: string[] = [];
  let status: HealthDTO['status'] = 'ok';
  const raise = (level: 'degraded' | 'critical', reason: string): void => {
    reasons.push(reason);
    if (level === 'critical' || status === 'ok') {
      status = level;
    }
  };
  if (summary.requests >= 20) {
    if (summary.errorRate >= 5) raise('critical', `${round(summary.errorRate)} % de réponses en erreur serveur`);
    else if (summary.errorRate >= 1) raise('degraded', `${round(summary.errorRate)} % de réponses en erreur serveur`);
    if (summary.p95Ms >= 2000) raise('critical', `Latence p95 de ${Math.round(summary.p95Ms)} ms`);
    else if (summary.p95Ms >= 500) raise('degraded', `Latence p95 de ${Math.round(summary.p95Ms)} ms`);
  }
  if (lagMs >= 500) raise('critical', `Boucle d'évènements en retard de ${Math.round(lagMs)} ms`);
  else if (lagMs >= 100) raise('degraded', `Boucle d'évènements en retard de ${Math.round(lagMs)} ms`);
  const usedRatio = 1 - os.freemem() / os.totalmem();
  if (usedRatio >= 0.95) raise('degraded', `Mémoire de la machine utilisée à ${Math.round(usedRatio * 100)} %`);
  return { status, reasons };
}

export function buildSnapshot(ctx: AppContext, range: MonitoringRange): MonitoringSnapshotDTO {
  const window = ctx.metrics.window(range);
  const recent = range === '15m' ? window.summary : ctx.metrics.window('15m').summary;
  const overview = buildOverview(ctx);
  return {
    range,
    generatedAt: new Date().toISOString(),
    stepMs: window.stepMs,
    overview,
    summary: window.summary,
    series: window.series,
    routes: window.routes,
    health: assessHealth(recent, ctx.metrics.last.lag),
  };
}
