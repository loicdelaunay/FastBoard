import { GROUP_LIMITS, type GroupAccessDTO, type GroupDTO, type GroupMemberRole, type GroupSpaceRole } from '../../shared/groups.ts';
import { hasPermission } from '../../shared/permissions.ts';
import { boardRole, boardsEnabled } from '../boards/store.ts';
import type { Actor, AppContext } from '../context.ts';
import { nowIso, type Db } from '../db/database.ts';
import { docRole, docsEnabled } from '../docs/store.ts';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.ts';
import { getAuthUser, resolveProjectAccess, type AuthUser } from './access.ts';
import { grantsOfGroup, groupMemberIds, type GroupGrants } from './groupRows.ts';
import { broadcastMembers } from './projects.ts';

/**
 * Groupes de personnes : on les ajoute d'un coup aux projets, aux espaces de documentation et de tableaux blancs. Les
 * droits se lisent dans les vues *_access (rôle direct et rôles des groupes) : ajouter quelqu'un à un groupe, l'en
 * retirer, changer le rôle d'un groupe ou le supprimer prend effet aussitôt, y compris pour les pages et les éditions
 * déjà ouvertes (voir `propagateAccess`).
 */

interface GroupRow {
  id: number;
  name: string;
  description: string;
  color: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

interface MemberRow {
  group_id: number;
  user_id: number;
  role: GroupMemberRole;
  created_at: string;
}

const NO_GRANTS: GroupGrants = { projects: [], docSpaces: [], boardSpaces: [] };

function toDTO(row: GroupRow, members: MemberRow[], viewer: AuthUser): GroupDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    members: members.map((member) => ({ userId: member.user_id, role: member.role, addedAt: member.created_at })),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canManage: hasPermission(viewer.permissions, 'groups.manage') || members.some((member) => member.user_id === viewer.id && member.role === 'manager'),
  };
}

/** Tous les groupes : chacun les voit, pour les ajouter à ce qu'il partage (comme l'annuaire des personnes). */
export function listGroups(db: Db, viewer: AuthUser): GroupDTO[] {
  const rows = db.all<GroupRow>('SELECT * FROM user_groups ORDER BY name COLLATE NOCASE');
  const members = db.all<MemberRow>('SELECT group_id, user_id, role, created_at FROM user_group_members ORDER BY created_at, user_id');
  return rows.map((row) => toDTO(row, members.filter((member) => member.group_id === row.id), viewer));
}

function requireGroupRow(db: Db, groupId: number): GroupRow {
  const row = db.get<GroupRow>('SELECT * FROM user_groups WHERE id = ?', groupId);
  if (!row) throw notFound('Groupe introuvable.');
  return row;
}

export function getGroup(db: Db, viewer: AuthUser, groupId: number): GroupDTO {
  const row = requireGroupRow(db, groupId);
  return toDTO(row, db.all<MemberRow>('SELECT group_id, user_id, role, created_at FROM user_group_members WHERE group_id = ? ORDER BY created_at, user_id', groupId), viewer);
}

/** Gestionnaire du groupe, ou `groups.manage`. */
export function canManageGroup(db: Db, viewer: AuthUser, groupId: number): boolean {
  if (hasPermission(viewer.permissions, 'groups.manage')) return true;
  return db.get<{ role: string }>('SELECT role FROM user_group_members WHERE group_id = ? AND user_id = ?', groupId, viewer.id)?.role === 'manager';
}

function requireManage(db: Db, viewer: AuthUser, groupId: number): GroupRow {
  const row = requireGroupRow(db, groupId);
  if (!canManageGroup(db, viewer, groupId)) throw forbidden('Seuls les gestionnaires du groupe peuvent le modifier.');
  return row;
}

function assertFreeName(db: Db, name: string, except: number | null): void {
  const taken = db.get<{ id: number }>('SELECT id FROM user_groups WHERE name = ? COLLATE NOCASE', name);
  if (taken && taken.id !== except) throw conflict('Un groupe porte déjà ce nom.');
}

function assertActiveUser(db: Db, userId: number): void {
  const user = db.get<{ is_active: number }>('SELECT is_active FROM users WHERE id = ?', userId);
  if (!user || user.is_active !== 1) throw badRequest('Utilisateur introuvable ou désactivé.');
}

/** Où le groupe a accès, parmi ce que `viewer` peut voir lui-même. */
export function groupAccess(ctx: AppContext, viewer: AuthUser, groupId: number): GroupAccessDTO[] {
  const { db } = ctx;
  requireGroupRow(db, groupId);
  const projects = db
    .all<{ id: number; name: string; role: string }>(
      `SELECT p.id, p.name, r.name AS role FROM project_groups pg JOIN projects p ON p.id = pg.project_id JOIN roles r ON r.id = pg.role_id
        WHERE pg.group_id = ? ORDER BY p.name COLLATE NOCASE`,
      groupId,
    )
    .filter((row) => resolveProjectAccess(db, viewer, row.id) !== null)
    .map((row) => ({ kind: 'project' as const, ...row }));
  const spaces = (kind: 'docs' | 'boards'): GroupAccessDTO[] => {
    if (kind === 'docs' ? !docsEnabled(db) : !boardsEnabled(db)) return [];
    const [table, spaces] = kind === 'docs' ? ['doc_space_groups', 'doc_spaces'] : ['board_space_groups', 'board_spaces'];
    return db
      .all<{ id: number; name: string; role: string }>(
        `SELECT s.id, s.name, sg.role FROM ${table} sg JOIN ${spaces} s ON s.id = sg.space_id WHERE sg.group_id = ? ORDER BY s.name COLLATE NOCASE`,
        groupId,
      )
      .filter((row) => (kind === 'docs' ? docRole(db, viewer, row.id) : boardRole(db, viewer, row.id)) !== null)
      .map((row) => ({ kind, ...row }));
  };
  return [...projects, ...spaces('docs'), ...spaces('boards')];
}

// --- Propagation des droits ------------------------------------------------------------------------------------------

/**
 * Les accès de `userIds` aux projets et espaces `grants` viennent de changer (groupe modifié) : chaque projet relit ses
 * membres et ses droits, qui l'a perdu en est sorti aussitôt (pages ouvertes comprises), et chaque espace revérifie le
 * rôle des personnes qui y sont (une éditrice redevenue lectrice ne peut plus écrire, une personne retirée en sort).
 */
export function propagateAccess(ctx: AppContext, actor: Actor, grants: GroupGrants, userIds: number[]): void {
  const people = [...new Set(userIds)];
  for (const projectId of grants.projects) {
    broadcastMembers(ctx, actor, projectId);
    for (const userId of people) {
      const user = getAuthUser(ctx.db, userId);
      if (!user || !resolveProjectAccess(ctx.db, user, projectId)) ctx.hub.revokeProject(projectId, userId);
    }
  }
  for (const spaceId of grants.docSpaces) {
    for (const userId of people) ctx.docRooms.refreshAccess(spaceId, userId);
    ctx.docRooms.refreshSpace(spaceId);
  }
  for (const spaceId of grants.boardSpaces) {
    for (const userId of people) ctx.boardRooms.refreshAccess(spaceId, userId);
    ctx.boardRooms.refreshSpace(spaceId);
  }
  if (grants.projects.length) ctx.hub.refreshProjectLists(people);
  if (grants.docSpaces.length || grants.boardSpaces.length) ctx.hub.refreshSpaces(people);
}

/** Le groupe a changé (nom, membres) : chacun relit la liste des groupes. */
function announce(ctx: AppContext): void {
  ctx.hub.broadcast({ t: 'groups.changed' });
}

// --- Groupes ---------------------------------------------------------------------------------------------------------

export function createGroup(ctx: AppContext, viewer: AuthUser, input: { name: string; description: string; color: string | null; memberIds: number[] }): GroupDTO {
  const { db } = ctx;
  const name = input.name.trim();
  assertFreeName(db, name, null);
  const others = [...new Set(input.memberIds)].filter((id) => id !== viewer.id);
  if (others.length + 1 > GROUP_LIMITS.membersMax) throw badRequest(`Un groupe ne peut pas compter plus de ${GROUP_LIMITS.membersMax} personnes.`);
  for (const userId of others) assertActiveUser(db, userId);
  const now = nowIso();
  let groupId = 0;
  db.transaction(() => {
    groupId = db.run('INSERT INTO user_groups (name, description, color, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', name, input.description.trim(), input.color, viewer.id, now, now).lastInsertRowid;
    // Qui crée le groupe le gère ; les autres en sont membres.
    db.run("INSERT INTO user_group_members (group_id, user_id, role, created_at) VALUES (?, ?, 'manager', ?)", groupId, viewer.id, now);
    for (const userId of others) db.run("INSERT INTO user_group_members (group_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)", groupId, userId, now);
  });
  ctx.logger.info('groups', `Groupe créé : ${name}`, { groupId, members: others.length + 1 }, viewer.id);
  announce(ctx);
  return getGroup(db, viewer, groupId);
}

export function updateGroup(ctx: AppContext, actor: Actor, viewer: AuthUser, groupId: number, patch: { name?: string; description?: string; color?: string | null }): GroupDTO {
  const { db } = ctx;
  const row = requireManage(db, viewer, groupId);
  const name = patch.name?.trim() ?? row.name;
  if (name !== row.name) assertFreeName(db, name, groupId);
  db.run(
    'UPDATE user_groups SET name = ?, description = ?, color = ?, updated_at = ? WHERE id = ?',
    name,
    patch.description?.trim() ?? row.description,
    patch.color === undefined ? row.color : patch.color,
    nowIso(),
    groupId,
  );
  // Le nom et la couleur s'affichent dans les membres des projets et des espaces : ils les relisent.
  propagateAccess(ctx, actor, grantsOfGroup(db, groupId), []);
  announce(ctx);
  return getGroup(db, viewer, groupId);
}

export function deleteGroup(ctx: AppContext, actor: Actor, viewer: AuthUser, groupId: number): void {
  const { db } = ctx;
  const row = requireManage(db, viewer, groupId);
  const grants = grantsOfGroup(db, groupId);
  const members = groupMemberIds(db, groupId);
  db.run('DELETE FROM user_groups WHERE id = ?', groupId);
  ctx.logger.info('groups', `Groupe supprimé : ${row.name}`, { groupId }, viewer.id);
  propagateAccess(ctx, actor, grants, members);
  announce(ctx);
}

function managers(db: Db, groupId: number): number[] {
  return db.all<{ user_id: number }>("SELECT user_id FROM user_group_members WHERE group_id = ? AND role = 'manager'", groupId).map((row) => row.user_id);
}

/** Ajoute une personne au groupe, ou change son rôle dans le groupe ; elle reçoit aussitôt les accès du groupe. */
export function setGroupMember(ctx: AppContext, actor: Actor, viewer: AuthUser, groupId: number, userId: number, role: GroupMemberRole): GroupDTO {
  const { db } = ctx;
  requireManage(db, viewer, groupId);
  assertActiveUser(db, userId);
  const current = db.get<{ role: GroupMemberRole }>('SELECT role FROM user_group_members WHERE group_id = ? AND user_id = ?', groupId, userId);
  if (current) {
    const remaining = managers(db, groupId).filter((id) => id !== userId);
    if (current.role === 'manager' && role !== 'manager' && remaining.length === 0) throw conflict('Un groupe doit garder au moins un gestionnaire.');
    db.run('UPDATE user_group_members SET role = ? WHERE group_id = ? AND user_id = ?', role, groupId, userId);
  } else {
    const count = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM user_group_members WHERE group_id = ?', groupId)?.n ?? 0;
    if (count >= GROUP_LIMITS.membersMax) throw badRequest(`Un groupe ne peut pas compter plus de ${GROUP_LIMITS.membersMax} personnes.`);
    db.run('INSERT INTO user_group_members (group_id, user_id, role, created_at) VALUES (?, ?, ?, ?)', groupId, userId, role, nowIso());
    propagateAccess(ctx, actor, grantsOfGroup(db, groupId), [userId]);
  }
  db.run('UPDATE user_groups SET updated_at = ? WHERE id = ?', nowIso(), groupId);
  announce(ctx);
  return getGroup(db, viewer, groupId);
}

/** Retire une personne du groupe (ou elle le quitte) : elle perd aussitôt les accès qu'elle ne tenait que de lui. */
export function removeGroupMember(ctx: AppContext, actor: Actor, viewer: AuthUser, groupId: number, userId: number): GroupDTO {
  const { db } = ctx;
  requireGroupRow(db, groupId);
  if (userId !== viewer.id && !canManageGroup(db, viewer, groupId)) throw forbidden('Seuls les gestionnaires du groupe peuvent le modifier.');
  const current = db.get<{ role: GroupMemberRole }>('SELECT role FROM user_group_members WHERE group_id = ? AND user_id = ?', groupId, userId);
  if (!current) throw notFound('Cette personne n’est pas dans le groupe.');
  const others = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM user_group_members WHERE group_id = ? AND user_id != ?', groupId, userId)?.n ?? 0;
  if (current.role === 'manager' && others > 0 && managers(db, groupId).length === 1) {
    throw conflict('Un groupe doit garder au moins un gestionnaire : nommez-en un autre avant.');
  }
  db.run('DELETE FROM user_group_members WHERE group_id = ? AND user_id = ?', groupId, userId);
  db.run('UPDATE user_groups SET updated_at = ? WHERE id = ?', nowIso(), groupId);
  propagateAccess(ctx, actor, grantsOfGroup(db, groupId), [userId]);
  announce(ctx);
  return getGroup(db, viewer, groupId);
}

// --- Accès d'un groupe aux projets et aux espaces ----------------------------------------------------------------------

function projectOwnerRoleId(db: Db): number | null {
  return db.get<{ id: number }>("SELECT id FROM roles WHERE scope = 'project' AND key = 'owner'")?.id ?? null;
}

/** Ajoute un groupe à un projet, ou change son rôle. Un groupe n'est jamais propriétaire (il faut un responsable nommé). */
export function setProjectGroup(ctx: AppContext, actor: Actor, projectId: number, groupId: number, roleId: number): void {
  const { db } = ctx;
  requireGroupRow(db, groupId);
  if (!db.get("SELECT 1 FROM roles WHERE id = ? AND scope = 'project'", roleId)) throw badRequest('Rôle de projet invalide.');
  if (roleId === projectOwnerRoleId(db)) throw badRequest('Un groupe ne peut pas être propriétaire d’un projet.');
  db.run(
    'INSERT INTO project_groups (project_id, group_id, role_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (project_id, group_id) DO UPDATE SET role_id = excluded.role_id',
    projectId,
    groupId,
    roleId,
    nowIso(),
  );
  propagateAccess(ctx, actor, { ...NO_GRANTS, projects: [projectId] }, groupMemberIds(db, groupId));
}

export function removeProjectGroup(ctx: AppContext, actor: Actor, projectId: number, groupId: number): void {
  const { db } = ctx;
  if (!db.get('SELECT 1 FROM project_groups WHERE project_id = ? AND group_id = ?', projectId, groupId)) throw notFound('Ce groupe n’a pas accès à ce projet.');
  db.run('DELETE FROM project_groups WHERE project_id = ? AND group_id = ?', projectId, groupId);
  propagateAccess(ctx, actor, { ...NO_GRANTS, projects: [projectId] }, groupMemberIds(db, groupId));
}

const SPACE_TABLES = { docs: 'doc_space_groups', boards: 'board_space_groups' } as const;

/** Ajoute un groupe à un espace de documentation ou de tableaux blancs, ou change son rôle (lecteur ou éditeur). */
export function setSpaceGroup(ctx: AppContext, actor: Actor, kind: 'docs' | 'boards', spaceId: number, groupId: number, role: GroupSpaceRole): void {
  const { db } = ctx;
  requireGroupRow(db, groupId);
  db.run(
    `INSERT INTO ${SPACE_TABLES[kind]} (space_id, group_id, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (space_id, group_id) DO UPDATE SET role = excluded.role`,
    spaceId,
    groupId,
    role,
    nowIso(),
  );
  propagateAccess(ctx, actor, { ...NO_GRANTS, [kind === 'docs' ? 'docSpaces' : 'boardSpaces']: [spaceId] }, groupMemberIds(db, groupId));
}

export function removeSpaceGroup(ctx: AppContext, actor: Actor, kind: 'docs' | 'boards', spaceId: number, groupId: number): void {
  const { db } = ctx;
  const table = SPACE_TABLES[kind];
  if (!db.get(`SELECT 1 FROM ${table} WHERE space_id = ? AND group_id = ?`, spaceId, groupId)) throw notFound('Ce groupe n’a pas accès à cet espace.');
  db.run(`DELETE FROM ${table} WHERE space_id = ? AND group_id = ?`, spaceId, groupId);
  propagateAccess(ctx, actor, { ...NO_GRANTS, [kind === 'docs' ? 'docSpaces' : 'boardSpaces']: [spaceId] }, groupMemberIds(db, groupId));
}
