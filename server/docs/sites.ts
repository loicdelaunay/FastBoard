import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { docRoleAtLeast, docTitle, type DocSiteDTO, type DocSiteVisibility, type WikiDTO, type WikiPageDTO, type WikiSearchHitDTO } from '../../shared/docs.ts';
import { authenticate } from '../auth/authenticate.ts';
import type { AppContext } from '../context.ts';
import { nowIso, type Db } from '../db/database.ts';
import { badRequest, forbidden, HttpError, notFound } from '../http/errors.ts';
import { getAuthUser } from '../services/access.ts';
import { docExcerpt } from '../services/search.ts';
import { foldText } from '../services/tickets.ts';
import { docRole, docsEnabled, listNodes, readBytes, readText, requireNode, type NodeRow } from './store.ts';

/**
 * Site web d'un espace : un wiki en lecture seule à une adresse stable, ouvert aux membres de l'espace, à des personnes
 * choisies (et aux propriétaires), ou à tout le monde sans compte.
 */

interface SiteRow {
  space_id: number;
  slug: string;
  visibility: DocSiteVisibility;
  people: string;
  created_at: string;
  updated_at: string;
}

const toDTO = (row: SiteRow): DocSiteDTO => ({ slug: row.slug, visibility: row.visibility, people: JSON.parse(row.people) as number[], createdAt: row.created_at, updatedAt: row.updated_at });

export function getSite(db: Db, spaceId: number): DocSiteDTO | null {
  const row = db.get<SiteRow>('SELECT * FROM doc_sites WHERE space_id = ?', spaceId);
  return row ? toDTO(row) : null;
}

/** Adresse lisible et impossible à deviner : le nom de l'espace, suivi de caractères tirés au hasard. */
function newSlug(name: string): string {
  const words = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${words || 'wiki'}-${randomBytes(5).toString('hex')}`;
}

export function saveSite(ctx: AppContext, userId: number, spaceId: number, input: { visibility: DocSiteVisibility; people: number[] }): DocSiteDTO {
  const { db } = ctx;
  const people = [...new Set(input.people)];
  for (const id of people) {
    if (!getAuthUser(db, id)?.isActive) throw badRequest('Utilisateur introuvable ou désactivé.');
  }
  const now = nowIso();
  const existing = db.get<SiteRow>('SELECT * FROM doc_sites WHERE space_id = ?', spaceId);
  if (existing) {
    db.run('UPDATE doc_sites SET visibility = ?, people = ?, updated_at = ? WHERE space_id = ?', input.visibility, JSON.stringify(people), now, spaceId);
  } else {
    const name = db.get<{ name: string }>('SELECT name FROM doc_spaces WHERE id = ?', spaceId)?.name ?? '';
    db.run('INSERT INTO doc_sites (space_id, slug, visibility, people, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', spaceId, newSlug(name), input.visibility, JSON.stringify(people), userId, now, now);
  }
  ctx.logger.info('docs', `Site web d'un espace de documentation ${existing ? 'modifié' : 'activé'} (${input.visibility})`, { spaceId }, userId);
  ctx.docRooms.refreshSpace(spaceId);
  return getSite(db, spaceId)!;
}

export function removeSite(ctx: AppContext, userId: number, spaceId: number): void {
  ctx.db.run('DELETE FROM doc_sites WHERE space_id = ?', spaceId);
  ctx.logger.info('docs', "Site web d'un espace de documentation désactivé", { spaceId }, userId);
  ctx.docRooms.refreshSpace(spaceId);
}

interface WikiSite extends SiteRow {
  name: string;
  description: string;
  obsidian: number;
  space_updated: string;
}

/** Vérifie qu'on peut lire le site : sans compte s'il est public, sinon avec les droits voulus. */
export function wikiAccess(ctx: AppContext, request: IncomingMessage, slug: string): WikiSite {
  const site = docsEnabled(ctx.db)
    ? ctx.db.get<WikiSite>('SELECT s.*, d.name, d.description, d.obsidian, d.updated_at AS space_updated FROM doc_sites s JOIN doc_spaces d ON d.id = s.space_id WHERE s.slug = ?', slug)
    : undefined;
  if (!site) throw notFound('Site introuvable.');
  if (site.visibility === 'public') return site;
  const attempt = authenticate(ctx, request);
  if (attempt.kind !== 'session' && attempt.kind !== 'token') throw new HttpError(401, 'Connectez-vous pour lire ce site.', 'unauthorized');
  const role = docRole(ctx.db, attempt.user, site.space_id);
  const allowed = site.visibility === 'members' ? role !== null : role === 'owner' || (JSON.parse(site.people) as number[]).includes(attempt.user.id);
  if (!allowed) throw forbidden('Ce site n’est pas partagé avec vous.');
  return site;
}

/** Espace du site, si la personne connectée peut y écrire (lien « Modifier cette page »). */
function editableSpace(ctx: AppContext, request: IncomingMessage, site: WikiSite): number | null {
  const attempt = authenticate(ctx, request);
  if (attempt.kind !== 'session' && attempt.kind !== 'token') return null;
  const role = docRole(ctx.db, attempt.user, site.space_id);
  return role && docRoleAtLeast(role, 'editor') ? site.space_id : null;
}

export function wikiTree(ctx: AppContext, request: IncomingMessage, site: WikiSite): WikiDTO {
  return {
    editSpaceId: editableSpace(ctx, request, site),
    slug: site.slug,
    name: site.name,
    description: site.description,
    obsidian: site.obsidian === 1,
    nodes: listNodes(ctx.db, site.space_id).map((node) => ({ id: node.id, path: node.path, kind: node.kind, icon: node.icon, color: node.color })),
    updatedAt: site.space_updated,
  };
}

/** Fichier du site : seulement s'il appartient à son espace et n'est pas à la corbeille. */
export function wikiNode(ctx: AppContext, site: WikiSite, nodeId: number): NodeRow {
  const node = requireNode(ctx.db, nodeId);
  if (node.space_id !== site.space_id || node.deleted_at) throw notFound('Page introuvable.');
  return node;
}

export function wikiPage(ctx: AppContext, site: WikiSite, nodeId: number): WikiPageDTO {
  const node = wikiNode(ctx, site, nodeId);
  if (node.kind !== 'markdown') throw notFound('Page introuvable.');
  return { id: node.id, path: node.path, content: ctx.docRooms.currentText(node.id) ?? readText(ctx, node), updatedAt: node.updated_at };
}

const SEARCH_RESULTS = 20;

/** Recherche dans les pages du site : titre et chemin d'abord, puis texte (index replié, comme la recherche générale). */
export function wikiSearch(ctx: AppContext, site: WikiSite, rawQuery: string): WikiSearchHitDTO[] {
  const query = foldText(rawQuery.trim());
  if (!query) return [];
  const rows = ctx.db.all<{ id: number; space_id: number; path: string; in_text: number }>(
    `SELECT id, space_id, path, instr(COALESCE(search_text, ''), ?) > 0 AS in_text FROM doc_nodes
      WHERE space_id = ? AND kind = 'markdown' AND deleted_at IS NULL`,
    query,
    site.space_id,
  );
  const score = (row: (typeof rows)[number]): number | null => {
    const title = foldText(docTitle(row.path));
    if (title.startsWith(query)) return 0;
    if (title.includes(query)) return 1;
    if (foldText(row.path).includes(query)) return 2;
    return row.in_text ? 3 : null;
  };
  return rows
    .map((row) => ({ row, rank: score(row) }))
    .filter((hit): hit is { row: (typeof rows)[number]; rank: number } => hit.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.row.path.localeCompare(b.row.path))
    .slice(0, SEARCH_RESULTS)
    .map(({ row }) => ({
      id: row.id,
      path: row.path,
      title: docTitle(row.path),
      excerpt: row.in_text ? docExcerpt(ctx.docRooms.currentText(row.id) ?? readText(ctx, row), query) : '',
    }));
}

export function wikiFile(ctx: AppContext, site: WikiSite, nodeId: number): Buffer | null {
  const node = wikiNode(ctx, site, nodeId);
  return node.kind === 'image' ? readBytes(ctx, node) : null;
}
