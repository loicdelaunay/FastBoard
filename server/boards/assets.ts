import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeFileName, sniffImageMime } from '../../shared/attachments.ts';
import { BOARD_ASSET_LIMITS, BOARD_ICON_LIMITS, type BoardAssetDTO, type BoardIconDTO } from '../../shared/boards.ts';
import type { Actor, AppContext } from '../context.ts';
import { nowIso, type Db } from '../db/database.ts';
import { badRequest, conflict, notFound } from '../http/errors.ts';

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
