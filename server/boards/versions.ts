import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { BOARD_VERSION_LIMITS, type BoardElement, type BoardVersionDTO, type BoardVersionKind } from '../../shared/boards.ts';
import { nowIso, type Db } from '../db/database.ts';
import { sanitizeElements } from './elements.ts';

/**
 * Historique d'un tableau blanc : une version (les éléments, compressés) à chaque enregistrement. Les enregistrements
 * rapprochés d'une même personne se rangent dans la même version, qui garde le dernier état ; une restauration a
 * toujours la sienne. Le mode « Historique » de l'éditeur les parcourt.
 */

interface VersionRow {
  id: number;
  board_id: number;
  user_id: number | null;
  kind: BoardVersionKind;
  element_count: number;
  hash: string;
  created_at: string;
  tag: string | null;
  tagged_at: string | null;
}

const COLUMNS = 'id, board_id, user_id, kind, element_count, hash, created_at, tag, tagged_at';

const toDTO = (row: VersionRow): BoardVersionDTO => ({ id: row.id, createdAt: row.created_at, userId: row.user_id, kind: row.kind, elementCount: row.element_count, tag: row.tag, taggedAt: row.tagged_at });

/** Empreinte du contenu d'un tableau, quel que soit l'ordre de ses éléments (une salle d'édition a le sien). */
export function elementsHash(json: string): string {
  let canonical = json;
  try {
    const list = JSON.parse(json) as Array<{ id?: string }>;
    list.sort((a, b) => ((a.id ?? '') < (b.id ?? '') ? -1 : (a.id ?? '') > (b.id ?? '') ? 1 : 0));
    canonical = JSON.stringify(list);
  } catch {
    // Contenu illisible : son empreinte brute.
  }
  return createHash('sha1').update(canonical).digest('hex');
}

const lastVersion = (db: Db, boardId: number): VersionRow | undefined => db.get<VersionRow>(`SELECT ${COLUMNS} FROM board_versions WHERE board_id = ? ORDER BY id DESC LIMIT 1`, boardId);

function insert(db: Db, boardId: number, json: string, hash: string, count: number, userId: number | null, kind: BoardVersionKind, at: string): number {
  return db.run('INSERT INTO board_versions (board_id, user_id, kind, element_count, hash, elements, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', boardId, userId, kind, count, hash, gzipSync(json), at).lastInsertRowid;
}

/**
 * Note l'état d'un tableau dans son historique. Sans changement depuis la dernière version, rien n'est ajouté ; une
 * modification qui suit de près celle de la même personne complète sa version au lieu d'en créer une.
 */
export function recordBoardVersion(db: Db, boardId: number, json: string, count: number, userId: number | null, kind: BoardVersionKind = 'edit', now = Date.now()): void {
  const last = lastVersion(db, boardId);
  const hash = elementsHash(json);
  if (last?.hash === hash) return;
  // Une version étiquetée ne change plus : la modification suivante a toujours la sienne.
  if (last && !last.tag && kind === 'edit' && last.kind === 'edit' && last.user_id === userId && now - Date.parse(last.created_at) < BOARD_VERSION_LIMITS.mergeMs) {
    db.run('UPDATE board_versions SET element_count = ?, hash = ?, elements = ? WHERE id = ?', count, hash, gzipSync(json), last.id);
    return;
  }
  insert(db, boardId, json, hash, count, userId, kind, new Date(now).toISOString());
  // Au-delà de la limite, les plus anciennes versions partent, sauf les versions étiquetées.
  db.run(
    'DELETE FROM board_versions WHERE board_id = ? AND tag IS NULL AND id NOT IN (SELECT id FROM board_versions WHERE board_id = ? AND tag IS NULL ORDER BY id DESC LIMIT ?)',
    boardId,
    boardId,
    BOARD_VERSION_LIMITS.perBoard,
  );
}

/** Avant la première version d'un tableau qui avait déjà un contenu : ce contenu, à la date de son dernier enregistrement. */
export function recordBoardBaseline(db: Db, boardId: number, json: string, count: number, userId: number | null, at: string | null): void {
  if (!count || lastVersion(db, boardId)) return;
  insert(db, boardId, json, elementsHash(json), count, userId, 'edit', at ?? nowIso());
}

export function listBoardVersions(db: Db, boardId: number): BoardVersionDTO[] {
  return db.all<VersionRow>(`SELECT ${COLUMNS} FROM board_versions WHERE board_id = ? ORDER BY id`, boardId).map(toDTO);
}

/** Version dont le contenu est exactement `json` (l'état actuel du tableau), si c'est la dernière. */
export function matchingVersion(db: Db, boardId: number, json: string): number | null {
  const last = lastVersion(db, boardId);
  return last && last.hash === elementsHash(json) ? last.id : null;
}

export function readBoardVersion(db: Db, boardId: number, versionId: number): { version: BoardVersionDTO; elements: BoardElement[] } | null {
  const row = db.get<VersionRow & { elements: Uint8Array }>(`SELECT ${COLUMNS}, elements FROM board_versions WHERE id = ? AND board_id = ?`, versionId, boardId);
  if (!row) return null;
  let elements: BoardElement[] = [];
  try {
    elements = sanitizeElements(JSON.parse(gunzipSync(row.elements).toString('utf8')) as unknown[]);
  } catch {
    // Version illisible : un tableau vide plutôt qu'une erreur.
  }
  return { version: toDTO(row), elements };
}

/** Version de l'état actuel (`json`) : la dernière si elle est identique, sinon une nouvelle. */
export function currentBoardVersion(db: Db, boardId: number, json: string, count: number, userId: number | null): number {
  const last = lastVersion(db, boardId);
  const hash = elementsHash(json);
  return last && last.hash === hash ? last.id : insert(db, boardId, json, hash, count, userId, 'edit', nowIso());
}

/** Pose (ou retire, `null`) l'étiquette d'une version ; `false` si une autre version de ce tableau porte déjà ce nom. */
export function setBoardVersionTag(db: Db, boardId: number, versionId: number, name: string | null, userId: number | null): boolean {
  if (name !== null && db.get('SELECT id FROM board_versions WHERE board_id = ? AND tag = ? COLLATE NOCASE AND id != ?', boardId, name, versionId)) return false;
  db.run('UPDATE board_versions SET tag = ?, tagged_by = ?, tagged_at = ? WHERE id = ? AND board_id = ?', name, name === null ? null : userId, name === null ? null : nowIso(), versionId, boardId);
  return true;
}

export function boardVersionById(db: Db, boardId: number, versionId: number): BoardVersionDTO | null {
  const row = db.get<VersionRow>(`SELECT ${COLUMNS} FROM board_versions WHERE id = ? AND board_id = ?`, versionId, boardId);
  return row ? toDTO(row) : null;
}
