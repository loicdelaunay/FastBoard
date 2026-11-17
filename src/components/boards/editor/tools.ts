import { shapePath } from '@shared/boardGeometry';
import type { BoardAssetDTO, BoardColor, FastRefKind, ShapeKind } from '@shared/boards';

/** Modes et outils de la barre latérale des tableaux blancs. */

export type BoardMode = 'diagram' | 'sticky' | 'mind' | 'draw';

/** Action de la barre de sélection ou du menu contextuel. */
export type SelectionAction =
  | 'duplicate'
  | 'delete'
  | 'front'
  | 'back'
  | 'lock'
  | 'unlock'
  | 'mermaid'
  | 'section'
  | 'add-row'
  | 'add-column'
  | 'chart-from-table'
  | 'chart-data'
  | 'edit-table'
  | 'make-template'
  | 'template-update'
  | 'template-apply'
  | 'template-open'
  | 'template-detach';

/** Ce que l'on ajoute depuis l'ajout rapide (clic droit, barre latérale, touche /). */
export type QuickPick =
  | { kind: 'element'; tool: BoardTool; shape?: ShapeKind }
  | { kind: 'icon'; icon: string }
  | { kind: 'image'; asset: BoardAssetDTO }
  | { kind: 'template'; id: number; name: string }
  | { kind: 'mermaid' };

/** Objet de FastBoard choisi pour un Fast Element. */
export interface FastPick {
  kind: FastRefKind;
  id: number;
  label: string;
}

export type BoardTool =
  | 'select'
  | 'hand'
  | 'shape'
  | 'text'
  | 'connector'
  | 'sticky'
  | 'frame'
  | 'fast'
  | 'table'
  | 'chart'
  | 'mind'
  | 'vote'
  | 'pen'
  | 'highlighter'
  | 'eraser';

export interface ToolDef {
  tool: BoardTool;
  label: string;
  icon: string;
  /** Raccourci clavier (une lettre). */
  key?: string;
  /** Outil d'écriture : caché en lecture seule. */
  edit: boolean;
}

export const MODES: Array<{ mode: BoardMode; label: string; icon: string }> = [
  { mode: 'diagram', label: 'Diagramme', icon: 'pi pi-sitemap' },
  { mode: 'sticky', label: 'Post-it', icon: 'pi pi-clone' },
  { mode: 'mind', label: 'Carte mentale', icon: 'pi pi-share-alt' },
  { mode: 'draw', label: 'Dessin libre', icon: 'pi pi-pencil' },
];

const SELECT: ToolDef = { tool: 'select', label: 'Sélection', icon: 'pi pi-arrow-up-left', key: 'v', edit: false };
const HAND: ToolDef = { tool: 'hand', label: 'Déplacer la vue', icon: 'pi pi-arrows-alt', key: 'h', edit: false };

export const MODE_TOOLS: Record<BoardMode, ToolDef[]> = {
  diagram: [
    SELECT,
    HAND,
    { tool: 'shape', label: 'Forme', icon: 'shape', key: 'r', edit: true },
    { tool: 'text', label: 'Texte', icon: 'pi pi-language', key: 't', edit: true },
    { tool: 'connector', label: 'Lien', icon: 'pi pi-arrow-right', key: 'c', edit: true },
    { tool: 'sticky', label: 'Post-it', icon: 'pi pi-stop', key: 's', edit: true },
    { tool: 'frame', label: 'Section', icon: 'pi pi-th-large', key: 'f', edit: true },
    { tool: 'fast', label: 'Fast Element', icon: 'pi pi-bolt', key: 'e', edit: true },
    { tool: 'table', label: 'Tableau', icon: 'pi pi-table', edit: true },
    { tool: 'chart', label: 'Graphique', icon: 'pi pi-chart-bar', edit: true },
  ],
  sticky: [
    SELECT,
    HAND,
    { tool: 'sticky', label: 'Post-it', icon: 'pi pi-stop', key: 's', edit: true },
    { tool: 'frame', label: 'Section', icon: 'pi pi-th-large', key: 'f', edit: true },
    { tool: 'text', label: 'Texte', icon: 'pi pi-language', key: 't', edit: true },
    { tool: 'vote', label: 'Voter', icon: 'pi pi-thumbs-up', key: 'o', edit: true },
  ],
  mind: [
    SELECT,
    HAND,
    { tool: 'mind', label: 'Nouvelle carte mentale', icon: 'pi pi-share-alt', key: 'm', edit: true },
    { tool: 'text', label: 'Texte', icon: 'pi pi-language', key: 't', edit: true },
    { tool: 'sticky', label: 'Post-it', icon: 'pi pi-stop', key: 's', edit: true },
  ],
  draw: [
    SELECT,
    HAND,
    { tool: 'pen', label: 'Crayon', icon: 'pi pi-pencil', key: 'p', edit: true },
    { tool: 'highlighter', label: 'Surligneur', icon: 'pi pi-palette', key: 'l', edit: true },
    { tool: 'eraser', label: 'Gomme', icon: 'pi pi-eraser', key: 'x', edit: true },
  ],
};

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  rounded: 'Rectangle arrondi',
  ellipse: 'Ellipse',
  diamond: 'Losange',
  parallelogram: 'Parallélogramme',
  hexagon: 'Hexagone',
  cylinder: 'Cylindre',
  triangle: 'Triangle',
};

export const COLOR_LABELS: Record<BoardColor, string> = {
  default: 'Par défaut',
  gray: 'Gris',
  red: 'Rouge',
  orange: 'Orange',
  yellow: 'Jaune',
  green: 'Vert',
  blue: 'Bleu',
  purple: 'Violet',
  pink: 'Rose',
};

/** Couleurs des branches d'une carte mentale, dans l'ordre. */
export const MIND_COLORS: BoardColor[] = ['blue', 'green', 'orange', 'purple', 'pink', 'red', 'yellow'];

/** Petite icône SVG d'une forme (barre d'outils, barre de sélection). */
export function shapeIcon(shape: ShapeKind): string {
  const [w, h] = shape === 'ellipse' || shape === 'diamond' || shape === 'hexagon' || shape === 'triangle' ? [16, 14] : [18, 12];
  return `<svg viewBox="-1 -1 ${w + 2} ${h + 2}" width="18" height="16" aria-hidden="true"><path d="${shapePath(shape, w, h)}" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
}
