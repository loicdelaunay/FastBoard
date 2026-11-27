import type { PersonalBoardDTO } from '../../shared/personalBoard.ts';
import type { UserSummaryDTO } from '../../shared/types.ts';
import type { Db } from '../db/database.ts';
import { resolveProjectAccess, type AuthUser } from './access.ts';
import { buildSnapshot, listProjectSummaries } from './projects.ts';

/**
 * « Mon tableau » : dans chaque projet visible et non archivé, les tickets dont la personne a une ligne d'avancement,
 * avec les listes du projet (catégories, priorités, composants, livraisons), ses personnes et les droits qu'on y a.
 */
export function personalBoard(db: Db, user: AuthUser): PersonalBoardDTO {
  const withMine = new Set(db.all<{ project_id: number }>('SELECT DISTINCT t.project_id FROM tickets t JOIN ticket_parts p ON p.ticket_id = t.id WHERE p.user_id = ?', user.id).map((row) => row.project_id));
  const board: PersonalBoardDTO = { projects: [], users: [], categories: [], priorities: [], components: [], deliveries: [], tickets: [] };
  const users = new Map<number, UserSummaryDTO>();
  for (const summary of listProjectSummaries(db, user)) {
    if (summary.archived || !withMine.has(summary.id)) continue;
    const access = resolveProjectAccess(db, user, summary.id);
    if (!access) continue;
    const snapshot = buildSnapshot(db, access);
    board.projects.push({ project: snapshot.project, permissions: snapshot.permissions, memberIds: snapshot.users.map((member) => member.id) });
    board.categories.push(...snapshot.categories);
    board.priorities.push(...snapshot.priorities);
    board.components.push(...snapshot.components);
    board.deliveries.push(...snapshot.deliveries);
    board.tickets.push(...snapshot.tickets.filter((ticket) => ticket.assignees.some((assignee) => assignee.userId === user.id)));
    for (const member of snapshot.users) users.set(member.id, member);
  }
  board.users = [...users.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  return board;
}

/** Projets dont l'activité peut concerner la personne (ceux qu'elle voit, archivés compris). */
export function personalProjectIds(db: Db, user: AuthUser): number[] {
  return listProjectSummaries(db, user).map((project) => project.id);
}
