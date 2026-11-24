import { docParent, docTitle, type DocNodeDTO, type DocVersionDTO, type DocVersionFileDTO } from '../../shared/docs.ts';
import { cleanTagName, VERSION_TAG_LIMITS, type VersionTagHitDTO } from '../../shared/versionTags.ts';
import type { Actor, AppContext } from '../context.ts';
import { nowIso } from '../db/database.ts';
import { badRequest, conflict, notFound } from '../http/errors.ts';
import type { AuthUser } from '../services/access.ts';
import { foldText } from '../services/tickets.ts';
import { docVersionFiles, freezeDocVersion, thawDocVersion, withFrozenImages } from './frozen.ts';
import { createNode, findNodeByPath, listSpaces, readText, versionById, writeContent, type NodeRow, type VersionRow } from './store.ts';

/**
 * Étiquettes des versions d'une note : une version nommée (« v1.0 ») n'est jamais effacée de l'historique, se cite avec
 * `@[Guide · v1.0](doc:12#v:345)` et se rouvre en lecture seule ; pour la modifier, on la copie dans une nouvelle note.
 */

/** Version de cette note, ou 404. */
function versionOf(ctx: AppContext, node: NodeRow, versionId: number): VersionRow {
  const row = ctx.db.get<VersionRow>('SELECT * FROM doc_versions WHERE id = ? AND node_id = ?', versionId, node.id);
  if (!row) throw notFound('Version introuvable.');
  return row;
}

/** Version de l'état actuel de la note : la dernière si elle a le même texte, sinon une nouvelle. */
function currentVersion(ctx: AppContext, actor: Actor, node: NodeRow): number {
  const content = ctx.docRooms.currentText(node.id) ?? readText(ctx, node);
  const last = ctx.db.get<{ id: number; content: string }>('SELECT id, content FROM doc_versions WHERE node_id = ? ORDER BY id DESC LIMIT 1', node.id);
  if (last && last.content === content) return last.id;
  const author = actor.userId ? ctx.db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', actor.userId)?.name : undefined;
  return ctx.db.run('INSERT INTO doc_versions (node_id, content, authors, origin, created_at) VALUES (?, ?, ?, ?, ?)', node.id, content, JSON.stringify(author ? [author] : []), 'edit', nowIso()).lastInsertRowid;
}

/**
 * Donne une étiquette à une version (`versionId`), ou à l'état actuel de la note (`null`) ; `name` vide ou `null` la
 * retire (la version suit alors la durée de conservation de l'historique). Une version qui reçoit une étiquette fige
 * ses images : celles de l'espace aujourd'hui pour l'état actuel, celles d'alors pour une ancienne version.
 */
export function tagDocVersion(ctx: AppContext, actor: Actor, node: NodeRow, versionId: number | null, rawName: string | null): DocVersionDTO {
  const name = rawName === null ? null : cleanTagName(rawName);
  if (versionId === null && name === null) throw badRequest('Donnez un nom à l’étiquette.');
  const id = versionId === null ? currentVersion(ctx, actor, node) : versionOf(ctx, node, versionId).id;
  if (name !== null) {
    const taken = ctx.db.get<{ id: number }>('SELECT id FROM doc_versions WHERE node_id = ? AND tag = ? COLLATE NOCASE AND id != ?', node.id, name, id);
    if (taken) throw conflict('Une autre version porte déjà cette étiquette.');
  }
  const before = versionOf(ctx, node, id);
  ctx.db.run('UPDATE doc_versions SET tag = ?, tagged_by = ?, tagged_at = ? WHERE id = ?', name, name === null ? null : actor.userId, name === null ? null : nowIso(), id);
  if (name !== null && before.tag === null) {
    const last = ctx.db.get<{ id: number }>('SELECT id FROM doc_versions WHERE node_id = ? ORDER BY id DESC LIMIT 1', node.id)?.id;
    freezeDocVersion(ctx, node, id, before.content, versionId === null || last === id ? null : before.created_at);
  } else if (name === null && before.tag !== null) {
    thawDocVersion(ctx, id);
  }
  ctx.logger.info('docs', name ? `Version étiquetée « ${name} » : ${node.path}` : `Étiquette retirée : ${node.path}`, { nodeId: node.id, versionId: id }, actor.userId);
  return versionById(ctx.db, id)!;
}

/** Contenu d'une version de cette note, avec son étiquette et ses images figées. */
export function docVersionContent(ctx: AppContext, node: NodeRow, versionId: number): { version: DocVersionDTO; content: string; files: DocVersionFileDTO[] } {
  const row = versionOf(ctx, node, versionId);
  return { version: versionById(ctx.db, row.id)!, content: row.content, files: docVersionFiles(ctx.db, row.id) };
}

/** Remet une version (ou une partie, `content`) dans la note ; une version étiquetée y ramène ses images figées. */
export function restoreDocVersion(ctx: AppContext, actor: Actor, node: NodeRow, version: VersionRow, content: string | undefined): void {
  writeContent(ctx, actor, node, withFrozenImages(ctx, actor, node, version.id, content ?? version.content, node.path), 'restore');
}

/**
 * Copie une version dans une nouvelle note, à côté de l'originale : « Guide (v1.0) », « Guide (v1.0) 2 »… C'est ainsi
 * qu'on écrit à partir d'une ancienne version sans toucher à la note.
 */
export function forkDocVersion(ctx: AppContext, actor: Actor, node: NodeRow, versionId: number): DocNodeDTO {
  const row = versionOf(ctx, node, versionId);
  const folder = docParent(node.path);
  const suffix = row.tag ?? row.created_at.slice(0, 16).replace('T', ' ').replace(':', 'h');
  const base = `${folder ? `${folder}/` : ''}${docTitle(node.path)} (${suffix.replace(/[\\/:*?"<>|]/g, '-')})`;
  let candidate = base;
  for (let index = 2; findNodeByPath(ctx.db, node.space_id, `${candidate}.md`); index += 1) candidate = `${base} ${index}`;
  const content = withFrozenImages(ctx, actor, node, row.id, row.content, `${candidate}.md`);
  return createNode(ctx, actor, node.space_id, { path: candidate, kind: 'markdown', content });
}

/** Étiquettes des notes des espaces de la personne, par leur nom ou celui de la note (`@`). */
export function searchDocTags(ctx: AppContext, user: AuthUser, query: string): VersionTagHitDTO[] {
  const spaces = new Map(listSpaces(ctx, user).map((space) => [space.id, space.name]));
  if (!spaces.size) return [];
  const words = foldText(query).split(/\s+/).filter(Boolean);
  const rows = ctx.db.all<{ id: number; node_id: number; tag: string; created_at: string; path: string; space_id: number }>(
    `SELECT v.id, v.node_id, v.tag, v.created_at, n.path, n.space_id FROM doc_versions v JOIN doc_nodes n ON n.id = v.node_id
      WHERE v.tag IS NOT NULL AND n.deleted_at IS NULL AND n.kind = 'markdown' ORDER BY v.tagged_at DESC`,
  );
  const hits: VersionTagHitDTO[] = [];
  for (const row of rows) {
    const spaceName = spaces.get(row.space_id);
    if (spaceName === undefined) continue;
    const title = docTitle(row.path);
    const haystack = foldText(`${row.tag} ${title}`);
    if (!words.every((word) => haystack.includes(word))) continue;
    hits.push({ kind: 'doc', id: row.node_id, versionId: row.id, tag: row.tag, title, spaceName, createdAt: row.created_at });
    if (hits.length >= VERSION_TAG_LIMITS.searchResults) break;
  }
  return hits;
}
