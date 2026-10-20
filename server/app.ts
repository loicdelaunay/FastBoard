import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import { SecretBox } from './auth/secretBox.ts';
import { startBackupScheduler } from './backup/service.ts';
import { purgeExpiredSessions } from './auth/sessions.ts';
import { loadConfig, type AppConfig } from './config.ts';
import type { AppContext } from './context.ts';
import { Db } from './db/database.ts';
import { migrate } from './db/migrations.ts';
import { seedSystem } from './db/seed.ts';
import { HttpError, notFound } from './http/errors.ts';
import { csrfGuard, requireAuth } from './http/middleware.ts';
import { embeddedFrontend } from './http/embedded.ts';
import { requestMonitor } from './http/monitor.ts';
import { runningAsExecutable } from './runtime.ts';
import { Logger } from './monitoring/logger.ts';
import { Metrics } from './monitoring/metrics.ts';
import { Hub } from './realtime/hub.ts';
import { adminRouter } from './routes/admin.ts';
import { attachmentsRouter, attachmentUploadRouter } from './routes/attachments.ts';
import { accountRouter, publicAuthRouter } from './routes/auth.ts';
import { docsRouter } from './routes/docs.ts';
import { projectsRouter } from './routes/projects.ts';
import { ticketsRouter } from './routes/tickets.ts';

export interface RunningServer {
  ctx: AppContext;
  server: http.Server;
  port: number;
  createdSuperAdmin: boolean;
  close: () => Promise<void>;
}

function securityHeaders(config: AppConfig) {
  const csp = [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (config.isProd) {
      res.setHeader('Content-Security-Policy', csp);
    }
    next();
  };
}

function errorHandler(ctx: AppContext) {
  return (error: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } });
      return;
    }
    const type = (error as { type?: string } | null)?.type;
    if (type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'bad_request', message: 'Corps de requête JSON invalide.' } });
      return;
    }
    if (type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'too_large', message: 'Le contenu envoyé est trop volumineux.' } });
      return;
    }
    const requestId = (res.locals.requestId as string | undefined) ?? null;
    const user = res.locals.user as { id: number } | undefined;
    res.locals.errorLogged = true;
    ctx.logger.error(
      'http',
      `Erreur interne : ${error instanceof Error ? error.message : String(error)}`,
      { stack: error instanceof Error ? error.stack : undefined, method: _req.method, path: _req.originalUrl.split('?')[0] },
      user?.id,
      requestId,
    );
    res.status(500).json({ error: { code: 'internal', message: 'Erreur interne du serveur.', requestId } });
  };
}

export async function startServer(overrides: Partial<AppConfig> = {}): Promise<RunningServer> {
  const config = loadConfig(overrides);
  const db = new Db(config.dbPath);
  migrate(db);
  const { createdSuperAdmin } = await seedSystem(db, config);

  // Pièces jointes : dossier à côté de la base (ou dossier temporaire quand la base est en mémoire).
  const ephemeralUploads = config.uploadsDir === null;
  const uploadsDir = config.uploadsDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'fastboard-uploads-'));
  fs.mkdirSync(uploadsDir, { recursive: true });

  const hub = new Hub();
  const logger = new Logger(db, { minLevel: config.logLevel, toConsole: config.logToConsole });
  const metrics = new Metrics(db, { wsClients: () => hub.clientCount });
  const ctx: AppContext = { config, db, hub, logger, metrics, uploadsDir, secrets: new SecretBox(config.dbPath) };
  db.onSlowQuery = (sql, ms) => logger.warn('db', `Requête SQL lente (${Math.round(ms)} ms)`, { sql: sql.replace(/\s+/g, ' ').slice(0, 300), ms: Math.round(ms) });
  logger.start();
  metrics.start();
  logger.info('system', 'Serveur démarré', { node: process.version, db: config.dbPath, uploads: uploadsDir, production: config.isProd });
  if (createdSuperAdmin) {
    logger.info('auth', `Compte super administrateur créé (${config.superAdmin.email})`);
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(securityHeaders(config));

  const api = express.Router();
  api.use(requestMonitor(ctx));
  // Envoi de fichiers : corps brut, donc avant l'analyse JSON.
  api.use(attachmentUploadRouter(ctx));
  api.use(express.json({ limit: '1mb' }));
  api.use(csrfGuard(ctx));
  api.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  api.use(publicAuthRouter(ctx));
  api.use(docsRouter(ctx));
  api.use(requireAuth(ctx));
  api.use(accountRouter(ctx));
  api.use(adminRouter(ctx));
  api.use(projectsRouter(ctx));
  api.use(ticketsRouter(ctx));
  api.use(attachmentsRouter(ctx));
  api.use((_req, _res, next) => next(notFound('Route inconnue.')));
  app.use('/api', api);

  const indexFile = path.join(config.distDir, 'index.html');
  if (runningAsExecutable) {
    app.use(embeddedFrontend());
  } else if (fs.existsSync(indexFile)) {
    app.use(express.static(config.distDir, { index: false, maxAge: '1h', setHeaders: (res, filePath) => {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    } }));
    app.use((req, res, next) => {
      // Les ressources (fichiers avec extension, /assets) ne retombent jamais sur la page d'accueil.
      const isPage = (req.method === 'GET' || req.method === 'HEAD') && !path.extname(req.path) && !req.path.startsWith('/assets/');
      if (!isPage || req.path.startsWith('/api') || req.path === '/ws') {
        next();
        return;
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexFile);
    });
  }

  app.use(errorHandler(ctx));

  const server = http.createServer(app);
  hub.attach(server, ctx);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;

  const purge = setInterval(() => purgeExpiredSessions(ctx), 60 * 60 * 1000);
  purge.unref();
  const stopBackups = startBackupScheduler(ctx);

  return {
    ctx,
    server,
    port,
    createdSuperAdmin,
    close: async () => {
      clearInterval(purge);
      stopBackups();
      hub.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      logger.info('system', 'Serveur arrêté');
      metrics.stop();
      logger.stop();
      db.close();
      if (ephemeralUploads) {
        fs.rmSync(uploadsDir, { recursive: true, force: true });
      }
    },
  };
}
