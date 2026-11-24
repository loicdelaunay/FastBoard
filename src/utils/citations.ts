import type { RouteLocationRaw } from 'vue-router';
import { citedElementsOf, citedLinesOf, linesParam, type LineRange } from '@shared/citations';
import { useBoardsStore } from '@/stores/boards';
import { useDocsStore } from '@/stores/docs';

/**
 * Ouvrir un élément cité : une note sur ses lignes citées (`?lines=12-18`), un tableau blanc sur ses éléments cités
 * (`?elements=a,b`). Déjà dans l'espace de l'élément, on y reste (pas de rechargement de l'espace).
 */

/** Adresse d'une note, ses lignes citées surlignées, ou une de ses versions étiquetées (lecture seule). */
export function docCitationRoute(nodeId: number, ranges: readonly LineRange[] | null, version: number | null = null): RouteLocationRaw {
  const lines = { ...(ranges?.length ? { lines: linesParam(ranges) } : {}), ...(version ? { version: String(version) } : {}) };
  const docs = useDocsStore();
  const node = docs.space ? docs.nodes.find((entry) => entry.id === nodeId) : undefined;
  return node && docs.space ? { name: 'doc-space', params: { spaceId: docs.space.id }, query: { file: String(nodeId), ...lines } } : { name: 'doc-file', params: { nodeId }, query: lines };
}

/** Adresse d'un tableau blanc, ses éléments cités sélectionnés et cadrés, ou une de ses versions (mode Historique). */
export function boardCitationRoute(boardId: number, elements: readonly string[] | null, version: number | null = null): RouteLocationRaw {
  const focus = { ...(elements?.length ? { elements: elements.join(',') } : {}), ...(version ? { version: String(version) } : {}) };
  const boards = useBoardsStore();
  const node = boards.space ? boards.nodes.find((entry) => entry.id === boardId) : undefined;
  return node && boards.space ? { name: 'board-space', params: { spaceId: boards.space.id }, query: { board: String(boardId), ...focus } } : { name: 'board-file', params: { boardId }, query: focus };
}

/** Où mène un lien de mention rendu (`a.md-mention`) : note, tableau blanc ou projet ; `null` sinon. */
export function citationRoute(link: HTMLElement): RouteLocationRaw | null {
  const version = link.dataset.version ? Number(link.dataset.version) : null;
  if (link.dataset.doc) return docCitationRoute(Number(link.dataset.doc), citedLinesOf(link.dataset.lines ? `L${link.dataset.lines}` : null), version);
  if (link.dataset.board) return boardCitationRoute(Number(link.dataset.board), citedElementsOf(link.dataset.elements ? `el:${link.dataset.elements}` : null), version);
  if (link.dataset.project) return { name: 'project', params: { projectId: link.dataset.project } };
  return null;
}
