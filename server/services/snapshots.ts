import fs from 'node:fs';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { sanitizeFileName, sniffImageMime } from '../../shared/attachments.ts';
import type { BoardElement, BoardNodeKind } from '../../shared/boards.ts';
import {
  SNAPSHOT_LIMITS,
  type BoardSnapshotContent,
  type DocSnapshotContent,
  type ProjectSnapshotContent,
  type SnapshotContent,
  type SnapshotKind,
  type SpaceSnapshotDTO,
} from '../../shared/snapshots.ts';
import { cleanTagName } from '../../shared/versionTags.ts';
import { boardFile, boardFileRefs, storeAsset } from '../boards/assets.ts';
import { withoutTemplateLink } from '../boards/elements.ts';
import { createBoardNode, createBoardSpace, getBoardSpace, listBoardNodes, readBoardElements, requireBoardSpace, requireBoardsEnabled } from '../boards/store.ts';
import type { Actor, AppContext } from '../context.ts';
import { nowIso } from '../db/database.ts';
import { createNode, createSpace, getSpace, listNodes, listTemplates, putImported, putImportedFolder, readBytes, readText, requireDocsEnabled, requireSpace } from '../docs/store.ts';
import { badRequest, conflict, notFound } from '../http/errors.ts';
import { requireGlobal, requireProject, type AuthUser } from './access.ts';
import { attachmentFile } from './attachments.ts';
import { exportProjectJson } from './export.ts';
import { collectFrozen, freezeBytes, readFrozen } from './frozenFiles.ts';
import { buildSnapshot } from './projects.ts';

/**
 * Étiquettes d'espace (voir `shared/snapshots.ts`) : à la création, tout le contenu de l'espace est copié dans les
 * fichiers figés (par empreinte : un fichier inchangé d'une étiquette à l'autre n'est gardé qu'une fois), avec un
 * manifeste JSON qui décrit l'espace. L'étiquette ne lit ensuite plus que ses copies : rien de ce qui arrive à l'espace
 * ne la change.
 */

interface SnapshotRow {
  id: number;
  kind: SnapshotKind;
  space_id: number;
  name: string;
  description: string;
  space_name: string;
  manifest: string;
  items: number;
  files: number;
  bytes: number;
  created_by: number | null;
  created_at: string;
}

type Level = 'read' | 'write' | 'manage';

const toDTO = (row: SnapshotRow & { created_by_name: string | null }): SpaceSnapshotDTO => ({
  id: row.id,
  kind: row.kind,
  spaceId: row.space_id,
  name: row.name,
  description: row.description,
  spaceName: row.space_name,
  items: row.items,
  files: row.files,
  bytes: row.bytes,
  createdBy: row.created_by,
  createdByName: row.created_by_name,
  createdAt: row.created_at,
});

const SELECT = 'SELECT s.*, u.name AS created_by_name FROM space_snapshots s LEFT JOIN users u ON u.id = s.created_by';

/**
 * Vérifie l'accès à l'espace : `read` pour consulter ses étiquettes, `write` pour en poser (éditeur, ou « Configurer
 * le projet »), `manage` pour en supprimer (propriétaire de l'espace, ou « Configurer le projet »).
 */
function requireAccess(ctx: AppContext, user: AuthUser, kind: SnapshotKind, spaceId: number, level: Level): void {
  if (kind === 'docs') {
    requireDocsEnabled(ctx.db);
    requireSpace(ctx, user, spaceId, level === 'read' ? 'reader' : level === 'write' ? 'editor' : 'owner');
  } else if (kind === 'boards') {
    requireBoardsEnabled(ctx.db);
    requireBoardSpace(ctx, user, spaceId, level === 'read' ? 'reader' : level === 'write' ? 'editor' : 'owner');
  } else {
    requireProject(ctx, user, spaceId, level === 'read' ? undefined : 'project.edit');
  }
}

function requireSnapshot(ctx: AppContext, user: AuthUser, snapshotId: number, level: Level = 'read'): SnapshotRow & { created_by_name: string | null } {
  const row = ctx.db.get<SnapshotRow & { created_by_name: string | null }>(`${SELECT} WHERE s.id = ?`, snapshotId);
  if (!row) throw notFound('Étiquette introuvable.');
  requireAccess(ctx, user, row.kind, row.space_id, level);
  return row;
}

/** Les personnes qui voient l'espace relisent ses étiquettes (liste ouverte). */
function announce(ctx: AppContext, kind: SnapshotKind, spaceId: number): void {
  const [view, column] = kind === 'docs' ? ['doc_access', 'space_id'] : kind === 'boards' ? ['board_access', 'space_id'] : ['project_access', 'project_id'];
  for (const { user_id } of ctx.db.all<{ user_id: number }>(`SELECT DISTINCT user_id FROM ${view} WHERE ${column} = ?`, spaceId)) {
    ctx.hub.sendToUser(user_id, { t: 'snapshots.changed', kind, spaceId });
  }
}

export function listSnapshots(ctx: AppContext, user: AuthUser, kind: SnapshotKind, spaceId: number): SpaceSnapshotDTO[] {
  requireAccess(ctx, user, kind, spaceId, 'read');
  return ctx.db.all<SnapshotRow & { created_by_name: string | null }>(`${SELECT} WHERE s.kind = ? AND s.space_id = ? ORDER BY s.id DESC`, kind, spaceId).map(toDTO);
}

/** Les copies d'une étiquette en cours de création. */
class Collector {
  readonly entries = new Map<string, { hash: string; ref: string; name: string }>();
  readonly sizes = new Map<string, number>();
  private readonly ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  keep(data: Uint8Array, mime: string, ref = '', name = ''): string {
    const hash = freezeBytes(this.ctx, data, mime);
    this.entries.set(`${hash}|${ref}`, { hash, ref, name });
    this.sizes.set(hash, data.length);
    return hash;
  }

  keepJson(value: unknown): string {
    return this.keep(Buffer.from(JSON.stringify(value), 'utf8'), 'application/json');
  }
}

function freezeDocs(ctx: AppContext, user: AuthUser, spaceId: number, files: Collector): { content: DocSnapshotContent; items: number; spaceName: string } {
  // Les textes en cours d'édition sont d'abord écrits : l'étiquette prend l'état que voient les personnes.
  ctx.docRooms.flushSpace(spaceId);
  const space = getSpace(ctx, user, spaceId);
  const nodes: DocSnapshotContent['nodes'] = [];
  for (const node of [...listNodes(ctx.db, spaceId), ...listTemplates(ctx.db, spaceId)]) {
    let file: string | null = null;
    const ref = { space_id: spaceId, path: node.path, kind: node.kind };
    if (node.kind === 'markdown' || node.kind === 'template') {
      file = files.keep(Buffer.from(ctx.docRooms.currentText(node.id) ?? readText(ctx, ref), 'utf8'), 'text/markdown; charset=utf-8');
    } else if (node.kind === 'image') {
      const data = readBytes(ctx, ref);
      const mime = data ? sniffImageMime(data.subarray(0, 16)) : null;
      if (data && mime) file = files.keep(data, mime);
    }
    nodes.push({ id: node.id, path: node.path, kind: node.kind, memo: node.memo, icon: node.icon, color: node.color, updatedAt: node.updatedAt, file });
  }
  return {
    content: { kind: 'docs', space: { name: space.name, description: space.description, obsidian: space.obsidian }, nodes },
    items: nodes.filter((node) => node.kind === 'markdown').length,
    spaceName: space.name,
  };
}

function freezeBoards(ctx: AppContext, user: AuthUser, spaceId: number, files: Collector): { content: BoardSnapshotContent; items: number; spaceName: string } {
  const space = getBoardSpace(ctx, user, spaceId);
  const nodes: BoardSnapshotContent['nodes'] = [];
  const refs = new Set<string>();
  for (const node of listBoardNodes(ctx.db, spaceId)) {
    let file: string | null = null;
    if (node.kind !== 'folder') {
      const elements = readBoardElements(ctx, node);
      file = files.keepJson(elements);
      for (const ref of boardFileRefs(elements)) refs.add(ref);
    }
    nodes.push({ id: node.id, path: node.path, kind: node.kind, updatedAt: node.updatedAt, file });
  }
  const shown: BoardSnapshotContent['files'] = [];
  for (const ref of refs) {
    const found = boardFile(ctx, ref);
    if (found) shown.push({ ref, name: found.name, mime: found.mime, file: files.keep(found.data, found.mime, ref, found.name) });
  }
  return {
    content: { kind: 'boards', space: { name: space.name, description: space.description }, nodes, files: shown },
    items: nodes.filter((node) => node.kind === 'board').length,
    spaceName: space.name,
  };
}

function freezeProject(ctx: AppContext, user: AuthUser, projectId: number, files: Collector): { content: ProjectSnapshotContent; items: number; spaceName: string } {
  const access = requireProject(ctx, user, projectId);
  const snapshot = buildSnapshot(ctx.db, access);
  // L'export complet, avec les personnes citées (auteurs des commentaires et de l'historique, même parties depuis).
  const exported = { ...(exportProjectJson(ctx.db, access) as Record<string, unknown>), users: snapshot.users };
  const attachments: ProjectSnapshotContent['attachments'] = [];
  const rows = ctx.db.all<{ id: number; ticket_id: number; name: string; mime: string; size: number; storage: string }>(
    "SELECT a.id, a.ticket_id, a.name, a.mime, a.size, a.storage FROM ticket_attachments a JOIN tickets t ON t.id = a.ticket_id WHERE t.project_id = ? AND a.kind = 'file' ORDER BY a.id",
    projectId,
  );
  for (const row of rows) {
    let data: Buffer;
    try {
      data = fs.readFileSync(attachmentFile(ctx, row));
    } catch {
      continue;
    }
    attachments.push({ id: row.id, ticketId: row.ticket_id, name: row.name, mime: row.mime, size: data.length, file: files.keep(data, row.mime || 'application/octet-stream', '', row.name) });
  }
  const { key, name } = snapshot.project;
  return {
    content: { kind: 'project', project: { key, name }, file: files.keepJson(exported), attachments },
    items: snapshot.tickets.length,
    spaceName: `${key} — ${name}`,
  };
}

/** Pose une étiquette sur l'espace : tout son contenu, tel qu'il est maintenant, est figé sous ce nom. */
export function createSnapshot(ctx: AppContext, actor: Actor, user: AuthUser, kind: SnapshotKind, spaceId: number, input: { name: string; description?: string }): SpaceSnapshotDTO {
  requireAccess(ctx, user, kind, spaceId, 'write');
  const name = cleanTagName(input.name);
  if (!name) throw badRequest('Donnez un nom à l’étiquette.');
  const description = (input.description ?? '').trim().slice(0, SNAPSHOT_LIMITS.descriptionMax);
  if (ctx.db.get('SELECT 1 AS found FROM space_snapshots WHERE kind = ? AND space_id = ? AND name = ? COLLATE NOCASE', kind, spaceId, name)) throw conflict('Une étiquette de cet espace porte déjà ce nom.');
  const count = ctx.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM space_snapshots WHERE kind = ? AND space_id = ?', kind, spaceId)?.count ?? 0;
  if (count >= SNAPSHOT_LIMITS.perSpace) throw conflict(`Un espace ne peut pas garder plus de ${SNAPSHOT_LIMITS.perSpace} étiquettes : supprimez-en une.`);

  const files = new Collector(ctx);
  const frozen = kind === 'docs' ? freezeDocs(ctx, user, spaceId, files) : kind === 'boards' ? freezeBoards(ctx, user, spaceId, files) : freezeProject(ctx, user, spaceId, files);
  const manifest = files.keepJson(frozen.content);
  const bytes = [...files.sizes.values()].reduce((sum, size) => sum + size, 0);
  let id = 0;
  ctx.db.transaction(() => {
    id = ctx.db.run(
      'INSERT INTO space_snapshots (kind, space_id, name, description, space_name, manifest, items, files, bytes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      kind,
      spaceId,
      name,
      description,
      frozen.spaceName,
      manifest,
      frozen.items,
      files.sizes.size - 1,
      bytes,
      actor.userId,
      nowIso(),
    ).lastInsertRowid;
    for (const entry of files.entries.values()) ctx.db.run('INSERT OR IGNORE INTO space_snapshot_files (snapshot_id, hash, ref, name) VALUES (?, ?, ?, ?)', id, entry.hash, entry.ref, entry.name);
  });
  ctx.logger.info(kind === 'project' ? 'project' : kind, `Étiquette d’espace « ${name} » : ${frozen.spaceName}`, { kind, spaceId, snapshotId: id, files: files.sizes.size, bytes }, actor.userId);
  announce(ctx, kind, spaceId);
  return toDTO(ctx.db.get<SnapshotRow & { created_by_name: string | null }>(`${SELECT} WHERE s.id = ?`, id)!);
}

/** Retire l'étiquette ; ses copies partent si plus rien ne les garde. Propriétaire de l'espace, ou qui l'a posée. */
export function deleteSnapshot(ctx: AppContext, actor: Actor, user: AuthUser, snapshotId: number): void {
  const row = requireSnapshot(ctx, user, snapshotId, 'read');
  requireAccess(ctx, user, row.kind, row.space_id, row.created_by === user.id ? 'write' : 'manage');
  ctx.db.run('DELETE FROM space_snapshots WHERE id = ?', snapshotId);
  collectFrozen(ctx);
  ctx.logger.info(row.kind === 'project' ? 'project' : row.kind, `Étiquette d’espace supprimée « ${row.name} » : ${row.space_name}`, { snapshotId }, actor.userId);
  announce(ctx, row.kind, row.space_id);
}

function readContent(ctx: AppContext, row: SnapshotRow): SnapshotContent {
  const frozen = readFrozen(ctx, row.manifest);
  if (!frozen) throw notFound('Le contenu de cette étiquette est introuvable.');
  return JSON.parse(frozen.data.toString('utf8')) as SnapshotContent;
}

/** L'étiquette et la description de son contenu (les fichiers se lisent un par un). */
export function snapshotContent(ctx: AppContext, user: AuthUser, snapshotId: number): { snapshot: SpaceSnapshotDTO; content: SnapshotContent } {
  const row = requireSnapshot(ctx, user, snapshotId);
  return { snapshot: toDTO(row), content: readContent(ctx, row) };
}

/** Un fichier figé de l'étiquette (et de nulle autre : l'empreinte seule ne suffit pas). */
export function snapshotFile(ctx: AppContext, user: AuthUser, snapshotId: number, hash: string): { mime: string; data: Buffer } {
  requireSnapshot(ctx, user, snapshotId);
  if (!/^[0-9a-f]{64}$/.test(hash) || !ctx.db.get('SELECT 1 AS found FROM space_snapshot_files WHERE snapshot_id = ? AND hash = ?', snapshotId, hash)) throw notFound('Fichier introuvable.');
  const frozen = readFrozen(ctx, hash);
  if (!frozen) throw notFound('Fichier introuvable.');
  return frozen;
}

const text = (ctx: AppContext, hash: string | null): string => (hash ? (readFrozen(ctx, hash)?.data.toString('utf8') ?? '') : '');
const bytes = (ctx: AppContext, hash: string | null): Uint8Array | null => {
  const data = hash ? readFrozen(ctx, hash)?.data : null;
  return data ? new Uint8Array(data) : null;
};

/**
 * Archive ZIP de l'étiquette : pour la documentation, les dossiers, notes et images à leur place (comme l'export de
 * l'espace) et les modèles dans `_modeles/` ; pour les tableaux, les éléments de chacun (`.json`) et leurs fichiers ;
 * pour un projet, `projet.json` et les pièces jointes. `etiquette.json` décrit l'étiquette.
 */
export function snapshotArchive(ctx: AppContext, user: AuthUser, snapshotId: number): { name: string; spaceName: string; data: Buffer } {
  const row = requireSnapshot(ctx, user, snapshotId);
  const content = readContent(ctx, row);
  const files: Zippable = {};
  const mtime = new Date(row.created_at);
  const put = (path: string, data: Uint8Array | null, compress = true): void => {
    if (data) files[path] = [data, { level: compress ? 6 : 0, mtime }];
  };
  if (content.kind === 'docs') {
    for (const node of content.nodes) {
      if (node.kind === 'folder') files[`${node.path}/`] = [new Uint8Array(0), { level: 0, mtime }];
      else if (node.kind === 'image') put(node.path, bytes(ctx, node.file), false);
      else put(node.kind === 'template' ? `_modeles/${node.path}` : node.path, bytes(ctx, node.file));
    }
  } else if (content.kind === 'boards') {
    for (const node of content.nodes) {
      if (node.kind === 'folder') files[`${node.path}/`] = [new Uint8Array(0), { level: 0, mtime }];
      else put(`${node.kind === 'template' ? '_modeles/' : ''}${node.path}.json`, bytes(ctx, node.file));
    }
    for (const file of content.files) put(`_fichiers/${file.ref.replace(':', '-')}-${sanitizeFileName(file.name, 120)}`, bytes(ctx, file.file), false);
  } else {
    put('projet.json', bytes(ctx, content.file));
    for (const attachment of content.attachments) put(`pieces-jointes/${attachment.ticketId}/${attachment.id}-${sanitizeFileName(attachment.name, 120)}`, bytes(ctx, attachment.file), false);
  }
  files['etiquette.json'] = strToU8(
    JSON.stringify({ app: 'FastBoard', kind: row.kind, space: row.space_name, tag: row.name, description: row.description, createdAt: row.created_at, createdBy: row.created_by_name, content }, null, 2),
  );
  return { name: row.name, spaceName: row.space_name, data: Buffer.from(zipSync(files)) };
}

/**
 * Nouvel espace à partir de l'étiquette (documentation, tableaux blancs) : son contenu tel qu'il était, sous le nom
 * donné (par défaut « Espace (étiquette) »). Il faut pouvoir créer un espace ; la personne en est propriétaire.
 */
export function restoreSnapshot(ctx: AppContext, actor: Actor, user: AuthUser, snapshotId: number, rawName?: string): { kind: SnapshotKind; spaceId: number } {
  const row = requireSnapshot(ctx, user, snapshotId);
  const content = readContent(ctx, row);
  if (content.kind === 'project') throw badRequest('Une étiquette de projet se consulte et se télécharge ; elle ne redonne pas de projet.');
  const name = (rawName?.trim() || `${content.space.name} (${row.name})`).slice(0, 80);
  if (content.kind === 'docs') {
    requireGlobal(user, 'docs.create');
    const space = createSpace(ctx, user, { name, description: content.space.description, obsidian: content.space.obsidian });
    const folders = content.nodes.filter((node) => node.kind === 'folder').sort((a, b) => a.path.localeCompare(b.path));
    for (const folder of folders) putImportedFolder(ctx, actor, space.id, folder.path);
    for (const node of content.nodes) {
      if (node.kind === 'markdown') putImported(ctx, actor, space.id, node.path, text(ctx, node.file));
      else if (node.kind === 'image') {
        const data = bytes(ctx, node.file);
        if (data) putImported(ctx, actor, space.id, node.path, data);
      } else if (node.kind === 'template') createNode(ctx, actor, space.id, { path: node.path, kind: 'template', content: text(ctx, node.file) });
    }
    // Notes, icônes et couleurs des dossiers et des fichiers.
    for (const node of content.nodes) {
      if (node.memo || node.icon || node.color) {
        ctx.db.run('UPDATE doc_nodes SET memo = ?, icon = ?, color = ? WHERE space_id = ? AND path = ? AND kind = ? AND deleted_at IS NULL', node.memo, node.icon, node.color, space.id, node.path, node.kind);
      }
    }
    ctx.docRooms.publishTree(space.id);
    ctx.logger.info('docs', `Espace recréé depuis l’étiquette « ${row.name} » : ${name}`, { snapshotId, spaceId: space.id }, actor.userId);
    return { kind: 'docs', spaceId: space.id };
  }
  requireGlobal(user, 'boards.create');
  const space = createBoardSpace(ctx, user, { name, description: content.space.description });
  // Les images reviennent dans le nouvel espace (nouvelles clés) ; les icônes ajoutées restent celles du site.
  const keys = new Map<string, string>();
  for (const file of content.files) {
    if (!file.ref.startsWith('asset:')) continue;
    const data = readFrozen(ctx, file.file)?.data;
    if (!data) continue;
    try {
      keys.set(file.ref.slice(6), storeAsset(ctx, actor, space.id, file.name, data).key);
    } catch {
      // Limite d'images atteinte : l'élément garde l'ancienne clé, encore lisible grâce à l'étiquette.
    }
  }
  const templates = new Map<number, number>();
  const elementsOf = (hash: string | null): BoardElement[] => {
    try {
      return (JSON.parse(text(ctx, hash) || '[]') as BoardElement[]).map((element) => {
        let next = element;
        if (next.type === 'image' && keys.has(next.asset)) next = { ...next, asset: keys.get(next.asset)! };
        if (next.tpl) next = templates.has(next.tpl.id) ? { ...next, tpl: { ...next.tpl, id: templates.get(next.tpl.id)! } } : withoutTemplateLink(next);
        return next;
      });
    } catch {
      return [];
    }
  };
  const order: BoardNodeKind[] = ['template', 'folder', 'board'];
  for (const kind of order) {
    for (const node of content.nodes.filter((entry) => entry.kind === kind).sort((a, b) => a.path.localeCompare(b.path))) {
      const created = createBoardNode(ctx, actor, space.id, { path: node.path, kind, elements: kind === 'folder' ? [] : elementsOf(node.file) });
      if (kind === 'template') templates.set(node.id, created.id);
    }
  }
  ctx.logger.info('boards', `Espace recréé depuis l’étiquette « ${row.name} » : ${name}`, { snapshotId, spaceId: space.id }, actor.userId);
  return { kind: 'boards', spaceId: space.id };
}
