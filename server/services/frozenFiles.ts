import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AppContext } from '../context.ts';
import { nowIso } from '../db/database.ts';

/**
 * Pièces jointes figées des versions étiquetées (et des étiquettes d'espace, voir `snapshots.ts`). Quand une note ou un
 * tableau blanc reçoit une étiquette, ses images
 * (et, pour un tableau, ses icônes ajoutées par les administrateurs) sont copiées à part, rangées par leur empreinte
 * dans `uploads/frozen` : la version étiquetée les montre ensuite telles qu'elles étaient, même si l'image est remplacée
 * ou supprimée depuis. Une copie partagée par plusieurs versions n'existe qu'une fois ; elle part quand plus aucune
 * version étiquetée ne la garde.
 */

const frozenDir = (ctx: AppContext): string => path.join(ctx.uploadsDir, 'frozen');
const frozenPath = (ctx: AppContext, hash: string): string => path.join(frozenDir(ctx), hash);

/** Empreinte (SHA-256, en hexadécimal) d'un contenu. */
export function contentHash(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Range une copie de `data` (si elle n'existe pas déjà) et rend son empreinte. */
export function freezeBytes(ctx: AppContext, data: Uint8Array, mime: string): string {
  const hash = contentHash(data);
  const file = frozenPath(ctx, hash);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(frozenDir(ctx), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, data);
    fs.renameSync(temporary, file);
  }
  ctx.db.run('INSERT OR IGNORE INTO frozen_files (hash, mime, size, created_at) VALUES (?, ?, ?, ?)', hash, mime, data.length, nowIso());
  return hash;
}

/** Contenu d'une copie figée, ou `null` si elle n'existe plus. */
export function readFrozen(ctx: AppContext, hash: string): { mime: string; data: Buffer } | null {
  const row = ctx.db.get<{ mime: string }>('SELECT mime FROM frozen_files WHERE hash = ?', hash);
  if (!row) return null;
  try {
    return { mime: row.mime, data: fs.readFileSync(frozenPath(ctx, hash)) };
  } catch {
    return null;
  }
}

/** Efface les copies que plus aucune version étiquetée ni étiquette d'espace ne garde ; rend leur nombre. */
export function collectFrozen(ctx: AppContext): number {
  const orphans = ctx.db.all<{ hash: string }>(
    'SELECT hash FROM frozen_files WHERE hash NOT IN (SELECT hash FROM doc_version_files) AND hash NOT IN (SELECT hash FROM board_version_files) AND hash NOT IN (SELECT hash FROM space_snapshot_files)',
  );
  for (const { hash } of orphans) {
    ctx.db.run('DELETE FROM frozen_files WHERE hash = ?', hash);
    try {
      fs.rmSync(frozenPath(ctx, hash), { force: true });
    } catch (error) {
      ctx.logger.warn('storage', `Suppression impossible de la copie figée ${hash}`, { error: String(error) });
    }
  }
  return orphans.length;
}

/** L'espace (ou le projet) est supprimé : ses étiquettes d'espace partent avec lui, et leurs copies devenues inutiles. */
export function dropSnapshots(ctx: AppContext, kind: 'docs' | 'boards' | 'project', spaceId: number): void {
  if (ctx.db.run('DELETE FROM space_snapshots WHERE kind = ? AND space_id = ?', kind, spaceId).changes) collectFrozen(ctx);
}

// --- Tableaux blancs : références `asset:<clé>` (image de l'espace) et `icon:<id>` (icône ajoutée) -----------------------

/** Copie figée la plus récente d'une image ou d'une icône d'un tableau, gardée par une version étiquetée ou une étiquette d'espace. */
export function frozenBoardFile(ctx: AppContext, ref: string): { mime: string; data: Buffer; name: string } | null {
  const row =
    ctx.db.get<{ hash: string; name: string }>('SELECT hash, name FROM board_version_files WHERE ref = ? ORDER BY version_id DESC LIMIT 1', ref) ??
    ctx.db.get<{ hash: string; name: string }>('SELECT hash, name FROM space_snapshot_files WHERE ref = ? ORDER BY snapshot_id DESC LIMIT 1', ref);
  const frozen = row ? readFrozen(ctx, row.hash) : null;
  return frozen && row ? { ...frozen, name: row.name } : null;
}
