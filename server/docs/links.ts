import { extractDocLinks, resolveDocLink, type DocLinkTargets } from '../../shared/docLinks.ts';
import { docTitle, type DocLinkNoteDTO, type DocLinksDTO, type DocLinkTicketDTO, type DocNodeDTO } from '../../shared/docs.ts';
import type { AppContext } from '../context.ts';
import type { AuthUser } from '../services/access.ts';
import { visibleProjects } from '../services/search.ts';
import { listNodes, listSpaces, readText, type NodeRow } from './store.ts';

/**
 * Liens entre notes et tickets. L'index garde les cibles telles qu'elles sont écrites : elles sont résolues à la lecture,
 * ce qui dispense de le recalculer quand un fichier change de nom.
 */

/** Au-delà, une note citée de partout ne gagne rien à tout lister. */
const LIST_MAX = 100;

interface IndexedNote {
  id: number;
  space_id: number;
  path: string;
  links: string;
}

interface TicketRow {
  id: number;
  project_id: number;
  number: number;
  title: string;
}

export function noteLinks(ctx: AppContext, user: AuthUser, node: NodeRow): DocLinksDTO {
  const spaces = new Map(listSpaces(ctx, user).map((space) => [space.id, space.name]));
  const projects = new Map(visibleProjects(ctx.db, user).map((project) => [project.id, project.key]));
  const treeOf = new Map<number, DocNodeDTO[]>();
  const tree = (spaceId: number): DocNodeDTO[] => {
    if (!treeOf.has(spaceId)) treeOf.set(spaceId, listNodes(ctx.db, spaceId));
    return treeOf.get(spaceId)!;
  };
  const toNote = (entry: { id: number; spaceId: number; path: string }): DocLinkNoteDTO => ({ id: entry.id, spaceId: entry.spaceId, spaceName: spaces.get(entry.spaceId) ?? '', path: entry.path, title: docTitle(entry.path) });
  const toTicket = (row: TicketRow): DocLinkTicketDTO => ({ id: row.id, projectId: row.project_id, key: `${projects.get(row.project_id)}-${row.number}`, title: row.title });
  const inList = (ids: Iterable<number>): string => [...ids].join(',') || 'NULL';

  // Sortants : le texte en cours d'écriture, pas celui du dernier enregistrement.
  const found = extractDocLinks(ctx.docRooms.currentText(node.id) ?? readText(ctx, node));
  const notes = new Map<number, DocLinkNoteDTO>();
  const broken: string[] = [];
  for (const target of found.paths) {
    const hit = resolveDocLink(tree(node.space_id), node.path, target);
    if (hit?.kind === 'markdown') notes.set(hit.id, toNote(hit));
    else if (!hit) broken.push(decodeTarget(target));
  }
  if (found.docs.length) {
    const rows = ctx.db.all<{ id: number; space_id: number; path: string }>(
      `SELECT id, space_id, path FROM doc_nodes WHERE id IN (${inList(found.docs)}) AND deleted_at IS NULL AND space_id IN (${inList(spaces.keys())})`,
    );
    for (const row of rows) notes.set(row.id, toNote({ id: row.id, spaceId: row.space_id, path: row.path }));
  }
  notes.delete(node.id);
  const tickets = found.tickets.length
    ? ctx.db.all<TicketRow>(`SELECT id, project_id, number, title FROM tickets WHERE id IN (${inList(found.tickets)}) AND project_id IN (${inList(projects.keys())})`).map(toTicket)
    : [];

  // Entrants : les notes de l'espace par leurs liens, celles des autres espaces par leurs mentions.
  const others = ctx.db.all<IndexedNote>(
    `SELECT id, space_id, path, links FROM doc_nodes WHERE kind = 'markdown' AND deleted_at IS NULL AND links IS NOT NULL AND id != ? AND space_id IN (${inList(spaces.keys())})`,
    node.id,
  );
  const citing = others.filter((row) => {
    const links = JSON.parse(row.links) as DocLinkTargets;
    if (links.docs.includes(node.id)) return true;
    return row.space_id === node.space_id && links.paths.some((target) => resolveDocLink(tree(row.space_id), row.path, target)?.id === node.id);
  });
  const pattern = `%(doc:${node.id})%`;
  const citingTickets = ctx.db.all<TicketRow>(
    `SELECT t.id, t.project_id, t.number, t.title FROM tickets t
      WHERE t.project_id IN (${inList(projects.keys())})
        AND (t.description LIKE ? OR EXISTS (SELECT 1 FROM ticket_comments c WHERE c.ticket_id = t.id AND c.deleted_at IS NULL AND c.body LIKE ?))
      ORDER BY t.updated_at DESC LIMIT ?`,
    pattern,
    pattern,
    LIST_MAX,
  );

  return {
    outgoing: { notes: [...notes.values()], tickets, broken },
    backlinks: { notes: citing.slice(0, LIST_MAX).map((row) => toNote({ id: row.id, spaceId: row.space_id, path: row.path })), tickets: citingTickets.map(toTicket) },
  };
}

function decodeTarget(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}
