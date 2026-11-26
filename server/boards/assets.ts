import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeFileName, sniffImageMime } from '../../shared/attachments.ts';
import { BOARD_ASSET_LIMITS, BOARD_ICON_LIMITS, type BoardAssetDTO, type BoardElement, type BoardIconDTO } from '../../shared/boards.ts';
import type { Actor, AppContext } from '../context.ts';
import { nowIso, type Db } from '../db/database.ts';
import { badRequest, conflict, notFound } from '../http/errors.ts';
import { collectFrozen, freezeBytes, frozenBoardFile } from '../services/frozenFiles.ts';

/**
 * Fichiers des tableaux blancs : images et SVG envoyés dans un espace (réutilisables dans tous ses tableaux) et icônes
 * ajoutées par les administrateurs (proposées partout). Un fichier d'espace se lit par sa clé, longue et aléatoire :
 * c'est elle qui donne l'accès, ce qui permet de l'afficher aussi aux visiteurs d'un tableau partagé.
 */

interface AssetRow {
  id: number;
  space_id: number;
  key: string;
  name: string;
  mime: string;
  size: number;
  created_by: number | null;
  created_at: string;
}

interface IconRow {
  id: number;
  name: string;
  svg: string;
  created_by: number | null;
  created_at: string;
}

const toAsset = (row: AssetRow): BoardAssetDTO => ({ id: row.id, spaceId: row.space_id, key: row.key, name: row.name, mime: row.mime, size: row.size, createdBy: row.created_by, createdAt: row.created_at });
const toIcon = (row: Pick<IconRow, 'id' | 'name' | 'created_at'>): BoardIconDTO => ({ id: row.id, name: row.name, createdAt: row.created_at });

const assetsDir = (ctx: AppContext): string => path.join(ctx.uploadsDir, 'board-assets');
export const assetFile = (ctx: AppContext, key: string): string => path.join(assetsDir(ctx), key);

/** Le texte commence par une balise `<svg>` (après une éventuelle déclaration XML, des commentaires, un DOCTYPE). */
export function looksLikeSvg(text: string): boolean {
  return /^﻿?\s*(<\?xml[^>]*>\s*)?((<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)\s*)*<svg[\s>]/i.test(text);
}

/** Refuse un SVG qui embarque du script ou du contenu externe ; renvoie le texte s'il convient. */
export function checkSvg(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) > maxBytes) throw badRequest(`Ce SVG dépasse ${Math.round(maxBytes / 1024)} Ko.`);
  if (!looksLikeSvg(text)) throw badRequest('Ce fichier n’est pas un SVG.');
  if (/<script|<foreignObject|<iframe|<embed|<object|\son[a-z]+\s*=|javascript:|<!ENTITY/i.test(text)) throw badRequest('SVG refusé : il contient du script ou du contenu externe.');
  return text.trim();
}

// --- Images d'un espace ----------------------------------------------------------------------------------------------

export function listAssets(db: Db, spaceId: number): BoardAssetDTO[] {
  return db.all<AssetRow>('SELECT * FROM board_assets WHERE space_id = ? ORDER BY created_at DESC, id DESC', spaceId).map(toAsset);
}

export function requireAsset(db: Db, assetId: number): BoardAssetDTO {
  const row = db.get<AssetRow>('SELECT * FROM board_assets WHERE id = ?', assetId);
  if (!row) throw notFound('Image introuvable.');
  return toAsset(row);
}

export function assetByKey(db: Db, key: string): BoardAssetDTO | null {
  const row = db.get<AssetRow>('SELECT * FROM board_assets WHERE key = ?', key);
  return row ? toAsset(row) : null;
}

/** Range une image (PNG, JPEG, WebP, GIF) ou un SVG dans l'espace. */
export function storeAsset(ctx: AppContext, actor: Actor, spaceId: number, rawName: string, data: Buffer): BoardAssetDTO {
  if (!data.length) throw badRequest('Fichier vide.');
  const count = ctx.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM board_assets WHERE space_id = ?', spaceId)?.count ?? 0;
  if (count >= BOARD_ASSET_LIMITS.perSpace) throw conflict(`Un espace ne peut pas garder plus de ${BOARD_ASSET_LIMITS.perSpace} images.`);
  let mime: string | null = sniffImageMime(data.subarray(0, 16));
  if (!mime) {
    checkSvg(data.toString('utf8'), BOARD_ASSET_LIMITS.bytes);
    mime = 'image/svg+xml';
  }
  const key = randomBytes(18).toString('base64url');
  fs.mkdirSync(assetsDir(ctx), { recursive: true });
  fs.writeFileSync(assetFile(ctx, key), data);
  const name = sanitizeFileName(rawName || 'image', BOARD_ASSET_LIMITS.nameMax);
  const id = ctx.db.run('INSERT INTO board_assets (space_id, key, name, mime, size, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', spaceId, key, name, mime, data.length, actor.userId, nowIso()).lastInsertRowid;
  return requireAsset(ctx.db, id);
}

/** Retire une image de l'espace (les éléments qui l'affichent montrent alors qu'elle manque). */
export function deleteAsset(ctx: AppContext, asset: BoardAssetDTO): void {
  ctx.db.run('DELETE FROM board_assets WHERE id = ?', asset.id);
  fs.rmSync(assetFile(ctx, asset.key), { force: true });
}

/** Avant de supprimer un espace : ses fichiers sur le disque (les lignes partent avec l'espace). */
export function removeSpaceAssets(ctx: AppContext, spaceId: number): void {
  for (const row of ctx.db.all<{ key: string }>('SELECT key FROM board_assets WHERE space_id = ?', spaceId)) {
    try {
      fs.rmSync(assetFile(ctx, row.key), { force: true });
    } catch (error) {
      ctx.logger.warn('storage', `Suppression impossible de l'image ${row.key}`, { error: String(error) });
    }
  }
}

/** Taille maximale d'une image intégrée à un aperçu, et de l'ensemble des images d'un aperçu. */
const PREVIEW_IMAGE_BYTES = 3 * 1024 * 1024;
const PREVIEW_TOTAL_BYTES = 8 * 1024 * 1024;

/**
 * Images et icônes à intégrer dans l'aperçu d'un tableau (en adresses `data:`, l'aperçu ne chargeant rien d'extérieur).
 * Une image trop lourde, ou au-delà du total permis, garde seulement sa place.
 */
export function previewResources(ctx: AppContext): { image: (key: string) => string | null; customIcon: (id: number) => string | null } {
  const seen = new Map<string, string | null>();
  let total = 0;
  const once = (key: string, load: () => { mime: string; data: Buffer } | null): string | null => {
    if (seen.has(key)) return seen.get(key)!;
    let result: string | null = null;
    try {
      const loaded = load();
      if (loaded && loaded.data.length <= PREVIEW_IMAGE_BYTES && total + loaded.data.length <= PREVIEW_TOTAL_BYTES) {
        total += loaded.data.length;
        result = `data:${loaded.mime};base64,${loaded.data.toString('base64')}`;
      }
    } catch {
      // Fichier manquant : l'aperçu garde la place de l'image.
    }
    seen.set(key, result);
    return result;
  };
  return {
    image: (key) =>
      once(`a:${key}`, () => {
        const asset = assetByKey(ctx.db, key);
        return asset ? { mime: asset.mime, data: fs.readFileSync(assetFile(ctx, asset.key)) } : frozenBoardFile(ctx, `asset:${key}`);
      }),
    customIcon: (id) =>
      once(`i:${id}`, () => {
        const svg = iconSvg(ctx.db, id);
        return svg ? { mime: 'image/svg+xml', data: Buffer.from(svg, 'utf8') } : frozenBoardFile(ctx, `icon:${id}`);
      }),
  };
}

// --- Fichiers figés des versions étiquetées ----------------------------------------------------------------------------

/** Références aux fichiers d'un tableau : `asset:<clé>` (image de l'espace) et `icon:<id>` (icône ajoutée). */
/** Fichiers que montrent des éléments : images de l'espace (`asset:<clé>`) et icônes ajoutées (`icon:<id>`). */
export function boardFileRefs(elements: readonly BoardElement[]): string[] {
  const refs = new Set<string>();
  for (const element of elements) {
    if (element.type === 'image' && element.asset) refs.add(`asset:${element.asset}`);
    else if (element.type === 'icon' && /^custom:\d+$/.test(element.icon)) refs.add(`icon:${element.icon.slice(7)}`);
  }
  return [...refs];
}

/** Contenu d'une image ou d'une icône d'un tableau (`asset:<clé>`, `icon:<id>`) : l'actuel, sinon une copie figée. */
export function boardFile(ctx: AppContext, ref: string): { mime: string; data: Buffer; name: string } | null {
  const [kind, id] = [ref.slice(0, ref.indexOf(':')), ref.slice(ref.indexOf(':') + 1)];
  try {
    if (kind === 'asset') {
      const asset = assetByKey(ctx.db, id);
      if (asset) return { mime: asset.mime, data: fs.readFileSync(assetFile(ctx, asset.key)), name: asset.name };
    } else {
      const icon = ctx.db.get<{ name: string; svg: string }>('SELECT name, svg FROM board_icons WHERE id = ?', Number(id));
      if (icon) return { mime: 'image/svg+xml', data: Buffer.from(icon.svg, 'utf8'), name: icon.name };
    }
  } catch {
    // Fichier manquant : la copie figée, s'il y en a une.
  }
  // Déjà supprimé, mais figé par une version étiquetée ou une étiquette d'espace : la même copie.
  return frozenBoardFile(ctx, ref);
}

/**
 * Fige les images et les icônes ajoutées d'une version qui reçoit une étiquette : elles restent visibles dans cette
 * version (mode Historique, aperçu, copie, restauration) même si on les supprime ensuite. Rend le nombre de fichiers figés.
 */
export function freezeBoardFiles(ctx: AppContext, versionId: number, elements: readonly BoardElement[]): number {
  let count = 0;
  for (const ref of boardFileRefs(elements)) {
    const file = boardFile(ctx, ref);
    if (!file) continue;
    ctx.db.run('INSERT OR IGNORE INTO board_version_files (version_id, ref, name, hash) VALUES (?, ?, ?, ?)', versionId, ref, file.name, freezeBytes(ctx, file.data, file.mime));
    count += 1;
  }
  return count;
}

/** L'étiquette est retirée : la version ne garde plus ses fichiers. */
export function thawBoardFiles(ctx: AppContext, versionId: number): void {
  if (ctx.db.run('DELETE FROM board_version_files WHERE version_id = ?', versionId).changes) collectFrozen(ctx);
}

/**
 * Restauration ou copie d'une version : les images supprimées depuis de l'espace, mais figées par une version
 * étiquetée, y reviennent sous la même clé (les éléments les retrouvent tels quels). Rend leur nombre.
 */
export function reviveFrozenAssets(ctx: AppContext, actor: Actor, spaceId: number, elements: readonly BoardElement[]): number {
  let count = 0;
  for (const ref of boardFileRefs(elements)) {
    if (!ref.startsWith('asset:')) continue;
    const key = ref.slice(6);
    if (assetByKey(ctx.db, key)) continue;
    const frozen = frozenBoardFile(ctx, ref);
    if (!frozen) continue;
    fs.mkdirSync(assetsDir(ctx), { recursive: true });
    fs.writeFileSync(assetFile(ctx, key), frozen.data);
    ctx.db.run('INSERT INTO board_assets (space_id, key, name, mime, size, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', spaceId, key, frozen.name || 'image', frozen.mime, frozen.data.length, actor.userId, nowIso());
    count += 1;
  }
  return count;
}

// --- Icônes ajoutées par les administrateurs --------------------------------------------------------------------------

export function listIcons(db: Db): BoardIconDTO[] {
  return db.all<IconRow>('SELECT id, name, created_at FROM board_icons ORDER BY name COLLATE NOCASE, id').map(toIcon);
}

export function iconSvg(db: Db, iconId: number): string | null {
  return db.get<{ svg: string }>('SELECT svg FROM board_icons WHERE id = ?', iconId)?.svg ?? null;
}

export function addIcon(ctx: AppContext, actor: Actor, name: string, svg: string): BoardIconDTO {
  const count = ctx.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM board_icons')?.count ?? 0;
  if (count >= BOARD_ICON_LIMITS.count) throw conflict(`La bibliothèque ne peut pas garder plus de ${BOARD_ICON_LIMITS.count} icônes ajoutées.`);
  const text = checkSvg(svg, BOARD_ICON_LIMITS.svgBytes);
  const label = name.trim().slice(0, BOARD_ICON_LIMITS.nameMax) || 'icône';
  const id = ctx.db.run('INSERT INTO board_icons (name, svg, created_by, created_at) VALUES (?, ?, ?, ?)', label, text, actor.userId, nowIso()).lastInsertRowid;
  return toIcon(ctx.db.get<IconRow>('SELECT id, name, created_at FROM board_icons WHERE id = ?', id)!);
}

export function deleteIcon(db: Db, iconId: number): void {
  if (!db.run('DELETE FROM board_icons WHERE id = ?', iconId).changes) throw notFound('Icône introuvable.');
}
