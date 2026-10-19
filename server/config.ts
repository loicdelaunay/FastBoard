import path from 'node:path';
import { appRoot, runningAsExecutable } from './runtime.ts';
import { LIMITS } from '../shared/constants.ts';
import { isLogLevel, type LogLevel } from '../shared/monitoring.ts';


export interface AppConfig {
  port: number;
  host: string;
  dbPath: string;
  distDir: string;
  /** Dossier des pièces jointes (par défaut à côté de la base ; `null` = dossier temporaire, pour les tests). */
  uploadsDir: string | null;
  maxUploadBytes: number;
  /** Niveau minimal des journaux conservés (`FASTBOARD_LOG_LEVEL` : debug, info, warn, error). */
  logLevel: LogLevel;
  /** Recopie les journaux sur la console du serveur (`FASTBOARD_LOG_CONSOLE=0` pour couper). */
  logToConsole: boolean;
  isProd: boolean;
  sessionDays: number;
  cookieName: string;
  /** Origines supplémentaires acceptées (CORS strict / WebSocket), séparées par des virgules dans l'environnement. */
  allowedOrigins: string[];
  loginRateLimit: { max: number; windowMs: number } | null;
  /** Nombre de requêtes autorisées par jeton d'API et par fenêtre (null = illimité). */
  apiRateLimit: { max: number; windowMs: number } | null;
  superAdmin: { email: string; password: string; name: string };
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const root = appRoot();
  const dbPath = overrides.dbPath ?? process.env.FASTBOARD_DB ?? path.join(root, 'data', 'fastboard.sqlite');
  const maxMb = Number(process.env.FASTBOARD_MAX_UPLOAD_MB);
  return {
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? '0.0.0.0',
    dbPath,
    distDir: path.join(root, 'dist'),
    uploadsDir: process.env.FASTBOARD_UPLOADS ?? (dbPath === ':memory:' ? null : path.join(path.dirname(dbPath), 'uploads')),
    maxUploadBytes: Number.isFinite(maxMb) && maxMb > 0 ? Math.floor(maxMb * 1024 * 1024) : LIMITS.attachmentMaxBytes,
    logLevel: isLogLevel(process.env.FASTBOARD_LOG_LEVEL) ? process.env.FASTBOARD_LOG_LEVEL : 'info',
    logToConsole: process.env.FASTBOARD_LOG_CONSOLE !== '0',
    // L'exécutable autonome se comporte toujours comme en production (en-tête CSP, interface embarquée).
    isProd: process.env.NODE_ENV === 'production' || runningAsExecutable,
    sessionDays: 14,
    cookieName: 'fb_session',
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((entry) => entry.trim()).filter(Boolean),
    loginRateLimit: { max: 10, windowMs: 10 * 60 * 1000 },
    apiRateLimit: { max: 600, windowMs: 60 * 1000 },
    superAdmin: { email: 'admin@admin.com', password: 'admin1234', name: 'Super Admin' },
    ...overrides,
  };
}
