import fs from 'node:fs';
import { sniffImageMime } from '../../shared/attachments.ts';
import { extractDocImages, resolveDocLink, rewriteDocImages } from '../../shared/docLinks.ts';
import { docBaseName, type DocNodeDTO, type DocVersionFileDTO } from '../../shared/docs.ts';
import type { Actor, AppContext } from '../context.ts';
import type { Db } from '../db/database.ts';
import { collectFrozen, contentHash, freezeBytes, readFrozen } from '../services/frozenFiles.ts';
import { addImageFile, findNodeByPath, readBytes, storedImageFile, type NodeRow } from './store.ts';

/**
 * Images figées d'une version étiquetée d'une note : à l'étiquetage, une copie des images que la note montre, telles
 * qu'elles étaient à la date de la version (une image remplacée ou supprimée depuis est reprise de la corbeille). La
 * version étiquetée les affiche ensuite, même si l'image change ; copiée dans une nouvelle note ou restaurée, elle
 * remet dans l'espace celles qui ont changé ou disparu, et ses liens les suivent.
 */

interface ImageRow {
  id: number;
  space_id: number;
  path: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

const asNode = (row: Pick<ImageRow, 'id' | 'space_id' | 'path' | 'updated_at' | 'deleted_at'>): DocNodeDTO => ({
  id: row.id,
  spaceId: row.space_id,
  path: row.path,
  kind: 'image',
  size: 0,
  updatedAt: row.updated_at,
  updatedBy: null,
  deletedAt: row.deleted_at,
  memo: '',
  icon: null,
  color: null,
});

/**
 * Images de l'espace telles qu'elles étaient à la date `at` (ou aujourd'hui, `null`), une par chemin. Pour un chemin
 * dont l'image a été remplacée depuis, l'ancienne (gardée dans la corbeille) l'emporte : c'est elle que la note montrait.
 */
function imagesAt(ctx: AppContext, spaceId: number, at: string | null): ImageRow[] {
  const rows = ctx.db.all<ImageRow>("SELECT id, space_id, path, created_at, updated_at, deleted_at FROM doc_nodes WHERE space_id = ? AND kind = 'image'", spaceId);
  const best = new Map<string, { row: ImageRow; score: number }>();
  for (const row of rows) {
    let score: number;
    if (at === null) {
      if (row.deleted_at) continue;
      score = 1;
    } else {
      if (row.created_at > at || (row.deleted_at && row.deleted_at <= at)) continue;
      // Dans la corbeille, non modifiée depuis `at` : le contenu d'alors (image remplacée ensuite) ; sinon l'image en place.
      score = row.deleted_at ? (row.updated_at <= at ? 3 : 1) : 2;
    }
    const key = row.path.toLowerCase();
    const known = best.get(key);
    if (!known || score > known.score) best.set(key, { row, score });
  }
  return [...best.values()].map((entry) => entry.row);
}

/** Fige les images que montre la version (`at` : sa date, ou `null` pour l'état actuel de l'espace). */
export function freezeDocVersion(ctx: AppContext, note: NodeRow, versionId: number, content: string, at: string | null): number {
  const images = imagesAt(ctx, note.space_id, at);
  const nodes = images.map(asNode);
  const frozen = new Set<string>();
  for (const link of extractDocImages(content)) {
    const found = resolveDocLink(nodes, note.path, link);
    if (!found || frozen.has(found.path.toLowerCase())) continue;
    const row = images.find((image) => image.id === found.id)!;
    let data: Buffer;
    try {
      data = fs.readFileSync(storedImageFile(ctx, row));
    } catch {
      continue;
    }
    const mime = sniffImageMime(data.subarray(0, 16));
    if (!mime) continue;
    ctx.db.run('INSERT OR IGNORE INTO doc_version_files (version_id, path, hash) VALUES (?, ?, ?)', versionId, row.path, freezeBytes(ctx, data, mime));
    frozen.add(row.path.toLowerCase());
  }
  return frozen.size;
}

/** L'étiquette est retirée : la version ne garde plus ses images. */
export function thawDocVersion(ctx: AppContext, versionId: number): void {
  if (ctx.db.run('DELETE FROM doc_version_files WHERE version_id = ?', versionId).changes) collectFrozen(ctx);
}

export function docVersionFiles(db: Db, versionId: number): DocVersionFileDTO[] {
  return db
    .all<{ id: number; path: string }>('SELECT id, path FROM doc_version_files WHERE version_id = ? ORDER BY path COLLATE NOCASE', versionId)
    .map((row) => ({ id: row.id, path: row.path, url: `/api/documentation/version-files/${row.id}` }));
}

/** Image figée (son contenu) et la version qui la garde, ou `null`. */
export function docVersionFile(ctx: AppContext, fileId: number): { versionId: number; path: string; mime: string; data: Buffer } | null {
  const row = ctx.db.get<{ version_id: number; path: string; hash: string }>('SELECT version_id, path, hash FROM doc_version_files WHERE id = ?', fileId);
  const frozen = row ? readFrozen(ctx, row.hash) : null;
  return row && frozen ? { versionId: row.version_id, path: row.path, ...frozen } : null;
}

/** `Pictures/schema.png` → `Pictures/schema (v1.0).png`. */
function taggedName(relative: string, tag: string): string {
  const base = docBaseName(relative);
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? relative.slice(0, relative.length - base.length + dot) : relative;
  return `${stem} (${tag.replace(/[\\/:*?"<>|]/g, '-')})${dot > 0 ? relative.slice(stem.length) : ''}`;
}

/**
 * Texte d'une version étiquetée prêt à écrire dans `notePath` (copie ou restauration) : ses images figées qui ont
 * disparu reviennent à leur place, celles qui ont changé depuis reviennent à côté (« schema (v1.0).png »), et les liens
 * du texte vont vers elles. Les images inchangées restent celles de l'espace.
 */
export function withFrozenImages(ctx: AppContext, actor: Actor, note: NodeRow, versionId: number, content: string, notePath: string): string {
  const files = ctx.db.all<{ path: string; hash: string }>('SELECT path, hash FROM doc_version_files WHERE version_id = ?', versionId);
  if (!files.length) return content;
  const tag = ctx.db.get<{ tag: string | null }>('SELECT tag FROM doc_versions WHERE id = ?', versionId)?.tag ?? 'version';
  const moved = new Map<string, string>();
  /** Une image de l'espace à ce chemin, avec exactement ce contenu. */
  const same = (relative: string, hash: string): boolean => {
    const node = findNodeByPath(ctx.db, note.space_id, relative);
    const bytes = node?.kind === 'image' ? readBytes(ctx, node) : null;
    return Boolean(bytes && contentHash(bytes) === hash);
  };
  for (const file of files) {
    if (same(file.path, file.hash)) continue;
    const tagged = taggedName(file.path, tag);
    // Déjà revenue lors d'une copie ou d'une restauration précédente : la même.
    if (same(tagged, file.hash)) {
      moved.set(file.path.toLowerCase(), findNodeByPath(ctx.db, note.space_id, tagged)!.path);
      continue;
    }
    const frozen = readFrozen(ctx, file.hash);
    if (!frozen) continue;
    const taken = Boolean(findNodeByPath(ctx.db, note.space_id, file.path));
    const placed = addImageFile(ctx, actor, note.space_id, taken ? tagged : file.path, frozen.data);
    if (placed.toLowerCase() !== file.path.toLowerCase()) moved.set(file.path.toLowerCase(), placed);
  }
  if (!moved.size) return content;
  const targets = files.map((file, index) => asNode({ id: -(index + 1), space_id: note.space_id, path: file.path, updated_at: '', deleted_at: null }));
  return rewriteDocImages(content, notePath, (target) => {
    const found = resolveDocLink(targets, note.path, target);
    return found ? (moved.get(found.path.toLowerCase()) ?? null) : null;
  });
}
