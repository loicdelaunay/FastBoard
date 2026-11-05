import fs from 'node:fs';
import path from 'node:path';
import { extractDocLinks } from '../../shared/docLinks.ts';
import { docBaseName, docFileKind, docRoleAtLeast, docTitle, DOC_LIMITS, normalizeDocPath, withMarkdownExtension } from '../../shared/docs.ts';
import type { DocMemberDTO, DocNodeDTO, DocNodeKind, DocRole, DocSearchHitDTO, DocSpaceDTO, DocVersionDTO, DocVersionOrigin } from '../../shared/docs.ts';
import { hasPermission } from '../../shared/permissions.ts';
import type { Actor, AppContext } from '../context.ts';
import { nowIso, type Db } from '../db/database.ts';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../http/errors.ts';
import { getAuthUser, type AuthUser } from '../services/access.ts';
import { readSetting, writeSetting } from '../services/appSettings.ts';
import { mentionedUserIds, notifyDocMention } from '../services/notifications.ts';
import { foldText } from '../services/tickets.ts';

/** Espaces de documentation : base pour les droits, l'arbre et l'historique ; fichiers réels dans `docs/<id>/`. */

interface SpaceRow {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface NodeRow {
  id: number;
  space_id: number;
  path: string;
  kind: DocNodeKind;
  size: number;
  updated_by: number | null;
  updated_at: string;
  deleted_at: string | null;
}

interface VersionRow {
  id: number;
  node_id: number;
  content: string;
  authors: string;
  origin: DocVersionOrigin;
  created_at: string;
}

/** Tout sauf le texte cherchable, qui pèse autant que la note. */
const NODE_COLUMNS = 'id, space_id, path, kind, size, updated_by, updated_at, deleted_at';

/** Dossier des fichiers mis à la corbeille (images), hors de l'arbre visible. */
const TRASH = '.trash';

export function docsEnabled(db: Db): boolean {
  return readSetting<{ enabled?: boolean }>(db, 'docs')?.enabled === true;
}

export function setDocsEnabled(db: Db, enabled: boolean): void {
  writeSetting(db, 'docs', { enabled });
}

export function requireDocsEnabled(db: Db): void {
  if (!docsEnabled(db)) throw new HttpError(409, "La documentation n'est pas activée sur ce site.", 'docs_disabled');
}

function toNodeDTO(row: NodeRow): DocNodeDTO {
  return { id: row.id, spaceId: row.space_id, path: row.path, kind: row.kind, size: row.size, updatedAt: row.updated_at, updatedBy: row.updated_by, deletedAt: row.deleted_at };
}

// --- Droits ----------------------------------------------------------------------------------------------------------

/** Rôle de la personne dans un espace ; `docs.manage` donne la main sur tous, pour reprendre un espace sans propriétaire. */
export function docRole(db: Db, user: AuthUser, spaceId: number): DocRole | null {
  if (!db.get('SELECT 1 FROM doc_spaces WHERE id = ?', spaceId)) return null;
  if (hasPermission(user.permissions, 'docs.manage')) return 'owner';
  return db.get<{ role: DocRole }>('SELECT role FROM doc_members WHERE space_id = ? AND user_id = ?', spaceId, user.id)?.role ?? null;
}

/** Vérifie l'accès à un espace : introuvable pour qui n'en est pas membre, interdit en dessous du rôle demandé. */
export function requireSpace(ctx: AppContext, user: AuthUser, spaceId: number, minimum: DocRole = 'reader'): DocRole {
  requireDocsEnabled(ctx.db);
  const role = docRole(ctx.db, user, spaceId);
  if (!role) throw notFound('Espace de documentation introuvable.');
  if (!docRoleAtLeast(role, minimum)) throw forbidden();
  return role;
}

export function requireNode(db: Db, nodeId: number): NodeRow {
  const row = db.get<NodeRow>(`SELECT ${NODE_COLUMNS} FROM doc_nodes WHERE id = ?`, nodeId);
  if (!row) throw notFound('Fichier introuvable.');
  return row;
}

// --- Disque ----------------------------------------------------------------------------------------------------------

export function spaceDir(ctx: AppContext, spaceId: number): string {
  return path.join(ctx.docsDir, String(spaceId));
}

/** Chemin absolu d'un fichier de l'espace ; refuse tout ce qui sortirait de son dossier. */
function diskPath(ctx: AppContext, spaceId: number, relative: string): string {
  const root = spaceDir(ctx, spaceId);
  const full = path.resolve(root, ...relative.split('/'));
  if (full !== root && !full.startsWith(root + path.sep)) throw badRequest('Chemin invalide.');
  return full;
}

/** Écriture atomique : un fichier n'est jamais vu à moitié écrit. */
function writeFile(file: string, data: string | Uint8Array): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, data);
  fs.renameSync(temporary, file);
}

export function readText(ctx: AppContext, node: Pick<NodeRow, 'space_id' | 'path'>): string {
  try {
    return fs.readFileSync(diskPath(ctx, node.space_id, node.path), 'utf8');
  } catch {
    return '';
  }
}

export function readBytes(ctx: AppContext, node: Pick<NodeRow, 'space_id' | 'path'>): Buffer | null {
  try {
    return fs.readFileSync(diskPath(ctx, node.space_id, node.path));
  } catch {
    return null;
  }
}

/** Écrit le texte d'un fichier et met à jour sa ligne (appelé directement ou par une salle de collaboration). */
export function storeText(ctx: AppContext, node: NodeRow, content: string, userId: number | null): void {
  writeFile(diskPath(ctx, node.space_id, node.path), content);
  ctx.db.run('UPDATE doc_nodes SET size = ?, updated_by = ?, updated_at = ?, search_text = ?, links = ? WHERE id = ?', Buffer.byteLength(content), userId, nowIso(), foldText(content), JSON.stringify(extractDocLinks(content)), node.id);
  ctx.db.run('UPDATE doc_spaces SET updated_at = ? WHERE id = ?', nowIso(), node.space_id);
}

/** Complète l'index des notes écrites avant qu'il n'existe. */
export function reindexDocs(ctx: AppContext): void {
  for (const node of ctx.db.all<NodeRow>(`SELECT ${NODE_COLUMNS} FROM doc_nodes WHERE kind = 'markdown' AND deleted_at IS NULL AND search_text IS NULL`)) {
    const content = readText(ctx, node);
    ctx.db.run('UPDATE doc_nodes SET search_text = ?, links = ? WHERE id = ?', foldText(content), JSON.stringify(extractDocLinks(content)), node.id);
  }
}

// --- Espaces ---------------------------------------------------------------------------------------------------------

export function listSpaces(ctx: AppContext, user: AuthUser): DocSpaceDTO[] {
  const seesAll = hasPermission(user.permissions, 'docs.manage');
  const rows = ctx.db.all<SpaceRow & { my_role: DocRole | null; files: number; members: number }>(
    `SELECT s.*, m.role AS my_role,
            (SELECT COUNT(*) FROM doc_nodes n WHERE n.space_id = s.id AND n.deleted_at IS NULL AND n.kind = 'markdown') AS files,
            (SELECT COUNT(*) FROM doc_members x WHERE x.space_id = s.id) AS members
       FROM doc_spaces s LEFT JOIN doc_members m ON m.space_id = s.id AND m.user_id = ?
      ${seesAll ? '' : 'WHERE m.role IS NOT NULL'}
      ORDER BY s.updated_at DESC`,
    user.id,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    role: seesAll ? 'owner' : row.my_role!,
    fileCount: row.files,
    memberCount: row.members,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function getSpace(ctx: AppContext, user: AuthUser, spaceId: number): DocSpaceDTO {
  const space = listSpaces(ctx, user).find((entry) => entry.id === spaceId);
  if (!space) throw notFound('Espace de documentation introuvable.');
  return space;
}

export function createSpace(ctx: AppContext, user: AuthUser, input: { name: string; description: string }): DocSpaceDTO {
  const now = nowIso();
  let spaceId = 0;
  ctx.db.transaction(() => {
    spaceId = ctx.db.run('INSERT INTO doc_spaces (name, description, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', input.name, input.description, user.id, now, now).lastInsertRowid;
    ctx.db.run("INSERT INTO doc_members (space_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)", spaceId, user.id, now);
  });
  fs.mkdirSync(spaceDir(ctx, spaceId), { recursive: true });
  ctx.logger.info('docs', `Espace de documentation créé : ${input.name}`, { spaceId }, user.id);
  return getSpace(ctx, user, spaceId);
}

export function updateSpace(ctx: AppContext, user: AuthUser, spaceId: number, patch: { name?: string; description?: string }): DocSpaceDTO {
  const row = ctx.db.get<SpaceRow>('SELECT * FROM doc_spaces WHERE id = ?', spaceId)!;
  ctx.db.run('UPDATE doc_spaces SET name = ?, description = ?, updated_at = ? WHERE id = ?', patch.name ?? row.name, patch.description ?? row.description, nowIso(), spaceId);
  return getSpace(ctx, user, spaceId);
}

export function deleteSpace(ctx: AppContext, user: AuthUser, spaceId: number): void {
  ctx.docRooms.closeSpace(spaceId);
  ctx.db.run('DELETE FROM doc_spaces WHERE id = ?', spaceId);
  fs.rmSync(spaceDir(ctx, spaceId), { recursive: true, force: true });
  ctx.logger.info('docs', 'Espace de documentation supprimé', { spaceId }, user.id);
}

// --- Membres ---------------------------------------------------------------------------------------------------------

export function listMembers(db: Db, spaceId: number): DocMemberDTO[] {
  return db.all<{ user_id: number; role: DocRole }>('SELECT user_id, role FROM doc_members WHERE space_id = ? ORDER BY created_at', spaceId).map((row) => ({ userId: row.user_id, role: row.role }));
}

function guardLastOwner(db: Db, spaceId: number, userId: number): void {
  const owners = db.all<{ user_id: number }>("SELECT user_id FROM doc_members WHERE space_id = ? AND role = 'owner'", spaceId);
  if (owners.length === 1 && owners[0]!.user_id === userId) throw conflict('Un espace doit garder au moins un propriétaire.');
}

export function setMember(ctx: AppContext, spaceId: number, userId: number, role: DocRole): DocMemberDTO[] {
  const { db } = ctx;
  const account = getAuthUser(db, userId);
  if (!account?.isActive) throw badRequest('Utilisateur introuvable ou désactivé.');
  if (role !== 'owner') guardLastOwner(db, spaceId, userId);
  db.run(
    'INSERT INTO doc_members (space_id, user_id, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (space_id, user_id) DO UPDATE SET role = excluded.role',
    spaceId,
    userId,
    role,
    nowIso(),
  );
  ctx.docRooms.refreshAccess(spaceId, userId);
  return listMembers(db, spaceId);
}

export function removeMember(ctx: AppContext, spaceId: number, userId: number): DocMemberDTO[] {
  guardLastOwner(ctx.db, spaceId, userId);
  ctx.db.run('DELETE FROM doc_members WHERE space_id = ? AND user_id = ?', spaceId, userId);
  ctx.docRooms.refreshAccess(spaceId, userId);
  return listMembers(ctx.db, spaceId);
}

// --- Arbre -----------------------------------------------------------------------------------------------------------

export function listNodes(db: Db, spaceId: number): DocNodeDTO[] {
  return db.all<NodeRow>(`SELECT ${NODE_COLUMNS} FROM doc_nodes WHERE space_id = ? AND deleted_at IS NULL ORDER BY path COLLATE NOCASE`, spaceId).map(toNodeDTO);
}

export function listTrash(db: Db, spaceId: number): DocNodeDTO[] {
  return db.all<NodeRow>(`SELECT ${NODE_COLUMNS} FROM doc_nodes WHERE space_id = ? AND deleted_at IS NOT NULL AND kind != 'folder' ORDER BY deleted_at DESC`, spaceId).map(toNodeDTO);
}

function activeNode(db: Db, spaceId: number, relative: string): NodeRow | undefined {
  return db.get<NodeRow>(`SELECT ${NODE_COLUMNS} FROM doc_nodes WHERE space_id = ? AND path = ? COLLATE NOCASE AND deleted_at IS NULL`, spaceId, relative);
}

export function findNodeByPath(db: Db, spaceId: number, relative: string): NodeRow | undefined {
  return activeNode(db, spaceId, relative);
}

function assertRoom(db: Db, spaceId: number): void {
  const count = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM doc_nodes WHERE space_id = ? AND deleted_at IS NULL', spaceId)?.n ?? 0;
  if (count >= DOC_LIMITS.nodesPerSpace) throw badRequest(`Un espace ne peut pas contenir plus de ${DOC_LIMITS.nodesPerSpace} éléments.`);
}

function insertNode(db: Db, spaceId: number, relative: string, kind: DocNodeKind, size: number, userId: number | null): number {
  const now = nowIso();
  return db.run('INSERT INTO doc_nodes (space_id, path, kind, size, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', spaceId, relative, kind, size, userId, now, now).lastInsertRowid;
}

/** Crée les dossiers manquants au-dessus d'un chemin. */
function ensureFolders(ctx: AppContext, spaceId: number, relative: string, userId: number | null): void {
  const segments = relative.split('/').slice(0, -1);
  for (let depth = 1; depth <= segments.length; depth += 1) {
    const folder = segments.slice(0, depth).join('/');
    const existing = activeNode(ctx.db, spaceId, folder);
    if (existing && existing.kind !== 'folder') throw conflict('Un fichier porte déjà ce nom.');
    if (!existing) insertNode(ctx.db, spaceId, folder, 'folder', 0, userId);
  }
}

/** Chemin validé pour un nouvel élément : les notes reçoivent leur extension. */
function cleanPath(raw: string, kind: DocNodeKind): string {
  const relative = normalizeDocPath(kind === 'markdown' ? withMarkdownExtension(raw.trim()) : raw);
  if (!relative) throw badRequest('Nom invalide : évitez les caractères spéciaux et les noms commençant par un point.');
  return relative;
}

/** Variante libre d'un chemin occupé : `note (2).md`. */
function freePath(db: Db, spaceId: number, relative: string): string {
  const dot = docBaseName(relative).lastIndexOf('.');
  const stem = dot > 0 ? relative.slice(0, relative.length - docBaseName(relative).length + dot) : relative;
  const extension = dot > 0 ? relative.slice(stem.length) : '';
  let candidate = relative;
  for (let index = 2; activeNode(db, spaceId, candidate); index += 1) candidate = `${stem} (${index})${extension}`;
  return candidate;
}

export function createNode(ctx: AppContext, actor: Actor, spaceId: number, input: { path: string; kind: 'folder' | 'markdown'; content?: string }): DocNodeDTO {
  const { db } = ctx;
  const relative = cleanPath(input.path, input.kind);
  if (activeNode(db, spaceId, relative)) throw conflict('Un élément porte déjà ce nom.');
  assertRoom(db, spaceId);
  const content = input.content ?? '';
  let nodeId = 0;
  db.transaction(() => {
    ensureFolders(ctx, spaceId, relative, actor.userId);
    nodeId = insertNode(db, spaceId, relative, input.kind, Buffer.byteLength(content), actor.userId);
  });
  const node = requireNode(db, nodeId);
  if (input.kind === 'folder') fs.mkdirSync(diskPath(ctx, spaceId, relative), { recursive: true });
  else {
    storeText(ctx, node, content, actor.userId);
    addVersion(ctx, actor, node, content, input.content === undefined ? 'create' : 'api', authorNames(ctx, actor.userId), '');
  }
  ctx.docRooms.publishTree(spaceId);
  return toNodeDTO(requireNode(db, nodeId));
}

/** Renomme ou déplace un élément ; pour un dossier, tout son contenu suit. */
export function moveNode(ctx: AppContext, actor: Actor, nodeId: number, nextRaw: string): DocNodeDTO {
  const { db } = ctx;
  const node = requireNode(db, nodeId);
  if (node.deleted_at) throw conflict('Cet élément est dans la corbeille.');
  const next = cleanPath(nextRaw, node.kind);
  if (node.kind === 'image' && docFileKind(next) !== 'image') throw badRequest('Une image garde son extension.');
  if (next === node.path) return toNodeDTO(node);
  if (node.kind === 'folder' && next.toLowerCase().startsWith(`${node.path.toLowerCase()}/`)) throw badRequest('Un dossier ne peut pas être déplacé dans lui-même.');
  const taken = activeNode(db, node.space_id, next);
  if (taken && taken.id !== node.id) throw conflict('Un élément porte déjà ce nom.');
  ctx.docRooms.flushSpace(node.space_id);
  db.transaction(() => {
    ensureFolders(ctx, node.space_id, next, actor.userId);
    const now = nowIso();
    db.run('UPDATE doc_nodes SET path = ?, updated_at = ? WHERE id = ?', next, now, nodeId);
    if (node.kind === 'folder') {
      const inside = db.all<{ id: number; path: string }>('SELECT id, path FROM doc_nodes WHERE space_id = ? AND deleted_at IS NULL AND path LIKE ? ESCAPE ?', node.space_id, `${escapeLike(node.path)}/%`, '\\');
      for (const child of inside) db.run('UPDATE doc_nodes SET path = ? WHERE id = ?', next + child.path.slice(node.path.length), child.id);
    }
  });
  const target = diskPath(ctx, node.space_id, next);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const source = diskPath(ctx, node.space_id, node.path);
  if (fs.existsSync(source)) fs.renameSync(source, target);
  ctx.docRooms.publishTree(node.space_id);
  return toNodeDTO(requireNode(db, nodeId));
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/** Met à la corbeille : la dernière version d'une note et le fichier d'une image restent 15 jours. */
export function deleteNode(ctx: AppContext, actor: Actor, nodeId: number): void {
  const { db } = ctx;
  const node = requireNode(db, nodeId);
  if (node.deleted_at) return;
  const targets = node.kind === 'folder'
    ? db.all<NodeRow>(`SELECT ${NODE_COLUMNS} FROM doc_nodes WHERE space_id = ? AND deleted_at IS NULL AND (id = ? OR path LIKE ? ESCAPE ?)`, node.space_id, node.id, `${escapeLike(node.path)}/%`, '\\')
    : [node];
  const now = nowIso();
  for (const target of targets) {
    ctx.docRooms.closeNode(target.id, 'deleted');
    if (target.kind === 'markdown') {
      const content = readText(ctx, target);
      addVersion(ctx, actor, target, content, 'delete', authorNames(ctx, actor.userId), content);
      fs.rmSync(diskPath(ctx, target.space_id, target.path), { force: true });
    } else if (target.kind === 'image') {
      const kept = path.join(spaceDir(ctx, target.space_id), TRASH, String(target.id));
      fs.mkdirSync(path.dirname(kept), { recursive: true });
      const source = diskPath(ctx, target.space_id, target.path);
      if (fs.existsSync(source)) fs.renameSync(source, kept);
    }
    db.run('UPDATE doc_nodes SET deleted_at = ?, updated_by = ?, updated_at = ? WHERE id = ?', now, actor.userId, now, target.id);
  }
  if (node.kind === 'folder') fs.rmSync(diskPath(ctx, node.space_id, node.path), { recursive: true, force: true });
  ctx.docRooms.publishTree(node.space_id);
}

/** Sort un fichier de la corbeille, à son ancien emplacement ou sous un nom libre. */
export function restoreNode(ctx: AppContext, actor: Actor, nodeId: number): DocNodeDTO {
  const { db } = ctx;
  const node = requireNode(db, nodeId);
  if (!node.deleted_at) return toNodeDTO(node);
  const relative = freePath(db, node.space_id, node.path);
  assertRoom(db, node.space_id);
  db.transaction(() => {
    ensureFolders(ctx, node.space_id, relative, actor.userId);
    db.run('UPDATE doc_nodes SET path = ?, deleted_at = NULL, updated_by = ?, updated_at = ? WHERE id = ?', relative, actor.userId, nowIso(), nodeId);
  });
  const restored = requireNode(db, nodeId);
  if (node.kind === 'markdown') {
    const last = db.get<{ content: string }>('SELECT content FROM doc_versions WHERE node_id = ? ORDER BY id DESC LIMIT 1', nodeId);
    storeText(ctx, restored, last?.content ?? '', actor.userId);
  } else if (node.kind === 'image') {
    const kept = path.join(spaceDir(ctx, node.space_id), TRASH, String(node.id));
    const target = diskPath(ctx, node.space_id, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(kept)) fs.renameSync(kept, target);
  }
  ctx.docRooms.publishTree(node.space_id);
  return toNodeDTO(requireNode(db, nodeId));
}

// --- Contenu et historique -------------------------------------------------------------------------------------------

export function authorNames(ctx: AppContext, userId: number | null): string[] {
  const name = userId === null ? undefined : ctx.db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', userId)?.name;
  return name ? [name] : [];
}

/**
 * Ajoute une version si le texte a changé depuis la précédente, et prévient les personnes nouvellement mentionnées.
 * `previous` : texte à comparer pour les mentions.
 */
export function addVersion(ctx: AppContext, actor: Actor, node: NodeRow, content: string, origin: DocVersionOrigin, authors: string[], previous: string): void {
  const last = ctx.db.get<{ content: string }>('SELECT content FROM doc_versions WHERE node_id = ? ORDER BY id DESC LIMIT 1', node.id);
  if (last?.content === content && origin !== 'delete') return;
  ctx.db.run('INSERT INTO doc_versions (node_id, content, authors, origin, created_at) VALUES (?, ?, ?, ?, ?)', node.id, content, JSON.stringify(authors), origin, nowIso());
  if (origin === 'delete' || origin === 'restore') return;
  const known = mentionedUserIds(last?.content ?? previous);
  for (const userId of mentionedUserIds(content)) {
    if (known.has(userId) || userId === actor.userId) continue;
    const account = getAuthUser(ctx.db, userId);
    if (account?.isActive && docRole(ctx.db, account, node.space_id)) notifyDocMention(ctx, actor, userId, node.id, docTitle(node.path), content);
  }
}

/** Remplace le texte d'une note : passe par la salle de collaboration si elle est ouverte, pour que tout le monde le voie. */
export function writeContent(ctx: AppContext, actor: Actor, node: NodeRow, content: string, origin: DocVersionOrigin): void {
  if (content.length > DOC_LIMITS.fileChars) throw badRequest(`Un fichier ne peut pas dépasser ${DOC_LIMITS.fileChars} caractères.`);
  const previous = ctx.docRooms.currentText(node.id) ?? readText(ctx, node);
  if (content === previous) return;
  if (!ctx.docRooms.replaceText(node.id, content)) storeText(ctx, node, content, actor.userId);
  addVersion(ctx, actor, requireNode(ctx.db, node.id), content, origin, authorNames(ctx, actor.userId), previous);
}

export function listVersions(db: Db, nodeId: number): DocVersionDTO[] {
  return db
    .all<Omit<VersionRow, 'content'> & { size: number }>('SELECT id, node_id, authors, origin, created_at, LENGTH(CAST(content AS BLOB)) AS size FROM doc_versions WHERE node_id = ? ORDER BY id DESC', nodeId)
    .map((row) => ({ id: row.id, nodeId: row.node_id, authors: JSON.parse(row.authors) as string[], origin: row.origin, size: row.size, createdAt: row.created_at }));
}

/** Note active, sans erreur si elle a disparu. */
export function activeNote(db: Db, nodeId: number): NodeRow | undefined {
  return db.get<NodeRow>(`SELECT ${NODE_COLUMNS} FROM doc_nodes WHERE id = ? AND kind = 'markdown' AND deleted_at IS NULL`, nodeId);
}

export function requireVersion(db: Db, versionId: number): VersionRow {
  const row = db.get<VersionRow>('SELECT * FROM doc_versions WHERE id = ?', versionId);
  if (!row) throw notFound('Version introuvable.');
  return row;
}

/** Oublie ce qui dépasse la durée de conservation : anciennes versions et corbeille. */
export function purgeDocs(ctx: AppContext, now = Date.now()): void {
  const { db } = ctx;
  const limit = new Date(now - DOC_LIMITS.retentionDays * 86_400_000).toISOString();
  db.run('DELETE FROM doc_versions WHERE created_at < ? AND node_id IN (SELECT id FROM doc_nodes WHERE deleted_at IS NULL)', limit);
  db.run('DELETE FROM doc_exports WHERE created_at < ?', new Date(now - DOC_LIMITS.exportDays * 86_400_000).toISOString());
  for (const node of db.all<NodeRow>(`SELECT ${NODE_COLUMNS} FROM doc_nodes WHERE deleted_at IS NOT NULL AND deleted_at < ?`, limit)) {
    fs.rmSync(path.join(spaceDir(ctx, node.space_id), TRASH, String(node.id)), { force: true });
    db.run('DELETE FROM doc_nodes WHERE id = ?', node.id);
  }
}

// --- Images ----------------------------------------------------------------------------------------------------------

/** Range une image dans le dossier `images` à côté de la note ; retourne son chemin. */
export function storeImage(ctx: AppContext, actor: Actor, spaceId: number, folder: string, name: string, data: Uint8Array): DocNodeDTO {
  const { db } = ctx;
  const safeFolder = folder ? normalizeDocPath(folder) : '';
  const base = normalizeDocPath(docBaseName(name));
  if (safeFolder === null || !base || docFileKind(base) !== 'image') throw badRequest('Nom d’image invalide.');
  const wanted = [safeFolder, 'images', base].filter(Boolean).join('/');
  assertRoom(db, spaceId);
  const relative = freePath(db, spaceId, wanted);
  let nodeId = 0;
  db.transaction(() => {
    ensureFolders(ctx, spaceId, relative, actor.userId);
    nodeId = insertNode(db, spaceId, relative, 'image', data.length, actor.userId);
  });
  writeFile(diskPath(ctx, spaceId, relative), data);
  ctx.docRooms.publishTree(spaceId);
  return toNodeDTO(requireNode(db, nodeId));
}

/** Écrit un fichier importé, en créant son nœud s'il n'existe pas. */
export function putImported(ctx: AppContext, actor: Actor, spaceId: number, relative: string, data: string | Uint8Array): void {
  const { db } = ctx;
  const existing = activeNode(db, spaceId, relative);
  const kind = docFileKind(relative)!;
  if (typeof data === 'string') {
    if (existing) {
      writeContent(ctx, actor, existing, data, 'import');
      return;
    }
    db.transaction(() => ensureFolders(ctx, spaceId, relative, actor.userId));
    const node = requireNode(db, insertNode(db, spaceId, relative, kind, 0, actor.userId));
    storeText(ctx, node, data, actor.userId);
    addVersion(ctx, actor, requireNode(db, node.id), data, 'import', authorNames(ctx, actor.userId), '');
    return;
  }
  db.transaction(() => ensureFolders(ctx, spaceId, relative, actor.userId));
  if (existing) db.run('UPDATE doc_nodes SET size = ?, updated_by = ?, updated_at = ? WHERE id = ?', data.length, actor.userId, nowIso(), existing.id);
  else insertNode(db, spaceId, relative, kind, data.length, actor.userId);
  writeFile(diskPath(ctx, spaceId, relative), data);
}

/** Crée un dossier importé, vide ou non, s'il manque. */
export function putImportedFolder(ctx: AppContext, actor: Actor, spaceId: number, relative: string): void {
  ctx.db.transaction(() => ensureFolders(ctx, spaceId, `${relative}/-`, actor.userId));
  fs.mkdirSync(diskPath(ctx, spaceId, relative), { recursive: true });
}

export function uniquePath(db: Db, spaceId: number, relative: string): string {
  return freePath(db, spaceId, relative);
}

// --- Recherche -------------------------------------------------------------------------------------------------------

/** Fichiers des espaces accessibles dont le chemin contient la recherche (sélecteur de mentions). */
export function searchNodes(ctx: AppContext, user: AuthUser, query: string, limit = 10): DocSearchHitDTO[] {
  const spaces = new Map(listSpaces(ctx, user).map((space) => [space.id, space.name]));
  if (spaces.size === 0) return [];
  const pattern = `%${escapeLike(query.trim())}%`;
  const rows = ctx.db.all<NodeRow>(
    `SELECT ${NODE_COLUMNS} FROM doc_nodes WHERE kind = 'markdown' AND deleted_at IS NULL AND space_id IN (${[...spaces.keys()].join(',')}) AND path LIKE ? ESCAPE ? ORDER BY updated_at DESC LIMIT ?`,
    pattern,
    '\\',
    limit,
  );
  return rows.map((row) => ({ id: row.id, spaceId: row.space_id, spaceName: spaces.get(row.space_id) ?? '', path: row.path, title: docTitle(row.path) }));
}
