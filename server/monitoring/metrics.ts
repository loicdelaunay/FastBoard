import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { StatementSync } from 'node:sqlite';
import {
  LATENCY_BOUNDS_MS,
  METRICS_RETENTION_MS,
  MONITORING_RANGES,
  type MonitoringRange,
  type MonitoringSummaryDTO,
  type RouteStatDTO,
  type SeriesPoint,
} from '../../shared/monitoring.ts';
import type { Db } from '../db/database.ts';

const MINUTE = 60_000;
const SAMPLE_MS = 5_000;
const MAX_ROUTES_PER_BUCKET = 80;
const BINS = LATENCY_BOUNDS_MS.length + 1;
const MB = 1024 * 1024;

/** Indicateurs d'une minute. Les champs sont courts car la ligne est stockée telle quelle en base. */
export interface Bucket {
  /** Début de la minute (ms). */
  t: number;
  /** Requêtes, erreurs 4xx, erreurs 5xx. */
  n: number;
  e4: number;
  e5: number;
  /** Somme et maximum des durées (ms). */
  ms: number;
  max: number;
  /** Histogramme des durées. */
  h: number[];
  /** Par route (« GET /api/tickets/:id ») : [requêtes, erreurs 5xx, somme ms, max ms, ...histogramme]. */
  r: Record<string, number[]>;
  /** Somme des échantillons de processeur (% d'un cœur) et nombre d'échantillons. */
  cpu: number;
  s: number;
  /** Maxima : mémoire résidente et tas (octets), retard de boucle p99 et max (ms), clients WebSocket. */
  rss: number;
  heap: number;
  lag: number;
  lagMax: number;
  ws: number;
  /** Requêtes SQL et durée cumulée (ms). */
  dbq: number;
  dbms: number;
}

function emptyBucket(t: number): Bucket {
  return { t, n: 0, e4: 0, e5: 0, ms: 0, max: 0, h: new Array<number>(BINS).fill(0), r: {}, cpu: 0, s: 0, rss: 0, heap: 0, lag: 0, lagMax: 0, ws: 0, dbq: 0, dbms: 0 };
}

function binOf(ms: number): number {
  const index = LATENCY_BOUNDS_MS.findIndex((bound) => ms <= bound);
  return index < 0 ? BINS - 1 : index;
}

/** Percentile estimé à partir de l'histogramme (interpolation linéaire dans la classe), borné par le maximum observé. */
export function percentile(histogram: number[], p: number, max: number): number {
  const total = histogram.reduce((sum, count) => sum + count, 0);
  if (total === 0) {
    return 0;
  }
  const target = total * p;
  let seen = 0;
  for (let i = 0; i < histogram.length; i++) {
    const count = histogram[i] ?? 0;
    if (count > 0 && seen + count >= target) {
      const low = i === 0 ? 0 : (LATENCY_BOUNDS_MS[i - 1] ?? 0);
      const high = i < LATENCY_BOUNDS_MS.length ? (LATENCY_BOUNDS_MS[i] ?? low) : Math.max(max, low);
      return Math.min(max || high, low + ((high - low) * (target - seen)) / count);
    }
    seen += count;
  }
  return max;
}

function mergeInto(target: Bucket, source: Bucket): void {
  target.n += source.n;
  target.e4 += source.e4;
  target.e5 += source.e5;
  target.ms += source.ms;
  target.max = Math.max(target.max, source.max);
  source.h.forEach((count, i) => (target.h[i] = (target.h[i] ?? 0) + count));
  for (const [key, entry] of Object.entries(source.r)) {
    const existing = target.r[key];
    if (!existing) {
      target.r[key] = [...entry];
      continue;
    }
    existing[0]! += entry[0]!;
    existing[1]! += entry[1]!;
    existing[2]! += entry[2]!;
    existing[3] = Math.max(existing[3]!, entry[3]!);
    for (let i = 4; i < entry.length; i++) existing[i] = (existing[i] ?? 0) + entry[i]!;
  }
  target.cpu += source.cpu;
  target.s += source.s;
  target.rss = Math.max(target.rss, source.rss);
  target.heap = Math.max(target.heap, source.heap);
  target.lag = Math.max(target.lag, source.lag);
  target.lagMax = Math.max(target.lagMax, source.lagMax);
  target.ws = Math.max(target.ws, source.ws);
  target.dbq += source.dbq;
  target.dbms += source.dbms;
}

function toPoint(bucket: Bucket): SeriesPoint {
  return {
    t: bucket.t,
    requests: bucket.n,
    errors4xx: bucket.e4,
    errors5xx: bucket.e5,
    avgMs: bucket.n ? bucket.ms / bucket.n : 0,
    p50Ms: percentile(bucket.h, 0.5, bucket.max),
    p95Ms: percentile(bucket.h, 0.95, bucket.max),
    p99Ms: percentile(bucket.h, 0.99, bucket.max),
    maxMs: bucket.max,
    cpu: bucket.s ? bucket.cpu / bucket.s : 0,
    rssMb: bucket.rss / MB,
    heapMb: bucket.heap / MB,
    lagMs: bucket.lag,
    wsClients: bucket.ws,
    dbQueries: bucket.dbq,
    dbAvgMs: bucket.dbq ? bucket.dbms / bucket.dbq : 0,
  };
}

export interface MetricsSources {
  wsClients: () => number;
}

export interface MetricsWindow {
  stepMs: number;
  series: SeriesPoint[];
  summary: MonitoringSummaryDTO;
  routes: RouteStatDTO[];
}

/**
 * Indicateurs de performance : requêtes HTTP (latence, erreurs, routes), processeur, mémoire, boucle d'évènements,
 * WebSocket et SQLite. Agrégés par minute, gardés en mémoire et sauvegardés en base pour survivre aux redémarrages.
 */
export class Metrics {
  readonly startedAt = new Date();
  readonly #db: Db;
  readonly #sources: MetricsSources;
  #current: Bucket;
  #history: Bucket[] = [];
  #loop: ReturnType<typeof monitorEventLoopDelay> | null = null;
  #timer: NodeJS.Timeout | null = null;
  #lastCpu = process.cpuUsage();
  #lastSample = performance.now();
  #lastDb = { queries: 0, totalMs: 0 };
  #upsert: StatementSync | null = null;
  /** Dernières valeurs échantillonnées (pour l'aperçu instantané). */
  last = { cpu: 0, lag: 0 };

  constructor(db: Db, sources: MetricsSources) {
    this.#db = db;
    this.#sources = sources;
    this.#current = emptyBucket(this.#minute());
    this.#lastDb = { queries: db.stats.queries, totalMs: db.stats.totalMs };
    this.#load();
    this.#sampleMemory(this.#current);
  }

  /** Mémoire et clients WebSocket : relevés dès l'ouverture d'une minute, pour qu'aucune ne soit vide. */
  #sampleMemory(bucket: Bucket): void {
    const memory = process.memoryUsage();
    bucket.rss = Math.max(bucket.rss, memory.rss);
    bucket.heap = Math.max(bucket.heap, memory.heapUsed);
    bucket.ws = Math.max(bucket.ws, this.#sources.wsClients());
  }

  #minute(now = Date.now()): number {
    return Math.floor(now / MINUTE) * MINUTE;
  }

  /** Recharge l'historique conservé en base ; une minute en cours avant un redémarrage est reprise. */
  #load(): void {
    try {
      const since = Date.now() - METRICS_RETENTION_MS;
      const rows = this.#db.raw.prepare('SELECT ts, data FROM metrics_minutes WHERE ts >= ? ORDER BY ts').all(since) as unknown as Array<{ ts: number; data: string }>;
      for (const row of rows) {
        const bucket = JSON.parse(row.data) as Bucket;
        bucket.t = row.ts;
        if (bucket.t === this.#current.t) {
          this.#current = bucket;
        } else {
          this.#history.push(bucket);
        }
      }
    } catch {
      /* historique illisible : on repart de zéro */
    }
  }

  start(): void {
    this.#loop = monitorEventLoopDelay({ resolution: 20 });
    this.#loop.enable();
    this.#lastCpu = process.cpuUsage();
    this.#lastSample = performance.now();
    this.#timer = setInterval(() => this.sample(), SAMPLE_MS);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#loop?.disable();
    this.#loop = null;
    this.#persist(this.#current);
  }

  /** Passe à la minute courante : l'ancienne est sauvegardée et ajoutée à l'historique. */
  #roll(): Bucket {
    const minute = this.#minute();
    if (this.#current.t !== minute) {
      const finished = this.#current;
      this.#history.push(finished);
      this.#persist(finished);
      this.#current = emptyBucket(minute);
      this.#sampleMemory(this.#current);
      const oldest = Date.now() - METRICS_RETENTION_MS;
      while (this.#history.length > 0 && this.#history[0]!.t < oldest) {
        this.#history.shift();
      }
      try {
        this.#db.raw.prepare('DELETE FROM metrics_minutes WHERE ts < ?').run(oldest);
      } catch {
        /* base indisponible */
      }
    }
    return this.#current;
  }

  #persist(bucket: Bucket): void {
    if (bucket.n === 0 && bucket.s === 0) {
      return;
    }
    try {
      this.#upsert ??= this.#db.raw.prepare('INSERT OR REPLACE INTO metrics_minutes (ts, data) VALUES (?, ?)');
      this.#upsert.run(bucket.t, JSON.stringify(bucket));
    } catch {
      /* base fermée : l'historique en mémoire reste valable */
    }
  }

  /** Enregistre une requête terminée. */
  record(method: string, route: string, status: number, ms: number): void {
    const bucket = this.#roll();
    bucket.n += 1;
    if (status >= 500) bucket.e5 += 1;
    else if (status >= 400) bucket.e4 += 1;
    bucket.ms += ms;
    bucket.max = Math.max(bucket.max, ms);
    const bin = binOf(ms);
    bucket.h[bin] = (bucket.h[bin] ?? 0) + 1;

    let key = `${method} ${route}`;
    if (!bucket.r[key] && Object.keys(bucket.r).length >= MAX_ROUTES_PER_BUCKET) {
      key = `${method} (autres)`;
    }
    const entry = (bucket.r[key] ??= [0, 0, 0, 0, ...new Array<number>(BINS).fill(0)]);
    entry[0]! += 1;
    if (status >= 500) entry[1]! += 1;
    entry[2]! += ms;
    entry[3] = Math.max(entry[3]!, ms);
    entry[4 + bin] = (entry[4 + bin] ?? 0) + 1;
  }

  /** Échantillonne le processeur, la mémoire, la boucle d'évènements, SQLite et les clients WebSocket. */
  sample(): void {
    const bucket = this.#roll();
    const now = performance.now();
    const cpu = process.cpuUsage();
    const elapsedUs = (now - this.#lastSample) * 1000;
    const usedUs = cpu.user - this.#lastCpu.user + (cpu.system - this.#lastCpu.system);
    const percent = elapsedUs > 0 ? Math.max(0, (usedUs / elapsedUs) * 100) : 0;
    this.#lastCpu = cpu;
    this.#lastSample = now;

    const memory = process.memoryUsage();
    const p99 = this.#loop ? this.#loop.percentile(99) / 1e6 : 0;
    const maxLag = this.#loop ? this.#loop.max / 1e6 : 0;
    this.#loop?.reset();

    bucket.cpu += percent;
    bucket.s += 1;
    bucket.rss = Math.max(bucket.rss, memory.rss);
    bucket.heap = Math.max(bucket.heap, memory.heapUsed);
    bucket.lag = Math.max(bucket.lag, Number.isFinite(p99) ? p99 : 0);
    bucket.lagMax = Math.max(bucket.lagMax, Number.isFinite(maxLag) ? maxLag : 0);
    bucket.ws = Math.max(bucket.ws, this.#sources.wsClients());

    const { queries, totalMs } = this.#db.stats;
    bucket.dbq += queries - this.#lastDb.queries;
    bucket.dbms += totalMs - this.#lastDb.totalMs;
    this.#lastDb = { queries, totalMs };
    this.last = { cpu: percent, lag: Number.isFinite(p99) ? p99 : 0 };
  }

  /** Données d'une fenêtre de temps, regroupées pour tenir en ~180 points. */
  window(range: MonitoringRange): MetricsWindow {
    this.#roll();
    const duration = MONITORING_RANGES[range].ms;
    const since = Date.now() - duration;
    const buckets = [...this.#history, this.#current].filter((bucket) => bucket.t + MINUTE > since);

    const stepMinutes = Math.max(1, Math.ceil(duration / MINUTE / 180));
    const stepMs = stepMinutes * MINUTE;
    const groups = new Map<number, Bucket>();
    const total = emptyBucket(0);
    for (const bucket of buckets) {
      const start = Math.floor(bucket.t / stepMs) * stepMs;
      const group = groups.get(start) ?? emptyBucket(start);
      mergeInto(group, bucket);
      groups.set(start, group);
      mergeInto(total, bucket);
    }
    const series = [...groups.values()].sort((a, b) => a.t - b.t).map(toPoint);

    const covered = buckets.length > 0 ? Math.max(1, (Date.now() - Math.max(since, buckets[0]!.t)) / MINUTE) : 1;
    const summary: MonitoringSummaryDTO = {
      requests: total.n,
      requestsPerMinute: total.n / covered,
      errors4xx: total.e4,
      errors5xx: total.e5,
      errorRate: total.n ? (total.e5 / total.n) * 100 : 0,
      avgMs: total.n ? total.ms / total.n : 0,
      p50Ms: percentile(total.h, 0.5, total.max),
      p95Ms: percentile(total.h, 0.95, total.max),
      p99Ms: percentile(total.h, 0.99, total.max),
      maxMs: total.max,
      histogram: total.h,
    };
    const routes: RouteStatDTO[] = Object.entries(total.r).map(([key, entry]) => {
      const space = key.indexOf(' ');
      const histogram = entry.slice(4);
      return {
        method: key.slice(0, space),
        route: key.slice(space + 1),
        count: entry[0]!,
        errors: entry[1]!,
        avgMs: entry[0]! ? entry[2]! / entry[0]! : 0,
        p95Ms: percentile(histogram, 0.95, entry[3]!),
        maxMs: entry[3]!,
      };
    });
    routes.sort((a, b) => b.count - a.count);
    return { stepMs, series, summary, routes };
  }
}
