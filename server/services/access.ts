import { isLocale, type Locale } from '../../shared/locales.ts';
import { ALL_PROJECT_PERMISSION_KEYS, hasPermission } from '../../shared/permissions.ts';
import { normalizeAppearance, type AppearanceDTO } from '../../shared/themes.ts';
import type { MeDTO, TokenInfoDTO } from '../../shared/types.ts';
import type { AppContext } from '../context.ts';
import type { Db } from '../db/database.ts';
import { conflict, forbidden, notFound } from '../http/errors.ts';
import { parsePermissions, type ProjectRow } from './rows.ts';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  roleId: number;
  roleKey: string | null;
  roleName: string;
  /** Permissions globales du rôle (peut contenir le joker `*`). */
  permissions: string[];
  theme: string;
  appearance: AppearanceDTO;
  locale: Locale | null;
  avatarVersion: number;
  isActive: boolean;
  /** Renseigné quand la requête est authentifiée par un jeton d'API (et non par une session). */
  token: TokenInfoDTO | null;
}

interface AuthUserRow {
  id: number;
  email: string;
  name: string;
  role_id: number;
  is_active: number;
  theme: string;
  appearance: string;
  locale: string | null;
  avatar_version: number;
  role_key: string | null;
  role_name: string;
  permissions: string;
}

function parseAppearance(raw: string | null | undefined): AppearanceDTO {
  try {
    return normalizeAppearance(JSON.parse(raw || '{}'));
  } catch {
    return normalizeAppearance({});
  }
}

export function getAuthUser(db: Db, userId: number): AuthUser | undefined {
  const row = db.get<AuthUserRow>(
    `SELECT u.id, u.email, u.name, u.role_id, u.is_active, u.theme, u.appearance, u.locale, u.avatar_version,
            r.key AS role_key, r.name AS role_name, r.permissions
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    userId,
  );
  if (!row) {
    return undefined;
  }
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    roleId: row.role_id,
    roleKey: row.role_key,
    roleName: row.role_name,
    permissions: parsePermissions(row.permissions),
    theme: row.theme,
    appearance: parseAppearance(row.appearance),
    locale: isLocale(row.locale) ? row.locale : null,
    avatarVersion: row.avatar_version,
    isActive: row.is_active === 1,
    token: null,
  };
}

export function toMeDTO(user: AuthUser): MeDTO {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarVersion: user.avatarVersion,
    isActive: user.isActive,
    theme: user.theme,
    appearance: user.appearance,
    locale: user.locale,
    roleId: user.roleId,
    roleName: user.roleName,
    roleKey: user.roleKey,
    permissions: user.permissions,
  };
}

export interface ProjectAccess {
  project: ProjectRow;
  /** Permissions effectives dans ce projet. */
  permissions: Set<string>;
  /** Rôle de projet de l'utilisateur (null s'il n'est pas membre). */
  roleId: number | null;
}

/** Résout les droits d'un utilisateur sur un projet ; `null` si le projet n'existe pas ou n'est pas visible. */
export function resolveProjectAccess(db: Db, user: AuthUser, projectId: number): ProjectAccess | null {
  // Un jeton limité à certains projets n'en voit aucun autre.
  if (user.token?.projectIds && !user.token.projectIds.includes(projectId)) {
    return null;
  }
  const project = db.get<ProjectRow>('SELECT * FROM projects WHERE id = ?', projectId);
  if (!project) {
    return null;
  }
  const member = db.get<{ role_id: number; permissions: string }>(
    `SELECT m.role_id, r.permissions FROM project_members m JOIN roles r ON r.id = m.role_id
      WHERE m.project_id = ? AND m.user_id = ?`,
    projectId,
    user.id,
  );

  if (hasPermission(user.permissions, 'projects.manage_all')) {
    return { project, permissions: new Set(ALL_PROJECT_PERMISSION_KEYS), roleId: member?.role_id ?? null };
  }
  if (member) {
    const granted = parsePermissions(member.permissions);
    const permissions = granted.includes('*') ? new Set(ALL_PROJECT_PERMISSION_KEYS) : new Set(granted);
    return { project, permissions, roleId: member.role_id };
  }
  if (hasPermission(user.permissions, 'projects.view_all')) {
    return { project, permissions: new Set(), roleId: null };
  }
  return null;
}

const ARCHIVE_EXEMPT = new Set(['project.edit', 'project.delete', 'project.members']);

/**
 * Vérifie l'accès à un projet. Répond 404 si le projet est invisible (pour ne pas révéler son existence),
 * 403 si la permission manque, 409 si le projet archivé est en lecture seule.
 */
export function requireProject(ctx: AppContext, user: AuthUser, projectId: number, permission?: string): ProjectAccess {
  const access = resolveProjectAccess(ctx.db, user, projectId);
  if (!access) {
    throw notFound('Projet introuvable.');
  }
  if (permission) {
    if (!access.permissions.has(permission)) {
      throw forbidden();
    }
    if (access.project.archived === 1 && !ARCHIVE_EXEMPT.has(permission)) {
      throw conflict('Ce projet est archivé : il est en lecture seule.');
    }
  }
  return access;
}

export function requireGlobal(user: AuthUser, permission: string): void {
  if (!hasPermission(user.permissions, permission)) {
    throw forbidden();
  }
}
