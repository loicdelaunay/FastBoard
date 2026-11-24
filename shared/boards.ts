import type { DocLinkNoteDTO, DocLinkTicketDTO, DocMemberDTO, DocRole } from './docs.ts';

/**
 * Tableaux blancs : des espaces (comme la documentation) qui rangent des tableaux en dossiers. Un tableau est un
 * ensemble d'éléments posés sur un plan infini, en coordonnées « monde » (pixels au zoom 100 %), édité à plusieurs
 * en temps réel (Yjs : une carte `elements` id → élément).
 */

export type BoardRole = DocRole;
export type BoardMemberDTO = DocMemberDTO;

export const BOARD_LIMITS = {
  nameMax: 120,
  descriptionMax: 2000,
  pathMax: 500,
  depthMax: 12,
  nodesPerSpace: 5000,
  /** Éléments d'un tableau. */
  elements: 5000,
  /** Texte d'un élément. */
  textMax: 10_000,
  /** Cellules d'un tableau (lignes × colonnes). */
  tableCells: 2500,
  /** Points d'un trait à main levée. */
  pathPoints: 4000,
  /** Taille de l'ensemble des éléments, en JSON. */
  jsonBytes: 5 * 1024 * 1024,
  retentionDays: 15,
} as const;

/** Historique d'un tableau : nombre de versions gardées, et délai sous lequel les enregistrements d'une personne se regroupent. */
export const BOARD_VERSION_LIMITS = { perBoard: 300, mergeMs: 60_000 } as const;
/** `restore` : version créée en restaurant une version plus ancienne. */
export type BoardVersionKind = 'edit' | 'restore';

/** Une version de l'historique d'un tableau (ses éléments se lisent à part). */
export interface BoardVersionDTO {
  id: number;
  createdAt: string;
  /** Auteur du dernier enregistrement de cette version ; `null` : inconnu (compte supprimé, jeton d'API retiré…). */
  userId: number | null;
  kind: BoardVersionKind;
  elementCount: number;
}

/** Ce qui change entre deux états d'un tableau : identifiants ajoutés, modifiés et retirés. */
export function diffElements(before: readonly BoardElement[], after: readonly BoardElement[]): { added: string[]; changed: string[]; removed: string[] } {
  const previous = new Map(before.map((element) => [element.id, JSON.stringify(element)]));
  const added: string[] = [];
  const changed: string[] = [];
  for (const element of after) {
    const old = previous.get(element.id);
    if (old === undefined) added.push(element.id);
    else if (old !== JSON.stringify(element)) changed.push(element.id);
    previous.delete(element.id);
  }
  return { added, changed, removed: [...previous.keys()] };
}

export interface BoardSpaceDTO {
  id: number;
  name: string;
  description: string;
  /** Recherche sémantique (RAG) : ses tableaux sont indexés pour l'assistant IA. */
  rag: boolean;
  role: BoardRole;
  /** La personne n'a ce rôle que par ses droits d'administration : elle n'est pas propriétaire de l'espace. */
  adminAccess: boolean;
  boardCount: number;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

/** `template` : modèle de l'espace, inséré dans les tableaux (ses copies restent liées à lui). */
export type BoardNodeKind = 'folder' | 'board' | 'template';

export interface BoardNodeDTO {
  id: number;
  spaceId: number;
  /** Chemin dans l'espace, avec des `/` : `Dossier/Sous-dossier/Mon tableau`. */
  path: string;
  kind: BoardNodeKind;
  /** Nombre d'éléments d'un tableau. */
  elementCount: number;
  /** À qui le tableau est partagé en plus des membres de l'espace (`null` : à personne). */
  share: BoardShareAudience | null;
  updatedAt: string;
  updatedBy: number | null;
  deletedAt: string | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Partage d'un tableau
// ---------------------------------------------------------------------------------------------------------------------

/** `users` : toute personne connectée ; `people` : une liste ; `public` : tout le monde, même sans compte. */
export const BOARD_SHARE_AUDIENCES = ['users', 'people', 'public'] as const;
export type BoardShareAudience = (typeof BOARD_SHARE_AUDIENCES)[number];
/** Droits donnés par le partage. */
export const BOARD_SHARE_ROLES = ['reader', 'editor'] as const;
export type BoardShareRole = (typeof BOARD_SHARE_ROLES)[number];

/**
 * Affichage d'un tableau cité dans une note ou un ticket, écrit après son numéro : `@[Architecture](board:7#image)`.
 * `link` : un simple lien ; `card` : son nom et son aperçu ; `image` : son image seule ; `embed` : une vue où l'on se
 * déplace et où l'on zoome. Sans rien, le tableau s'affiche en carte s'il est seul sur sa ligne, en lien sinon.
 */
export const BOARD_MENTION_VIEWS = ['link', 'card', 'image', 'embed'] as const;
export type BoardMentionView = (typeof BOARD_MENTION_VIEWS)[number];

/** Affichage demandé par le suffixe d'une mention (`image`, `embed`…), ou `null` s'il est absent ou inconnu. */
export function boardMentionView(suffix: string | null | undefined): BoardMentionView | null {
  return (BOARD_MENTION_VIEWS as readonly string[]).includes(suffix ?? '') ? (suffix as BoardMentionView) : null;
}

/**
 * Suffixe d'une mention (source d'expression régulière), facultatif : l'affichage d'un tableau (`#image`), des lignes
 * citées d'une note (`#L12-18`) ou des éléments cités d'un tableau (`#el:a1b2c3,d4e5f6`, voir `shared/citations.ts`).
 */
export const MENTION_VIEW_SUFFIX = '(?:#([A-Za-z0-9:,_-]{1,400}))?';

export const BOARD_SHARE_LIMITS = {
  passwordMin: 4,
  passwordMax: 200,
  people: 200,
  /** Durée d'un accès ouvert par le mot de passe. */
  tokenDays: 7,
  guestNameMax: 40,
} as const;

/** Partage d'un tableau, vu par ceux qui le règlent. */
export interface BoardShareDTO {
  /** Adresse : `/t/{slug}`. */
  slug: string;
  audience: BoardShareAudience;
  people: number[];
  role: BoardShareRole;
  hasPassword: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Ce qu'un visiteur apprend d'un tableau partagé, une fois l'accès vérifié. */
export interface BoardShareInfoDTO {
  slug: string;
  boardId: number;
  title: string;
  spaceName: string;
  /** Droits du visiteur : ceux du partage, ou ceux de son rôle dans l'espace s'ils sont plus larges. */
  role: BoardRole;
  /** Le visiteur est membre de l'espace (il peut ouvrir le tableau dans l'application). */
  member: boolean;
  spaceId: number | null;
}

/** Résultat de la recherche de tableaux (mentions, Fast Element). */
export interface BoardSearchHitDTO {
  id: number;
  spaceId: number;
  spaceName: string;
  path: string;
  title: string;
}

/** Ce qui cite un tableau (notes et tickets par une mention, tableaux par un Fast Element), et ce qu'il montre. */
export interface BoardLinksDTO {
  backlinks: { notes: DocLinkNoteDTO[]; tickets: DocLinkTicketDTO[]; boards: BoardSearchHitDTO[] };
  outgoing: { notes: DocLinkNoteDTO[]; tickets: DocLinkTicketDTO[]; boards: BoardSearchHitDTO[] };
}

// ---------------------------------------------------------------------------------------------------------------------
// Éléments
// ---------------------------------------------------------------------------------------------------------------------

/** Couleurs : leurs teintes réelles dépendent du thème (variables CSS `--board-<couleur>-…`). */
export const BOARD_COLORS = ['default', 'gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'] as const;
export type BoardColor = (typeof BOARD_COLORS)[number];

export const SHAPE_KINDS = ['rect', 'rounded', 'ellipse', 'diamond', 'parallelogram', 'hexagon', 'cylinder', 'triangle'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** Remplissage : plein, contour seul, ou ni l'un ni l'autre (texte seul). */
export const FILL_STYLES = ['solid', 'outline', 'none'] as const;
export type FillStyle = (typeof FILL_STYLES)[number];

export const TEXT_SIZES = ['s', 'm', 'l', 'xl'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
export const TEXT_SIZE_PX: Record<TextSize, number> = { s: 12, m: 15, l: 20, xl: 28 };

export type Side = 'top' | 'right' | 'bottom' | 'left';

/**
 * Lien d'un élément avec le modèle dont il est une copie (façon « prefab ») : `id` du modèle, `inst` commun aux
 * éléments d'une même copie, `key` identifiant de l'élément dans le modèle, `v` version du modèle copiée.
 */
export interface TemplateLink {
  id: number;
  inst: string;
  key: string;
  v: string;
}

interface Placed {
  id: string;
  /** Ordre d'empilement : le plus grand est devant. */
  z: number;
  x: number;
  y: number;
  w: number;
  h: number;
  locked?: boolean;
  tpl?: TemplateLink;
  /** Groupe : les éléments qui portent le même identifiant se sélectionnent et se déplacent ensemble. */
  group?: string;
}

export interface ShapeElement extends Placed {
  type: 'shape';
  shape: ShapeKind;
  text: string;
  color: BoardColor;
  fill: FillStyle;
  size: TextSize;
}

export interface TextElement extends Placed {
  type: 'text';
  text: string;
  color: BoardColor;
  size: TextSize;
  align: 'left' | 'center' | 'right';
}

export interface StickyElement extends Placed {
  type: 'sticky';
  text: string;
  color: BoardColor;
  /** Personnes qui ont voté pour ce post-it. */
  votes: number[];
}

/** Section : un cadre titré qui regroupe des éléments (ils bougent avec lui). */
export interface FrameElement extends Placed {
  type: 'frame';
  title: string;
  color: BoardColor;
}

/** Nœud de carte mentale : `parent` null pour la racine ; la position des enfants est calculée. */
export interface MindElement extends Placed {
  type: 'mind';
  text: string;
  color: BoardColor;
  parent: string | null;
  /** Côté où partent les enfants d'une racine. */
  direction: 'right' | 'left';
}

/** Trait à main levée : `points` relatifs à (x, y), à plat [x0, y0, x1, y1…]. */
export interface PathElement extends Placed {
  type: 'path';
  points: number[];
  color: BoardColor;
  width: number;
  highlighter: boolean;
}

export type FastRefKind = 'ticket' | 'note' | 'folder' | 'space' | 'board';

/** Objet de FastBoard affiché sur le tableau : ticket, note, dossier ou espace de documentation, autre tableau. */
export interface FastElement extends Placed {
  type: 'fast';
  ref: { kind: FastRefKind; id: number };
  /** Titre mémorisé, montré tant que l'objet n'est pas chargé (ou s'il n'est plus accessible). */
  label: string;
}

/** Icône : `lucide:camera` (bibliothèque intégrée) ou `custom:12` (ajoutée par un administrateur). */
export interface IconElement extends Placed {
  type: 'icon';
  icon: string;
  /** `default` : couleur du texte (icône intégrée) ou couleurs d'origine (icône ajoutée). */
  color: BoardColor;
  /** Épaisseur du trait des icônes intégrées. */
  stroke: number;
  /** Remplissage d'une icône intégrée : teinté (la couleur, en transparence) ou plein ; absent : au trait seulement. */
  fill?: IconFill;
}

export const ICON_FILLS = ['tint', 'solid'] as const;
export type IconFill = (typeof ICON_FILLS)[number];

/** Image ou SVG envoyé dans l'espace : `asset` est la clé du fichier. */
export interface ImageElement extends Placed {
  type: 'image';
  asset: string;
  name: string;
}

/** Composants de maquette (wireframe), façon Whimsical. */
export const MOCKUP_KINDS = [
  'browser',
  'mobile',
  'navbar',
  'tabs',
  'breadcrumb',
  'heading',
  'paragraph',
  'link',
  'button',
  'input',
  'search',
  'select',
  'checkbox',
  'radio',
  'toggle',
  'slider',
  'progress',
  'rating',
  'badge',
  'alert',
  'avatar',
  'image',
  'video',
  'list',
  'card',
  'modal',
  'pagination',
  'divider',
] as const;
export type MockupKind = (typeof MOCKUP_KINDS)[number];
/** Style d'un bouton ou d'une pastille : plein, teinté, contour, sans fond. */
export const MOCKUP_VARIANTS = ['primary', 'secondary', 'outline', 'ghost'] as const;
export type MockupVariant = (typeof MOCKUP_VARIANTS)[number];

/**
 * Élément de maquette. `text` porte son contenu, une ligne par entrée pour les listes (onglets, menu, fil d'Ariane…) ;
 * `value` sa valeur (pourcentage d'un curseur, onglet ou page choisis, nombre d'étoiles) ; `checked` l'état coché.
 */
export interface MockupElement extends Placed {
  type: 'mockup';
  kind: MockupKind;
  text: string;
  color: BoardColor;
  variant: MockupVariant;
  checked: boolean;
  value: number;
  size: TextSize;
}

export interface TableElement extends Placed {
  type: 'table';
  /** `rows[0]` : l'en-tête. */
  rows: string[][];
  color: BoardColor;
}

export const CHART_KINDS = ['bar', 'line', 'pie', 'doughnut', 'radar'] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

/** Graphique (Chart.js) : ses données viennent d'un tableau du tableau blanc (`source`) ou de `rows`. */
export interface ChartElement extends Placed {
  type: 'chart';
  chart: ChartKind;
  title: string;
  source: string | null;
  /** Première colonne : étiquettes ; colonnes suivantes : séries (en-tête = nom de la série). */
  rows: string[][];
}

/** Extrémité d'un lien : accrochée à un élément (et un côté, `null` : le plus proche), sinon un point libre. */
export interface ConnectorEnd {
  id: string | null;
  side: Side | null;
  x: number;
  y: number;
  /** Position de l'accroche le long du côté choisi, de 0 (haut ou gauche) à 1 ; absente : le milieu. */
  t?: number;
}

export const CONNECTOR_ROUTES = ['straight', 'elbow', 'curve'] as const;
export type ConnectorRoute = (typeof CONNECTOR_ROUTES)[number];
/** Épaisseur d'un lien et de ses pointes ; `block` : grosse flèche pleine et cerclée, façon Google Drawings. */
export const CONNECTOR_WEIGHTS = ['s', 'm', 'l', 'xl', 'block'] as const;
export type ConnectorWeight = (typeof CONNECTOR_WEIGHTS)[number];
/** Dessin d'un lien là où il croise un lien placé dessous : arc, coupure ou pointe (comme dans draw.io). */
export const CONNECTOR_JUMPS = ['arc', 'gap', 'sharp'] as const;
export type ConnectorJump = (typeof CONNECTOR_JUMPS)[number];
/** Animations d'un lien : tirets qui défilent, points qui circulent, pulsation, comète. */
export const CONNECTOR_ANIMATIONS = ['flow', 'dots', 'pulse', 'comet'] as const;
export type ConnectorAnimation = (typeof CONNECTOR_ANIMATIONS)[number];
export const ANIMATION_SPEEDS = ['slow', 'normal', 'fast'] as const;
export type AnimationSpeed = (typeof ANIMATION_SPEEDS)[number];
/** Nombre maximal de points de passage d'un lien. */
export const WAYPOINTS_MAX = 64;

export interface ConnectorElement {
  id: string;
  type: 'connector';
  z: number;
  from: ConnectorEnd;
  to: ConnectorEnd;
  label: string;
  route: ConnectorRoute;
  dashed: boolean;
  arrowStart: boolean;
  arrowEnd: boolean;
  color: BoardColor;
  /** Absente : `m`, l'épaisseur habituelle. */
  weight?: ConnectorWeight;
  /** Points de passage, dans l'ordre, en coordonnées du tableau. */
  waypoints?: Array<{ x: number; y: number }>;
  /** Saut aux croisements avec les liens placés dessous ; absent : aucun. */
  jump?: ConnectorJump;
  /** Animation ; absente : aucune. */
  animation?: ConnectorAnimation;
  /** L'animation va de l'arrivée vers le départ. */
  animationReverse?: boolean;
  /** Couleur de l'animation ; absente : celle du lien. */
  animationColor?: BoardColor;
  animationSpeed?: AnimationSpeed;
  locked?: boolean;
  tpl?: TemplateLink;
  group?: string;
}

export type PlacedElement = ShapeElement | TextElement | StickyElement | FrameElement | MindElement | PathElement | FastElement | TableElement | ChartElement | IconElement | ImageElement | MockupElement;
export type BoardElement = PlacedElement | ConnectorElement;
export type BoardElementType = BoardElement['type'];

export const isPlaced = (element: BoardElement): element is PlacedElement => element.type !== 'connector';

/** Longueur maximale de l'identifiant d'un groupe. */
export const GROUP_ID_MAX = 40;

/**
 * Groupe d'un élément, façon Whimsical : un clic prend tout le groupe. Les nœuds de carte mentale n'en ont jamais (leur
 * carte les range et les déplace).
 */
export const elementGroup = (element: BoardElement): string | null => (element.type !== 'mind' && element.group ? element.group : null);

/** L'élément rangé dans le groupe `group`, ou sorti de tout groupe (`null`). */
export function withGroup<T extends BoardElement>(element: T, group: string | null): T {
  const { group: _group, ...rest } = element;
  return (group && element.type !== 'mind' ? { ...rest, group } : rest) as T;
}

/** Un lien déplacé de (dx, dy) : ses extrémités libres et ses points de passage (les accroches suivent leurs formes). */
export function shiftConnector(connector: ConnectorElement, dx: number, dy: number): Pick<ConnectorElement, 'from' | 'to' | 'waypoints'> {
  return {
    from: { ...connector.from, x: connector.from.x + dx, y: connector.from.y + dy },
    to: { ...connector.to, x: connector.to.x + dx, y: connector.to.y + dy },
    waypoints: connector.waypoints?.map((point) => ({ x: point.x + dx, y: point.y + dy })),
  };
}

/** Éléments qui portent un texte qu'on peut lier par un lien (export Mermaid, recherche). */
export function elementText(element: BoardElement): string {
  switch (element.type) {
    case 'shape':
    case 'text':
    case 'sticky':
    case 'mind':
    case 'mockup':
      return element.text;
    case 'frame':
      return element.title;
    case 'connector':
      return element.label;
    case 'fast':
      return element.label;
    case 'table':
      return element.rows.map((row) => row.join(' ')).join('\n');
    case 'chart':
      return element.title;
    case 'image':
      return element.name;
    case 'path':
    case 'icon':
      return '';
  }
}

/** Texte cherchable d'un tableau. */
export function boardSearchText(elements: readonly BoardElement[]): string {
  return elements
    .map(elementText)
    .filter(Boolean)
    .join('\n');
}

/** Nom affiché d'un tableau d'après son chemin. */
export function boardTitle(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

// ---------------------------------------------------------------------------------------------------------------------
// Icônes et fichiers des tableaux
// ---------------------------------------------------------------------------------------------------------------------

export const BOARD_ASSET_LIMITS = {
  /** Taille d'une image ou d'un SVG envoyé dans un espace. */
  bytes: 10 * 1024 * 1024,
  perSpace: 500,
  nameMax: 200,
} as const;

export const BOARD_ICON_LIMITS = {
  /** Taille du SVG d'une icône ajoutée par un administrateur. */
  svgBytes: 200 * 1024,
  nameMax: 80,
  count: 2000,
} as const;

/** Épaisseurs de trait proposées pour les icônes intégrées. */
export const ICON_STROKES = [1, 1.5, 2, 2.5, 3] as const;

/** Image ou SVG d'un espace, réutilisable dans tous ses tableaux. */
export interface BoardAssetDTO {
  id: number;
  spaceId: number;
  /** Clé (aléatoire) du fichier : `/api/board-assets/{key}`. */
  key: string;
  name: string;
  mime: string;
  size: number;
  createdBy: number | null;
  createdAt: string;
}

/** Icône ajoutée par un administrateur, proposée dans tous les tableaux. */
export interface BoardIconDTO {
  id: number;
  name: string;
  createdAt: string;
}

/** Adresse d'une image d'espace. */
export const boardAssetUrl = (key: string): string => `/api/board-assets/${key}`;
/** Adresse du SVG d'une icône ajoutée. */
export const boardIconUrl = (id: number): string => `/api/board-icons/${id}`;

/** Identifiant court et aléatoire d'un nouvel élément. */
export function newElementId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(36).padStart(2, '0')).join('').slice(0, 12);
}
