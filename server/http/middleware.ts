import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { CLIENT_ID_HEADER, USER_ID_HEADER } from '../../shared/constants.ts';
import { authenticate } from '../auth/authenticate.ts';
import { parseCookies } from './cookies.ts';
import type { Actor, AppContext } from '../context.ts';
import type { AuthUser } from '../services/access.ts';
import { forbidden, HttpError } from './errors.ts';
import { isAllowedOrigin } from './origin.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Refuse les requêtes modifiantes dont l'`Origin` n'est pas celle du site (défense CSRF en plus de SameSite).
 * Ne concerne que l'authentification par cookie : un jeton d'API est envoyé explicitement dans `Authorization`,
 * ce qu'un site tiers ne peut pas provoquer.
 */
export function csrfGuard(ctx: AppContext): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!SAFE_METHODS.has(req.method) && !req.headers.authorization && !isAllowedOrigin(req, ctx.config)) {
      next(forbidden('Origine de la requête non autorisée.'));
      return;
    }
    next();
  };
}

export function sessionToken(ctx: AppContext, req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[ctx.config.cookieName];
}

const rateWindows = new Map<number, { count: number; resetAt: number }>();

/** Limite le débit par jeton (fenêtre fixe) ; lève une 429 avec `Retry-After`. */
function enforceRateLimit(ctx: AppContext, res: Response, tokenId: number): void {
  const limit = ctx.config.apiRateLimit;
  if (!limit) {
    return;
  }
  const now = Date.now();
  let entry = rateWindows.get(tokenId);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + limit.windowMs };
    rateWindows.set(tokenId, entry);
  }
  entry.count += 1;
  res.setHeader('X-RateLimit-Limit', String(limit.max));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit.max - entry.count)));
  if (entry.count > limit.max) {
    res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
    throw new HttpError(429, "Trop de requêtes avec ce jeton d'API. Réessayez dans quelques instants.", 'rate_limited');
  }
}

export function requireAuth(ctx: AppContext): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const attempt = authenticate(ctx, req);

    if (attempt.kind === 'bad_token') {
      ctx.logger.warn('auth', "Jeton d'API invalide, expiré ou révoqué présenté", { ip: req.ip ?? null, path: req.path }, null, res.locals.requestId as string);
      next(new HttpError(401, "Jeton d'API invalide, expiré ou révoqué.", 'invalid_token'));
      return;
    }
    if (attempt.kind === 'none') {
      next(new HttpError(401, 'Authentification requise.', 'unauthorized'));
      return;
    }

    const { user } = attempt;
    if (attempt.kind === 'token') {
      if (user.token!.scope === 'read' && !SAFE_METHODS.has(req.method)) {
        next(new HttpError(403, "Ce jeton d'API est en lecture seule.", 'token_read_only'));
        return;
      }
      try {
        enforceRateLimit(ctx, res, user.token!.id);
      } catch (error) {
        next(error);
        return;
      }
    } else {
      // Un onglet resté ouvert sur un autre compte ne doit pas agir au nom de l'utilisateur du cookie.
      const claimed = req.get(USER_ID_HEADER);
      if (claimed !== undefined && claimed !== String(user.id)) {
        next(new HttpError(401, 'Votre session a changé : vous êtes connecté avec un autre compte dans un autre onglet.', 'session_changed'));
        return;
      }
    }
    res.locals.user = user;
    next();
  };
}

/** Réserve une route à l'interface (session) : un jeton d'API ne peut ni administrer, ni gérer d'autres jetons, ni changer de mot de passe. */
export function sessionOnly(): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (currentUser(res).token) {
      next(new HttpError(403, "Cette opération n'est pas accessible avec un jeton d'API : utilisez l'interface.", 'session_required'));
      return;
    }
    next();
  };
}

export function currentUser(res: Response): AuthUser {
  return res.locals.user as AuthUser;
}

export function actorOf(req: Request, res: Response): Actor {
  const user = currentUser(res);
  const origin = req.get(CLIENT_ID_HEADER);
  return { userId: user.id, origin: origin ? origin.slice(0, 64) : null, via: user.token ? user.token.displayName || user.token.name : null };
}
