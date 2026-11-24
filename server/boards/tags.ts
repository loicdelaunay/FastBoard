import { boardTitle, type BoardVersionDTO } from '../../shared/boards.ts';
import { cleanTagName, VERSION_TAG_LIMITS, type VersionTagHitDTO } from '../../shared/versionTags.ts';
import type { Actor, AppContext } from '../context.ts';
import { badRequest, conflict, notFound } from '../http/errors.ts';
import type { AuthUser } from '../services/access.ts';
import { foldText } from '../services/tickets.ts';
import { boardsEnabled, listBoardSpaces, readBoardElements, type BoardNodeRow } from './store.ts';
import { freezeBoardFiles, thawBoardFiles } from './assets.ts';
import { boardVersionById, currentBoardVersion, readBoardVersion, setBoardVersionTag } from './versions.ts';

/**
 * Étiquettes des versions d'un tableau blanc : comme pour les notes, une version nommée reste dans l'historique, se cite
 * avec `@[Architecture · v2](board:7#v:88)` et s'ouvre dans le mode Historique (lecture seule, copie possible).
 */
export function tagBoardVersion(ctx: AppContext, actor: Actor, node: BoardNodeRow, versionId: number | null, rawName: string | null): BoardVersionDTO {
  const name = rawName === null ? null : cleanTagName(rawName);
  if (versionId === null && name === null) throw badRequest('Donnez un nom à l’étiquette.');
  let id = versionId;
  if (id === null) {
    const elements = readBoardElements(ctx, node);
    id = currentBoardVersion(ctx.db, node.id, JSON.stringify(elements), elements.length, actor.userId);
  }
  const before = boardVersionById(ctx.db, node.id, id);
  if (!before) throw notFound('Version introuvable.');
  if (!setBoardVersionTag(ctx.db, node.id, id, name, actor.userId)) throw conflict('Une autre version porte déjà cette étiquette.');
  // Une version qui reçoit une étiquette fige ses images et ses icônes ajoutées ; sans étiquette, elle les rend.
  if (name !== null && before.tag === null) freezeBoardFiles(ctx, id, readBoardVersion(ctx.db, node.id, id)?.elements ?? []);
  else if (name === null && before.tag !== null) thawBoardFiles(ctx, id);
  ctx.logger.info('boards', name ? `Version étiquetée « ${name} » : ${node.path}` : `Étiquette retirée : ${node.path}`, { boardId: node.id, versionId: id }, actor.userId);
  return boardVersionById(ctx.db, node.id, id)!;
}

/** Étiquettes des tableaux des espaces de la personne, par leur nom ou celui du tableau (`@`). */
export function searchBoardTags(ctx: AppContext, user: AuthUser, query: string): VersionTagHitDTO[] {
  if (!boardsEnabled(ctx.db)) return [];
  const spaces = new Map(listBoardSpaces(ctx, user).map((space) => [space.id, space.name]));
  if (!spaces.size) return [];
  const words = foldText(query).split(/\s+/).filter(Boolean);
  const rows = ctx.db.all<{ id: number; board_id: number; tag: string; created_at: string; path: string; space_id: number }>(
    `SELECT v.id, v.board_id, v.tag, v.created_at, n.path, n.space_id FROM board_versions v JOIN board_nodes n ON n.id = v.board_id
      WHERE v.tag IS NOT NULL AND n.deleted_at IS NULL ORDER BY v.tagged_at DESC`,
  );
  const hits: VersionTagHitDTO[] = [];
  for (const row of rows) {
    const spaceName = spaces.get(row.space_id);
    if (spaceName === undefined) continue;
    const title = boardTitle(row.path);
    if (!words.every((word) => foldText(`${row.tag} ${title}`).includes(word))) continue;
    hits.push({ kind: 'board', id: row.board_id, versionId: row.id, tag: row.tag, title, spaceName, createdAt: row.created_at });
    if (hits.length >= VERSION_TAG_LIMITS.searchResults) break;
  }
  return hits;
}
