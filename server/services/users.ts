import { hasPermission, isSubsetOfPermissions } from '../../shared/permissions.ts';
import type { AdminUserDTO, UserSummaryDTO } from '../../shared/types.ts';
import { hashPassword } from '../auth/password.ts';
import { destroyUserSessions } from '../auth/sessions.ts';
import type { AppContext } from '../context.ts';
import { nowIso, type Db } from '../db/database.ts';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.ts';
import { getAuthUser, type AuthUser } from './access.ts';
import { DEFAULT_THEME_ID, isCustomThemeId, normalizeAppearance } from '../../shared/themes.ts';
import { parsePermissions, toUserSummary, USER_COLUMNS, type UserRow } from './rows.ts';

interface AdminUserRow extends UserRow {
  role_key: string | null;
  role_name: string;
}

function toAdminUser(row: AdminUserRow): AdminUserDTO {
  return {
    ...toUserSummary(row),
    theme: row.theme,
    roleId: row.role_id,
    roleName: row.role_name,
    roleKey: row.role_key,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

const ADMIN_USER_SELECT = `SELECT ${USER_COLUMNS}, r.key AS role_key, r.name AS role_name
                             FROM users u JOIN roles r ON r.id = u.role_id`;

export function listAdminUsers(db: Db): AdminUserDTO[] {
  return db.all<AdminUserRow>(`${ADMIN_USER_SELECT} ORDER BY u.name COLLATE NOCASE`).map(toAdminUser);
}

export function getAdminUser(db: Db, userId: number): AdminUserDTO {
  const row = db.get<AdminUserRow>(`${ADMIN_USER_SELECT} WHERE u.id = ?`, userId);
  if (!row) {
    throw notFound('Utilisateur introuvable.');
  }
  return toAdminUser(row);
}

/** Annuaire minimal des comptes actifs, utilisé pour inviter des membres. */
export function listDirectory(db: Db): UserSummaryDTO[] {
  return db
    .all<UserRow>(`SELECT ${USER_COLUMNS} FROM users u WHERE u.is_active = 1 ORDER BY u.name COLLATE NOCASE`)
    .map(toUserSummary);
}

function globalRolePermissions(db: Db, roleId: number): string[] {
  const role = db.get<{ permissions: string }>("SELECT permissions FROM roles WHERE id = ? AND scope = 'global'", roleId);
  if (!role) {
    throw badRequest('Rôle global invalide.');
  }
  return parsePermissions(role.permissions);
}

function assertEmailFree(db: Db, email: string, exceptUserId?: number): void {
  const existing = db.get<{ id: number }>('SELECT id FROM users WHERE email = ? COLLATE NOCASE', email);
  if (existing && existing.id !== exceptUserId) {
    throw conflict('Un compte utilise déjà cette adresse e-mail.');
  }
}

/** Nombre d'autres comptes actifs possédant le joker `*`. */
function otherActiveSuperAdmins(db: Db, exceptUserId: number): number {
  const rows = db.all<{ permissions: string }>(
    'SELECT r.permissions FROM users u JOIN roles r ON r.id = u.role_id WHERE u.is_active = 1 AND u.id != ?',
    exceptUserId,
  );
  return rows.filter((row) => parsePermissions(row.permissions).includes('*')).length;
}

export async function createUserByAdmin(
  ctx: AppContext,
  actor: AuthUser,
  input: { email: string; name: string; password: string; roleId: number },
): Promise<AdminUserDTO> {
  const { db } = ctx;
  const rolePermissions = globalRolePermissions(db, input.roleId);
  if (!isSubsetOfPermissions(rolePermissions, actor.permissions)) {
    throw forbidden("Vous ne pouvez pas attribuer un rôle plus privilégié que le vôtre.");
  }
  assertEmailFree(db, input.email);
  const passwordHash = await hashPassword(input.password);
  const now = nowIso();
  const { lastInsertRowid } = db.run(
    'INSERT INTO users (email, name, password_hash, role_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    input.email,
    input.name,
    passwordHash,
    input.roleId,
    now,
    now,
  );
  return getAdminUser(db, lastInsertRowid);
}

export interface AdminUserPatch {
  email?: string;
  name?: string;
  roleId?: number;
  isActive?: boolean;
  password?: string;
}

export async function updateUserByAdmin(ctx: AppContext, actor: AuthUser, targetId: number, patch: AdminUserPatch): Promise<AdminUserDTO> {
  const { db } = ctx;
  const target = getAuthUser(db, targetId);
  if (!target) {
    throw notFound('Utilisateur introuvable.');
  }
  if (!isSubsetOfPermissions(target.permissions, actor.permissions)) {
    throw forbidden('Vous ne pouvez pas modifier un compte plus privilégié que le vôtre.');
  }
  const isSelf = target.id === actor.id;
  if (isSelf && patch.isActive === false) {
    throw forbidden('Vous ne pouvez pas désactiver votre propre compte.');
  }
  if (isSelf && patch.roleId !== undefined && patch.roleId !== target.roleId) {
    throw forbidden('Vous ne pouvez pas modifier votre propre rôle.');
  }

  const sets: string[] = [];
  const params: Array<string | number> = [];
  let losesSuperAdmin = false;

  if (patch.roleId !== undefined && patch.roleId !== target.roleId) {
    const rolePermissions = globalRolePermissions(db, patch.roleId);
    if (!isSubsetOfPermissions(rolePermissions, actor.permissions)) {
      throw forbidden('Vous ne pouvez pas attribuer un rôle plus privilégié que le vôtre.');
    }
    losesSuperAdmin = target.permissions.includes('*') && !rolePermissions.includes('*');
    sets.push('role_id = ?');
    params.push(patch.roleId);
  }
  if (patch.isActive === false && target.isActive && target.permissions.includes('*')) {
    losesSuperAdmin = true;
  }
  if (losesSuperAdmin && otherActiveSuperAdmins(db, targetId) === 0) {
    throw conflict('Il doit rester au moins un super administrateur actif.');
  }
  if (patch.email !== undefined) {
    assertEmailFree(db, patch.email, targetId);
    sets.push('email = ?');
    params.push(patch.email);
  }
  if (patch.name !== undefined) {
    sets.push('name = ?');
    params.push(patch.name);
  }
  if (patch.isActive !== undefined) {
    sets.push('is_active = ?');
    params.push(patch.isActive ? 1 : 0);
  }
  if (patch.password !== undefined) {
    sets.push('password_hash = ?');
    params.push(await hashPassword(patch.password));
  }

  if (sets.length > 0) {
    db.run(`UPDATE users SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...params, nowIso(), targetId);
  }
  if (patch.password !== undefined || patch.isActive === false) {
    destroyUserSessions(ctx, targetId);
    ctx.hub.disconnectUser(targetId);
  } else {
    ctx.hub.refreshUsers([targetId]);
  }
  notifyProfileChange(ctx, targetId);
  return getAdminUser(db, targetId);
}

export function deleteUserByAdmin(ctx: AppContext, actor: AuthUser, targetId: number): void {
  const { db } = ctx;
  const target = getAuthUser(db, targetId);
  if (!target) {
    throw notFound('Utilisateur introuvable.');
  }
  if (target.id === actor.id) {
    throw forbidden('Vous ne pouvez pas supprimer votre propre compte.');
  }
  if (!isSubsetOfPermissions(target.permissions, actor.permissions)) {
    throw forbidden('Vous ne pouvez pas supprimer un compte plus privilégié que le vôtre.');
  }
  if (target.permissions.includes('*') && target.isActive && otherActiveSuperAdmins(db, targetId) === 0) {
    throw conflict('Il doit rester au moins un super administrateur actif.');
  }
  const projectIds = db
    .all<{ project_id: number }>('SELECT project_id FROM project_members WHERE user_id = ?', targetId)
    .map((row) => row.project_id);
  ctx.hub.disconnectUser(targetId);
  db.run('DELETE FROM users WHERE id = ?', targetId);
  for (const projectId of projectIds) {
    notifyMembersOfProject(ctx, projectId);
  }
}

/** Informe les projets partagés qu'un profil (nom, image) a changé. */
export function notifyProfileChange(ctx: AppContext, userId: number): void {
  const projectIds = ctx.db
    .all<{ project_id: number }>('SELECT project_id FROM project_members WHERE user_id = ?', userId)
    .map((row) => row.project_id);
  for (const projectId of projectIds) {
    notifyMembersOfProject(ctx, projectId);
  }
}

function notifyMembersOfProject(ctx: AppContext, projectId: number): void {
  const users = ctx.db
    .all<UserRow>(
      `SELECT ${USER_COLUMNS} FROM users u JOIN project_members m ON m.user_id = u.id
        WHERE m.project_id = ? ORDER BY u.name COLLATE NOCASE`,
      projectId,
    )
    .map(toUserSummary);
  const members = ctx.db
    .all<{ user_id: number; role_id: number; created_at: string }>(
      'SELECT user_id, role_id, created_at FROM project_members WHERE project_id = ? ORDER BY created_at, user_id',
      projectId,
    )
    .map((row) => ({ userId: row.user_id, roleId: row.role_id, joinedAt: row.created_at }));
  ctx.hub.publish(projectId, [{ type: 'members.changed', members, users }], { userId: null, origin: null });
}

// ---------------------------------------------------------------------------------------------------------------------
// Profil personnel
// ---------------------------------------------------------------------------------------------------------------------

export function updateOwnProfile(ctx: AppContext, userId: number, patch: { name?: string; theme?: string; locale?: string; appearance?: unknown }): void {
  const sets: string[] = [];
  const params: string[] = [];
  const current = ctx.db.get<{ theme: string; appearance: string }>('SELECT theme, appearance FROM users WHERE id = ?', userId);
  let appearance = normalizeAppearance(JSON.parse(current?.appearance || '{}'));
  if (patch.appearance !== undefined) {
    appearance = normalizeAppearance(patch.appearance);
    sets.push('appearance = ?');
    params.push(JSON.stringify(appearance));
  }
  // Un thème personnalisé doit exister ; supprimer le thème utilisé ramène au thème par défaut.
  const theme = patch.theme ?? current?.theme ?? DEFAULT_THEME_ID;
  if (isCustomThemeId(theme) && !appearance.customThemes.some((entry) => entry.id === theme)) {
    if (patch.theme !== undefined) throw badRequest('Thème inconnu.');
    patch = { ...patch, theme: DEFAULT_THEME_ID };
  }
  if (patch.name !== undefined) {
    sets.push('name = ?');
    params.push(patch.name);
  }
  if (patch.theme !== undefined) {
    sets.push('theme = ?');
    params.push(patch.theme);
  }
  if (patch.locale !== undefined) {
    sets.push('locale = ?');
    params.push(patch.locale);
  }
  if (sets.length === 0) {
    return;
  }
  ctx.db.run(`UPDATE users SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...params, nowIso(), userId);
  if (patch.name !== undefined) {
    notifyProfileChange(ctx, userId);
  }
}

export function setAvatar(ctx: AppContext, userId: number, mime: string, data: Buffer): void {
  ctx.db.run(
    'UPDATE users SET avatar = ?, avatar_mime = ?, avatar_version = avatar_version + 1, updated_at = ? WHERE id = ?',
    data,
    mime,
    nowIso(),
    userId,
  );
  notifyProfileChange(ctx, userId);
}

export function clearAvatar(ctx: AppContext, userId: number): void {
  ctx.db.run(
    'UPDATE users SET avatar = NULL, avatar_mime = NULL, avatar_version = avatar_version + 1, updated_at = ? WHERE id = ?',
    nowIso(),
    userId,
  );
  notifyProfileChange(ctx, userId);
}

export function getAvatar(db: Db, userId: number): { mime: string; data: Uint8Array } | null {
  const row = db.get<{ avatar: Uint8Array | null; avatar_mime: string | null }>(
    'SELECT avatar, avatar_mime FROM users WHERE id = ?',
    userId,
  );
  if (!row?.avatar || !row.avatar_mime) {
    return null;
  }
  return { mime: row.avatar_mime, data: row.avatar };
}

export function canSeeAdminArea(user: AuthUser): boolean {
  return hasPermission(user.permissions, 'admin.access');
}
