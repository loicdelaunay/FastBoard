/** Documentation : espaces collaboratifs de fichiers Markdown, rangés en dossiers sur le serveur (façon coffre Obsidian). */

export const DOC_ROLES = ['reader', 'editor', 'owner'] as const;
export type DocRole = (typeof DOC_ROLES)[number];

export const DOC_ROLE_LABELS: Record<DocRole, string> = { reader: 'Lecteur', editor: 'Éditeur', owner: 'Propriétaire' };

/** Vrai si `role` donne au moins les droits de `minimum`. */
export function docRoleAtLeast(role: DocRole, minimum: DocRole): boolean {
  return DOC_ROLES.indexOf(role) >= DOC_ROLES.indexOf(minimum);
}

export type DocNodeKind = 'folder' | 'markdown' | 'image';

export interface DocSpaceDTO {
  id: number;
  name: string;
  description: string;
  /** Rôle de la personne dans cet espace. */
  role: DocRole;
  fileCount: number;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Dossier, fichier Markdown ou image d'un espace ; son identifiant survit aux renommages et déplacements. */
export interface DocNodeDTO {
  id: number;
  spaceId: number;
  /** Chemin relatif au dossier de l'espace, avec des `/`. */
  path: string;
  kind: DocNodeKind;
  size: number;
  updatedAt: string;
  updatedBy: number | null;
  /** Date de mise à la corbeille (`null` : fichier actif). */
  deletedAt: string | null;
}

export interface DocMemberDTO {
  userId: number;
  role: DocRole;
}

export type DocVersionOrigin = 'create' | 'edit' | 'api' | 'import' | 'restore' | 'delete';

export interface DocVersionDTO {
  id: number;
  nodeId: number;
  /** Personnes qui ont écrit depuis la version précédente. */
  authors: string[];
  origin: DocVersionOrigin;
  size: number;
  createdAt: string;
}

export interface DocSearchHitDTO {
  id: number;
  spaceId: number;
  spaceName: string;
  path: string;
  title: string;
}

/** Note citée par une autre, ou qui la cite. */
export interface DocLinkNoteDTO {
  id: number;
  spaceId: number;
  spaceName: string;
  path: string;
  title: string;
}

export interface DocLinkTicketDTO {
  id: number;
  projectId: number;
  key: string;
  title: string;
}

/** Ce qu'une note cite, et ce qui la cite. */
export interface DocLinksDTO {
  outgoing: { notes: DocLinkNoteDTO[]; tickets: DocLinkTicketDTO[]; broken: string[] };
  backlinks: { notes: DocLinkNoteDTO[]; tickets: DocLinkTicketDTO[] };
}

/**
 * Sort d'un fichier du ZIP importé :
 * `new` absent du serveur ; `same` identique ; `updated` modifié dans l'import seulement ; `kept` modifié sur le serveur
 * seulement ; `merged` modifié des deux côtés, fusionné sans conflit ; `conflict` à trancher ; `removed` retiré de l'import.
 */
export type DocImportStatus = 'new' | 'same' | 'updated' | 'kept' | 'merged' | 'conflict' | 'removed';

export interface DocImportEntryDTO {
  path: string;
  kind: 'markdown' | 'image';
  status: DocImportStatus;
  /** Texte fusionné, avec des marques de conflit si besoin (`merged`, `conflict`). */
  merged: string | null;
}

export interface DocImportPreviewDTO {
  importId: string;
  entries: DocImportEntryDTO[];
  /** Fichiers ignorés : format non pris en charge ou chemin invalide. */
  ignored: string[];
}

/** `auto` : résultat proposé ; `keep` : garder le serveur ; `incoming` : prendre l'import ; `both` : garder les deux ; `delete` : supprimer du serveur. */
export type DocImportAction = 'auto' | 'keep' | 'incoming' | 'both' | 'delete';

export const DOC_LIMITS = {
  nameMax: 120,
  descriptionMax: 500,
  segmentMax: 120,
  depthMax: 12,
  /** Texte d'un fichier Markdown, en caractères. */
  fileChars: 1_000_000,
  imageBytes: 10 * 1024 * 1024,
  nodesPerSpace: 5_000,
  zipBytes: 100 * 1024 * 1024,
  unzippedBytes: 300 * 1024 * 1024,
  zipFiles: 5_000,
  /** Durée de conservation de l'historique et de la corbeille. */
  retentionDays: 15,
  /** Textes exportés gardés sur le serveur pour fusionner au retour : par personne et par espace, et leur durée. */
  exportsKept: 20,
  exportDays: 90,
};

const MARKDOWN = /\.(md|markdown)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const FORBIDDEN_NAME = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/** Nature d'un fichier d'après son nom ; `null` : format non pris en charge. */
export function docFileKind(path: string): 'markdown' | 'image' | null {
  if (MARKDOWN.test(path)) return 'markdown';
  return IMAGE.test(path) ? 'image' : null;
}

/** Dernier élément d'un chemin. */
export function docBaseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Dossier parent d'un chemin (vide à la racine). */
export function docParent(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

/** Titre affiché : le nom du fichier sans son extension Markdown. */
export function docTitle(path: string): string {
  return docBaseName(path).replace(MARKDOWN, '');
}

/**
 * Chemin relatif sûr, ou `null` : pas de remontée, de dossier caché ni de caractère refusé par Windows. Le chemin finit
 * sur le disque du serveur : c'est la seule porte d'entrée des noms saisis ou lus dans une archive.
 */
export function normalizeDocPath(raw: string): string | null {
  const segments = raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').split('/').map((segment) => segment.trim());
  if (segments.length === 0 || segments.length > DOC_LIMITS.depthMax) return null;
  for (const segment of segments) {
    // eslint-disable-next-line no-control-regex
    if (!segment || segment.startsWith('.') || segment.endsWith('.') || segment.length > DOC_LIMITS.segmentMax || /[\u0000-\u001f\u007f<>:"|?*]/.test(segment) || FORBIDDEN_NAME.test(segment)) return null;
  }
  return segments.join('/');
}

/** Complète un nom de note par l'extension Markdown. */
export function withMarkdownExtension(path: string): string {
  return MARKDOWN.test(path) ? path : `${path}.md`;
}

/** Octets ↔ base64, pour faire passer les mises à jour de collaboration dans les messages JSON du WebSocket. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
