import fs from 'node:fs';
import os from 'node:os';
import type { HealthDTO, MonitoringOverviewDTO, MonitoringRange, MonitoringSnapshotDTO, MonitoringSummaryDTO } from '../../shared/monitoring.ts';
import type { AppContext } from '../context.ts';
import { countLogsSince } from './logger.ts';

const MB = 1024 * 1024;
const round = (value: number, digits = 1): number => Math.round(value * 10 ** digits) / 10 ** digits;

const COUNTED_TABLES = [
  ['users', 'Utilisateurs'],
  ['projects', 'Projets'],
  ['tickets', 'Tickets'],
  ['ticket_comments', 'Commentaires'],
  ['ticket_attachments', 'Pièces jointes'],
  ['ticket_history', 'Historique des tickets'],
  ['activities', 'Journal d\'activité'],
  ['sessions', 'Sessions'],
  ['api_tokens', "Jetons d'API"],
  ['app_logs', 'Journaux serveur'],
  ['metrics_minutes', 'Indicateurs (minutes)'],
] as const;

function fileSize(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/** Les comptages de tables ne changent pas vite : on les met en cache pour ne pas les refaire à chaque rafraîchissement. */
const tableCache = new WeakMap<AppContext, { at: number; tables: Array<{ name: string; rows: number }> }>();

function tableCounts(ctx: AppContext): Array<{ name: string; rows: number }> {
  const cached = tableCache.get(ctx);
  if (cached && Date.now() - cached.at < 15_000) {
    return cached.tables;
  }
  const tables = COUNTED_TABLES.map(([table, name]) => ({
    name,
    rows: ctx.db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n as number,
  }));
  tableCache.set(ctx, { at: Date.now(), tables });
  return tables;
}

export function buildOverview(ctx: AppContext): MonitoringOverviewDTO {
  const memory = process.memoryUsage();
  const files = ctx.db.raw.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM ticket_attachments').get() as { n: number; bytes: number };
  const logs = countLogsSince(ctx.db, new Date(Date.now() - 24 * 3600_000).toISOString());
  const queries = ctx.db.stats.queries;
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
    },
    database: {
      fileMb: round(fileSize(ctx.config.dbPath) / MB, 2),
      walMb: round(fileSize(`${ctx.config.dbPath}-wal`) / MB, 2),
      queries,
      avgQueryMs: queries ? round(ctx.db.stats.totalMs / queries, 3) : 0,
      slowQueries: ctx.db.stats.slow,
      tables: tableCounts(ctx),
    },
    storage: { attachments: files.n, attachmentsMb: round(files.bytes / MB, 2) },
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
