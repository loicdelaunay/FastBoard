import { randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync, strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { docFileKind, DOC_LIMITS, normalizeDocPath } from '../../shared/docs.ts';
import type { DocImportAction, DocImportEntryDTO, DocImportPreviewDTO, DocImportStatus } from '../../shared/docs.ts';
import { isInlineImage, sniffImageMime } from '../../shared/attachments.ts';
import type { Actor, AppContext } from '../context.ts';
import { nowIso } from '../db/database.ts';
import { badRequest, notFound } from '../http/errors.ts';
import { markDifferences, mergeThreeWay } from './merge.ts';
import { deleteNode, findNodeByPath, listNodes, putImported, putImportedFolder, readBytes, readText, uniquePath, type NodeRow } from './store.ts';

/**
 * Export et réimport. Le ZIP reproduit exactement l'arbre de l'espace, dossiers vides compris, sans rien de plus. Le texte
 * exporté reste sur le serveur : au retour, il sert de version d'origine pour une vraie fusion à trois. Le commentaire du
 * ZIP dit de quel export il s'agit ; une archive refaite à la main le perd, et l'on reprend alors l'export de la personne
 * qui lui ressemble le plus.
 */

const COMMENT_PREFIX = 'fastboard-export:';
const IMPORT_TTL_MS = 30 * 60 * 1000;

interface PendingEntry extends DocImportEntryDTO {
  /** Contenu du ZIP. */
  incoming: string | Uint8Array | null;
}

interface PendingImport {
  userId: number;
  spaceId: number;
  expiresAt: number;
  entries: Map<string, PendingEntry>;
  folders: string[];
}

const pending = new Map<string, PendingImport>();

function forgetExpired(): void {
  const now = Date.now();
  for (const [id, entry] of pending) {
    if (entry.expiresAt <= now) pending.delete(id);
  }
}

function rememberExport(ctx: AppContext, spaceId: number, userId: number, texts: Record<string, string>): string {
  const id = randomUUID();
  ctx.db.run('INSERT INTO doc_exports (id, space_id, user_id, texts, created_at) VALUES (?, ?, ?, ?, ?)', id, spaceId, userId, gzipSync(strToU8(JSON.stringify(texts))), nowIso());
  ctx.db.run(
    'DELETE FROM doc_exports WHERE id IN (SELECT id FROM doc_exports WHERE space_id = ? AND user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?)',
    spaceId,
    userId,
    DOC_LIMITS.exportsKept,
  );
  return id;
}

function exportedTexts(row: { texts: Uint8Array }): Map<string, string> {
  return new Map(Object.entries(JSON.parse(strFromU8(gunzipSync(row.texts))) as Record<string, string>));
}

/** Le commentaire de fin d'archive n'est pas une entrée du ZIP : il n'apparaît pas à l'extraction. */
function withComment(zip: Uint8Array, comment: string): Buffer {
  const text = Buffer.from(comment, 'utf8');
  const result = Buffer.concat([zip, text]);
  result.writeUInt16LE(text.length, zip.length - 2);
  return result;
}

function commentOf(data: Uint8Array): string {
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  for (let index = buffer.length - 22; index >= 0 && index >= buffer.length - 22 - 0xffff; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) return buffer.toString('utf8', index + 22, index + 22 + buffer.readUInt16LE(index + 20));
  }
  return '';
}

/**
 * Exporte un espace, ou l'un de ses dossiers, avec les chemins de l'espace. `remember` : la personne pourra réimporter,
 * le texte exporté est donc gardé pour la fusion.
 */
export function exportSpace(ctx: AppContext, userId: number, spaceId: number, options: { folder?: string; remember: boolean }): Buffer {
  ctx.docRooms.flushSpace(spaceId);
  const { folder = '' } = options;
  const files: Zippable = {};
  const texts: Record<string, string> = {};
  for (const node of listNodes(ctx.db, spaceId)) {
    if (folder && node.path !== folder && !node.path.startsWith(`${folder}/`)) continue;
    const mtime = new Date(node.updatedAt);
    if (node.kind === 'folder') {
      files[`${node.path}/`] = [new Uint8Array(0), { level: 0, mtime }];
      continue;
    }
    const row = { space_id: spaceId, path: node.path };
    if (node.kind === 'markdown') {
      const text = readText(ctx, row);
      files[node.path] = [strToU8(text), { mtime }];
      texts[node.path] = text;
    } else {
      const data = readBytes(ctx, row);
      // Images déjà compressées : les recompresser ne ferait que perdre du temps.
      if (data) files[node.path] = [new Uint8Array(data), { level: 0, mtime }];
    }
  }
  const zip = zipSync(files, { level: 6 });
  return options.remember ? withComment(zip, `${COMMENT_PREFIX}${rememberExport(ctx, spaceId, userId, texts)}`) : Buffer.from(zip);
}

/** Exporte un fichier seul, tel quel. */
export function exportFile(ctx: AppContext, userId: number, node: NodeRow, remember: boolean): Buffer | null {
  ctx.docRooms.flushSpace(node.space_id);
  if (node.kind !== 'markdown') return readBytes(ctx, node);
  const text = readText(ctx, node);
  if (remember) rememberExport(ctx, node.space_id, userId, { [node.path]: text });
  return Buffer.from(text, 'utf8');
}

/** Texte d'origine des fichiers importés : l'export nommé par l'archive, sinon celui de la personne qui les couvre le mieux. */
function originalTexts(ctx: AppContext, userId: number, spaceId: number, exportId: string | null, paths: string[]): Map<string, string> {
  const named = exportId ? ctx.db.get<{ texts: Uint8Array }>('SELECT texts FROM doc_exports WHERE id = ? AND space_id = ?', exportId, spaceId) : undefined;
  if (named) return exportedTexts(named);
  let best = new Map<string, string>();
  let bestScore = 0;
  for (const row of ctx.db.all<{ texts: Uint8Array }>('SELECT texts FROM doc_exports WHERE space_id = ? AND user_id = ? ORDER BY created_at DESC, rowid DESC', spaceId, userId)) {
    const texts = exportedTexts(row);
    const score = paths.filter((path) => texts.has(path)).length;
    if (score > bestScore) {
      best = texts;
      bestScore = score;
    }
  }
  return best;
}

/** Fichiers et dossiers de l'archive, chemins nettoyés. Un dossier englobant inconnu de l'espace (coffre zippé) est retiré. */
function readArchive(ctx: AppContext, spaceId: number, data: Uint8Array, folder: string): { files: Map<string, Uint8Array>; folders: string[]; ignored: string[]; exportId: string | null } {
  let total = 0;
  let count = 0;
  const directories: string[] = [];
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(data, {
      filter: (file) => {
        if (file.name.endsWith('/')) {
          directories.push(file.name.slice(0, -1));
          return false;
        }
        count += 1;
        total += file.originalSize;
        if (count > DOC_LIMITS.zipFiles || total > DOC_LIMITS.unzippedBytes) throw new RangeError('trop gros');
        return true;
      },
    });
  } catch (error) {
    throw badRequest(error instanceof RangeError ? 'Archive trop volumineuse.' : 'Archive ZIP illisible.');
  }
  // Réglages d'Obsidian, Git, dossiers cachés, résidus de macOS : rien à reprendre.
  const hidden = (name: string): boolean => name.split('/').some((segment) => segment.startsWith('.') || segment === '__MACOSX');
  const names = Object.keys(unzipped).filter((name) => !hidden(name));
  const entries = [...names, ...directories.filter((name) => !hidden(name)).map((name) => `${name}/`)];
  const tops = new Set(entries.map((name) => name.split('/')[0]!));
  const top = [...tops][0];
  const wrapped = tops.size === 1 && entries.every((name) => name.includes('/')) && !findNodeByPath(ctx.db, spaceId, top ?? '');
  const relative = (name: string): string => (wrapped ? name.slice(top!.length + 1) : name);

  // Import dans un dossier : un chemin déjà donné depuis la racine de l'espace reste tel quel.
  const inFolder = folder !== '' && !names.every((name) => relative(name).startsWith(`${folder}/`));
  const place = (name: string): string => (inFolder ? `${folder}/${relative(name)}` : relative(name));

  const files = new Map<string, Uint8Array>();
  const ignored: string[] = [];
  for (const name of names) {
    const clean = normalizeDocPath(place(name));
    if (!clean || !docFileKind(clean)) ignored.push(relative(name));
    else files.set(clean, unzipped[name]!);
  }
  const folders = directories.flatMap((name) => {
    const clean = hidden(name) || (wrapped && name === top) ? null : normalizeDocPath(place(name));
    return clean ? [clean] : [];
  });
  const comment = commentOf(data);
  return { files, folders, ignored, exportId: comment.startsWith(COMMENT_PREFIX) ? comment.slice(COMMENT_PREFIX.length) : null };
}

function analyseText(server: string | null, base: string | undefined, incoming: string): { status: DocImportStatus; merged: string | null } {
  if (server === null) return { status: 'new', merged: null };
  if (server === incoming) return { status: 'same', merged: null };
  if (base === undefined) return { status: 'conflict', merged: markDifferences(server, incoming) };
  if (server === base) return { status: 'updated', merged: null };
  if (incoming === base) return { status: 'kept', merged: null };
  const { text, conflict } = mergeThreeWay(server, base, incoming);
  return { status: conflict ? 'conflict' : 'merged', merged: text };
}

/** Compare un fichier reçu à celui du serveur ; `null` : format refusé. */
function analyseFile(ctx: AppContext, spaceId: number, relative: string, bytes: Uint8Array, base: string | undefined): PendingEntry | null {
  const node = findNodeByPath(ctx.db, spaceId, relative);
  if (docFileKind(relative) === 'markdown') {
    if (bytes.length > DOC_LIMITS.fileChars * 4) return null;
    const incoming = strFromU8(bytes);
    const { status, merged } = analyseText(node ? readText(ctx, node) : null, base, incoming);
    return { path: relative, kind: 'markdown', status, merged, incoming };
  }
  const mime = sniffImageMime(bytes.subarray(0, 16));
  if (!mime || !isInlineImage(mime) || bytes.length > DOC_LIMITS.imageBytes) return null;
  const current = node ? readBytes(ctx, node) : null;
  const status: DocImportStatus = !current ? 'new' : current.equals(bytes) ? 'same' : 'conflict';
  return { path: relative, kind: 'image', status, merged: null, incoming: bytes };
}

function register(userId: number, spaceId: number, entries: Map<string, PendingEntry>, folders: string[], ignored: string[]): DocImportPreviewDTO {
  const importId = randomUUID();
  pending.set(importId, { userId, spaceId, expiresAt: Date.now() + IMPORT_TTL_MS, entries, folders });
  return { importId, entries: [...entries.values()].map(({ incoming: _incoming, ...entry }) => entry).sort((a, b) => a.path.localeCompare(b.path)), ignored };
}

/** Analyse un ZIP importé dans un espace, ou dans l'un de ses dossiers. */
export function previewImport(ctx: AppContext, userId: number, spaceId: number, data: Uint8Array, folder = ''): DocImportPreviewDTO {
  forgetExpired();
  ctx.docRooms.flushSpace(spaceId);
  const { files, folders, ignored, exportId } = readArchive(ctx, spaceId, data, folder);
  const base = originalTexts(ctx, userId, spaceId, exportId, [...files.keys()]);
  const entries = new Map<string, PendingEntry>();
  for (const [relative, bytes] of files) {
    const entry = analyseFile(ctx, spaceId, relative, bytes, base.get(relative));
    if (entry) entries.set(relative, entry);
    else ignored.push(relative);
  }
  // Exportés puis retirés de l'archive : proposés à la suppression, jamais supprimés d'office.
  for (const relative of base.keys()) {
    if (folder && !relative.startsWith(`${folder}/`)) continue;
    const node = findNodeByPath(ctx.db, spaceId, relative);
    if (node && !files.has(node.path)) entries.set(node.path, { path: node.path, kind: 'markdown', status: 'removed', merged: null, incoming: null });
  }
  return register(userId, spaceId, entries, folders, ignored);
}

/** Analyse le fichier réimporté sur une note ou une image précise, quel que soit son nom sur le disque. */
export function previewFileImport(ctx: AppContext, userId: number, node: NodeRow, data: Uint8Array): DocImportPreviewDTO {
  forgetExpired();
  ctx.docRooms.flushSpace(node.space_id);
  const base = originalTexts(ctx, userId, node.space_id, null, [node.path]);
  const entry = analyseFile(ctx, node.space_id, node.path, data, base.get(node.path));
  if (!entry) throw badRequest(node.kind === 'image' ? 'Image invalide (PNG, JPEG, WebP ou GIF).' : 'Fichier trop volumineux.');
  return register(userId, node.space_id, new Map([[node.path, entry]]), [], []);
}

export interface ImportDecision {
  path: string;
  action: DocImportAction;
  /** Texte final d'un conflit résolu à la main. */
  content?: string;
}

export function applyImport(ctx: AppContext, actor: Actor, spaceId: number, importId: string, decisions: ImportDecision[]): { written: number; deleted: number } {
  forgetExpired();
  const plan = pending.get(importId);
  if (!plan || plan.spaceId !== spaceId || plan.userId !== actor.userId) throw notFound('Import introuvable ou expiré : relancez-le.');
  let written = 0;
  let deleted = 0;
  for (const folder of plan.folders) putImportedFolder(ctx, actor, spaceId, folder);
  for (const decision of decisions) {
    const entry = plan.entries.get(decision.path);
    if (!entry || decision.action === 'keep') continue;
    if (decision.action === 'delete') {
      const node = findNodeByPath(ctx.db, spaceId, entry.path);
      if (node) deleteNode(ctx, actor, node.id);
      deleted += 1;
      continue;
    }
    if (entry.incoming === null) continue;
    if (decision.action === 'both') {
      const dot = entry.path.lastIndexOf('.');
      putImported(ctx, actor, spaceId, uniquePath(ctx.db, spaceId, `${entry.path.slice(0, dot)} (import)${entry.path.slice(dot)}`), entry.incoming);
    } else if (decision.action === 'incoming') {
      putImported(ctx, actor, spaceId, entry.path, entry.incoming);
    } else {
      putImported(ctx, actor, spaceId, entry.path, decision.content ?? entry.merged ?? entry.incoming);
    }
    written += 1;
  }
  pending.delete(importId);
  ctx.docRooms.publishTree(spaceId);
  ctx.logger.info('docs', `Import dans un espace de documentation : ${written} fichier(s) écrit(s), ${deleted} supprimé(s)`, { spaceId }, actor.userId);
  return { written, deleted };
}
