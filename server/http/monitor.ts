import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AppContext } from '../context.ts';
import type { AuthUser } from '../services/access.ts';

const SLOW_REQUEST_MS = 1000;

/** Modèle de la route appelée (« /api/tickets/:id ») : sert de clé aux statistiques, sans identifiants. */
function routeLabel(req: Request, base: string, status: number): string {
  if (req.route) {
    return `${base}${typeof req.route.path === 'string' ? req.route.path : ''}`;
  }
  if (status === 404) return '(route inconnue)';
  return status === 401 ? '(non authentifié)' : '(autre)';
}

/**
 * Mesure chaque requête de l'API : durée, statut et route alimentent les indicateurs de performance ;
 * les erreurs, refus et lenteurs sont inscrits au journal. Ajoute `X-Request-Id` à la réponse.
 */
export function requestMonitor(ctx: AppContext): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = performance.now();
    // `baseUrl` est remis à zéro quand la réponse part : on le relève ici (« /api »).
    const base = req.baseUrl;
    const requestId = randomUUID().slice(0, 8);
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    res.on('finish', () => {
      const ms = performance.now() - start;
      const status = res.statusCode;
      const route = routeLabel(req, base, status);
      ctx.metrics.record(req.method, route, status, ms);

      const user = res.locals.user as AuthUser | undefined;
      const path = req.originalUrl.split('?')[0] ?? req.originalUrl;
      const detail = { method: req.method, route, status, ms: Math.round(ms), via: user?.token?.name ?? null };
      const message = `${req.method} ${path} → ${status} (${Math.round(ms)} ms)`;
      if (status >= 500) {
        // Les exceptions sont déjà détaillées (avec leur pile) par le gestionnaire d'erreurs.
        if (!res.locals.errorLogged) {
          ctx.logger.error('http', message, detail, user?.id, requestId);
        }
      } else if (status === 403 || status === 429) {
        ctx.logger.warn('http', message, detail, user?.id, requestId);
      } else if (ms >= SLOW_REQUEST_MS) {
        ctx.logger.warn('http', `Requête lente : ${message}`, detail, user?.id, requestId);
      } else {
        ctx.logger.debug('http', message, detail, user?.id, requestId);
      }
    });
    next();
  };
}
