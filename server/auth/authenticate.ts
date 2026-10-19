import type { IncomingMessage } from 'node:http';
import type { AppContext } from '../context.ts';
import { parseCookies } from '../http/cookies.ts';
import type { AuthUser } from '../services/access.ts';
import { resolveSession } from './sessions.ts';
import { resolveApiToken, TOKEN_PREFIX } from './tokens.ts';

/** Extrait un jeton d'API de l'en-tête `Authorization: Bearer fb_…`. */
export function bearerSecret(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization;
  if (!header) {
    return undefined;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1];
}

export type AuthAttempt =
  | { kind: 'none' }
  | { kind: 'session'; user: AuthUser }
  | { kind: 'token'; user: AuthUser }
  /** Un jeton a été présenté mais il est invalide, révoqué ou expiré. */
  | { kind: 'bad_token' };

/**
 * Authentifie une requête HTTP ou une montée en WebSocket : jeton d'API (en-tête `Authorization`) ou, à défaut,
 * cookie de session. Un jeton présenté mais invalide n'est jamais « rattrapé » par un cookie.
 */
export function authenticate(ctx: AppContext, request: IncomingMessage): AuthAttempt {
  const secret = bearerSecret(request);
  if (secret !== undefined) {
    const user = secret.startsWith(TOKEN_PREFIX) ? resolveApiToken(ctx, secret) : null;
    return user ? { kind: 'token', user } : { kind: 'bad_token' };
  }
  const user = resolveSession(ctx, parseCookies(request.headers.cookie)[ctx.config.cookieName]);
  return user ? { kind: 'session', user } : { kind: 'none' };
}
