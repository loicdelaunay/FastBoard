import { boardTitle, type BoardLinksDTO, type BoardSearchHitDTO, type FastRefKind } from '../../shared/boards.ts';
import { docTitle, type DocLinkNoteDTO, type DocLinkTicketDTO } from '../../shared/docs.ts';
import type { AppContext } from '../context.ts';
import { docsEnabled, listSpaces } from '../docs/store.ts';
import type { AuthUser } from '../services/access.ts';
import { visibleProjects } from '../services/search.ts';
import { boardsEnabled, listBoardSpaces, readBoardElements, type BoardNodeRow } from './store.ts';

/**
 * Liens d'un tableau blanc : ce qui le cite (notes et tickets par une mention `@[…](board:7)`, autres tableaux par un
 * Fast Element) et ce qu'il montre (ses Fast Elements). Toujours limités à ce que la personne peut voir.
 */

/** Au-delà, un tableau cité de partout ne gagne rien à tout lister. */
const LIST_MAX = 100;

const inList = (ids: Iterable<number>): string => [...ids].join(',') || 'NULL';

interface PathRow {
  id: number;
  space_id: number;
  path: string;
}

interface TicketRow {
  id: number;
  project_id: number;
  number: number;
  title: string;
}

function boardSpaces(ctx: AppContext, user: AuthUser): Map<number, string> {
  return boardsEnabled(ctx.db) ? new Map(listBoardSpaces(ctx, user).map((space) => [space.id, space.name])) : new Map();
}

const toBoard =
  (spaces: Map<number, string>) =>
  (row: PathRow): BoardSearchHitDTO => ({ id: row.id, spaceId: row.space_id, spaceName: spaces.get(row.space_id) ?? '', path: row.path, title: boardTitle(row.path) });

/** Tableaux visibles dont un Fast Element montre cet objet. */
export function boardsCiting(ctx: AppContext, user: AuthUser, kind: FastRefKind, id: number, except = 0): BoardSearchHitDTO[] {
  const spaces = boardSpaces(ctx, user);
  if (!spaces.size) return [];
  return ctx.db
    .all<PathRow>(
      `SELECT b.id, b.space_id, b.path FROM board_nodes b
        WHERE b.kind = 'board' AND b.deleted_at IS NULL AND b.id != ? AND b.space_id IN (${inList(spaces.keys())}) AND json_valid(b.elements)
          AND EXISTS (SELECT 1 FROM json_each(b.elements) e
                       WHERE json_extract(e.value, '$.type') = 'fast' AND json_extract(e.value, '$.ref.kind') = ? AND json_extract(e.value, '$.ref.id') = ?)
        ORDER BY b.updated_at DESC LIMIT ?`,
      except,
      kind,
      id,
      LIST_MAX,
    )
    .map(toBoard(spaces));
}

/** Les tableaux de cette liste que la personne peut voir. */
export function visibleBoards(ctx: AppContext, user: AuthUser, ids: readonly number[]): BoardSearchHitDTO[] {
  if (!ids.length) return [];
  const spaces = boardSpaces(ctx, user);
  if (!spaces.size) return [];
  return ctx.db
    .all<PathRow>(`SELECT id, space_id, path FROM board_nodes WHERE kind = 'board' AND deleted_at IS NULL AND id IN (${inList(ids)}) AND space_id IN (${inList(spaces.keys())})`)
    .map(toBoard(spaces));
}

export function boardLinks(ctx: AppContext, user: AuthUser, node: BoardNodeRow): BoardLinksDTO {
  const projects = new Map(visibleProjects(ctx.db, user).map((project) => [project.id, project.key]));
  const docs = docsEnabled(ctx.db) ? new Map(listSpaces(ctx, user).map((space) => [space.id, space.name])) : new Map<number, string>();
  const toTicket = (row: TicketRow): DocLinkTicketDTO => ({ id: row.id, projectId: row.project_id, key: `${projects.get(row.project_id)}-${row.number}`, title: row.title });
  const toNote = (row: PathRow): DocLinkNoteDTO => ({ id: row.id, spaceId: row.space_id, spaceName: docs.get(row.space_id) ?? '', path: row.path, title: docTitle(row.path) });

  // Ce qui le cite. Le texte indexé des notes est en minuscules, la mention s'y retrouve telle quelle.
  const mention = `%(board:${node.id})%`;
  const citingNotes = docs.size
    ? ctx.db.all<PathRow>(
        `SELECT id, space_id, path FROM doc_nodes WHERE kind = 'markdown' AND deleted_at IS NULL AND space_id IN (${inList(docs.keys())}) AND search_text LIKE ? ORDER BY updated_at DESC LIMIT ?`,
        mention,
        LIST_MAX,
      )
    : [];
  const citingTickets = projects.size
    ? ctx.db.all<TicketRow>(
        `SELECT t.id, t.project_id, t.number, t.title FROM tickets t
          WHERE t.project_id IN (${inList(projects.keys())})
            AND (t.description LIKE ? OR EXISTS (SELECT 1 FROM ticket_comments c WHERE c.ticket_id = t.id AND c.deleted_at IS NULL AND c.body LIKE ?))
          ORDER BY t.updated_at DESC LIMIT ?`,
        mention,
        mention,
        LIST_MAX,
      )
    : [];

  // Ce qu'il montre : ses Fast Elements (tels qu'ils sont en ce moment, même pas encore enregistrés).
  const refs = readBoardElements(ctx, node).flatMap((element) => (element.type === 'fast' ? [element.ref] : []));
  const ids = (...kinds: FastRefKind[]): number[] => [...new Set(refs.filter((ref) => kinds.includes(ref.kind)).map((ref) => ref.id))];
  const noteIds = ids('note', 'folder');
  const notes =
    noteIds.length && docs.size
      ? ctx.db.all<PathRow>(`SELECT id, space_id, path FROM doc_nodes WHERE id IN (${inList(noteIds)}) AND deleted_at IS NULL AND space_id IN (${inList(docs.keys())})`).map(toNote)
      : [];
  const ticketIds = ids('ticket');
  const tickets =
    ticketIds.length && projects.size
      ? ctx.db.all<TicketRow>(`SELECT id, project_id, number, title FROM tickets WHERE id IN (${inList(ticketIds)}) AND project_id IN (${inList(projects.keys())})`).map(toTicket)
      : [];

  return {
    backlinks: { notes: citingNotes.map(toNote), tickets: citingTickets.map(toTicket), boards: boardsCiting(ctx, user, 'board', node.id, node.id) },
    outgoing: { notes, tickets, boards: visibleBoards(ctx, user, ids('board').filter((id) => id !== node.id)) },
  };
}
