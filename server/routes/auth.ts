import express, { type Request, type Router } from 'express';
import { LIMITS } from '../../shared/constants.ts';
import { hashPassword, verifyDummyPassword, verifyPassword } from '../auth/password.ts';
import { createSession, destroySession, destroyUserSessions } from '../auth/sessions.ts';
import { createApiToken, listApiTokens, revealApiToken, revokeApiToken, updateApiToken } from '../auth/tokens.ts';
import type { AppContext } from '../context.ts';
import { nowIso } from '../db/database.ts';
import { serializeSessionCookie } from '../http/cookies.ts';
import { badRequest, HttpError, notFound, unauthorized } from '../http/errors.ts';
import { currentUser, sessionOnly, sessionToken } from '../http/middleware.ts';
import { createTokenSchema, loginSchema, passwordSchema, profileSchema, revealTokenSchema, searchQuerySchema, updateTokenSchema } from '../http/schemas.ts';
import { globalSearch, userSummary } from '../services/search.ts';
import { idParam, parse } from '../http/validate.ts';
import { getAuthUser, requireGlobal, toMeDTO } from '../services/access.ts';
import { clearAvatar, getAvatar, listDirectory, setAvatar, updateOwnProfile } from '../services/users.ts';
import { listRoles } from '../services/roles.ts';
import { hasPermission } from '../../shared/permissions.ts';

function detectImageMime(data: Buffer): string | null {
  if (data.length > 12 && data[0] === 0x89 && data.subarray(1, 4).toString('latin1') === 'PNG') {
    return 'image/png';
  }
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (data.length > 12 && data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function isSecure(req: Request): boolean {
  return req.secure || req.get('x-forwarded-proto') === 'https';
}

/** Routes accessibles sans session. */
export function publicAuthRouter(ctx: AppContext): Router {
  const router = express.Router();
  const attempts = new Map<string, { count: number; resetAt: number }>();

  function throttle(key: string): void {
    const limit = ctx.config.loginRateLimit;
    if (!limit) {
      return;
    }
    const now = Date.now();
    const entry = attempts.get(key);
    if (entry && entry.resetAt > now && entry.count >= limit.max) {
      throw new HttpError(429, 'Trop de tentatives de connexion. Réessayez dans quelques minutes.', 'rate_limited');
    }
  }

  function recordFailure(key: string): void {
    const limit = ctx.config.loginRateLimit;
    if (!limit) {
      return;
    }
    const now = Date.now();
    if (attempts.size > 5000) {
      for (const [existing, value] of attempts) {
        if (value.resetAt <= now) {
          attempts.delete(existing);
        }
      }
    }
    const entry = attempts.get(key);
    if (!entry || entry.resetAt <= now) {
      attempts.set(key, { count: 1, resetAt: now + limit.windowMs });
    } else {
      entry.count += 1;
    }
  }

  router.post('/auth/login', async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const key = `${req.ip ?? ''}|${email.toLowerCase()}`;
    try {
      throttle(key);
    } catch (error) {
      ctx.logger.warn('auth', `Trop de tentatives de connexion pour ${email}`, { ip: req.ip ?? null }, null, res.locals.requestId as string);
      throw error;
    }

    const row = ctx.db.get<{ id: number; password_hash: string; is_active: number }>(
      'SELECT id, password_hash, is_active FROM users WHERE email = ? COLLATE NOCASE',
      email,
    );
    const valid = row ? await verifyPassword(password, row.password_hash) : (await verifyDummyPassword(password), false);
    if (!row || !valid) {
      recordFailure(key);
      ctx.logger.warn('auth', `Échec de connexion pour ${email}`, { ip: req.ip ?? null, knownAccount: Boolean(row) }, row?.id ?? null, res.locals.requestId as string);
      throw unauthorized('Adresse e-mail ou mot de passe incorrect.');
    }
    if (row.is_active !== 1) {
      ctx.logger.warn('auth', `Connexion refusée : compte désactivé (${email})`, { ip: req.ip ?? null }, row.id, res.locals.requestId as string);
      throw new HttpError(403, 'Ce compte est désactivé. Contactez un administrateur.', 'account_disabled');
    }
    attempts.delete(key);

    const { token, maxAgeSeconds } = createSession(ctx, row.id, req.get('user-agent'));
    ctx.db.run('UPDATE users SET last_login_at = ? WHERE id = ?', nowIso(), row.id);
    res.setHeader('Set-Cookie', serializeSessionCookie(ctx.config.cookieName, token, { maxAgeSeconds, secure: isSecure(req) }));
    const user = getAuthUser(ctx.db, row.id);
    ctx.logger.info('auth', `Connexion de ${email}`, { ip: req.ip ?? null, userAgent: (req.get('user-agent') ?? '').slice(0, 160) }, row.id, res.locals.requestId as string);
    res.json({ user: user ? toMeDTO(user) : null });
  });

  router.post('/auth/logout', (req, res) => {
    destroySession(ctx, sessionToken(ctx, req));
    res.setHeader('Set-Cookie', serializeSessionCookie(ctx.config.cookieName, '', { maxAgeSeconds: 0, secure: isSecure(req) }));
    res.json({ ok: true });
  });

  return router;
}

/** Routes réservées aux utilisateurs connectés : profil, annuaire, avatars, rôles de projet. */
export function accountRouter(ctx: AppContext): Router {
  const router = express.Router();

  router.get('/me', (_req, res) => {
    const user = currentUser(res);
    res.json({ user: toMeDTO(user), token: user.token });
  });

  // --- Jetons d'API personnels (interface uniquement : un jeton ne peut pas en créer d'autres) ---

  router.get('/me/tokens', sessionOnly(), (_req, res) => {
    res.json({ tokens: listApiTokens(ctx.db, currentUser(res).id) });
  });

  router.post('/me/tokens', sessionOnly(), (req, res) => {
    const user = currentUser(res);
    requireGlobal(user, 'tokens.create');
    const { token, secret } = createApiToken(ctx, user, parse(createTokenSchema, req.body));
    res.status(201).json({ token, secret });
  });

  router.patch('/me/tokens/:id', sessionOnly(), (req, res) => {
    const user = currentUser(res);
    res.json({ token: updateApiToken(ctx, idParam(req.params.id), { userId: user.id, canManageAll: false }, parse(updateTokenSchema, req.body)) });
  });

  router.post('/me/tokens/:id/reveal', sessionOnly(), async (req, res) => {
    const user = currentUser(res);
    res.json({ secret: await revealApiToken(ctx, idParam(req.params.id), user.id, parse(revealTokenSchema, req.body).password) });
  });

  router.delete('/me/tokens/:id', sessionOnly(), (req, res) => {
    const user = currentUser(res);
    revokeApiToken(ctx, idParam(req.params.id), { userId: user.id, canManageAll: false });
    res.json({ ok: true });
  });

  router.patch('/me', sessionOnly(), (req, res) => {
    const user = currentUser(res);
    updateOwnProfile(ctx, user.id, parse(profileSchema, req.body));
    const fresh = getAuthUser(ctx.db, user.id);
    res.json({ user: fresh ? toMeDTO(fresh) : null });
  });

  router.post('/me/password', sessionOnly(), async (req, res) => {
    const user = currentUser(res);
    const { currentPassword, newPassword } = parse(passwordSchema, req.body);
    const row = ctx.db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', user.id);
    if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
      throw badRequest('Le mot de passe actuel est incorrect.');
    }
    ctx.db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', await hashPassword(newPassword), nowIso(), user.id);
    ctx.logger.info('auth', 'Mot de passe modifié par son titulaire', null, user.id, res.locals.requestId as string);
    // Les autres sessions sont fermées ; celle-ci est recréée pour garder l'utilisateur connecté.
    destroyUserSessions(ctx, user.id);
    ctx.hub.disconnectUser(user.id);
    const { token, maxAgeSeconds } = createSession(ctx, user.id, req.get('user-agent'));
    res.setHeader('Set-Cookie', serializeSessionCookie(ctx.config.cookieName, token, { maxAgeSeconds, secure: isSecure(req) }));
    res.json({ ok: true });
  });

  router.put(
    '/me/avatar',
    sessionOnly(),
    express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: LIMITS.avatarMaxBytes }),
    (req, res) => {
      const body: unknown = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw badRequest('Image invalide (PNG, JPEG ou WebP, 512 Ko maximum).');
      }
      const mime = detectImageMime(body);
      if (!mime) {
        throw badRequest("Le fichier n'est pas une image PNG, JPEG ou WebP valide.");
      }
      const user = currentUser(res);
      setAvatar(ctx, user.id, mime, body);
      const fresh = getAuthUser(ctx.db, user.id);
      res.json({ user: fresh ? toMeDTO(fresh) : null });
    },
  );

  router.delete('/me/avatar', sessionOnly(), (_req, res) => {
    const user = currentUser(res);
    clearAvatar(ctx, user.id);
    const fresh = getAuthUser(ctx.db, user.id);
    res.json({ user: fresh ? toMeDTO(fresh) : null });
  });

  router.get('/users', (_req, res) => {
    res.json({ users: listDirectory(ctx.db) });
  });

  router.get('/users/:id/summary', (req, res) => {
    res.json({ summary: userSummary(ctx.db, currentUser(res), idParam(req.params.id)) });
  });

  router.get('/search', (req, res) => {
    const query = parse(searchQuerySchema, req.query);
    res.json(globalSearch(ctx.db, currentUser(res), query.q, { limit: query.limit, kinds: query.type }));
  });

  router.get('/users/:id/avatar', (req, res) => {
    const avatar = getAvatar(ctx.db, idParam(req.params.id));
    if (!avatar) {
      throw notFound('Aucune image.');
    }
    res.setHeader('Content-Type', avatar.mime);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(Buffer.from(avatar.data));
  });

  /** Rôles de projet pour tous ; rôles globaux réservés à l'administration. */
  router.get('/roles', (req, res) => {
    const scope = req.query.scope === 'global' ? 'global' : 'project';
    if (scope === 'global') {
      const user = currentUser(res);
      const allowed = ['users.view', 'users.create', 'users.edit', 'roles.manage'].some((permission) => hasPermission(user.permissions, permission));
      if (!allowed) {
        throw new HttpError(403, "Vous n'avez pas la permission d'effectuer cette action.", 'forbidden');
      }
    }
    res.json({ roles: listRoles(ctx.db, scope) });
  });

  return router;
}
