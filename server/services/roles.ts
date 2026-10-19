import { ALL_PROJECT_PERMISSION_KEYS, hasPermission, isSubsetOfPermissions, permissionCatalog, type RoleScope } from '../../shared/permissions.ts';
import type { RoleDTO } from '../../shared/types.ts';
import type { AppContext } from '../context.ts';
import { nowIso, type Db } from '../db/database.ts';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.ts';
import type { AuthUser } from './access.ts';
import { parsePermissions, toRoleDTO, type RoleRow } from './rows.ts';

function usageOf(db: Db, role: Pick<RoleRow, 'id' | 'scope'>): number {
  const table = role.scope === 'global' ? 'users' : 'project_members';
  return db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE role_id = ?`, role.id)?.n ?? 0;
}

export function listRoles(db: Db, scope?: RoleScope): RoleDTO[] {
  const rows = scope
    ? db.all<RoleRow>('SELECT * FROM roles WHERE scope = ? ORDER BY is_system DESC, id', scope)
    : db.all<RoleRow>('SELECT * FROM roles ORDER BY scope, is_system DESC, id');
  return rows.map((row) => toRoleDTO(row, usageOf(db, row)));
}

function requireRole(db: Db, roleId: number): RoleRow {
  const role = db.get<RoleRow>('SELECT * FROM roles WHERE id = ?', roleId);
  if (!role) {
    throw notFound('Rôle introuvable.');
  }
  return role;
}

/**
 * Permissions que l'acteur a le droit d'accorder dans un rôle de ce périmètre.
 * Rôle global : un sous-ensemble de ses propres permissions. Rôle de projet : toutes, s'il gère tous les projets.
 */
function grantable(actor: AuthUser, scope: RoleScope): string[] {
  if (scope === 'global') {
    return actor.permissions;
  }
  return hasPermission(actor.permissions, 'projects.manage_all') ? [...ALL_PROJECT_PERMISSION_KEYS] : [];
}

function validatePermissions(scope: RoleScope, permissions: string[], actor: AuthUser): string[] {
  const known = new Set(permissionCatalog(scope).map((entry) => entry.key));
  const unique = [...new Set(permissions)];
  const unknown = unique.filter((permission) => !known.has(permission));
  if (unknown.length > 0) {
    throw badRequest(`Permission inconnue : ${unknown.join(', ')}.`);
  }
  if (!isSubsetOfPermissions(unique, grantable(actor, scope))) {
    throw forbidden('Vous ne pouvez pas accorder des permissions que vous ne possédez pas.');
  }
  return unique;
}

function assertNameFree(db: Db, scope: RoleScope, name: string, exceptId?: number): void {
  const existing = db.get<{ id: number }>('SELECT id FROM roles WHERE scope = ? AND name = ? COLLATE NOCASE', scope, name);
  if (existing && existing.id !== exceptId) {
    throw conflict('Un rôle porte déjà ce nom.');
  }
}

export function createRole(
  ctx: AppContext,
  actor: AuthUser,
  input: { scope: RoleScope; name: string; description: string; permissions: string[] },
): RoleDTO {
  const { db } = ctx;
  const permissions = validatePermissions(input.scope, input.permissions, actor);
  assertNameFree(db, input.scope, input.name);
  const { lastInsertRowid } = db.run(
    'INSERT INTO roles (scope, key, name, description, permissions, is_system, created_at) VALUES (?, NULL, ?, ?, ?, 0, ?)',
    input.scope,
    input.name,
    input.description,
    JSON.stringify(permissions),
    nowIso(),
  );
  const role = requireRole(db, lastInsertRowid);
  return toRoleDTO(role, 0);
}

export function updateRole(
  ctx: AppContext,
  actor: AuthUser,
  roleId: number,
  patch: { name?: string; description?: string; permissions?: string[] },
): RoleDTO {
  const { db } = ctx;
  const role = requireRole(db, roleId);
  if (role.key === 'super_admin' || role.key === 'owner') {
    throw conflict('Ce rôle est verrouillé et ne peut pas être modifié.');
  }
  if (!isSubsetOfPermissions(parsePermissions(role.permissions), grantable(actor, role.scope))) {
    throw forbidden('Vous ne pouvez pas modifier un rôle plus privilégié que le vôtre.');
  }

  const sets: string[] = [];
  const params: string[] = [];
  if (patch.name !== undefined && patch.name !== role.name) {
    if (role.is_system === 1) {
      throw conflict('Un rôle système ne peut pas être renommé.');
    }
    assertNameFree(db, role.scope, patch.name, roleId);
    sets.push('name = ?');
    params.push(patch.name);
  }
  if (patch.description !== undefined) {
    sets.push('description = ?');
    params.push(patch.description);
  }
  if (patch.permissions !== undefined) {
    sets.push('permissions = ?');
    params.push(JSON.stringify(validatePermissions(role.scope, patch.permissions, actor)));
  }
  if (sets.length > 0) {
    db.run(`UPDATE roles SET ${sets.join(', ')} WHERE id = ?`, ...params, roleId);
    ctx.hub.refreshEveryone();
  }
  const updated = requireRole(db, roleId);
  return toRoleDTO(updated, usageOf(db, updated));
}

export function deleteRole(ctx: AppContext, actor: AuthUser, roleId: number): void {
  const { db } = ctx;
  const role = requireRole(db, roleId);
  if (role.is_system === 1) {
    throw conflict('Un rôle système ne peut pas être supprimé.');
  }
  if (!isSubsetOfPermissions(parsePermissions(role.permissions), grantable(actor, role.scope))) {
    throw forbidden('Vous ne pouvez pas supprimer un rôle plus privilégié que le vôtre.');
  }
  if (usageOf(db, role) > 0) {
    throw conflict('Ce rôle est encore attribué : réassignez ses utilisateurs avant de le supprimer.');
  }
  db.run('DELETE FROM roles WHERE id = ?', roleId);
}
