import { DEFAULT_CATEGORIES, DEFAULT_PRIORITIES } from '../../shared/constants.ts';
import { suggestProjectKey } from '../../shared/projectKey.ts';
import { ticketProgress } from '../../shared/progress.ts';
import type {
  NameRef,
  ProjectChange,
  ProjectDTO,
  ProjectMemberDTO,
  ProjectSnapshotDTO,
  ProjectSummaryDTO,
  UserSummaryDTO,
} from '../../shared/types.ts';
import type { Actor, AppContext } from '../context.ts';
import { nowIso, type Db } from '../db/database.ts';
import { badRequest, conflict, notFound } from '../http/errors.ts';
import type { AuthUser, ProjectAccess } from './access.ts';
import { logActivity } from './activity.ts';
import { removeStoredFiles, storagesOfProject } from './attachments.ts';
import { listItems } from './projectLists.ts';
import { describeSettingsChange, mergeSettings, type SettingsPatch } from './projectSettings.ts';
import { hasPermission } from '../../shared/permissions.ts';
import {
  toCategoryDTO,
  toDeliveryDTO,
  toProjectDTO,
  toUserSummary,
  type CategoryRow,
  type DeliveryRow,
  type ProjectRow,
  type UserRow,
} from './rows.ts';
import { listTicketDTOs } from './tickets.ts';

export function getProjectDTO(db: Db, projectId: number): ProjectDTO {
  const row = db.get<ProjectRow>('SELECT * FROM projects WHERE id = ?', projectId);
  if (!row) {
    throw notFound('Projet introuvable.');
  }
  return toProjectDTO(row);
}

export function listMembers(db: Db, projectId: number): { members: ProjectMemberDTO[]; users: UserSummaryDTO[] } {
  const rows = db.all<{ user_id: number; role_id: number; created_at: string }>(
    'SELECT user_id, role_id, created_at FROM project_members WHERE project_id = ? ORDER BY created_at, user_id',
    projectId,
  );
  const users = db
    .all<UserRow>(
      `SELECT u.id, u.email, u.name, u.role_id, u.is_active, u.theme, u.avatar_version, u.created_at, u.last_login_at
         FROM users u JOIN project_members m ON m.user_id = u.id WHERE m.project_id = ? ORDER BY u.name COLLATE NOCASE`,
      projectId,
    )
    .map(toUserSummary);
  return {
    members: rows.map((row) => ({ userId: row.user_id, roleId: row.role_id, joinedAt: row.created_at })),
    users,
  };
}

export function buildSnapshot(db: Db, access: ProjectAccess): ProjectSnapshotDTO {
  const projectId = access.project.id;
  const { members, users } = listMembers(db, projectId);
  return {
    project: toProjectDTO(access.project),
    members,
    users,
    categories: db
      .all<CategoryRow>('SELECT * FROM categories WHERE project_id = ? ORDER BY position, id', projectId)
      .map(toCategoryDTO),
    priorities: listItems(db, 'priority', projectId),
    components: listItems(db, 'component', projectId),
    deliveries: db
      .all<DeliveryRow>('SELECT * FROM deliveries WHERE project_id = ? ORDER BY start_date, position, id', projectId)
      .map(toDeliveryDTO),
    tickets: listTicketDTOs(db, projectId),
    permissions: [...access.permissions],
  };
}

/** Projets visibles par l'utilisateur, avec indicateurs de progression. */
export function listProjectSummaries(db: Db, user: AuthUser): ProjectSummaryDTO[] {
  const seesAll = hasPermission(user.permissions, 'projects.view_all') || hasPermission(user.permissions, 'projects.manage_all');
  const rows = db.all<ProjectRow & { my_role_id: number | null; my_role_name: string | null }>(
    seesAll
      ? `SELECT p.*, m.role_id AS my_role_id, r.name AS my_role_name
           FROM projects p
           LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ?
           LEFT JOIN roles r ON r.id = m.role_id
          ORDER BY p.archived, p.name COLLATE NOCASE`
      : `SELECT p.*, m.role_id AS my_role_id, r.name AS my_role_name
           FROM projects p
           JOIN project_members m ON m.project_id = p.id AND m.user_id = ?
           JOIN roles r ON r.id = m.role_id
          ORDER BY p.archived, p.name COLLATE NOCASE`,
    user.id,
  );

  const allowed = user.token?.projectIds ?? null;
  return rows
    .filter((row) => allowed === null || allowed.includes(row.id))
    .map((row) => {
    const tickets = listTicketDTOs(db, row.id);
    const progress = tickets.length
      ? Math.round(tickets.reduce((sum, ticket) => sum + ticketProgress(ticket), 0) / tickets.length)
      : 0;
    const { users } = listMembers(db, row.id);
    return {
      ...toProjectDTO(row),
      memberCount: users.length,
      ticketCount: tickets.length,
      doneCount: tickets.filter((ticket) => ticket.status === 'done').length,
      progress,
      myRoleId: row.my_role_id,
      myRoleName: row.my_role_name,
      memberPreview: users.slice(0, 5),
    };
  });
}

export function createProject(
  ctx: AppContext,
  owner: AuthUser,
  input: { name: string; key?: string; description?: string },
): ProjectDTO {
  const { db } = ctx;
  const ownerRole = db.get<{ id: number }>("SELECT id FROM roles WHERE scope = 'project' AND key = 'owner'");
  if (!ownerRole) {
    throw new Error('Rôle « Propriétaire » introuvable : la base est-elle initialisée ?');
  }
  const projectId = db.transaction(() => {
    const now = nowIso();
    const { lastInsertRowid } = db.run(
      'INSERT INTO projects (name, key, description, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      input.name,
      (input.key ?? (suggestProjectKey(input.name) || 'PRJ')).toUpperCase(),
      input.description ?? '',
      owner.id,
      now,
      now,
    );
    db.run('INSERT INTO project_members (project_id, user_id, role_id, created_at) VALUES (?, ?, ?, ?)', lastInsertRowid, owner.id, ownerRole.id, now);
    DEFAULT_CATEGORIES.forEach((category, index) => {
      db.run('INSERT INTO categories (project_id, name, color, position) VALUES (?, ?, ?, ?)', lastInsertRowid, category.name, category.color, index);
    });
    DEFAULT_PRIORITIES.forEach((priority, index) => {
      db.run('INSERT INTO priorities (project_id, name, color, icon, position) VALUES (?, ?, ?, ?, ?)', lastInsertRowid, priority.name, priority.color, priority.icon, index);
    });
    return lastInsertRowid;
  });
  ctx.logger.info('project', `Projet créé : ${input.name}`, { projectId }, owner.id);
  return getProjectDTO(db, projectId);
}

export function updateProject(
  ctx: AppContext,
  actor: Actor,
  projectId: number,
  input: { name?: string; key?: string; description?: string; archived?: boolean; settings?: SettingsPatch },
): ProjectDTO {
  const { db } = ctx;
  const before = getProjectDTO(db, projectId);
  const sets: string[] = [];
  const params: Array<string | number> = [];
  const nextSettings = input.settings ? mergeSettings(db, projectId, input.settings) : null;
  if (input.name !== undefined) {
    sets.push('name = ?');
    params.push(input.name);
  }
  if (input.key !== undefined) {
    sets.push('key = ?');
    params.push(input.key.toUpperCase());
  }
  if (input.description !== undefined) {
    sets.push('description = ?');
    params.push(input.description);
  }
  if (input.archived !== undefined) {
    sets.push('archived = ?');
    params.push(input.archived ? 1 : 0);
  }
  if (nextSettings) {
    sets.push('settings = ?');
    params.push(JSON.stringify(nextSettings));
  }
  if (sets.length > 0) {
    db.run(`UPDATE projects SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...params, nowIso(), projectId);
  }
  const project = getProjectDTO(db, projectId);
  ctx.hub.publish(projectId, [{ type: 'project.updated', project }], actor);
  if (input.archived !== undefined) {
    ctx.hub.refreshProjectLists(listMembers(db, projectId).members.map((member) => member.userId));
  }
  const changes: ProjectChange[] = [];
  if (project.name !== before.name) changes.push({ field: 'name', from: before.name, to: project.name });
  if (project.key !== before.key) changes.push({ field: 'key', from: before.key, to: project.key });
  if (project.description !== before.description) changes.push({ field: 'description', from: before.description.slice(0, 140), to: project.description.slice(0, 140) });
  if (project.archived !== before.archived) changes.push({ field: 'archived', from: before.archived, to: project.archived });
  const settingsChange = nextSettings ? describeSettingsChange(before.settings, project.settings) : '';
  if (settingsChange) changes.push({ field: 'settings', from: null, to: settingsChange });
  if (changes.length > 0) {
    logActivity(ctx, actor, projectId, { kind: 'project', changes });
  }
  return project;
}

export function deleteProject(ctx: AppContext, projectId: number): void {
  const memberIds = listMembers(ctx.db, projectId).members.map((member) => member.userId);
  const name = getProjectDTO(ctx.db, projectId).name;
  const files = storagesOfProject(ctx.db, projectId);
  ctx.db.run('DELETE FROM projects WHERE id = ?', projectId);
  removeStoredFiles(ctx, files);
  ctx.logger.info('project', `Projet supprimé : ${name}`, { projectId, files: files.length });
  ctx.hub.closeProject(projectId);
  ctx.hub.refreshProjectLists(memberIds);
}

// ---------------------------------------------------------------------------------------------------------------------
// Membres
// ---------------------------------------------------------------------------------------------------------------------

export function addMember(ctx: AppContext, actor: Actor, projectId: number, userId: number, roleId: number): void {
  const { db } = ctx;
  const user = db.get<{ is_active: number }>('SELECT is_active FROM users WHERE id = ?', userId);
  if (!user || user.is_active !== 1) {
    throw badRequest('Utilisateur introuvable ou désactivé.');
  }
  assertProjectRole(db, roleId);
  if (db.get('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?', projectId, userId)) {
    throw conflict('Cet utilisateur est déjà membre du projet.');
  }
  db.run('INSERT INTO project_members (project_id, user_id, role_id, created_at) VALUES (?, ?, ?, ?)', projectId, userId, roleId, nowIso());
  broadcastMembers(ctx, actor, projectId);
  ctx.hub.refreshProjectLists([userId]);
  logActivity(ctx, actor, projectId, { kind: 'member', action: 'added', user: personRef(db, userId), role: roleName(db, roleId) });
}

export function changeMemberRole(ctx: AppContext, actor: Actor, projectId: number, userId: number, roleId: number): void {
  const { db } = ctx;
  assertProjectRole(db, roleId);
  const current = db.get<{ role_id: number }>('SELECT role_id FROM project_members WHERE project_id = ? AND user_id = ?', projectId, userId);
  if (!current) {
    throw notFound('Membre introuvable.');
  }
  guardLastOwner(db, projectId, userId, roleId);
  db.run('UPDATE project_members SET role_id = ? WHERE project_id = ? AND user_id = ?', roleId, projectId, userId);
  broadcastMembers(ctx, actor, projectId);
  ctx.hub.refreshProjectLists([userId]);
  ctx.hub.refreshUsers([userId]);
  if (current.role_id !== roleId) {
    logActivity(ctx, actor, projectId, {
      kind: 'member',
      action: 'role_changed',
      user: personRef(db, userId),
      role: roleName(db, roleId),
      previousRole: roleName(db, current.role_id),
    });
  }
}

export function removeMember(ctx: AppContext, actor: Actor, projectId: number, userId: number): void {
  const { db } = ctx;
  const current = db.get('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?', projectId, userId);
  if (!current) {
    throw notFound('Membre introuvable.');
  }
  guardLastOwner(db, projectId, userId, null);
  const removed = personRef(db, userId);
  db.transaction(() => {
    db.run('DELETE FROM project_members WHERE project_id = ? AND user_id = ?', projectId, userId);
    // Les parts de l'ancien membre disparaissent des tickets du projet.
    db.run(
      'DELETE FROM ticket_assignees WHERE user_id = ? AND ticket_id IN (SELECT id FROM tickets WHERE project_id = ?)',
      userId,
      projectId,
    );
  });
  broadcastMembers(ctx, actor, projectId);
  // Rafraîchit les tickets pour tout le monde (assignations retirées) via un instantané côté client.
  ctx.hub.revokeProject(projectId, userId);
  ctx.hub.refreshProjectLists([userId]);
  logActivity(ctx, actor, projectId, { kind: 'member', action: actor.userId === userId ? 'left' : 'removed', user: removed });
}

function personRef(db: Db, userId: number): NameRef {
  return { id: userId, name: db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', userId)?.name ?? 'Utilisateur supprimé' };
}

function roleName(db: Db, roleId: number): string {
  return db.get<{ name: string }>('SELECT name FROM roles WHERE id = ?', roleId)?.name ?? 'Rôle supprimé';
}

function assertProjectRole(db: Db, roleId: number): void {
  if (!db.get("SELECT 1 FROM roles WHERE id = ? AND scope = 'project'", roleId)) {
    throw badRequest('Rôle de projet invalide.');
  }
}

/** Un projet doit toujours conserver au moins un propriétaire. */
function guardLastOwner(db: Db, projectId: number, userId: number, nextRoleId: number | null): void {
  const owner = db.get<{ id: number }>("SELECT id FROM roles WHERE scope = 'project' AND key = 'owner'");
  if (!owner || nextRoleId === owner.id) {
    return;
  }
  const isOwner = db.get('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ? AND role_id = ?', projectId, userId, owner.id);
  if (!isOwner) {
    return;
  }
  const owners = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM project_members WHERE project_id = ? AND role_id = ?', projectId, owner.id);
  if ((owners?.n ?? 0) <= 1) {
    throw conflict('Le projet doit conserver au moins un propriétaire.');
  }
}

function broadcastMembers(ctx: AppContext, actor: Actor, projectId: number): void {
  const { members, users } = listMembers(ctx.db, projectId);
  ctx.hub.publish(projectId, [{ type: 'members.changed', members, users }], actor);
}
