import fs from 'node:fs';
import path from 'node:path';
import { extractDocLinks } from '../../shared/docLinks.ts';
import { docBaseName, docFileKind, docRoleAtLeast, docTitle, DOC_DEFAULT_IMAGE_FOLDER, DOC_LIMITS, normalizeDocPath, normalizeImageFolder, withMarkdownExtension } from '../../shared/docs.ts';
import { applyDocTemplate } from '../../shared/docTemplates.ts';
import type { DocBookmarkDTO, DocMemberDTO, DocRescanResultDTO, DocNodeDTO, DocNodeInfoDTO, DocNodeKind, DocRole, DocSearchHitDTO, DocSiteVisibility, DocSpaceDTO, DocVersionDTO, DocVersionOrigin } from '../../shared/docs.ts';
import { hasPermission } from '../../shared/permissions.ts';
import type { Actor, AppContext } from '../context.ts';
import { nowIso, type Db } from '../db/database.ts';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../http/errors.ts';
import { getAuthUser, type AuthUser } from '../services/access.ts';
import { roleOfRank, ROLE_RANK_SQL } from '../services/spaceRoles.ts';
import { readSetting, writeSetting } from '../services/appSettings.ts';
import { collectFrozen } from '../services/frozenFiles.ts';
import { mentionedUserIds, notifyDocMention } from '../services/notifications.ts';
import { foldText } from '../services/tickets.ts';

/** Espaces de documentation : base pour les droits, l'arbre et l'historique ; fichiers réels dans `docs/<id>/`. */

interface SpaceRow {
  id: number;
  name: string;
  description: string;
  obsidian: number;
  image_folder: string | null;
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
  memo: string;
  icon: string | null;
  color: string | null;
}

export interface VersionRow {
  id: number;
  node_id: number;
  content: string;
  authors: string;
  origin: DocVersionOrigin;
  created_at: string;
  tag: string | null;
  tagged_by: number | null;
  tagged_at: string | null;
}

/** Tout sauf le texte cherchable, qui pèse autant que la note. */
const NODE_COLUMNS = 'id, space_id, path, kind, size, updated_by, updated_at, deleted_at, memo, icon, color';

/** Dossier des fichiers mis à la corbeille (images), hors de l'arbre visible. */
const TRASH = '.trash';
/** Dossier des modèles de notes : un nom d'espace ne peut pas commencer par un point, il n'y entre donc rien d'autre. */
const TEMPLATES = '.templates';

interface DocSettings {
  enabled: boolean;
  /** Dossier des images collées dans une note, pour les espaces qui n'ont pas le leur. */
  imageFolder: string;
}

export function docSettings(db: Db): DocSettings {
  const stored = readSetting<{ enabled?: boolean; imageFolder?: unknown }>(db, 'docs');
  const imageFolder = typeof stored?.imageFolder === 'string' ? normalizeImageFolder(stored.imageFolder) : null;
  return { enabled: stored?.enabled === true, imageFolder: imageFolder ?? DOC_DEFAULT_IMAGE_FOLDER };
}

export function docsEnabled(db: Db): boolean {
  return docSettings(db).enabled;
}

/** Enregistre les réglages donnés ; les autres restent tels quels. */
export function saveDocSettings(db: Db, patch: Partial<DocSettings>): DocSettings {
  const current = docSettings(db);
  const next: DocSettings = { enabled: patch.enabled ?? current.enabled, imageFolder: patch.imageFolder ?? current.imageFolder };
  writeSetting(db, 'docs', next);
  return next;
}

export function requireDocsEnabled(db: Db): void {
  if (!docsEnabled(db)) throw new HttpError(409, "La documentation n'est pas activée sur ce site.", 'docs_disabled');
}

function toNodeDTO(row: NodeRow): DocNodeDTO {
  return { id: row.id, spaceId: row.space_id, path: row.path, kind: row.kind, size: row.size, updatedAt: row.updated_at, updatedBy: row.updated_by, deletedAt: row.deleted_at, memo: row.memo, icon: row.icon, color: row.color };
}

export function nodeDTO(row: NodeRow): DocNodeDTO {
  return toNodeDTO(row);
}

// --- Droits ----------------------------------------------------------------------------------------------------------

/**
 * Rôle de la personne dans un espace : le plus large de son rôle direct et de ceux de ses groupes (vue doc_access) ;
 * `docs.manage` donne la main sur tous, pour reprendre un espace sans propriétaire.
 */
export function docRole(db: Db, user: AuthUser, spaceId: number): DocRole | null {
  if (!db.get('SELECT 1 FROM doc_spaces WHERE id = ?', spaceId)) return null;
  if (hasPermission(user.permissions, 'docs.manage')) return 'owner';
  return roleOfRank(db.get<{ rank: number | null }>(`SELECT ${ROLE_RANK_SQL} AS rank FROM doc_access WHERE space_id = ? AND user_id = ?`, spaceId, user.id)?.rank);
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

type FileRef = Pick<NodeRow, 'space_id' | 'path'> & { kind?: DocNodeKind };

/** Fichier d'un nœud sur le disque : les modèles sont rangés à part. */
function fileOf(ctx: AppContext, node: FileRef): string {
  return diskPath(ctx, node.space_id, node.kind === 'template' ? `${TEMPLATES}/${node.path}` : node.path);
}

export function readText(ctx: AppContext, node: FileRef): string {
  try {
    return fs.readFileSync(fileOf(ctx, node), 'utf8');
  } catch {
    return '';
  }
}

export function readBytes(ctx: AppContext, node: FileRef): Buffer | null {
  try {
    return fs.readFileSync(fileOf(ctx, node));
  } catch {
    return null;
  }
}

/** Note ou modèle : un texte Markdown qui s'écrit à plusieurs. */
export function isTextNode(node: Pick<NodeRow, 'kind'>): boolean {
  return node.kind === 'markdown' || node.kind === 'template';
}

/** Écrit le texte d'un fichier et met à jour sa ligne (appelé directement ou par une salle de collaboration). */
export function storeText(ctx: AppContext, node: NodeRow, content: string, userId: number | null): void {
  writeFile(fileOf(ctx, node), content);
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
  // Rôle de la personne : le plus large, direct ou par un de ses groupes ; les membres comptent aussi ceux des groupes.
  const rows = ctx.db
    .all<SpaceRow & { my_rank: number | null; files: number; members: number; rag: number; site_slug: string | null; site_visibility: DocSiteVisibility | null }>(
      `SELECT s.*, w.slug AS site_slug, w.visibility AS site_visibility,
              (SELECT ${ROLE_RANK_SQL} FROM doc_access a WHERE a.space_id = s.id AND a.user_id = ?) AS my_rank,
              EXISTS (SELECT 1 FROM rag_scopes r WHERE r.scope = 'docs' AND r.container_id = s.id) AS rag,
              (SELECT COUNT(*) FROM doc_nodes n WHERE n.space_id = s.id AND n.deleted_at IS NULL AND n.kind = 'markdown') AS files,
              (SELECT COUNT(DISTINCT x.user_id) FROM doc_access x WHERE x.space_id = s.id) AS members
         FROM doc_spaces s LEFT JOIN doc_sites w ON w.space_id = s.id
        ORDER BY s.updated_at DESC`,
      user.id,
    )
    .map((row) => ({ ...row, my_role: roleOfRank(row.my_rank) }))
    .filter((row) => seesAll || row.my_role !== null);
  const defaultImageFolder = docSettings(ctx.db).imageFolder;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    role: seesAll ? 'owner' : row.my_role!,
    adminAccess: seesAll && row.my_role !== 'owner',
    fileCount: row.files,
    memberCount: row.members,
    obsidian: row.obsidian === 1,
    rag: row.rag === 1,
    imageFolder: row.image_folder,
    defaultImageFolder,
    site: row.site_slug && row.site_visibility ? { slug: row.site_slug, visibility: row.site_visibility } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function getSpace(ctx: AppContext, user: AuthUser, spaceId: number): DocSpaceDTO {
  const space = listSpaces(ctx, user).find((entry) => entry.id === spaceId);
  if (!space) throw notFound('Espace de documentation introuvable.');
  return space;
}

interface SpaceInput {
  name: string;
  description: string;
  obsidian?: boolean;
  /** Dossier des images collées, déjà nettoyé ; `null` : celui du site. */
  imageFolder?: string | null;
}

export function createSpace(ctx: AppContext, user: AuthUser, input: SpaceInput): DocSpaceDTO {
  const now = nowIso();
  let spaceId = 0;
  ctx.db.transaction(() => {
    spaceId = ctx.db.run(
      'INSERT INTO doc_spaces (name, description, obsidian, image_folder, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      input.name,
      input.description,
      input.obsidian === false ? 0 : 1,
      input.imageFolder ?? null,
      user.id,
      now,
      now,
    ).lastInsertRowid;
    ctx.db.run("INSERT INTO doc_members (space_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)", spaceId, user.id, now);
  });
  fs.mkdirSync(spaceDir(ctx, spaceId), { recursive: true });
  ctx.logger.info('docs', `Espace de documentation créé : ${input.name}`, { spaceId }, user.id);
  return getSpace(ctx, user, spaceId);
}

export function updateSpace(ctx: AppContext, user: AuthUser, spaceId: number, patch: Partial<SpaceInput>): DocSpaceDTO {
  const row = ctx.db.get<SpaceRow>('SELECT * FROM doc_spaces WHERE id = ?', spaceId)!;
  const obsidian = patch.obsidian === undefined ? row.obsidian : patch.obsidian ? 1 : 0;
  const imageFolder = patch.imageFolder === undefined ? row.image_folder : patch.imageFolder;
  ctx.db.run(
    'UPDATE doc_spaces SET name = ?, description = ?, obsidian = ?, image_folder = ?, updated_at = ? WHERE id = ?',
    patch.name ?? row.name,
    patch.description ?? row.description,
    obsidian,
    imageFolder,
    nowIso(),
    spaceId,
  );
  if (obsidian !== row.obsidian) ctx.docRooms.refreshSpace(spaceId);
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

/** Arbre de l'espace : dossiers, notes et images (les modèles sont à part, voir `listTemplates`). */
export function listNodes(db: Db, spaceId: number): DocNodeDTO[] {
  return db.all<NodeRow>(`SELECT ${NODE_COLUMNS} FROM doc_nodes WHERE space_id = ? AND deleted_at IS NULL AND kind != 'template' ORDER BY path COLLATE NOCASE`, spaceId).map(toNodeDTO);
}

/** Modèles de notes de l'espace. */
export function listTemplates(db: Db, spaceId: number): DocNodeDTO[] {
  return db.all<NodeRow>(`SELECT ${NODE_COLUMNS} FROM doc_nodes WHERE space_id = ? AND deleted_at IS NULL AND kind = 'template' ORDER BY path COLLATE NOCASE`, spaceId).map(toNodeDTO);
}

export function listTrash(db: Db, spaceId: number): DocNodeDTO[] {
  return db.all<NodeRow>(`SELECT ${NODE_COLUMNS} FROM doc_nodes WHERE space_id = ? AND deleted_at IS NOT NULL AND kind != 'folder' ORDER BY deleted_at DESC`, spaceId).map(toNodeDTO);
}

/** Élément actif à ce chemin, parmi les notes et dossiers ou parmi les modèles. */
function activeNode(db: Db, spaceId: number, relative: string, template = false): NodeRow | undefined {
  return db.get<NodeRow>(`SELECT ${NODE_COLUMNS} FROM doc_nodes WHERE space_id = ? AND path = ? COLLATE NOCASE AND deleted_at IS NULL AND (kind = 'template') = ?`, spaceId, relative, template ? 1 : 0);
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
  const relative = normalizeDocPath(kind === 'markdown' || kind === 'template' ? withMarkdownExtension(raw.trim()) : raw);
  if (!relative) throw badRequest('Nom invalide : évitez les caractères spéciaux et les noms commençant par un point.');
  if (kind === 'template' && relative.includes('/')) throw badRequest('Un modèle se nomme sans dossier.');
  return relative;
}

/** Variante libre d'un chemin occupé : `note (2).md`. `reserved` : chemins déjà promis (en minuscules), libres en base. */
function freePath(db: Db, spaceId: number, relative: string, template = false, reserved?: ReadonlySet<string>): string {
  const dot = docBaseName(relative).lastIndexOf('.');
  const stem = dot > 0 ? relative.slice(0, relative.length - docBaseName(relative).length + dot) : relative;
  const extension = dot > 0 ? relative.slice(stem.length) : '';
  const taken = (path: string): boolean => activeNode(db, spaceId, path, template) !== undefined || reserved?.has(path.toLowerCase()) === true;
  let candidate = relative;
  for (let index = 2; taken(candidate); index += 1) candidate = `${stem} (${index})${extension}`;
  return candidate;
}

/** Texte de départ d'un élément créé d'après un autre : un modèle donne une note aux variables remplies, sinon une copie. */
function textFrom(ctx: AppContext, actor: Actor, spaceId: number, sourceId: number, kind: DocNodeKind, relative: string): string {
  const source = requireNode(ctx.db, sourceId);
  if (source.space_id !== spaceId || source.deleted_at || !isTextNode(source)) throw notFound('Modèle introuvable.');
  const text = ctx.docRooms.currentText(source.id) ?? readText(ctx, source);
  if (source.kind !== 'template' || kind !== 'markdown') return text;
  return applyDocTemplate(text, { title: docTitle(relative), author: authorNames(ctx, actor.userId)[0] ?? '' });
}

/**
 * Crée un dossier, une note ou un modèle. `fromId` : note ou modèle de l'espace dont partir (une note créée d'après un
 * modèle reçoit son texte, variables remplies ; un modèle créé d'après une note en copie le texte).
 */
export function createNode(ctx: AppContext, actor: Actor, spaceId: number, input: { path: string; kind: 'folder' | 'markdown' | 'template'; content?: string; fromId?: number }): DocNodeDTO {
  const { db } = ctx;
  const template = input.kind === 'template';
  const relative = cleanPath(input.path, input.kind);
  if (activeNode(db, spaceId, relative, template)) throw conflict(template ? 'Un modèle porte déjà ce nom.' : 'Un élément porte déjà ce nom.');
  if (input.fromId !== undefined && (input.kind === 'folder' || input.content !== undefined)) throw badRequest('Donnez le texte ou le modèle de départ, pas les deux.');
  assertRoom(db, spaceId);
  const content = input.fromId === undefined ? (input.content ?? '') : textFrom(ctx, actor, spaceId, input.fromId, input.kind, relative);
  if (content.length > DOC_LIMITS.fileChars) throw badRequest(`Un fichier ne peut pas dépasser ${DOC_LIMITS.fileChars} caractères.`);
  let nodeId = 0;
  db.transaction(() => {
    if (!template) ensureFolders(ctx, spaceId, relative, actor.userId);
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
  const template = node.kind === 'template';
  if (node.kind === 'image' && docFileKind(next) !== 'image') throw badRequest('Une image garde son extension.');
  if (next === node.path) return toNodeDTO(node);
  if (node.kind === 'folder' && next.toLowerCase().startsWith(`${node.path.toLowerCase()}/`)) throw badRequest('Un dossier ne peut pas être déplacé dans lui-même.');
  const taken = activeNode(db, node.space_id, next, template);
  if (taken && taken.id !== node.id) throw conflict(template ? 'Un modèle porte déjà ce nom.' : 'Un élément porte déjà ce nom.');
  ctx.docRooms.flushSpace(node.space_id);
  db.transaction(() => {
    if (!template) ensureFolders(ctx, node.space_id, next, actor.userId);
    const now = nowIso();
    db.run('UPDATE doc_nodes SET path = ?, updated_at = ? WHERE id = ?', next, now, nodeId);
    if (node.kind === 'folder') {
      const inside = db.all<{ id: number; path: string }>('SELECT id, path FROM doc_nodes WHERE space_id = ? AND deleted_at IS NULL AND path LIKE ? ESCAPE ?', node.space_id, `${escapeLike(node.path)}/%`, '\\');
      for (const child of inside) db.run('UPDATE doc_nodes SET path = ? WHERE id = ?', next + child.path.slice(node.path.length), child.id);
    }
  });
  const target = fileOf(ctx, { ...node, path: next });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const source = fileOf(ctx, node);
  if (fs.existsSync(source)) fs.renameSync(source, target);
  ctx.docRooms.publishTree(node.space_id);
  return toNodeDTO(requireNode(db, nodeId));
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

const TOO_DEEP = 'Trop de dossiers imbriqués à l’arrivée : choisissez un dossier moins profond.';

/** Déplace un fichier ou un dossier sur le disque, en créant ce qu'il faut au-dessus. */
function moveOnDisk(from: string, to: string, folder: boolean): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (!fs.existsSync(from)) {
    if (folder) fs.mkdirSync(to, { recursive: true });
    return;
  }
  try {
    fs.renameSync(from, to);
  } catch {
    // Destination déjà présente sur le disque (dossier hors de l'arbre) : copie, puis retrait de l'original.
    fs.cpSync(from, to, { recursive: true, force: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

/**
 * Déplace des éléments vers un autre espace (à sa racine ou dans `rawFolder`). Un dossier emporte tout ce qu'il
 * contient ; un nom déjà pris à l'arrivée devient « Nom (2) ». Chaque élément garde son identifiant, donc son
 * historique, ses commentaires, ses étiquettes de version et les favoris. Les salles d'édition ouvertes se ferment
 * (« déplacé ») : elles vérifiaient les droits de l'ancien espace. Renvoie les éléments déplacés, à leur nouvelle place.
 */
export function moveNodesToSpace(ctx: AppContext, actor: Actor, nodeIds: readonly number[], targetSpaceId: number, rawFolder = ''): { nodes: DocNodeDTO[]; movedIds: number[] } {
  const { db } = ctx;
  const chosen = [...new Set(nodeIds)].map((id) => requireNode(db, id));
  const sourceSpaceId = chosen[0]?.space_id;
  if (sourceSpaceId === undefined) throw badRequest('Choisissez au moins un élément.');
  if (chosen.some((node) => node.space_id !== sourceSpaceId)) throw badRequest('Les éléments à déplacer doivent venir du même espace.');
  if (chosen.some((node) => node.deleted_at)) throw conflict('Cet élément est dans la corbeille.');
  if (targetSpaceId === sourceSpaceId) throw badRequest('Ces éléments sont déjà dans cet espace.');
  const folder = rawFolder.trim() ? cleanPath(rawFolder, 'folder') : '';
  const landing = folder ? activeNode(db, targetSpaceId, folder) : undefined;
  if (landing && landing.kind !== 'folder') throw conflict('Un fichier porte déjà ce nom.');

  // Ce que contient déjà un dossier choisi part avec lui.
  const folders = chosen.filter((node) => node.kind === 'folder').map((node) => `${node.path.toLowerCase()}/`);
  const roots = chosen.filter((node) => node.kind === 'template' || !folders.some((prefix) => node.path.toLowerCase().startsWith(prefix)));
  const reserved = { notes: new Set<string>(), templates: new Set<string>() };
  const moves: Array<{ node: NodeRow; next: string }> = [];
  for (const root of roots) {
    const template = root.kind === 'template';
    const wanted = template || !folder ? docBaseName(root.path) : `${folder}/${docBaseName(root.path)}`;
    const next = freePath(db, targetSpaceId, wanted, template, template ? reserved.templates : reserved.notes);
    (template ? reserved.templates : reserved.notes).add(next.toLowerCase());
    if (next.split('/').length > DOC_LIMITS.depthMax) throw badRequest(TOO_DEEP);
    moves.push({ node: root, next });
    if (root.kind !== 'folder') continue;
    const inside = db.all<NodeRow>(`SELECT ${NODE_COLUMNS} FROM doc_nodes WHERE space_id = ? AND deleted_at IS NULL AND kind != 'template' AND path LIKE ? ESCAPE ?`, sourceSpaceId, `${escapeLike(root.path)}/%`, '\\');
    for (const child of inside) {
      const childNext = next + child.path.slice(root.path.length);
      if (childNext.split('/').length > DOC_LIMITS.depthMax) throw badRequest(TOO_DEEP);
      if (activeNode(db, targetSpaceId, childNext)) throw conflict('Un élément porte déjà ce nom.');
      reserved.notes.add(childNext.toLowerCase());
      moves.push({ node: child, next: childNext });
    }
  }
  const count = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM doc_nodes WHERE space_id = ? AND deleted_at IS NULL', targetSpaceId)?.n ?? 0;
  if (count + moves.length > DOC_LIMITS.nodesPerSpace) throw badRequest(`Un espace ne peut pas contenir plus de ${DOC_LIMITS.nodesPerSpace} éléments.`);

  // Ce qui est en cours d'écriture part d'abord sur le disque, à son ancienne place.
  for (const { node } of moves) if (isTextNode(node)) ctx.docRooms.closeNode(node.id, 'moved', targetSpaceId);
  const now = nowIso();
  db.transaction(() => {
    if (folder) ensureFolders(ctx, targetSpaceId, `${folder}/-`, actor.userId);
    for (const { node, next } of moves) db.run('UPDATE doc_nodes SET space_id = ?, path = ?, updated_at = ? WHERE id = ?', targetSpaceId, next, now, node.id);
    db.run('UPDATE doc_spaces SET updated_at = ? WHERE id IN (?, ?)', now, sourceSpaceId, targetSpaceId);
  });
  if (folder) fs.mkdirSync(diskPath(ctx, targetSpaceId, folder), { recursive: true });
  // Sur le disque, un dossier emporte ses fichiers : seuls les éléments choisis se déplacent.
  for (const { node, next } of moves.filter((move) => roots.includes(move.node))) {
    try {
      moveOnDisk(fileOf(ctx, node), fileOf(ctx, { space_id: targetSpaceId, path: next, kind: node.kind }), node.kind === 'folder');
    } catch (error) {
      ctx.logger.warn('docs', `Déplacement sur le disque impossible : ${node.path}`, { nodeId: node.id, error: String(error) }, actor.userId);
    }
  }
  ctx.docRooms.publishTree(sourceSpaceId);
  ctx.docRooms.publishTree(targetSpaceId);
  ctx.logger.info('docs', `${moves.length} élément(s) déplacé(s) vers un autre espace`, { from: sourceSpaceId, to: targetSpaceId, nodeIds: roots.map((node) => node.id) }, actor.userId);
  return { nodes: roots.map((node) => toNodeDTO(requireNode(db, node.id))), movedIds: moves.map((move) => move.node.id) };
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
    if (isTextNode(target)) {
      const content = readText(ctx, target);
      addVersion(ctx, actor, target, content, 'delete', authorNames(ctx, actor.userId), content);
      fs.rmSync(fileOf(ctx, target), { force: true });
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
  const template = node.kind === 'template';
  const relative = freePath(db, node.space_id, node.path, template);
  assertRoom(db, node.space_id);
  db.transaction(() => {
    if (!template) ensureFolders(ctx, node.space_id, relative, actor.userId);
    db.run('UPDATE doc_nodes SET path = ?, deleted_at = NULL, updated_by = ?, updated_at = ? WHERE id = ?', relative, actor.userId, nowIso(), nodeId);
  });
  const restored = requireNode(db, nodeId);
  if (isTextNode(node)) {
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

// --- Actualiser depuis le disque ----------------------------------------------------------------------------------------

interface DiskEntry {
  relative: string;
  kind: DocNodeKind;
  file: string;
  size: number;
  mtime: number;
}

/** Fichiers et dossiers réellement présents dans le dossier de l'espace (dossiers cachés et fichiers temporaires exclus). */
function diskEntries(ctx: AppContext, spaceId: number): { entries: DiskEntry[]; skipped: number } {
  const root = spaceDir(ctx, spaceId);
  fs.mkdirSync(root, { recursive: true });
  const entries: DiskEntry[] = [];
  let skipped = 0;
  const walk = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      // Les liens symboliques pourraient mener hors de l'espace.
      if (entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (!prefix && entry.name === TEMPLATES && entry.isDirectory()) {
        for (const template of fs.readdirSync(file, { withFileTypes: true })) {
          if (!template.isFile() || docFileKind(template.name) !== 'markdown' || normalizeDocPath(template.name) !== template.name) continue;
          const stat = fs.statSync(path.join(file, template.name));
          entries.push({ relative: template.name, kind: 'template', file: path.join(file, template.name), size: stat.size, mtime: stat.mtimeMs });
        }
        continue;
      }
      // Dossiers cachés (corbeille, .obsidian…) et fichiers en cours d'écriture.
      if (entry.name.startsWith('.') || /\.\d+\.tmp$/.test(entry.name)) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (normalizeDocPath(relative) !== relative) {
        skipped += 1;
        continue;
      }
      if (entry.isDirectory()) {
        entries.push({ relative, kind: 'folder', file, size: 0, mtime: 0 });
        walk(file, relative);
      } else if (entry.isFile()) {
        const kind = docFileKind(entry.name);
        if (!kind) {
          skipped += 1;
          continue;
        }
        const stat = fs.statSync(file);
        entries.push({ relative, kind, file, size: stat.size, mtime: stat.mtimeMs });
      }
    }
  };
  walk(root, '');
  return { entries, skipped };
}

/**
 * Relit le dossier de l'espace sur le serveur et met l'arbre à jour : les fichiers et dossiers ajoutés à la main y
 * entrent, ceux qui ont changé sont relus (une version garde le texte précédent), et ceux qui ont disparu passent à
 * la corbeille, d'où une note se restaure avec son dernier texte connu.
 */
export function rescanSpace(ctx: AppContext, actor: Actor, spaceId: number): DocRescanResultDTO {
  const { db } = ctx;
  const { entries, skipped } = diskEntries(ctx, spaceId);
  const keyOf = (kind: DocNodeKind, relative: string): string => `${kind === 'template' ? 'T' : 'N'}:${relative.toLowerCase()}`;
  const onDisk = new Map(entries.map((entry) => [keyOf(entry.kind, entry.relative), entry]));
  const nodes = db.all<NodeRow>(`SELECT ${NODE_COLUMNS} FROM doc_nodes WHERE space_id = ? AND deleted_at IS NULL ORDER BY path`, spaceId);
  const known = new Map(nodes.map((node) => [keyOf(node.kind, node.path), node]));
  const result: DocRescanResultDTO = { added: 0, updated: 0, removed: 0, skipped };
  const now = nowIso();
  const names = authorNames(ctx, actor.userId);

  // Disparus du disque (ou devenus autre chose : un dossier à la place d'une note).
  for (const node of nodes) {
    const entry = onDisk.get(keyOf(node.kind, node.path));
    if (entry && (entry.kind === node.kind || (isTextNode(entry) && isTextNode(node)))) continue;
    ctx.docRooms.closeNode(node.id, 'deleted');
    if (isTextNode(node)) {
      const last = db.get<{ content: string }>('SELECT content FROM doc_versions WHERE node_id = ? ORDER BY id DESC LIMIT 1', node.id)?.content ?? '';
      addVersion(ctx, actor, node, last, 'delete', names, last);
    }
    db.run('UPDATE doc_nodes SET deleted_at = ?, updated_by = ?, updated_at = ? WHERE id = ?', now, actor.userId, now, node.id);
    known.delete(keyOf(node.kind, node.path));
    result.removed += 1;
  }

  // Présents des deux côtés : le fichier a pu changer hors de FastBoard.
  for (const entry of entries) {
    const node = known.get(keyOf(entry.kind, entry.relative));
    if (!node) continue;
    if (node.path !== entry.relative) db.run('UPDATE doc_nodes SET path = ? WHERE id = ?', entry.relative, node.id);
    if (entry.kind === 'folder') continue;
    // Écrit par FastBoard, un fichier a la date de sa ligne ; plus récent ou d'une autre taille, il a été modifié à côté.
    const changed = entry.size !== node.size || entry.mtime > Date.parse(node.updated_at) + 2000;
    if (!changed) continue;
    if (entry.kind === 'image') {
      db.run('UPDATE doc_nodes SET size = ?, updated_by = ?, updated_at = ? WHERE id = ?', entry.size, actor.userId, now, node.id);
      result.updated += 1;
      continue;
    }
    const content = fs.readFileSync(entry.file, 'utf8').slice(0, DOC_LIMITS.fileChars);
    const fresh = requireNode(db, node.id);
    const previous = ctx.docRooms.currentText(node.id) ?? db.get<{ content: string }>('SELECT content FROM doc_versions WHERE node_id = ? ORDER BY id DESC LIMIT 1', node.id)?.content ?? '';
    // Une note ouverte reçoit le texte du disque en direct ; sinon son index (recherche, liens) est refait.
    if (!ctx.docRooms.replaceText(node.id, content)) storeText(ctx, fresh, content, actor.userId);
    if (content !== previous) addVersion(ctx, actor, requireNode(db, node.id), content, 'import', names, previous);
    result.updated += 1;
  }

  // Nouveaux : les dossiers avant leur contenu (ordre des chemins).
  const added = entries.filter((entry) => !known.has(keyOf(entry.kind, entry.relative))).sort((a, b) => a.relative.localeCompare(b.relative));
  let room = DOC_LIMITS.nodesPerSpace - (db.get<{ n: number }>('SELECT COUNT(*) AS n FROM doc_nodes WHERE space_id = ? AND deleted_at IS NULL', spaceId)?.n ?? 0);
  for (const entry of added) {
    if (room <= 0) {
      result.skipped += 1;
      continue;
    }
    db.transaction(() => {
      if (entry.kind !== 'template') ensureFolders(ctx, spaceId, entry.relative, actor.userId);
      if (entry.kind === 'folder' && activeNode(db, spaceId, entry.relative)) return;
      const id = insertNode(db, spaceId, entry.relative, entry.kind, entry.size, actor.userId);
      if (isTextNode(entry)) {
        const content = fs.readFileSync(entry.file, 'utf8').slice(0, DOC_LIMITS.fileChars);
        const node = requireNode(db, id);
        storeText(ctx, node, content, actor.userId);
        addVersion(ctx, actor, requireNode(db, id), content, 'import', names, '');
      }
    });
    room -= 1;
    result.added += 1;
  }

  ctx.docRooms.publishTree(spaceId);
  ctx.logger.info('docs', `Espace actualisé depuis le disque : ${result.added} ajouté(s), ${result.updated} mis à jour, ${result.removed} retiré(s)`, { spaceId }, actor.userId);
  return result;
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
  // Une mention dans un modèle ne prévient personne : elle le fera dans les notes qui en naîtront.
  if (origin === 'delete' || origin === 'restore' || node.kind === 'template') return;
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

const versionDTO = (row: Omit<VersionRow, 'content'> & { size: number }): DocVersionDTO => ({
  id: row.id,
  nodeId: row.node_id,
  authors: JSON.parse(row.authors) as string[],
  origin: row.origin,
  size: row.size,
  createdAt: row.created_at,
  tag: row.tag,
  taggedAt: row.tagged_at,
});
const VERSION_LIST_COLUMNS = 'id, node_id, authors, origin, created_at, tag, tagged_by, tagged_at, LENGTH(CAST(content AS BLOB)) AS size';

export function listVersions(db: Db, nodeId: number): DocVersionDTO[] {
  return db.all<Omit<VersionRow, 'content'> & { size: number }>(`SELECT ${VERSION_LIST_COLUMNS} FROM doc_versions WHERE node_id = ? ORDER BY id DESC`, nodeId).map(versionDTO);
}

export function versionById(db: Db, versionId: number): DocVersionDTO | null {
  const row = db.get<Omit<VersionRow, 'content'> & { size: number }>(`SELECT ${VERSION_LIST_COLUMNS} FROM doc_versions WHERE id = ?`, versionId);
  return row ? versionDTO(row) : null;
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
  // Une version étiquetée reste, quel que soit son âge.
  db.run('DELETE FROM doc_versions WHERE created_at < ? AND tag IS NULL AND node_id IN (SELECT id FROM doc_nodes WHERE deleted_at IS NULL)', limit);
  db.run('DELETE FROM doc_exports WHERE created_at < ?', new Date(now - DOC_LIMITS.exportDays * 86_400_000).toISOString());
  for (const node of db.all<NodeRow>(`SELECT ${NODE_COLUMNS} FROM doc_nodes WHERE deleted_at IS NOT NULL AND deleted_at < ?`, limit)) {
    fs.rmSync(path.join(spaceDir(ctx, node.space_id), TRASH, String(node.id)), { force: true });
    db.run('DELETE FROM doc_nodes WHERE id = ?', node.id);
  }
  // Les images figées que plus aucune version étiquetée ne garde (note ou espace supprimé).
  collectFrozen(ctx);
}

// --- Images ----------------------------------------------------------------------------------------------------------

/** Sous-dossier des images collées dans les notes d'un espace : le sien, sinon celui du site. */
export function spaceImageFolder(db: Db, spaceId: number): string {
  const own = db.get<{ image_folder: string | null }>('SELECT image_folder FROM doc_spaces WHERE id = ?', spaceId)?.image_folder;
  return (own ? normalizeImageFolder(own) : null) ?? docSettings(db).imageFolder;
}

/** Range une image dans le dossier des images de l'espace, à côté de la note ; retourne son chemin. */
export function storeImage(ctx: AppContext, actor: Actor, spaceId: number, folder: string, name: string, data: Uint8Array): DocNodeDTO {
  const { db } = ctx;
  const safeFolder = folder ? normalizeDocPath(folder) : '';
  const base = normalizeDocPath(docBaseName(name));
  if (safeFolder === null || !base || docFileKind(base) !== 'image') throw badRequest('Nom d’image invalide.');
  const wanted = [safeFolder, spaceImageFolder(db, spaceId), base].filter(Boolean).join('/');
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

/** Fichier qui garde le contenu d'une image : à sa place dans l'espace, ou dans la corbeille si elle en est sortie. */
export function storedImageFile(ctx: AppContext, node: Pick<NodeRow, 'id' | 'space_id' | 'path' | 'deleted_at'>): string {
  return node.deleted_at ? path.join(spaceDir(ctx, node.space_id), TRASH, String(node.id)) : diskPath(ctx, node.space_id, node.path);
}

/** Ajoute une image à ce chemin, ou au premier nom libre à côté (« schema (2).png ») ; rend son chemin. */
export function addImageFile(ctx: AppContext, actor: Actor, spaceId: number, wanted: string, data: Uint8Array): string {
  const { db } = ctx;
  assertRoom(db, spaceId);
  const relative = freePath(db, spaceId, wanted);
  db.transaction(() => {
    ensureFolders(ctx, spaceId, relative, actor.userId);
    insertNode(db, spaceId, relative, 'image', data.length, actor.userId);
  });
  writeFile(diskPath(ctx, spaceId, relative), data);
  ctx.docRooms.publishTree(spaceId);
  return relative;
}

/**
 * Remplace le contenu d'une image, sur place : elle garde son nom et son chemin, donc toutes les notes qui la montrent
 * affichent la nouvelle. L'ancienne part dans la corbeille (15 jours), sous le même nom, pour pouvoir la récupérer.
 */
export function replaceImage(ctx: AppContext, actor: Actor, node: NodeRow, data: Uint8Array): DocNodeDTO {
  const { db } = ctx;
  if (node.deleted_at) throw conflict('Cette image est dans la corbeille.');
  if (node.kind !== 'image') throw badRequest('Ce fichier n’est pas une image.');
  const source = diskPath(ctx, node.space_id, node.path);
  const now = nowIso();
  db.transaction(() => {
    if (fs.existsSync(source)) {
      // L'ancienne version : une image supprimée au même chemin, que la corbeille sait rendre.
      const kept = db.run(
        'INSERT INTO doc_nodes (space_id, path, kind, size, updated_by, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        node.space_id,
        node.path,
        'image',
        node.size,
        actor.userId,
        node.updated_at,
        node.updated_at,
        now,
      ).lastInsertRowid;
      const trash = path.join(spaceDir(ctx, node.space_id), TRASH, String(kept));
      fs.mkdirSync(path.dirname(trash), { recursive: true });
      fs.copyFileSync(source, trash);
    }
    db.run('UPDATE doc_nodes SET size = ?, updated_by = ?, updated_at = ? WHERE id = ?', data.length, actor.userId, now, node.id);
    db.run('UPDATE doc_spaces SET updated_at = ? WHERE id = ?', now, node.space_id);
  });
  writeFile(source, data);
  ctx.docRooms.publishTree(node.space_id);
  return toNodeDTO(requireNode(db, node.id));
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

// --- Note, infos et favoris -----------------------------------------------------------------------------------------

/** Note libre d'un fichier ou d'un dossier : visible de tous les membres, dans l'arbre et dans « Infos ». */
export function setMemo(ctx: AppContext, nodeId: number, memo: string): DocNodeDTO {
  const node = requireNode(ctx.db, nodeId);
  if (node.deleted_at) throw conflict('Cet élément est dans la corbeille.');
  ctx.db.run('UPDATE doc_nodes SET memo = ? WHERE id = ?', memo.trim().slice(0, DOC_LIMITS.memoMax), nodeId);
  ctx.docRooms.publishTree(node.space_id);
  return toNodeDTO(requireNode(ctx.db, nodeId));
}

/** Icône et couleur d'un dossier dans l'arbre (et sur le site web de l'espace) ; `null` : celles par défaut, absent : inchangée. */
export function setFolderStyle(ctx: AppContext, nodeId: number, style: { icon?: string | null; color?: string | null }): DocNodeDTO {
  const node = requireNode(ctx.db, nodeId);
  if (node.kind !== 'folder') throw badRequest('Seuls les dossiers ont une icône et une couleur.');
  if (node.deleted_at) throw conflict('Cet élément est dans la corbeille.');
  const icon = style.icon === undefined ? node.icon : style.icon === 'pi pi-folder' ? null : style.icon;
  const color = style.color === undefined ? node.color : (style.color?.toLowerCase() ?? null);
  ctx.db.run('UPDATE doc_nodes SET icon = ?, color = ? WHERE id = ?', icon, color, nodeId);
  ctx.docRooms.publishTree(node.space_id);
  return toNodeDTO(requireNode(ctx.db, nodeId));
}

export function nodeInfo(ctx: AppContext, node: NodeRow): DocNodeInfoDTO {
  const { db } = ctx;
  const created = db.get<{ created_at: string }>('SELECT created_at FROM doc_nodes WHERE id = ?', node.id)!.created_at;
  const updatedByName = node.updated_by === null ? null : (db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', node.updated_by)?.name ?? null);
  const versions = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM doc_versions WHERE node_id = ?', node.id)?.n ?? 0;
  const base = { node: toNodeDTO(node), createdAt: created, updatedByName, versions, words: null, chars: null, lines: null };
  if (node.kind === 'folder') {
    const inside = db.get<{ files: number; folders: number; bytes: number | null }>(
      `SELECT SUM(kind != 'folder') AS files, SUM(kind = 'folder') AS folders, SUM(size) AS bytes FROM doc_nodes WHERE space_id = ? AND deleted_at IS NULL AND path LIKE ? ESCAPE ?`,
      node.space_id,
      `${escapeLike(node.path)}/%`,
      '\\',
    );
    return { ...base, size: inside?.bytes ?? 0, files: inside?.files ?? 0, folders: inside?.folders ?? 0 };
  }
  if (!isTextNode(node)) return { ...base, size: node.size, files: 0, folders: 0 };
  const text = ctx.docRooms.currentText(node.id) ?? readText(ctx, node);
  return { ...base, size: Buffer.byteLength(text), files: 0, folders: 0, words: text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0, chars: text.length, lines: text === '' ? 0 : text.split('\n').length };
}

/** Favoris de la personne, limités aux espaces qu'elle peut encore lire. */
export function listBookmarks(ctx: AppContext, user: AuthUser): DocBookmarkDTO[] {
  const spaces = new Map(listSpaces(ctx, user).map((space) => [space.id, space.name]));
  return ctx.db
    .all<{ node_id: number; space_id: number; path: string; kind: 'markdown' | 'image'; created_at: string }>(
      `SELECT b.node_id, n.space_id, n.path, n.kind, b.created_at FROM doc_bookmarks b JOIN doc_nodes n ON n.id = b.node_id
        WHERE b.user_id = ? AND n.deleted_at IS NULL AND n.kind IN ('markdown', 'image') ORDER BY b.created_at DESC`,
      user.id,
    )
    .filter((row) => spaces.has(row.space_id))
    .map((row) => ({ nodeId: row.node_id, spaceId: row.space_id, spaceName: spaces.get(row.space_id)!, path: row.path, kind: row.kind, createdAt: row.created_at }));
}

export function setBookmark(ctx: AppContext, user: AuthUser, node: NodeRow, on: boolean): DocBookmarkDTO[] {
  if (node.kind === 'folder') throw badRequest('Seuls les fichiers se mettent en favori.');
  if (node.kind === 'template' && on) throw badRequest('Un modèle ne se met pas en favori.');
  if (on) ctx.db.run('INSERT INTO doc_bookmarks (user_id, node_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', user.id, node.id, nowIso());
  else ctx.db.run('DELETE FROM doc_bookmarks WHERE user_id = ? AND node_id = ?', user.id, node.id);
  return listBookmarks(ctx, user);
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
