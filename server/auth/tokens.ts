import { createHash, randomBytes } from 'node:crypto';
import type { ApiTokenDTO, ApiTokenScope } from '../../shared/types.ts';
import type { AppContext } from '../context.ts';
import { nowIso, type Db } from '../db/database.ts';
import { badRequest, notFound } from '../http/errors.ts';
import { verifyPassword } from './password.ts';
import { getAuthUser, type AuthUser } from '../services/access.ts';

/** Tous les jetons commencent par ce préfixe : facile à repérer (et à détecter dans un dépôt par un scanner de secrets). */
export const TOKEN_PREFIX = 'fb_';
const PREFIX_LENGTH = 11;
/** Évite une écriture en base à chaque requête : `last_used_at` est rafraîchi au plus une fois par minute. */
const LAST_USED_GRANULARITY_MS = 60_000;

interface TokenRow {
  id: number;
  user_id: number;
  name: string;
  display_name: string | null;
  prefix: string;
  token_hash: string;
  secret_enc: string | null;
  scope: ApiTokenScope;
  project_ids: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function parseProjectIds(raw: string | null): number[] | null {
  if (raw === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is number => Number.isInteger(id)) : [];
  } catch {
    return [];
  }
}

function toDTO(row: TokenRow, owner?: { id: number; name: string }): ApiTokenDTO {
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    revealable: row.secret_enc !== null,
    prefix: row.prefix,
    scope: row.scope,
    projectIds: parseProjectIds(row.project_ids),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    ...(owner ? { userId: owner.id, userName: owner.name } : {}),
  };
}

export interface CreateTokenInput {
  name: string;
  displayName?: string | null;
  scope: ApiTokenScope;
  /** `null` = tous les projets accessibles à l'utilisateur. */
  projectIds: number[] | null;
  /** `null` = n'expire jamais. */
  expiresInDays: number | null;
}

/** Crée un jeton ; le secret n'est stocké que chiffré (réaffichable par son propriétaire, mot de passe à l'appui). */
export function createApiToken(ctx: AppContext, user: AuthUser, input: CreateTokenInput): { token: ApiTokenDTO; secret: string } {
  const { db } = ctx;
  if (input.projectIds !== null) {
    const accessible = db.all<{ project_id: number }>('SELECT project_id FROM project_members WHERE user_id = ?', user.id).map((row) => row.project_id);
    const canSeeAll = user.permissions.includes('*') || user.permissions.includes('projects.view_all') || user.permissions.includes('projects.manage_all');
    for (const projectId of input.projectIds) {
      const exists = db.get('SELECT 1 FROM projects WHERE id = ?', projectId);
      if (!exists || (!canSeeAll && !accessible.includes(projectId))) {
        throw badRequest(`Le projet ${projectId} est introuvable ou vous n'y avez pas accès.`);
      }
    }
  }
  const secret = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  const now = new Date();
  const expiresAt = input.expiresInDays === null ? null : new Date(now.getTime() + input.expiresInDays * 86_400_000).toISOString();
  const { lastInsertRowid } = db.run(
    `INSERT INTO api_tokens (user_id, name, display_name, prefix, token_hash, secret_enc, scope, project_ids, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    user.id,
    input.name,
    input.displayName || null,
    secret.slice(0, PREFIX_LENGTH),
    hashSecret(secret),
    ctx.secrets.seal(secret),
    input.scope,
    input.projectIds === null ? null : JSON.stringify([...new Set(input.projectIds)]),
    now.toISOString(),
    expiresAt,
  );
  const row = db.get<TokenRow>('SELECT * FROM api_tokens WHERE id = ?', lastInsertRowid)!;
  ctx.logger.info('auth', `Jeton d'API créé : ${input.name}`, { tokenId: row.id, scope: input.scope, expiresAt }, user.id);
  return { token: toDTO(row), secret };
}

export function listApiTokens(db: Db, userId: number): ApiTokenDTO[] {
  return db.all<TokenRow>('SELECT * FROM api_tokens WHERE user_id = ? ORDER BY id DESC', userId).map((row) => toDTO(row));
}

/** Tous les jetons (administration), avec leur propriétaire. */
export function listAllApiTokens(db: Db): ApiTokenDTO[] {
  const rows = db.all<TokenRow & { owner_name: string }>(
    'SELECT t.*, u.name AS owner_name FROM api_tokens t JOIN users u ON u.id = t.user_id ORDER BY t.id DESC',
  );
  return rows.map((row) => toDTO(row, { id: row.user_id, name: row.owner_name }));
}

function requireOwnedToken(db: Db, tokenId: number, actor: { userId: number; canManageAll: boolean }): TokenRow {
  const row = db.get<TokenRow>('SELECT * FROM api_tokens WHERE id = ?', tokenId);
  if (!row || (row.user_id !== actor.userId && !actor.canManageAll)) {
    throw notFound('Jeton introuvable.');
  }
  return row;
}

export interface UpdateTokenInput {
  displayName?: string | null;
  /** Nouvelle échéance, comptée à partir d'aujourd'hui ; `null` = n'expire plus. */
  expiresInDays?: number | null;
}

/** Renomme (nom d'affichage) ou prolonge un jeton non révoqué ; un jeton expiré peut être prolongé. */
export function updateApiToken(ctx: AppContext, tokenId: number, actor: { userId: number; canManageAll: boolean }, input: UpdateTokenInput): ApiTokenDTO {
  const row = requireOwnedToken(ctx.db, tokenId, actor);
  if (row.revoked_at !== null) {
    throw badRequest('Un jeton révoqué ne peut plus être modifié.');
  }
  const displayName = input.displayName !== undefined ? input.displayName || null : row.display_name;
  const expiresAt =
    input.expiresInDays === undefined ? row.expires_at : input.expiresInDays === null ? null : new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString();
  ctx.db.run('UPDATE api_tokens SET display_name = ?, expires_at = ? WHERE id = ?', displayName, expiresAt, tokenId);
  if (expiresAt !== row.expires_at) {
    ctx.logger.info('auth', `Jeton d'API prolongé : ${row.name}`, { tokenId, expiresAt }, actor.userId);
  }
  const owner = ctx.db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', row.user_id);
  const fresh = ctx.db.get<TokenRow>('SELECT * FROM api_tokens WHERE id = ?', tokenId)!;
  return toDTO(fresh, actor.canManageAll ? { id: row.user_id, name: owner?.name ?? '' } : undefined);
}

/** Réaffiche le secret d'un jeton à son propriétaire, après vérification de son mot de passe. */
export async function revealApiToken(ctx: AppContext, tokenId: number, userId: number, password: string): Promise<string> {
  const row = requireOwnedToken(ctx.db, tokenId, { userId, canManageAll: false });
  const account = ctx.db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', userId);
  if (!account || !(await verifyPassword(password, account.password_hash))) {
    throw badRequest('Mot de passe incorrect.');
  }
  if (row.revoked_at !== null) {
    throw badRequest('Ce jeton est révoqué.');
  }
  const secret = row.secret_enc ? ctx.secrets.open(row.secret_enc) : null;
  if (!secret) {
    throw badRequest("Ce jeton a été créé avant la version 1.1 ou sa clé de chiffrement a changé : il ne peut pas être réaffiché. Créez-en un nouveau.");
  }
  ctx.logger.info('auth', `Jeton d'API réaffiché : ${row.name}`, { tokenId }, userId);
  return secret;
}

/** Révoque un jeton (le propriétaire, ou un administrateur des jetons) ; les connexions WebSocket qui l'utilisent sont coupées. */
export function revokeApiToken(ctx: AppContext, tokenId: number, actor: { userId: number; canManageAll: boolean }): void {
  const row = ctx.db.get<TokenRow>('SELECT * FROM api_tokens WHERE id = ?', tokenId);
  if (!row || (row.user_id !== actor.userId && !actor.canManageAll)) {
    throw notFound('Jeton introuvable.');
  }
  if (row.revoked_at === null) {
    ctx.db.run('UPDATE api_tokens SET revoked_at = ? WHERE id = ?', nowIso(), tokenId);
    ctx.logger.info('auth', `Jeton d'API révoqué : ${row.name}`, { tokenId }, actor.userId);
  }
  ctx.hub.disconnectToken(tokenId);
}

/** Authentifie un secret de jeton ; `null` s'il est inconnu, révoqué, expiré, ou si le compte est désactivé. */
export function resolveApiToken(ctx: AppContext, secret: string | undefined): AuthUser | null {
  if (!secret || !secret.startsWith(TOKEN_PREFIX) || secret.length > 120) {
    return null;
  }
  const row = ctx.db.get<TokenRow>('SELECT * FROM api_tokens WHERE token_hash = ?', hashSecret(secret));
  if (!row || row.revoked_at !== null) {
    return null;
  }
  const now = Date.now();
  if (row.expires_at !== null && Date.parse(row.expires_at) <= now) {
    return null;
  }
  const user = getAuthUser(ctx.db, row.user_id);
  if (!user || !user.isActive) {
    return null;
  }
  if (row.last_used_at === null || now - Date.parse(row.last_used_at) > LAST_USED_GRANULARITY_MS) {
    ctx.db.run('UPDATE api_tokens SET last_used_at = ? WHERE id = ?', new Date(now).toISOString(), row.id);
  }
  return { ...user, token: { id: row.id, name: row.name, displayName: row.display_name, scope: row.scope, projectIds: parseProjectIds(row.project_ids) } };
}
