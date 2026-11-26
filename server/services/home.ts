import { docTitle } from '../../shared/docs.ts';
import { boardTitle } from '../../shared/boards.ts';
import { HOME_LIMITS, type FavoriteKind, type FavoriteSpaceDTO, type HomeDTO, type HomeRecentDTO, type HomeTicketDTO } from '../../shared/home.ts';
import type { TicketStatus } from '../../shared/constants.ts';
import { boardsEnabled, listBoardSpaces, requireBoardSpace, requireBoardsEnabled } from '../boards/store.ts';
import type { AppContext } from '../context.ts';
import { nowIso } from '../db/database.ts';
import { docsEnabled, listBookmarks, listSpaces, requireDocsEnabled, requireSpace } from '../docs/store.ts';
import { requireProject, type AuthUser } from './access.ts';
import { importantNotifications, unreadCount } from './notifications.ts';
import { listProjectSummaries } from './projects.ts';

/**
 * Accueil et espaces favoris. Tout ce qui est montré passe par les listes d'accès de la personne : un espace ou un
 * projet qu'elle ne voit plus disparaît de ses favoris et de son activité récente.
 */

interface Visible {
  docs: Map<number, { name: string; description: string }>;
  boards: Map<number, { name: string; description: string }>;
  projects: Map<number, { name: string; description: string; key: string }>;
}

/** Espaces et projets que la personne voit (modules désactivés exclus). */
function visibleSpaces(ctx: AppContext, user: AuthUser): Visible {
  return {
    docs: new Map(docsEnabled(ctx.db) ? listSpaces(ctx, user).map((space) => [space.id, { name: space.name, description: space.description }]) : []),
    boards: new Map(boardsEnabled(ctx.db) ? listBoardSpaces(ctx, user).map((space) => [space.id, { name: space.name, description: space.description }]) : []),
    projects: new Map(listProjectSummaries(ctx.db, user).map((project) => [project.id, { name: project.name, description: project.description, key: project.key }])),
  };
}

function favoritesOf(ctx: AppContext, user: AuthUser, visible: Visible): FavoriteSpaceDTO[] {
  const rows = ctx.db.all<{ kind: FavoriteKind; space_id: number; created_at: string }>('SELECT kind, space_id, created_at FROM space_favorites WHERE user_id = ?', user.id);
  const favorites: FavoriteSpaceDTO[] = [];
  for (const row of rows) {
    const project = row.kind === 'project' ? visible.projects.get(row.space_id) : undefined;
    const space = row.kind === 'docs' ? visible.docs.get(row.space_id) : row.kind === 'boards' ? visible.boards.get(row.space_id) : project;
    if (!space) continue;
    favorites.push({ kind: row.kind, id: row.space_id, name: space.name, description: space.description, key: project?.key ?? null, createdAt: row.created_at });
  }
  return favorites.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
}

export function listFavorites(ctx: AppContext, user: AuthUser): FavoriteSpaceDTO[] {
  return favoritesOf(ctx, user, visibleSpaces(ctx, user));
}

/** Met un espace (ou un projet) que l'on voit en favori, ou l'en retire ; les autres onglets suivent. */
export function setFavorite(ctx: AppContext, user: AuthUser, kind: FavoriteKind, spaceId: number, on: boolean): FavoriteSpaceDTO[] {
  if (on) {
    if (kind === 'docs') {
      requireDocsEnabled(ctx.db);
      requireSpace(ctx, user, spaceId);
    } else if (kind === 'boards') {
      requireBoardsEnabled(ctx.db);
      requireBoardSpace(ctx, user, spaceId);
    } else {
      requireProject(ctx, user, spaceId);
    }
    ctx.db.run('INSERT INTO space_favorites (user_id, kind, space_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', user.id, kind, spaceId, nowIso());
  } else {
    ctx.db.run('DELETE FROM space_favorites WHERE user_id = ? AND kind = ? AND space_id = ?', user.id, kind, spaceId);
  }
  const favorites = listFavorites(ctx, user);
  ctx.hub.sendToUser(user.id, { t: 'favorites.changed', favorites });
  return favorites;
}

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** Notes, tableaux et tickets que la personne a modifiés en dernier, des plus récents aux plus anciens. */
function recentOf(ctx: AppContext, user: AuthUser, visible: Visible): HomeRecentDTO[] {
  const { db } = ctx;
  const items = new Map<string, HomeRecentDTO>();
  const add = (item: HomeRecentDTO): void => {
    const key = `${item.kind}:${item.id}`;
    const known = items.get(key);
    if (!known || known.at < item.at) items.set(key, item);
  };
  const scan = 60;

  // Notes : dernière à l'avoir écrite, ou autrice d'une version de son historique.
  const author = `%${escapeLike(JSON.stringify(user.name))}%`;
  const notes = db.all<{ id: number; space_id: number; path: string; at: string }>(
    `SELECT n.id, n.space_id, n.path, MAX(x.at) AS at FROM doc_nodes n JOIN (
       SELECT id AS node_id, updated_at AS at FROM doc_nodes WHERE updated_by = ? AND kind = 'markdown'
       UNION ALL
       SELECT node_id, MAX(created_at) AS at FROM doc_versions WHERE authors LIKE ? ESCAPE '\\' GROUP BY node_id
     ) x ON x.node_id = n.id
     WHERE n.kind = 'markdown' AND n.deleted_at IS NULL GROUP BY n.id ORDER BY at DESC LIMIT ?`,
    user.id,
    author,
    scan,
  );
  for (const note of notes) {
    const space = visible.docs.get(note.space_id);
    if (space) add({ kind: 'note', id: note.id, title: docTitle(note.path), spaceId: note.space_id, spaceName: space.name, key: null, at: note.at });
  }

  // Tableaux : dernière à l'avoir modifié, ou autrice d'une version.
  const boards = db.all<{ id: number; space_id: number; path: string; at: string }>(
    `SELECT b.id, b.space_id, b.path, MAX(x.at) AS at FROM board_nodes b JOIN (
       SELECT id AS board_id, updated_at AS at FROM board_nodes WHERE updated_by = ? AND kind = 'board'
       UNION ALL
       SELECT board_id, MAX(created_at) AS at FROM board_versions WHERE user_id = ? GROUP BY board_id
     ) x ON x.board_id = b.id
     WHERE b.kind = 'board' AND b.deleted_at IS NULL GROUP BY b.id ORDER BY at DESC LIMIT ?`,
    user.id,
    user.id,
    scan,
  );
  for (const board of boards) {
    const space = visible.boards.get(board.space_id);
    if (space) add({ kind: 'board', id: board.id, title: boardTitle(board.path), spaceId: board.space_id, spaceName: space.name, key: null, at: board.at });
  }

  // Tickets : créés, modifiés ou commentés par la personne.
  const tickets = db.all<{ id: number; project_id: number; number: number; title: string; at: string }>(
    `SELECT t.id, t.project_id, t.number, t.title, MAX(x.at) AS at FROM tickets t JOIN (
       SELECT ticket_id, MAX(created_at) AS at FROM ticket_history WHERE user_id = ? GROUP BY ticket_id
       UNION ALL
       SELECT ticket_id, MAX(created_at) AS at FROM ticket_comments WHERE user_id = ? GROUP BY ticket_id
     ) x ON x.ticket_id = t.id
     GROUP BY t.id ORDER BY at DESC LIMIT ?`,
    user.id,
    user.id,
    scan,
  );
  for (const ticket of tickets) {
    const project = visible.projects.get(ticket.project_id);
    if (project) add({ kind: 'ticket', id: ticket.id, title: ticket.title, spaceId: ticket.project_id, spaceName: project.name, key: `${project.key}-${ticket.number}`, at: ticket.at });
  }
  return [...items.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, HOME_LIMITS.recent);
}

/** Tickets non terminés où une part de la personne n'est pas finie : par échéance (les plus proches, donc en retard, d'abord). */
function assignedOf(ctx: AppContext, user: AuthUser, visible: Visible): HomeTicketDTO[] {
  const rows = ctx.db.all<{ id: number; project_id: number; number: number; title: string; status: TicketStatus; start_date: string | null; end_date: string | null; progress: number }>(
    `SELECT t.id, t.project_id, t.number, t.title, t.status, t.start_date, t.end_date, CAST(ROUND(AVG(a.progress)) AS INTEGER) AS progress
       FROM ticket_parts a JOIN tickets t ON t.id = a.ticket_id JOIN projects p ON p.id = t.project_id
      WHERE a.user_id = ? AND t.status != 'done' AND p.archived = 0
      GROUP BY t.id HAVING SUM(a.done = 0) > 0
      ORDER BY t.end_date IS NULL, t.end_date, t.id DESC`,
    user.id,
  );
  const tickets: HomeTicketDTO[] = [];
  for (const row of rows) {
    const project = visible.projects.get(row.project_id);
    if (!project) continue;
    tickets.push({ id: row.id, projectId: row.project_id, projectKey: project.key, projectName: project.name, key: `${project.key}-${row.number}`, title: row.title, status: row.status, startDate: row.start_date, endDate: row.end_date, progress: row.progress });
    if (tickets.length >= HOME_LIMITS.assigned) break;
  }
  return tickets;
}

export function homeFor(ctx: AppContext, user: AuthUser): HomeDTO {
  const visible = visibleSpaces(ctx, user);
  return {
    recent: recentOf(ctx, user, visible),
    assigned: assignedOf(ctx, user, visible),
    favorites: favoritesOf(ctx, user, visible),
    bookmarks: docsEnabled(ctx.db) ? listBookmarks(ctx, user) : [],
    notifications: importantNotifications(ctx.db, user.id, HOME_LIMITS.notifications),
    unread: unreadCount(ctx.db, user.id),
  };
}
