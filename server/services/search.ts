import { addDays, todayISO } from '../../shared/dates.ts';
import { hasPermission } from '../../shared/permissions.ts';
import type {
  ActivityData,
  SearchKind,
  SearchProjectHit,
  SearchResultDTO,
  SearchTicketHit,
  UserActivityDTO,
  UserSummaryPageDTO,
} from '../../shared/types.ts';
import type { TicketStatus } from '../../shared/constants.ts';
import type { Db } from '../db/database.ts';
import { notFound } from '../http/errors.ts';
import type { AuthUser } from './access.ts';
import { toUserSummary, USER_COLUMNS, type ProjectRow, type UserRow } from './rows.ts';
import { foldText } from './tickets.ts';

/** Projets que l'utilisateur peut voir (membre, ou `projects.view_all`), restreints aux projets du jeton le cas échéant. */
export function visibleProjects(db: Db, user: AuthUser): ProjectRow[] {
  const seesAll = hasPermission(user.permissions, 'projects.view_all') || hasPermission(user.permissions, 'projects.manage_all');
  const rows = seesAll
    ? db.all<ProjectRow>('SELECT * FROM projects ORDER BY name COLLATE NOCASE')
    : db.all<ProjectRow>('SELECT p.* FROM projects p JOIN project_members m ON m.project_id = p.id AND m.user_id = ? ORDER BY p.name COLLATE NOCASE', user.id);
  const allowed = user.token?.projectIds ?? null;
  return allowed === null ? rows : rows.filter((row) => allowed.includes(row.id));
}

/** Score de pertinence : 0 = correspondance exacte, 1 = début, 2 = début d'un mot, 3 = contenu ; `null` = absent. */
function rank(text: string, query: string): number | null {
  const folded = foldText(text);
  if (folded === query) return 0;
  if (folded.startsWith(query)) return 1;
  const index = folded.indexOf(query);
  if (index < 0) return null;
  return /[\s\-_/([{«"']/.test(folded[index - 1] ?? '') ? 2 : 3;
}

function bestRank(...ranks: Array<number | null>): number | null {
  const found = ranks.filter((value): value is number => value !== null);
  return found.length ? Math.min(...found) : null;
}

interface TicketSearchRow {
  id: number;
  project_id: number;
  number: number;
  title: string;
  description: string;
  status: TicketStatus;
  updated_at: string;
}

/** Recherche dans les projets, tickets et utilisateurs visibles ; `limit` résultats par type, avec le total. */
export function globalSearch(db: Db, user: AuthUser, rawQuery: string, options: { limit: number; kinds?: SearchKind[] }): SearchResultDTO {
  const query = foldText(rawQuery.trim());
  const empty: SearchResultDTO = { query: rawQuery, projects: { items: [], total: 0 }, tickets: { items: [], total: 0 }, users: { items: [], total: 0 } };
  if (!query) {
    return empty;
  }
  const wants = (kind: SearchKind): boolean => !options.kinds?.length || options.kinds.includes(kind);
  const projects = visibleProjects(db, user);
  const result = empty;

  if (wants('projects')) {
    const hits = projects
      .map((row) => ({ row, score: bestRank(rank(row.name, query), rank(row.key, query), (rank(row.description, query) ?? -1) >= 0 ? 4 : null) }))
      .filter((hit): hit is { row: ProjectRow; score: number } => hit.score !== null)
      .sort((a, b) => a.score - b.score || a.row.archived - b.row.archived || a.row.name.localeCompare(b.row.name));
    result.projects = {
      total: hits.length,
      items: hits.slice(0, options.limit).map(({ row }): SearchProjectHit => ({ id: row.id, key: row.key, name: row.name, description: row.description, archived: row.archived === 1 })),
    };
  }

  if (wants('tickets') && projects.length) {
    const byId = new Map(projects.map((project) => [project.id, project]));
    const rows = db.all<TicketSearchRow>(
      `SELECT id, project_id, number, title, description, status, updated_at FROM tickets WHERE project_id IN (${projects.map(() => '?').join(', ')})`,
      ...projects.map((project) => project.id),
    );
    const hits = rows
      .map((row) => {
        const key = `${byId.get(row.project_id)!.key}-${row.number}`;
        const keyScore = foldText(key) === query ? -1 : null;
        const score = bestRank(keyScore, rank(row.title, query), rank(key, query), (rank(row.description, query) ?? -1) >= 0 ? 4 : null);
        return { row, key, score };
      })
      .filter((hit): hit is { row: TicketSearchRow; key: string; score: number } => hit.score !== null)
      .sort((a, b) => a.score - b.score || b.row.updated_at.localeCompare(a.row.updated_at));
    result.tickets = {
      total: hits.length,
      items: hits.slice(0, options.limit).map(({ row, key }): SearchTicketHit => {
        const project = byId.get(row.project_id)!;
        return { id: row.id, projectId: row.project_id, projectKey: project.key, projectName: project.name, number: row.number, key, title: row.title, status: row.status, updatedAt: row.updated_at };
      }),
    };
  }

  if (wants('users')) {
    const hits = db
      .all<UserRow>(`SELECT ${USER_COLUMNS} FROM users u WHERE u.is_active = 1`)
      .map((row) => ({ row, score: bestRank(rank(row.name, query), rank(row.email, query)) }))
      .filter((hit): hit is { row: UserRow; score: number } => hit.score !== null)
      .sort((a, b) => a.score - b.score || a.row.name.localeCompare(b.row.name));
    result.users = { total: hits.length, items: hits.slice(0, options.limit).map(({ row }) => toUserSummary(row)) };
  }
  return result;
}

interface ActivityRowWithProject {
  id: number;
  project_id: number;
  user_id: number | null;
  via: string | null;
  grp: UserActivityDTO['group'];
  data: string;
  created_at: string;
  project_key: string;
  project_name: string;
}

/** Résumé de l'activité d'un utilisateur, limité aux projets visibles par la personne qui consulte. */
export function userSummary(db: Db, viewer: AuthUser, userId: number): UserSummaryPageDTO {
  const row = db.get<UserRow>(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = ?`, userId);
  if (!row) {
    throw notFound('Utilisateur introuvable.');
  }
  const visible = visibleProjects(db, viewer);
  const visibleIds = visible.map((project) => project.id);
  const inList = visibleIds.length ? `(${visibleIds.map(() => '?').join(', ')})` : '(NULL)';
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const projects = db
    .all<{ id: number; key: string; name: string; role_name: string }>(
      `SELECT p.id, p.key, p.name, r.name AS role_name FROM project_members m JOIN projects p ON p.id = m.project_id JOIN roles r ON r.id = m.role_id
        WHERE m.user_id = ? AND p.id IN ${inList} ORDER BY p.archived, p.name COLLATE NOCASE`,
      userId,
      ...visibleIds,
    )
    .map((project) => ({ id: project.id, key: project.key, name: project.name, roleName: project.role_name }));

  const assignedRows = db.all<TicketSearchRow & { end_date: string | null; part_progress: number; part_done: number; project_key: string; project_name: string }>(
    `SELECT t.id, t.project_id, t.number, t.title, t.description, t.status, t.updated_at, t.end_date,
            a.progress AS part_progress, a.done AS part_done, p.key AS project_key, p.name AS project_name
       FROM ticket_assignees a JOIN tickets t ON t.id = a.ticket_id JOIN projects p ON p.id = t.project_id
      WHERE a.user_id = ? AND t.status != 'done' AND p.archived = 0 AND t.project_id IN ${inList}
      ORDER BY a.done, CASE WHEN t.end_date IS NULL THEN 1 ELSE 0 END, t.end_date, t.updated_at DESC`,
    userId,
    ...visibleIds,
  );
  const assigned = assignedRows.map((ticket) => ({
    id: ticket.id,
    projectId: ticket.project_id,
    projectKey: ticket.project_key,
    projectName: ticket.project_name,
    number: ticket.number,
    key: `${ticket.project_key}-${ticket.number}`,
    title: ticket.title,
    status: ticket.status,
    updatedAt: ticket.updated_at,
    endDate: ticket.end_date,
    partProgress: ticket.part_progress,
    partDone: ticket.part_done === 1,
  }));

  const activityRows = db.all<ActivityRowWithProject>(
    `SELECT a.*, p.key AS project_key, p.name AS project_name FROM activities a JOIN projects p ON p.id = a.project_id
      WHERE a.user_id = ? AND a.project_id IN ${inList} AND a.created_at >= ? ORDER BY a.id DESC`,
    userId,
    ...visibleIds,
    since,
  );
  const recent = activityRows.slice(0, 40).map(
    (activity): UserActivityDTO => ({
      id: activity.id,
      projectId: activity.project_id,
      userId: activity.user_id,
      via: activity.via,
      group: activity.grp,
      data: JSON.parse(activity.data) as ActivityData,
      createdAt: activity.created_at,
      projectKey: activity.project_key,
      projectName: activity.project_name,
    }),
  );

  const today = todayISO();
  const counts = new Map<string, number>();
  for (const activity of activityRows) {
    const day = todayISO(new Date(activity.created_at));
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const activityByDay = Array.from({ length: 30 }, (_, index) => {
    const day = addDays(today, index - 29);
    return { day, count: counts.get(day) ?? 0 };
  });

  const donePartsLast30 =
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ticket_assignees a JOIN tickets t ON t.id = a.ticket_id WHERE a.user_id = ? AND a.done = 1 AND a.done_at >= ? AND t.project_id IN ${inList}`,
      userId,
      since,
      ...visibleIds,
    )?.n ?? 0;

  return {
    user: toUserSummary(row),
    projects,
    stats: {
      openTickets: assigned.filter((ticket) => !ticket.partDone).length,
      donePartsLast30,
      commentsLast30: activityRows.filter((activity) => activity.grp === 'comment' && activity.data.includes('"action":"created"')).length,
      actionsLast30: activityRows.length,
      viaApiLast30: activityRows.filter((activity) => activity.via !== null).length,
    },
    activityByDay,
    assigned,
    recent,
  };
}
