import { createHash, randomBytes } from 'node:crypto';
import type { AppContext } from '../context.ts';
import { nowIso } from '../db/database.ts';
import { getAuthUser, type AuthUser } from '../services/access.ts';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createSession(ctx: AppContext, userId: number, userAgent: string | undefined): { token: string; maxAgeSeconds: number } {
  const token = randomBytes(32).toString('base64url');
  const maxAgeSeconds = ctx.config.sessionDays * 86_400;
  const now = Date.now();
  ctx.db.run(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)',
    hashToken(token),
    userId,
    new Date(now).toISOString(),
    new Date(now + maxAgeSeconds * 1000).toISOString(),
    (userAgent ?? '').slice(0, 300),
  );
  return { token, maxAgeSeconds };
}

/** Retourne l'utilisateur de la session si elle est valide et le compte actif. */
/** Dernière écriture de « dernière activité » par compte (au plus une toutes les 5 minutes). */
const lastSeenWrites = new Map<number, number>();
const SEEN_INTERVAL_MS = 5 * 60 * 1000;

/** Note l'activité d'un compte : la session est réutilisée des jours durant sans nouvelle connexion. */
export function markSeen(ctx: AppContext, userId: number, force = false): void {
  const now = Date.now();
  if (!force && now - (lastSeenWrites.get(userId) ?? 0) < SEEN_INTERVAL_MS) return;
  lastSeenWrites.set(userId, now);
  ctx.db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', new Date(now).toISOString(), userId);
}

export function resolveSession(ctx: AppContext, token: string | undefined): AuthUser | null {
  if (!token) {
    return null;
  }
  const session = ctx.db.get<{ user_id: number; expires_at: string }>(
    'SELECT user_id, expires_at FROM sessions WHERE id = ?',
    hashToken(token),
  );
  if (!session) {
    return null;
  }
  if (session.expires_at <= nowIso()) {
    ctx.db.run('DELETE FROM sessions WHERE id = ?', hashToken(token));
    return null;
  }
  const user = getAuthUser(ctx.db, session.user_id);
  if (!user || !user.isActive) return null;
  markSeen(ctx, user.id);
  renewSession(ctx, token, session.expires_at);
  return user;
}

/** Une session prolongée il y a moins d'un jour ne l'est pas de nouveau : une écriture par jour au plus. */
const RENEW_AFTER_MS = 86_400_000;

/** Session glissante : utilisée, elle repart pour `sessionDays` jours ; seule une longue absence la fait expirer. */
function renewSession(ctx: AppContext, token: string, expiresAt: string): void {
  const lifetime = ctx.config.sessionDays * 86_400_000;
  const now = Date.now();
  if (Date.parse(expiresAt) - now > lifetime - RENEW_AFTER_MS) return;
  ctx.db.run('UPDATE sessions SET expires_at = ? WHERE id = ?', new Date(now + lifetime).toISOString(), hashToken(token));
}

/** Secondes avant l'expiration d'une session (pour aligner la durée du cookie), ou `null` si elle n'existe plus. */
export function sessionSecondsLeft(ctx: AppContext, token: string | undefined): number | null {
  if (!token) return null;
  const session = ctx.db.get<{ expires_at: string }>('SELECT expires_at FROM sessions WHERE id = ?', hashToken(token));
  if (!session) return null;
  const seconds = Math.floor((Date.parse(session.expires_at) - Date.now()) / 1000);
  return seconds > 0 ? seconds : null;
}

export function destroySession(ctx: AppContext, token: string | undefined): void {
  if (token) {
    ctx.db.run('DELETE FROM sessions WHERE id = ?', hashToken(token));
  }
}

export function destroyUserSessions(ctx: AppContext, userId: number): void {
  ctx.db.run('DELETE FROM sessions WHERE user_id = ?', userId);
}

export function purgeExpiredSessions(ctx: AppContext): void {
  ctx.db.run('DELETE FROM sessions WHERE expires_at <= ?', nowIso());
}
