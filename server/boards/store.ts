import {
  BOARD_LIMITS,
  boardSearchText,
  boardTitle,
  type BoardElement,
  type BoardMemberDTO,
  type BoardNodeDTO,
  type BoardNodeKind,
  type BoardRole,
  type BoardSearchHitDTO,
  type BoardShareAudience,
  type BoardSpaceDTO,
  type BoardVersionDTO,
  type BoardVersionKind,
} from '../../shared/boards.ts';
import { docRoleAtLeast, normalizeDocPath } from '../../shared/docs.ts';
import { hasPermission } from '../../shared/permissions.ts';
import type { Actor, AppContext } from '../context.ts';
import { nowIso, type Db } from '../db/database.ts';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../http/errors.ts';
import { getAuthUser, type AuthUser } from '../services/access.ts';
import { readSetting, writeSetting } from '../services/appSettings.ts';
import { foldText } from '../services/tickets.ts';
import { removeSpaceAssets, reviveFrozenAssets } from './assets.ts';
import { collectFrozen } from '../services/frozenFiles.ts';
import { sanitizeElements, stateOf, withoutTemplateLink } from './elements.ts';
import { listBoardVersions, matchingVersion, readBoardVersion, recordBoardBaseline, recordBoardVersion } from './versions.ts';

/** Tableaux blancs : espaces (droits), arbre de dossiers et de tableaux, éléments de chaque tableau. Tout est en base. */

interface SpaceRow {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface BoardNodeRow {
  id: number;
  space_id: number;
  path: string;
  kind: BoardNodeKind;
  element_count: number;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  share_audience?: BoardShareAudience | null;
}

const NODE_COLUMNS = 'id, space_id, path, kind, element_count, created_by, updated_by, created_at, updated_at, deleted_at, (SELECT audience FROM board_shares WHERE board_id = board_nodes.id) AS share_audience';

export function boardsEnabled(db: Db): boolean {
  return readSetting<{ enabled?: boolean }>(db, 'boards')?.enabled !== false;
}

export function setBoardsEnabled(db: Db, enabled: boolean): void {
  writeSetting(db, 'boards', { enabled });
}

export function requireBoardsEnabled(db: Db): void {
  if (!boardsEnabled(db)) throw new HttpError(409, "Les tableaux blancs ne sont pas activés sur ce site.", 'boards_disabled');
}

const toNodeDTO = (row: BoardNodeRow): BoardNodeDTO => ({
  id: row.id,
  spaceId: row.space_id,
  path: row.path,
  kind: row.kind,
  elementCount: row.element_count,
  share: row.share_audience ?? null,
  updatedAt: row.updated_at,
  updatedBy: row.updated_by,
  deletedAt: row.deleted_at,
});

export const boardNodeDTO = toNodeDTO;

// --- Droits ----------------------------------------------------------------------------------------------------------

/** Rôle de la personne dans un espace ; `boards.manage` donne la main sur tous. */
export function boardRole(db: Db, user: AuthUser, spaceId: number): BoardRole | null {
  if (!db.get('SELECT 1 FROM board_spaces WHERE id = ?', spaceId)) return null;
  if (hasPermission(user.permissions, 'boards.manage')) return 'owner';
  return db.get<{ role: BoardRole }>('SELECT role FROM board_members WHERE space_id = ? AND user_id = ?', spaceId, user.id)?.role ?? null;
}

/** Accès à un espace : introuvable pour qui n'en est pas membre, interdit en dessous du rôle demandé. */
export function requireBoardSpace(ctx: AppContext, user: AuthUser, spaceId: number, minimum: BoardRole = 'reader'): BoardRole {
  requireBoardsEnabled(ctx.db);
  const role = boardRole(ctx.db, user, spaceId);
  if (!role) throw notFound('Espace de tableaux introuvable.');
  if (!docRoleAtLeast(role, minimum)) throw forbidden();
  return role;
}

export function requireBoardNode(db: Db, nodeId: number): BoardNodeRow {
  const row = db.get<BoardNodeRow>(`SELECT ${NODE_COLUMNS} FROM board_nodes WHERE id = ?`, nodeId);
  if (!row) throw notFound('Tableau introuvable.');
  return row;
}

/** Tableau ou modèle (pas un dossier) hors de la corbeille, avec le rôle de la personne dans son espace. */
export function requireBoard(ctx: AppContext, user: AuthUser, nodeId: number, minimum: BoardRole = 'reader'): { node: BoardNodeRow; role: BoardRole } {
  const node = requireBoardNode(ctx.db, nodeId);
  const role = requireBoardSpace(ctx, user, node.space_id, minimum);
  if ((node.kind !== 'board' && node.kind !== 'template') || node.deleted_at) throw notFound('Tableau introuvable.');
  return { node, role };
}

// --- Espaces ---------------------------------------------------------------------------------------------------------

export function listBoardSpaces(ctx: AppContext, user: AuthUser): BoardSpaceDTO[] {
  const seesAll = hasPermission(user.permissions, 'boards.manage');
  const rows = ctx.db.all<SpaceRow & { my_role: BoardRole | null; boards: number; members: number; rag: number }>(
    `SELECT s.*, m.role AS my_role,
            EXISTS (SELECT 1 FROM rag_scopes r WHERE r.scope = 'boards' AND r.container_id = s.id) AS rag,
            (SELECT COUNT(*) FROM board_nodes n WHERE n.space_id = s.id AND n.deleted_at IS NULL AND n.kind = 'board') AS boards,
            (SELECT COUNT(*) FROM board_members x WHERE x.space_id = s.id) AS members
       FROM board_spaces s LEFT JOIN board_members m ON m.space_id = s.id AND m.user_id = ?
      ${seesAll ? '' : 'WHERE m.role IS NOT NULL'}
      ORDER BY s.updated_at DESC`,
    user.id,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    role: seesAll ? 'owner' : row.my_role!,
    adminAccess: seesAll && row.my_role !== 'owner',
    rag: row.rag === 1,
    boardCount: row.boards,
    memberCount: row.members,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function getBoardSpace(ctx: AppContext, user: AuthUser, spaceId: number): BoardSpaceDTO {
  const space = listBoardSpaces(ctx, user).find((entry) => entry.id === spaceId);
  if (!space) throw notFound('Espace de tableaux introuvable.');
  return space;
}

export function createBoardSpace(ctx: AppContext, user: AuthUser, input: { name: string; description: string }): BoardSpaceDTO {
  const now = nowIso();
  let spaceId = 0;
  ctx.db.transaction(() => {
    spaceId = ctx.db.run('INSERT INTO board_spaces (name, description, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', input.name, input.description, user.id, now, now).lastInsertRowid;
    ctx.db.run("INSERT INTO board_members (space_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)", spaceId, user.id, now);
  });
  ctx.logger.info('boards', `Espace de tableaux créé : ${input.name}`, { spaceId }, user.id);
  return getBoardSpace(ctx, user, spaceId);
}

export function updateBoardSpace(ctx: AppContext, user: AuthUser, spaceId: number, patch: { name?: string; description?: string }): BoardSpaceDTO {
  const row = ctx.db.get<SpaceRow>('SELECT * FROM board_spaces WHERE id = ?', spaceId)!;
  ctx.db.run('UPDATE board_spaces SET name = ?, description = ?, updated_at = ? WHERE id = ?', patch.name ?? row.name, patch.description ?? row.description, nowIso(), spaceId);
  ctx.boardRooms.refreshSpace(spaceId);
  return getBoardSpace(ctx, user, spaceId);
}

export function deleteBoardSpace(ctx: AppContext, user: AuthUser, spaceId: number): void {
  ctx.boardRooms.closeSpace(spaceId);
  removeSpaceAssets(ctx, spaceId);
  ctx.db.run('DELETE FROM board_spaces WHERE id = ?', spaceId);
  ctx.logger.info('boards', 'Espace de tableaux supprimé', { spaceId }, user.id);
}

// --- Membres ---------------------------------------------------------------------------------------------------------

export function listBoardMembers(db: Db, spaceId: number): BoardMemberDTO[] {
  return db.all<{ user_id: number; role: BoardRole }>('SELECT user_id, role FROM board_members WHERE space_id = ? ORDER BY created_at', spaceId).map((row) => ({ userId: row.user_id, role: row.role }));
}

function guardLastOwner(db: Db, spaceId: number, userId: number): void {
  const owners = db.all<{ user_id: number }>("SELECT user_id FROM board_members WHERE space_id = ? AND role = 'owner'", spaceId);
  if (owners.length === 1 && owners[0]!.user_id === userId) throw conflict('Un espace doit garder au moins un propriétaire.');
}

export function setBoardMember(ctx: AppContext, spaceId: number, userId: number, role: BoardRole): BoardMemberDTO[] {
  const account = getAuthUser(ctx.db, userId);
  if (!account?.isActive) throw badRequest('Utilisateur introuvable ou désactivé.');
  if (role !== 'owner') guardLastOwner(ctx.db, spaceId, userId);
  ctx.db.run(
    'INSERT INTO board_members (space_id, user_id, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (space_id, user_id) DO UPDATE SET role = excluded.role',
    spaceId,
    userId,
    role,
    nowIso(),
  );
  ctx.boardRooms.refreshAccess(spaceId, userId);
  return listBoardMembers(ctx.db, spaceId);
}

export function removeBoardMember(ctx: AppContext, spaceId: number, userId: number): BoardMemberDTO[] {
  guardLastOwner(ctx.db, spaceId, userId);
  ctx.db.run('DELETE FROM board_members WHERE space_id = ? AND user_id = ?', spaceId, userId);
  ctx.boardRooms.refreshAccess(spaceId, userId);
  return listBoardMembers(ctx.db, spaceId);
}

// --- Arbre -----------------------------------------------------------------------------------------------------------

export function listBoardNodes(db: Db, spaceId: number): BoardNodeDTO[] {
  return db.all<BoardNodeRow>(`SELECT ${NODE_COLUMNS} FROM board_nodes WHERE space_id = ? AND deleted_at IS NULL ORDER BY path COLLATE NOCASE`, spaceId).map(toNodeDTO);
}

export function listBoardTrash(db: Db, spaceId: number): BoardNodeDTO[] {
  return db.all<BoardNodeRow>(`SELECT ${NODE_COLUMNS} FROM board_nodes WHERE space_id = ? AND deleted_at IS NOT NULL AND kind IN ('board', 'template') ORDER BY deleted_at DESC`, spaceId).map(toNodeDTO);
}

/** Nœud actif à ce chemin ; les modèles ont leurs noms à eux, à part de ceux des tableaux et dossiers. */
const activeNode = (db: Db, spaceId: number, path: string, template = false): BoardNodeRow | undefined =>
  db.get<BoardNodeRow>(`SELECT ${NODE_COLUMNS} FROM board_nodes WHERE space_id = ? AND path = ? COLLATE NOCASE AND deleted_at IS NULL AND (kind = 'template') = ?`, spaceId, path, template ? 1 : 0);

function cleanPath(raw: string): string {
  const path = normalizeDocPath(raw);
  if (!path || path.length > BOARD_LIMITS.pathMax || path.split('/').length > BOARD_LIMITS.depthMax || path.split('/').some((segment) => segment.length > BOARD_LIMITS.nameMax)) {
    throw badRequest('Nom invalide : évitez les caractères spéciaux et les noms commençant par un point.');
  }
  return path;
}

/** Premier chemin libre : « Nom », « Nom (2) »… */
function freePath(db: Db, spaceId: number, path: string, template = false): string {
  if (!activeNode(db, spaceId, path, template)) return path;
  for (let index = 2; ; index += 1) {
    const candidate = `${path} (${index})`;
    if (!activeNode(db, spaceId, candidate, template)) return candidate;
  }
}

/** Nom d'un modèle : pas de dossier. */
function templatePath(raw: string): string {
  const path = cleanPath(raw);
  if (path.includes('/')) throw badRequest('Un modèle se nomme sans dossier.');
  return path;
}

function touchSpace(db: Db, spaceId: number): void {
  db.run('UPDATE board_spaces SET updated_at = ? WHERE id = ?', nowIso(), spaceId);
}

function insertNode(db: Db, spaceId: number, path: string, kind: BoardNodeKind, userId: number | null): number {
  const count = db.get<{ count: number }>('SELECT COUNT(*) AS count FROM board_nodes WHERE space_id = ? AND deleted_at IS NULL', spaceId)?.count ?? 0;
  if (count >= BOARD_LIMITS.nodesPerSpace) throw conflict(`Un espace ne peut pas contenir plus de ${BOARD_LIMITS.nodesPerSpace} tableaux et dossiers.`);
  const now = nowIso();
  return db.run('INSERT INTO board_nodes (space_id, path, kind, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', spaceId, path, kind, userId, userId, now, now).lastInsertRowid;
}

/** Crée les dossiers manquants au-dessus d'un chemin. */
function ensureFolders(db: Db, spaceId: number, path: string, userId: number | null): void {
  const segments = path.split('/').slice(0, -1);
  for (let depth = 1; depth <= segments.length; depth += 1) {
    const folder = segments.slice(0, depth).join('/');
    const existing = activeNode(db, spaceId, folder);
    if (existing?.kind === 'board') throw conflict('Un tableau porte déjà le nom de ce dossier.');
    if (!existing) insertNode(db, spaceId, folder, 'folder', userId);
  }
}

export function createBoardNode(ctx: AppContext, actor: Actor, spaceId: number, input: { path: string; kind: BoardNodeKind; elements?: readonly unknown[] }): BoardNodeDTO {
  const template = input.kind === 'template';
  const path = template ? templatePath(input.path) : cleanPath(input.path);
  if (activeNode(ctx.db, spaceId, path, template)) throw conflict(template ? 'Un modèle porte déjà ce nom.' : 'Un élément porte déjà ce nom.');
  let nodeId = 0;
  ctx.db.transaction(() => {
    if (!template) ensureFolders(ctx.db, spaceId, path, actor.userId);
    nodeId = insertNode(ctx.db, spaceId, path, input.kind, actor.userId);
    // Un modèle ne garde pas de lien vers un autre modèle : ses éléments sont les originaux.
    const elements = input.elements?.length ? sanitizeElements(input.elements).map((element) => (template ? withoutTemplateLink(element) : element)) : [];
    if (input.kind !== 'folder' && elements.length) storeElements(ctx.db, nodeId, elements, null, actor.userId);
    touchSpace(ctx.db, spaceId);
  });
  ctx.boardRooms.publishTree(spaceId);
  return toNodeDTO(requireBoardNode(ctx.db, nodeId));
}

/** Renomme ou déplace un tableau ou un dossier (avec tout son contenu). */
export function moveBoardNode(ctx: AppContext, actor: Actor, nodeId: number, rawPath: string): BoardNodeDTO {
  const node = requireBoardNode(ctx.db, nodeId);
  if (node.deleted_at) throw conflict('Ce tableau est dans la corbeille.');
  const template = node.kind === 'template';
  const path = template ? templatePath(rawPath) : cleanPath(rawPath);
  if (path.toLowerCase() === node.path.toLowerCase() && path === node.path) return toNodeDTO(node);
  if (node.kind === 'folder' && path.toLowerCase().startsWith(`${node.path.toLowerCase()}/`)) throw badRequest('Un dossier ne peut pas aller dans lui-même.');
  const other = activeNode(ctx.db, node.space_id, path, template);
  if (other && other.id !== node.id) throw conflict(template ? 'Un modèle porte déjà ce nom.' : 'Un élément porte déjà ce nom.');
  ctx.db.transaction(() => {
    if (!template) ensureFolders(ctx.db, node.space_id, path, actor.userId);
    const now = nowIso();
    if (node.kind === 'folder') {
      const children = ctx.db.all<{ id: number; path: string }>(`SELECT id, path FROM board_nodes WHERE space_id = ? AND deleted_at IS NULL AND path LIKE ? ESCAPE '\\'`, node.space_id, `${escapeLike(node.path)}/%`);
      for (const child of children) ctx.db.run('UPDATE board_nodes SET path = ? WHERE id = ?', `${path}${child.path.slice(node.path.length)}`, child.id);
    }
    ctx.db.run('UPDATE board_nodes SET path = ?, updated_at = ?, updated_by = ? WHERE id = ?', path, now, actor.userId, node.id);
    touchSpace(ctx.db, node.space_id);
  });
  ctx.boardRooms.publishTree(node.space_id);
  return toNodeDTO(requireBoardNode(ctx.db, nodeId));
}

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** Met à la corbeille un tableau, ou un dossier et tout ce qu'il contient. */
export function deleteBoardNode(ctx: AppContext, actor: Actor, nodeId: number): void {
  const node = requireBoardNode(ctx.db, nodeId);
  if (node.deleted_at) return;
  const now = nowIso();
  const ids = [node.id];
  if (node.kind === 'folder') {
    ids.push(...ctx.db.all<{ id: number }>(`SELECT id FROM board_nodes WHERE space_id = ? AND deleted_at IS NULL AND path LIKE ? ESCAPE '\\'`, node.space_id, `${escapeLike(node.path)}/%`).map((row) => row.id));
  }
  ctx.db.transaction(() => {
    for (const id of ids) ctx.db.run('UPDATE board_nodes SET deleted_at = ?, updated_by = ? WHERE id = ?', now, actor.userId, id);
    touchSpace(ctx.db, node.space_id);
  });
  for (const id of ids) ctx.boardRooms.closeBoard(id, 'deleted');
  ctx.boardRooms.publishTree(node.space_id);
}

/** Sort un tableau de la corbeille (sous un autre nom si le sien a été repris). */
export function restoreBoardNode(ctx: AppContext, actor: Actor, nodeId: number): BoardNodeDTO {
  const node = requireBoardNode(ctx.db, nodeId);
  if (!node.deleted_at) return toNodeDTO(node);
  ctx.db.transaction(() => {
    const template = node.kind === 'template';
    const path = freePath(ctx.db, node.space_id, node.path, template);
    if (!template) ensureFolders(ctx.db, node.space_id, path, actor.userId);
    ctx.db.run('UPDATE board_nodes SET path = ?, deleted_at = NULL, updated_at = ?, updated_by = ? WHERE id = ?', path, nowIso(), actor.userId, node.id);
    touchSpace(ctx.db, node.space_id);
  });
  ctx.boardRooms.publishTree(node.space_id);
  return toNodeDTO(requireBoardNode(ctx.db, nodeId));
}

/** Copie d'un tableau, à côté de lui. */
export function duplicateBoard(ctx: AppContext, actor: Actor, nodeId: number): BoardNodeDTO {
  const node = requireBoardNode(ctx.db, nodeId);
  const elements = readBoardElements(ctx, node);
  const copy = freePath(ctx.db, node.space_id, `${node.path} (copie)`);
  return createBoardNode(ctx, actor, node.space_id, { path: copy, kind: 'board', elements });
}

// --- Éléments --------------------------------------------------------------------------------------------------------

/** Éléments d'un tableau : ceux de la salle d'édition s'il est ouvert, sinon ceux enregistrés. */
export function readBoardElements(ctx: AppContext, node: Pick<BoardNodeRow, 'id'>): BoardElement[] {
  const live = ctx.boardRooms.currentElements(node.id);
  if (live) return live;
  const row = ctx.db.get<{ elements: string }>('SELECT elements FROM board_nodes WHERE id = ?', node.id);
  try {
    return sanitizeElements(JSON.parse(row?.elements ?? '[]') as unknown[]);
  } catch {
    return [];
  }
}

/** État Yjs enregistré d'un tableau. */
export function readBoardState(db: Db, nodeId: number): Uint8Array | null {
  const state = db.get<{ state: Uint8Array | null }>('SELECT state FROM board_nodes WHERE id = ?', nodeId)?.state;
  return state ? new Uint8Array(state) : null;
}

/** Enregistre les éléments d'un tableau : état Yjs, copie lisible et texte cherchable. */
export function storeElements(db: Db, nodeId: number, elements: readonly BoardElement[], state: Uint8Array | null, userId: number | null, kind: BoardVersionKind = 'edit'): void {
  const json = JSON.stringify(elements);
  if (Buffer.byteLength(json) > BOARD_LIMITS.jsonBytes) throw badRequest('Tableau trop volumineux.');
  const node = db.get<{ space_id: number; elements: string; element_count: number; updated_by: number | null; updated_at: string }>('SELECT space_id, elements, element_count, updated_by, updated_at FROM board_nodes WHERE id = ?', nodeId);
  // Historique : le contenu d'avant (pour un tableau plus ancien que l'historique), puis ce nouvel état.
  if (node) recordBoardBaseline(db, nodeId, node.elements, node.element_count, node.updated_by, node.updated_at);
  recordBoardVersion(db, nodeId, json, elements.length, userId, kind);
  db.run(
    'UPDATE board_nodes SET state = ?, elements = ?, element_count = ?, search_text = ?, updated_at = ?, updated_by = ? WHERE id = ?',
    state ?? stateOf(elements),
    json,
    elements.length,
    foldText(boardSearchText(elements)),
    nowIso(),
    userId,
    nodeId,
  );
  if (node) touchSpace(db, node.space_id);
}

/** Remplace les éléments d'un tableau (API) : par la salle s'il est ouvert, pour que chacun le voie aussitôt. */
/**
 * Ajoute ou remplace des éléments (`upsert`) et en retire (`remove`), sans toucher au reste : ce que d'autres dessinent
 * en même temps est gardé. Un lien accroché à un élément retiré part avec lui.
 */
export function patchBoardElements(ctx: AppContext, actor: Actor, node: BoardNodeRow, upsert: readonly unknown[], remove: readonly string[]): BoardElement[] {
  const removing = new Set(remove);
  const current = readBoardElements(ctx, node);
  const attached = (element: BoardElement): boolean => element.type === 'connector' && ((element.from.id !== null && removing.has(element.from.id)) || (element.to.id !== null && removing.has(element.to.id)));
  const next = new Map(current.filter((element) => !removing.has(element.id) && !attached(element)).map((element) => [element.id, element]));
  for (const element of sanitizeElements(upsert)) next.set(element.id, element);
  return writeBoardElements(ctx, actor, node, [...next.values()]);
}

export function writeBoardElements(ctx: AppContext, actor: Actor, node: BoardNodeRow, raw: readonly unknown[]): BoardElement[] {
  const elements = sanitizeElements(raw);
  if (!ctx.boardRooms.replaceElements(node.id, elements, actor.userId)) storeElements(ctx.db, node.id, elements, null, actor.userId);
  ctx.boardRooms.publishTree(node.space_id);
  return elements;
}

// --- Historique ------------------------------------------------------------------------------------------------------

/** Versions d'un tableau, de la plus ancienne à la plus récente, et celle qui est son état actuel (si elle est notée). */
export function boardHistory(ctx: AppContext, node: BoardNodeRow): { versions: BoardVersionDTO[]; currentVersionId: number | null } {
  return { versions: listBoardVersions(ctx.db, node.id), currentVersionId: matchingVersion(ctx.db, node.id, JSON.stringify(readBoardElements(ctx, node))) };
}

export function boardVersion(ctx: AppContext, node: BoardNodeRow, versionId: number): { version: BoardVersionDTO; elements: BoardElement[] } {
  const found = readBoardVersion(ctx.db, node.id, versionId);
  if (!found) throw notFound('Version introuvable.');
  return found;
}

/**
 * Remet un tableau dans l'état d'une version. L'état d'avant reste dans l'historique (on peut y revenir), et la
 * restauration y a sa propre version.
 */
export function restoreBoardVersion(ctx: AppContext, actor: Actor, node: BoardNodeRow, versionId: number): BoardElement[] {
  const { elements } = boardVersion(ctx, node, versionId);
  reviveFrozenAssets(ctx, actor, node.space_id, elements);
  const current = readBoardElements(ctx, node);
  ctx.db.transaction(() => {
    // Ce qui est à l'écran, même pas encore enregistré, entre dans l'historique avant d'être remplacé.
    recordBoardVersion(ctx.db, node.id, JSON.stringify(current), current.length, node.updated_by);
    recordBoardVersion(ctx.db, node.id, JSON.stringify(elements), elements.length, actor.userId, 'restore');
  });
  if (!ctx.boardRooms.replaceElements(node.id, elements, actor.userId)) storeElements(ctx.db, node.id, elements, null, actor.userId, 'restore');
  ctx.boardRooms.publishTree(node.space_id);
  return elements;
}

/** Nouveau tableau (ou modèle) à partir d'une version, à côté de l'original. */
export function forkBoardVersion(ctx: AppContext, actor: Actor, node: BoardNodeRow, versionId: number, name: string | undefined): BoardNodeDTO {
  const { elements } = boardVersion(ctx, node, versionId);
  reviveFrozenAssets(ctx, actor, node.space_id, elements);
  const folder = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/') + 1) : '';
  const template = node.kind === 'template';
  const wanted = name?.trim() ? `${template ? '' : folder}${name.trim().replace(/\//g, ' ')}` : `${node.path} (version)`;
  return createBoardNode(ctx, actor, node.space_id, { path: freePath(ctx.db, node.space_id, wanted, template), kind: template ? 'template' : 'board', elements });
}

// --- Recherche et corbeille ------------------------------------------------------------------------------------------

/** Tableaux des espaces accessibles, par leur nom d'abord, puis par leur contenu. */
export function searchBoards(ctx: AppContext, user: AuthUser, rawQuery: string, limit = 10): BoardSearchHitDTO[] {
  if (!boardsEnabled(ctx.db)) return [];
  const spaces = new Map(listBoardSpaces(ctx, user).map((space) => [space.id, space.name]));
  if (!spaces.size) return [];
  const query = foldText(rawQuery.trim());
  const rows = ctx.db.all<{ id: number; space_id: number; path: string; updated_at: string; in_text: number }>(
    `SELECT id, space_id, path, updated_at, instr(search_text, ?) > 0 AS in_text FROM board_nodes
      WHERE kind = 'board' AND deleted_at IS NULL AND space_id IN (${[...spaces.keys()].join(',')})`,
    query,
  );
  const rank = (row: (typeof rows)[number]): number | null => {
    if (!query) return 0;
    const title = foldText(boardTitle(row.path));
    if (title.startsWith(query)) return 0;
    if (title.includes(query)) return 1;
    if (foldText(row.path).includes(query)) return 2;
    return row.in_text ? 3 : null;
  };
  return rows
    .map((row) => ({ row, score: rank(row) }))
    .filter((hit): hit is { row: (typeof rows)[number]; score: number } => hit.score !== null)
    .sort((a, b) => a.score - b.score || b.row.updated_at.localeCompare(a.row.updated_at))
    .slice(0, limit)
    .map(({ row }) => ({ id: row.id, spaceId: row.space_id, spaceName: spaces.get(row.space_id) ?? '', path: row.path, title: boardTitle(row.path) }));
}

/** Vide la corbeille des tableaux au-delà de la durée de conservation. */
export function purgeBoards(ctx: AppContext, now = Date.now()): void {
  const limit = new Date(now - BOARD_LIMITS.retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const removed = ctx.db.run('DELETE FROM board_nodes WHERE deleted_at IS NOT NULL AND deleted_at < ?', limit).changes;
  if (removed) ctx.logger.info('boards', `Corbeille des tableaux vidée : ${removed} élément(s)`, { removed });
  // Les fichiers figés que plus aucune version étiquetée ne garde (tableau ou espace supprimé).
  collectFrozen(ctx);
}
