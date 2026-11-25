import type { GroupSpaceRole, ProjectGroupDTO, SpaceGroupDTO } from '../../shared/groups.ts';
import type { Db } from '../db/database.ts';

/**
 * Lectures des groupes ajoutés aux projets et aux espaces, sans dépendance vers les services (les projets et les espaces
 * les lisent pour leurs listes de membres, et les services des groupes s'appuient sur eux).
 */

export type SpaceGroupTable = 'doc_space_groups' | 'board_space_groups';

/** Membres de chaque groupe demandé. */
export function membersByGroup(db: Db, groupIds: number[]): Map<number, number[]> {
  const result = new Map<number, number[]>(groupIds.map((id) => [id, []]));
  if (!groupIds.length) return result;
  const rows = db.all<{ group_id: number; user_id: number }>(
    `SELECT group_id, user_id FROM user_group_members WHERE group_id IN (${groupIds.map(() => '?').join(',')}) ORDER BY created_at, user_id`,
    ...groupIds,
  );
  for (const row of rows) result.get(row.group_id)?.push(row.user_id);
  return result;
}

export function groupMemberIds(db: Db, groupId: number): number[] {
  return membersByGroup(db, [groupId]).get(groupId) ?? [];
}

/** Groupes ajoutés à un projet, avec leur rôle de projet et leurs membres. */
export function listProjectGroups(db: Db, projectId: number): ProjectGroupDTO[] {
  const rows = db.all<{ id: number; name: string; color: string | null; role_id: number }>(
    `SELECT g.id, g.name, g.color, pg.role_id FROM project_groups pg JOIN user_groups g ON g.id = pg.group_id
      WHERE pg.project_id = ? ORDER BY g.name COLLATE NOCASE`,
    projectId,
  );
  const members = membersByGroup(db, rows.map((row) => row.id));
  return rows.map((row) => ({ groupId: row.id, name: row.name, color: row.color, memberIds: members.get(row.id) ?? [], roleId: row.role_id }));
}

/** Groupes ajoutés à un espace de documentation ou de tableaux blancs. */
export function listSpaceGroups(db: Db, table: SpaceGroupTable, spaceId: number): SpaceGroupDTO[] {
  const rows = db.all<{ id: number; name: string; color: string | null; role: GroupSpaceRole }>(
    `SELECT g.id, g.name, g.color, sg.role FROM ${table} sg JOIN user_groups g ON g.id = sg.group_id
      WHERE sg.space_id = ? ORDER BY g.name COLLATE NOCASE`,
    spaceId,
  );
  const members = membersByGroup(db, rows.map((row) => row.id));
  return rows.map((row) => ({ groupId: row.id, name: row.name, color: row.color, memberIds: members.get(row.id) ?? [], role: row.role }));
}

/** Projets et espaces où un groupe a accès. */
export interface GroupGrants {
  projects: number[];
  docSpaces: number[];
  boardSpaces: number[];
}

export function grantsOfGroup(db: Db, groupId: number): GroupGrants {
  return {
    projects: db.all<{ project_id: number }>('SELECT project_id FROM project_groups WHERE group_id = ?', groupId).map((row) => row.project_id),
    docSpaces: db.all<{ space_id: number }>('SELECT space_id FROM doc_space_groups WHERE group_id = ?', groupId).map((row) => row.space_id),
    boardSpaces: db.all<{ space_id: number }>('SELECT space_id FROM board_space_groups WHERE group_id = ?', groupId).map((row) => row.space_id),
  };
}
