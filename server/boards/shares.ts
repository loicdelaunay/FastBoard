import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { BOARD_SHARE_LIMITS, boardTitle, type BoardRole, type BoardShareAudience, type BoardShareDTO, type BoardShareInfoDTO, type BoardShareRole } from '../../shared/boards.ts';
import { docRoleAtLeast } from '../../shared/docs.ts';
import { hashPassword, verifyPassword, verifyDummyPassword } from '../auth/password.ts';
import type { AppContext } from '../context.ts';
import { nowIso, type Db } from '../db/database.ts';
import { badRequest, forbidden, HttpError, notFound } from '../http/errors.ts';
import { getAuthUser, type AuthUser } from '../services/access.ts';
import { boardRole, boardsEnabled } from './store.ts';

/**
 * Partage d'un tableau en plus des membres de son espace : aux personnes connectées, à une liste de personnes, ou à
 * tout le monde sans compte, en lecture ou en écriture. Un mot de passe peut s'ajouter : une fois saisi, il ouvre un
 * accès signé, valable quelques jours, que le changement du mot de passe annule.
 */

interface ShareRow {
  board_id: number;
  slug: string;
  audience: BoardShareAudience;
  people: string;
  role: BoardShareRole;
  password_hash: string | null;
  secret: string;
  created_at: string;
  updated_at: string;
}

const toDTO = (row: ShareRow): BoardShareDTO => ({
  slug: row.slug,
  audience: row.audience,
  people: JSON.parse(row.people) as number[],
  role: row.role,
  hasPassword: Boolean(row.password_hash),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export function getBoardShare(db: Db, boardId: number): BoardShareDTO | null {
  const row = db.get<ShareRow>('SELECT * FROM board_shares WHERE board_id = ?', boardId);
  return row ? toDTO(row) : null;
}

const newSlug = (): string => randomBytes(9).toString('base64url');
const newSecret = (): string => randomBytes(24).toString('base64url');

/**
 * Règle le partage d'un tableau. \`password\` : absent, le mot de passe ne change pas ; \`null\` ou vide, il est retiré.
 * Changer de mot de passe ferme les accès déjà ouverts avec l'ancien.
 */
export async function saveBoardShare(
  ctx: AppContext,
  userId: number,
  boardId: number,
  input: { audience: BoardShareAudience; people: number[]; role: BoardShareRole; password?: string | null },
): Promise<BoardShareDTO> {
  const { db } = ctx;
  const people = [...new Set(input.people)].slice(0, BOARD_SHARE_LIMITS.people);
  for (const id of people) {
    if (!getAuthUser(db, id)?.isActive) throw badRequest('Utilisateur introuvable ou désactivé.');
  }
  if (input.audience === 'people' && !people.length) throw badRequest('Choisissez au moins une personne.');
  const existing = db.get<ShareRow>('SELECT * FROM board_shares WHERE board_id = ?', boardId);
  const password = input.password === undefined ? undefined : input.password?.trim() || null;
  if (password && password.length < BOARD_SHARE_LIMITS.passwordMin) throw badRequest(`Le mot de passe doit faire au moins ${BOARD_SHARE_LIMITS.passwordMin} caractères.`);
  const hash = password === undefined ? (existing?.password_hash ?? null) : password ? await hashPassword(password) : null;
  const secret = password === undefined && existing ? existing.secret : newSecret();
  const now = nowIso();
  if (existing) {
    db.run('UPDATE board_shares SET audience = ?, people = ?, role = ?, password_hash = ?, secret = ?, updated_at = ? WHERE board_id = ?', input.audience, JSON.stringify(people), input.role, hash, secret, now, boardId);
  } else {
    db.run(
      'INSERT INTO board_shares (board_id, slug, audience, people, role, password_hash, secret, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      boardId,
      newSlug(),
      input.audience,
      JSON.stringify(people),
      input.role,
      hash,
      secret,
      userId,
      now,
      now,
    );
  }
  ctx.logger.info('boards', `Partage d'un tableau ${existing ? 'modifié' : 'créé'} (${input.audience}, ${input.role}${hash ? ', mot de passe' : ''})`, { boardId }, userId);
  ctx.boardRooms.refreshShare(boardId);
  return getBoardShare(db, boardId)!;
}

export function removeBoardShare(ctx: AppContext, userId: number, boardId: number): void {
  ctx.db.run('DELETE FROM board_shares WHERE board_id = ?', boardId);
  ctx.logger.info('boards', "Partage d'un tableau retiré", { boardId }, userId);
  ctx.boardRooms.refreshShare(boardId);
}

// --- Accès d'un visiteur -----------------------------------------------------------------------------------------------

interface ShareTarget extends ShareRow {
  space_id: number;
  path: string;
  space_name: string;
}

function shareBySlug(db: Db, slug: string): ShareTarget | undefined {
  if (!/^[\w-]{6,40}$/.test(slug) || !boardsEnabled(db)) return undefined;
  return db.get<ShareTarget>(
    `SELECT s.*, n.space_id, n.path, b.name AS space_name FROM board_shares s
       JOIN board_nodes n ON n.id = s.board_id AND n.kind = 'board' AND n.deleted_at IS NULL
       JOIN board_spaces b ON b.id = n.space_id
      WHERE s.slug = ?`,
    slug,
  );
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Accès ouvert par le mot de passe : \`<expiration>.<signature>\`. */
function tokenFor(share: ShareRow, now = Date.now()): string {
  const expires = now + BOARD_SHARE_LIMITS.tokenDays * 24 * 60 * 60 * 1000;
  return `${expires}.${sign(share.secret, `${share.slug}.${expires}`)}`;
}

function tokenValid(share: ShareRow, token: string | null | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const [expires = '', signature = ''] = token.split('.');
  if (!/^\d+$/.test(expires) || Number(expires) < now) return false;
  const expected = Buffer.from(sign(share.secret, `${share.slug}.${expires}`));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Droits d'un visiteur sur un tableau partagé, après toutes les vérifications. */
export interface ShareGrant {
  boardId: number;
  spaceId: number;
  role: BoardRole;
  member: boolean;
}

/**
 * Vérifie l'accès par le lien : membre de l'espace (ses droits, au moins ceux du partage), personne visée par le
 * partage, ou visiteur sans compte d'un partage public. Le mot de passe ne s'applique qu'à ceux qui ne sont pas membres.
 */
export function resolveShare(ctx: AppContext, user: AuthUser | null, slug: string, token: string | null | undefined): ShareGrant {
  const share = shareBySlug(ctx.db, slug);
  if (!share) throw notFound('Tableau introuvable.');
  const own = user ? boardRole(ctx.db, user, share.space_id) : null;
  const grant = (role: BoardRole, member: boolean): ShareGrant => ({ boardId: share.board_id, spaceId: share.space_id, role, member });
  if (own) return grant(docRoleAtLeast(own, share.role) ? own : share.role, true);
  if (share.audience !== 'public') {
    if (!user) throw new HttpError(401, 'Connectez-vous pour ouvrir ce tableau.', 'unauthorized');
    if (share.audience === 'people' && !(JSON.parse(share.people) as number[]).includes(user.id)) throw forbidden('Ce tableau n’est pas partagé avec vous.');
  }
  if (share.password_hash && !tokenValid(share, token)) throw new HttpError(401, 'Ce tableau est protégé par un mot de passe.', 'board_password');
  return grant(share.role, false);
}

export function shareInfo(ctx: AppContext, slug: string, grant: ShareGrant): BoardShareInfoDTO {
  const share = shareBySlug(ctx.db, slug)!;
  return { slug, boardId: grant.boardId, title: boardTitle(share.path), spaceName: share.space_name, role: grant.role, member: grant.member, spaceId: grant.member ? grant.spaceId : null };
}

// Essais de mot de passe : quelques-uns par lien et par adresse, puis une pause.
const ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map<string, { count: number; since: number }>();

/** Vérifie le mot de passe d'un partage et rend un accès signé. */
export async function unlockShare(ctx: AppContext, user: AuthUser | null, slug: string, password: string, address: string): Promise<{ token: string }> {
  const share = shareBySlug(ctx.db, slug);
  if (!share) throw notFound('Tableau introuvable.');
  // Les mêmes règles d'accès que pour l'ouvrir, sans le mot de passe.
  if (share.audience !== 'public' && !user) throw new HttpError(401, 'Connectez-vous pour ouvrir ce tableau.', 'unauthorized');
  const key = `${slug}|${address}`;
  const now = Date.now();
  const current = attempts.get(key);
  const entry = current && now - current.since < ATTEMPT_WINDOW_MS ? current : { count: 0, since: now };
  if (entry.count >= ATTEMPTS) throw new HttpError(429, 'Trop d’essais : réessayez dans quelques minutes.', 'rate_limited');
  if (!share.password_hash) {
    await verifyDummyPassword(password);
    return { token: tokenFor(share) };
  }
  if (!(await verifyPassword(password, share.password_hash))) {
    attempts.set(key, { count: entry.count + 1, since: entry.since });
    throw forbidden('Mot de passe incorrect.');
  }
  attempts.delete(key);
  return { token: tokenFor(share) };
}
