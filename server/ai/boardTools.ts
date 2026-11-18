import type { AiChangeDTO } from '../../shared/ai.ts';
import { boundsOf } from '../../shared/boardGeometry.ts';
import { exportMermaid, mermaidToElements } from '../../shared/boardMermaid.ts';
import { BOARD_COLORS, boardTitle, elementText, isPlaced, newElementId, type BoardColor, type BoardElement, type StickyElement } from '../../shared/boards.ts';
import { createBoardNode, listBoardSpaces, patchBoardElements, readBoardElements, requireBoard, requireBoardSpace, searchBoards, type BoardNodeRow } from '../boards/store.ts';
import { badRequest } from '../http/errors.ts';
import { clip, PROPOSED, record, type ToolContext, type ToolDefinition } from './toolKit.ts';

/**
 * Outils de l'assistant sur les tableaux blancs : chercher et lire un tableau, y dessiner (Mermaid), poser des post-it,
 * modifier ou retirer des éléments, créer un tableau. Les droits de la personne dans l'espace sont revérifiés à chaque
 * appel ; une modification s'annule depuis le panneau.
 */

const BOARD = { type: 'integer', description: 'Identifiant du tableau blanc (voir « list_boards » ou le contexte).' };
const COLOR = { type: 'string', enum: [...BOARD_COLORS] };
const MAX_LISTED = 300;

function boardOf(tool: ToolContext, value: unknown, write: boolean): BoardNodeRow {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('Identifiant de tableau invalide.');
  return requireBoard(tool.ctx, tool.user, id, write ? 'editor' : 'reader').node;
}

const round = (value: number): number => Math.round(value);

/** Un élément en quelques champs lisibles par le modèle. */
function describe(element: BoardElement): Record<string, unknown> {
  const text = clip(elementText(element), 300);
  const base: Record<string, unknown> = { id: element.id, type: element.type, ...(text ? { text } : {}), ...(element.group ? { group: element.group } : {}) };
  if (element.type === 'connector') return { ...base, from: element.from.id, to: element.to.id, color: element.color };
  const placed: Record<string, unknown> = { ...base, x: round(element.x), y: round(element.y), w: round(element.w), h: round(element.h) };
  if ('color' in element) placed.color = element.color;
  if (element.type === 'shape') placed.shape = element.shape;
  if (element.type === 'mind') placed.parent = element.parent;
  if (element.type === 'fast') placed.ref = element.ref;
  if (element.type === 'icon') placed.icon = element.icon;
  if (element.type === 'sticky' && element.votes.length) placed.votes = element.votes.length;
  if (element.tpl) placed.template = element.tpl.id;
  return placed;
}

/** À droite de ce qui existe déjà (ou à l'origine d'un tableau vide). */
function freeSpot(elements: readonly BoardElement[]): { x: number; y: number } {
  const bounds = boundsOf(elements, new Map(elements.map((element) => [element.id, element])));
  return bounds ? { x: Math.round((bounds.x + bounds.w + 120) / 8) * 8, y: Math.round(bounds.y / 8) * 8 } : { x: 0, y: 0 };
}

const nextZ = (elements: readonly BoardElement[]): number => Math.max(0, ...elements.map((element) => element.z)) + 1;

/** Résumé lisible d'une liste d'éléments : leurs textes. */
const summary = (elements: readonly BoardElement[]): string => {
  const texts = elements.map(elementText).filter(Boolean);
  const listed = texts.slice(0, 6).map((entry) => `« ${clip(entry, 40)} »`).join(', ');
  return `${elements.length} élément${elements.length > 1 ? 's' : ''}${listed ? ` : ${listed}${texts.length > 6 ? '…' : ''}` : ''}`;
};

/** Applique (ou propose) un changement d'éléments et l'enregistre pour le panneau. */
function changeBoard(tool: ToolContext, node: BoardNodeRow, label: string, before: BoardElement[], after: BoardElement[]): unknown {
  const title = boardTitle(node.path);
  const diff: AiChangeDTO['diff'] = [
    { field: 'Tableau', from: null, to: title },
    ...(before.length ? [{ field: after.length ? 'Avant' : 'Retirés', from: summary(before), to: null }] : []),
    ...(after.length ? [{ field: before.length ? 'Après' : 'Ajoutés', from: null, to: summary(after) }] : []),
  ];
  const change = { label: `${label} (« ${title} »)`, projectId: null, ticketKey: null, diff, action: { kind: 'board.elements' as const, boardId: node.id, before, after } };
  if (tool.propose) {
    record(tool, change);
    return PROPOSED;
  }
  const kept = new Set(after.map((element) => element.id));
  patchBoardElements(tool.ctx, tool.actor, node, after, before.filter((element) => !kept.has(element.id)).map((element) => element.id));
  record(tool, change);
  return { ok: true, elements: after.map((element) => element.id) };
}

export const BOARD_TOOLS: ToolDefinition[] = [
  {
    name: 'list_boards',
    description: 'Cherche les tableaux blancs accessibles (nom, chemin ou texte des éléments) ; sans recherche, les espaces et les tableaux récents.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Texte cherché (facultatif).' } } },
    write: false,
    boards: true,
    label: (args) => (args.query ? `Recherche de tableaux « ${clip(String(args.query), 40)} »` : 'Liste des tableaux blancs'),
    run: (tool, args) => ({
      spaces: listBoardSpaces(tool.ctx, tool.user).map((space) => ({ id: space.id, name: space.name, role: space.role, boards: space.boardCount })),
      boards: searchBoards(tool.ctx, tool.user, String(args.query ?? ''), 30),
    }),
  },
  {
    name: 'read_board',
    description: 'Lit un tableau blanc : ses éléments (id, type, texte, position, couleur, liens, groupe) et sa structure en Mermaid.',
    parameters: { type: 'object', properties: { board: BOARD }, required: ['board'] },
    write: false,
    boards: true,
    label: () => 'Lecture d’un tableau blanc',
    run: (tool, args) => {
      const node = boardOf(tool, args.board, false);
      const elements = readBoardElements(tool.ctx, node);
      return {
        board: { id: node.id, title: boardTitle(node.path), path: node.path, kind: node.kind, count: elements.length },
        elements: elements.slice(0, MAX_LISTED).map(describe),
        ...(elements.length > MAX_LISTED ? { truncated: true } : {}),
        mermaid: clip(exportMermaid(elements), 6000),
      };
    },
  },
  {
    name: 'draw_on_board',
    description:
      'Dessine un diagramme sur un tableau blanc à partir de Mermaid : organigramme (`flowchart LR` / `graph TD`, nœuds, liens, sous-graphes) ou carte mentale (`mindmap`). Il est posé à droite de ce qui existe déjà, mis en page automatiquement.',
    parameters: { type: 'object', properties: { board: BOARD, mermaid: { type: 'string', description: 'Texte Mermaid (sans les ```).' } }, required: ['board', 'mermaid'] },
    write: true,
    boards: true,
    label: () => 'Dessin sur un tableau blanc',
    run: (tool, args) => {
      const node = boardOf(tool, args.board, true);
      const current = readBoardElements(tool.ctx, node);
      const created = mermaidToElements(String(args.mermaid ?? ''), freeSpot(current), { zStart: nextZ(current) });
      if (!created.length) throw badRequest('Ce Mermaid ne donne aucun élément.');
      return changeBoard(tool, node, 'Dessin', [], created);
    },
  },
  {
    name: 'add_sticky_notes',
    description: 'Pose des post-it sur un tableau blanc (atelier, rétrospective, idées), en grille, à droite de ce qui existe.',
    parameters: {
      type: 'object',
      properties: { board: BOARD, notes: { type: 'array', items: { type: 'string' }, maxItems: 50, description: 'Texte de chaque post-it.' }, color: { ...COLOR, description: 'Couleur (jaune par défaut).' } },
      required: ['board', 'notes'],
    },
    write: true,
    boards: true,
    label: (args) => `Ajout de ${Array.isArray(args.notes) ? args.notes.length : ''} post-it`,
    run: (tool, args) => {
      const node = boardOf(tool, args.board, true);
      const notes = (Array.isArray(args.notes) ? args.notes : []).map((note) => String(note).trim()).filter(Boolean).slice(0, 50);
      if (!notes.length) throw badRequest('Aucun post-it à poser.');
      const color = BOARD_COLORS.includes(args.color as BoardColor) ? (args.color as BoardColor) : 'yellow';
      const current = readBoardElements(tool.ctx, node);
      const spot = freeSpot(current);
      let z = nextZ(current);
      const created = notes.map((text, index): StickyElement => ({ id: newElementId(), type: 'sticky', z: z++, x: spot.x + (index % 4) * 204, y: spot.y + Math.floor(index / 4) * 204, w: 180, h: 180, text, color, votes: [] }));
      return changeBoard(tool, node, 'Post-it', [], created);
    },
  },
  {
    name: 'edit_board_element',
    description: 'Change le texte (ou le titre d’une section, l’étiquette d’un lien) et/ou la couleur d’un élément d’un tableau blanc. Lis le tableau d’abord pour connaître les identifiants.',
    parameters: { type: 'object', properties: { board: BOARD, element: { type: 'string', description: 'Identifiant de l’élément.' }, text: { type: 'string' }, color: COLOR }, required: ['board', 'element'] },
    write: true,
    boards: true,
    label: () => 'Modification d’un élément',
    run: (tool, args) => {
      const node = boardOf(tool, args.board, true);
      const current = readBoardElements(tool.ctx, node).find((element) => element.id === String(args.element));
      if (!current) throw badRequest('Élément introuvable sur ce tableau.');
      const next = { ...current } as BoardElement & Record<string, unknown>;
      if (typeof args.text === 'string') {
        const key = current.type === 'frame' ? 'title' : current.type === 'connector' ? 'label' : 'text';
        if (!(key in current)) throw badRequest('Cet élément ne porte pas de texte.');
        next[key] = args.text;
      }
      if (typeof args.color === 'string') {
        if (!BOARD_COLORS.includes(args.color as BoardColor) || !('color' in current)) throw badRequest('Couleur impossible pour cet élément.');
        next.color = args.color;
      }
      return changeBoard(tool, node, 'Modification', [current], [next]);
    },
  },
  {
    name: 'delete_board_elements',
    description: 'Retire des éléments d’un tableau blanc (les liens qui y sont accrochés partent avec eux).',
    parameters: { type: 'object', properties: { board: BOARD, elements: { type: 'array', items: { type: 'string' }, maxItems: 500, description: 'Identifiants des éléments.' } }, required: ['board', 'elements'] },
    write: true,
    boards: true,
    label: () => 'Suppression d’éléments',
    run: (tool, args) => {
      const node = boardOf(tool, args.board, true);
      const ids = new Set((Array.isArray(args.elements) ? args.elements : []).map(String));
      const current = readBoardElements(tool.ctx, node);
      const removed = current.filter((element) => ids.has(element.id) || (element.type === 'connector' && ((element.from.id && ids.has(element.from.id)) || (element.to.id && ids.has(element.to.id)))));
      if (!removed.length) throw badRequest('Aucun de ces éléments n’est sur ce tableau.');
      return changeBoard(tool, node, 'Suppression', removed, []);
    },
  },
  {
    name: 'create_board',
    description: 'Crée un tableau blanc dans un espace (chemin avec des « / » pour les dossiers), éventuellement déjà dessiné à partir de Mermaid.',
    parameters: {
      type: 'object',
      properties: { space: { type: 'integer', description: 'Identifiant de l’espace de tableaux.' }, path: { type: 'string', description: 'Ex. « Ateliers/Rétro de mars ».' }, mermaid: { type: 'string', description: 'Diagramme de départ (facultatif).' } },
      required: ['space', 'path'],
    },
    write: true,
    boards: true,
    label: (args) => `Création du tableau « ${clip(String(args.path ?? ''), 50)} »`,
    run: (tool, args) => {
      const spaceId = Number(args.space);
      requireBoardSpace(tool.ctx, tool.user, spaceId, 'editor');
      const path = String(args.path ?? '').trim();
      if (!path) throw badRequest('Nom du tableau manquant.');
      const elements = typeof args.mermaid === 'string' && args.mermaid.trim() ? mermaidToElements(args.mermaid, { x: 0, y: 0 }, { zStart: 1 }) : [];
      const base = { label: `Création du tableau « ${clip(path, 60)} »`, projectId: null, ticketKey: null, diff: [{ field: 'Tableau', from: null, to: path }, ...(elements.length ? [{ field: 'Ajoutés', from: null, to: summary(elements.filter(isPlaced)) }] : [])] };
      if (tool.propose) {
        record(tool, { ...base, action: { kind: 'board.create', spaceId, path, elements, nodeId: null } });
        return PROPOSED;
      }
      const node = createBoardNode(tool.ctx, tool.actor, spaceId, { path, kind: 'board', elements });
      record(tool, { ...base, action: { kind: 'board.create', spaceId, path, elements, nodeId: node.id } });
      return { board: { id: node.id, path: node.path } };
    },
  },
];
