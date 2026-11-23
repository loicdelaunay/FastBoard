/** Documentation : espaces collaboratifs de fichiers Markdown, rangés en dossiers sur le serveur (façon coffre Obsidian). */

import type { BoardSearchHitDTO } from './boards.ts';

export const DOC_ROLES = ['reader', 'editor', 'owner'] as const;
export type DocRole = (typeof DOC_ROLES)[number];

export const DOC_ROLE_LABELS: Record<DocRole, string> = { reader: 'Lecteur', editor: 'Éditeur', owner: 'Propriétaire' };

/** Vrai si `role` donne au moins les droits de `minimum`. */
export function docRoleAtLeast(role: DocRole, minimum: DocRole): boolean {
  return DOC_ROLES.indexOf(role) >= DOC_ROLES.indexOf(minimum);
}

/** `template` : modèle de note de l'espace, rangé à part (ses noms ne gênent pas ceux des notes). */
export type DocNodeKind = 'folder' | 'markdown' | 'image' | 'template';

export interface DocSpaceDTO {
  id: number;
  name: string;
  description: string;
  /** Rôle de la personne dans cet espace. */
  role: DocRole;
  /** La personne n'a ce rôle que par ses droits d'administration : elle n'est pas propriétaire de l'espace. */
  adminAccess: boolean;
  fileCount: number;
  memberCount: number;
  /** Syntaxe propre à Obsidian (callouts, surlignage, commentaires, étiquettes, notes de bas de page…). */
  obsidian: boolean;
  /** Sous-dossier, à côté de la note, où vont les images collées ou glissées ; `null` : celui du site (`defaultImageFolder`). */
  imageFolder: string | null;
  /** Dossier des images réglé dans l'administration, utilisé quand l'espace n'a pas le sien. */
  defaultImageFolder: string;
  /** Site web de l'espace, s'il est activé. */
  site: { slug: string; visibility: DocSiteVisibility } | null;
  createdAt: string;
  updatedAt: string;
}

/** Bilan de « Actualiser depuis le disque » : ce qui est entré dans l'espace, a été relu, ou est parti à la corbeille. */
export interface DocRescanResultDTO {
  added: number;
  updated: number;
  removed: number;
  /** Fichiers ignorés : format non pris en charge, nom refusé, ou espace plein. */
  skipped: number;
}

/** `members` : membres de l'espace ; `people` : personnes choisies ; `public` : tout le monde, sans compte. */
export const DOC_SITE_VISIBILITIES = ['members', 'people', 'public'] as const;
export type DocSiteVisibility = (typeof DOC_SITE_VISIBILITIES)[number];

export interface DocSiteDTO {
  slug: string;
  visibility: DocSiteVisibility;
  /** Personnes qui peuvent lire le site (`people`) ; les propriétaires de l'espace le peuvent toujours. */
  people: number[];
  createdAt: string;
  updatedAt: string;
}

/** Le site web d'un espace, tel que le lit son public. */
export interface WikiDTO {
  slug: string;
  name: string;
  description: string;
  obsidian: boolean;
  nodes: Array<Pick<DocNodeDTO, 'id' | 'path' | 'kind'>>;
  updatedAt: string;
  /** Espace à ouvrir pour « Modifier cette page » : seulement pour qui peut y écrire. */
  editSpaceId: number | null;
}

/** Résultat de la recherche dans un site web. */
export interface WikiSearchHitDTO {
  id: number;
  path: string;
  title: string;
  /** Ligne du texte où figure la recherche (vide si seul le titre correspond). */
  excerpt: string;
}

export interface WikiPageDTO {
  id: number;
  path: string;
  content: string;
  updatedAt: string;
}

/** Note ou image mise en favori par la personne. */
export interface DocBookmarkDTO {
  nodeId: number;
  spaceId: number;
  spaceName: string;
  path: string;
  kind: 'markdown' | 'image';
  createdAt: string;
}

/** Ce que dit « Infos » d'un fichier ou d'un dossier. */
export interface DocNodeInfoDTO {
  node: DocNodeDTO;
  createdAt: string;
  /** Dernière personne à l'avoir modifié. */
  updatedByName: string | null;
  /** Octets, contenu compris pour un dossier. */
  size: number;
  /** Pour un dossier : fichiers et sous-dossiers qu'il contient, à toute profondeur. */
  files: number;
  folders: number;
  /** Pour une note. */
  words: number | null;
  chars: number | null;
  lines: number | null;
  versions: number;
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
  /** Note libre : à quoi sert ce fichier ou ce dossier. */
  memo: string;
}

export interface DocMemberDTO {
  userId: number;
  role: DocRole;
}

export type DocVersionOrigin = 'create' | 'edit' | 'api' | 'import' | 'restore' | 'delete' | 'ai';

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
  /** `boards` : tableaux blancs mentionnés. */
  outgoing: { notes: DocLinkNoteDTO[]; tickets: DocLinkTicketDTO[]; boards: BoardSearchHitDTO[]; broken: string[] };
  /** `boards` : tableaux blancs qui montrent la note dans un Fast Element. */
  backlinks: { notes: DocLinkNoteDTO[]; tickets: DocLinkTicketDTO[]; boards: BoardSearchHitDTO[] };
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

/** Les deux versions d'un fichier importé et celle d'où elles sont parties, pour les comparer. */
export interface DocImportCompareDTO {
  /** Absent du serveur : nouveau fichier. */
  server: string | null;
  /** Absent de l'import : fichier retiré. */
  incoming: string | null;
  /** Texte exporté, s'il est encore connu. */
  base: string | null;
}

/** `auto` : résultat proposé ; `keep` : garder le serveur ; `incoming` : prendre l'import ; `both` : garder les deux ; `delete` : supprimer du serveur. */
export type DocImportAction = 'auto' | 'keep' | 'incoming' | 'both' | 'delete';

export const DOC_LIMITS = {
  nameMax: 120,
  memoMax: 1000,
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
  /** Nom du dossier des images collées, sous-dossiers compris. */
  imageFolderMax: 200,
};

/** Dossier où vont les images collées ou glissées dans une note, à côté d'elle, tant que rien d'autre n'est réglé. */
export const DOC_DEFAULT_IMAGE_FOLDER = 'Pictures';

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

/** Nom de dossier des images, nettoyé (`Captures/2026`), ou `null` s'il n'est pas utilisable. */
export function normalizeImageFolder(raw: string): string | null {
  return raw.trim().length > DOC_LIMITS.imageFolderMax ? null : normalizeDocPath(raw);
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
