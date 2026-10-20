/** Objets de la supervision (indicateurs de performance et journaux), partagés serveur ↔ interface. */

// --- Journaux ------------------------------------------------------------------------------------------------------------

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const LOG_SOURCES = ['system', 'http', 'auth', 'admin', 'project', 'storage', 'db', 'realtime', 'backup', 'service'] as const;
export type LogSource = (typeof LOG_SOURCES)[number];

export const LOG_LEVEL_META: Record<LogLevel, { label: string; severity: 'secondary' | 'info' | 'warn' | 'danger' }> = {
  debug: { label: 'Debug', severity: 'secondary' },
  info: { label: 'Info', severity: 'info' },
  warn: { label: 'Alerte', severity: 'warn' },
  error: { label: 'Erreur', severity: 'danger' },
};

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

export interface LogEntryDTO {
  id: number;
  ts: string;
  level: LogLevel;
  source: string;
  message: string;
  userId: number | null;
  userName: string | null;
  /** Identifiant de requête (en-tête `X-Request-Id`) pour retrouver l'erreur vue par un utilisateur. */
  requestId: string | null;
  data: unknown;
}

// --- Performances --------------------------------------------------------------------------------------------------------

/** Bornes supérieures (ms) de l'histogramme de latence ; une classe de plus reçoit tout ce qui les dépasse. */
export const LATENCY_BOUNDS_MS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000] as const;

export const MONITORING_RANGES = {
  '15m': { label: '15 min', ms: 15 * 60_000 },
  '1h': { label: '1 h', ms: 60 * 60_000 },
  '6h': { label: '6 h', ms: 6 * 60 * 60_000 },
  '24h': { label: '24 h', ms: 24 * 60 * 60_000 },
  '3d': { label: '3 jours', ms: 3 * 24 * 60 * 60_000 },
} as const;
export type MonitoringRange = keyof typeof MONITORING_RANGES;

export function isMonitoringRange(value: unknown): value is MonitoringRange {
  return typeof value === 'string' && value in MONITORING_RANGES;
}

/** Durée de conservation des indicateurs par minute. */
export const METRICS_RETENTION_MS = MONITORING_RANGES['3d'].ms;

export interface SeriesPoint {
  /** Début de la période (ms depuis 1970). */
  t: number;
  requests: number;
  errors4xx: number;
  errors5xx: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  /** Processeur utilisé par le serveur, en % d'un cœur. */
  cpu: number;
  rssMb: number;
  heapMb: number;
  /** Retard de la boucle d'évènements (p99, ms) : un serveur saturé répond avec retard. */
  lagMs: number;
  wsClients: number;
  dbQueries: number;
  dbAvgMs: number;
}

export interface RouteStatDTO {
  method: string;
  route: string;
  count: number;
  errors: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
}

export interface MonitoringSummaryDTO {
  requests: number;
  requestsPerMinute: number;
  errors4xx: number;
  errors5xx: number;
  /** Part des réponses en erreur serveur (0–100). */
  errorRate: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  /** Répartition des latences : nombre de requêtes par classe de `LATENCY_BOUNDS_MS` (+ dépassement). */
  histogram: number[];
}

export interface TableCountDTO {
  name: string;
  rows: number;
}

export interface MonitoringOverviewDTO {
  startedAt: string;
  uptimeSeconds: number;
  nodeVersion: string;
  platform: string;
  pid: number;
  cpuCount: number;
  process: { rssMb: number; heapUsedMb: number; heapTotalMb: number; externalMb: number; cpuPercent: number; lagMs: number };
  system: { totalMemMb: number; freeMemMb: number; loadAverage: number[] };
  realtime: { clients: number; usersOnline: number; messagesIn: number; messagesOut: number };
  database: {
    fileMb: number;
    walMb: number;
    queries: number;
    avgQueryMs: number;
    slowQueries: number;
    tables: TableCountDTO[];
  };
  storage: { attachments: number; attachmentsMb: number };
  logs: { errors24h: number; warnings24h: number };
}

export interface HealthDTO {
  status: 'ok' | 'degraded' | 'critical';
  reasons: string[];
}

export interface MonitoringSnapshotDTO {
  range: MonitoringRange;
  generatedAt: string;
  /** Durée couverte par chaque point de `series` (ms). */
  stepMs: number;
  overview: MonitoringOverviewDTO;
  summary: MonitoringSummaryDTO;
  series: SeriesPoint[];
  routes: RouteStatDTO[];
  health: HealthDTO;
}
