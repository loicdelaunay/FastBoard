import type { BoardNodeKind } from './boards.ts';
import type { DocNodeKind } from './docs.ts';
import { VERSION_TAG_LIMITS } from './versionTags.ts';

/**
 * Étiquettes d'espace : l'état complet d'un espace de documentation, d'un espace de tableaux blancs ou d'un projet,
 * figé à un instant sous un nom (« v1.0 »). Tout son contenu est copié à part, rangé par empreinte avec les pièces
 * jointes figées : l'étiquette ne dépend plus de l'espace (modifications, corbeille vidée, historique purgé, images
 * remplacées) et ne change jamais. Elle se consulte en lecture seule, se télécharge et, pour la documentation et les
 * tableaux blancs, redonne un nouvel espace. Elle part avec l'espace, ou quand on la supprime.
 */

export type SnapshotKind = 'docs' | 'boards' | 'project';
export const SNAPSHOT_KINDS: readonly SnapshotKind[] = ['docs', 'boards', 'project'];

export const SNAPSHOT_LIMITS = {
  nameMax: VERSION_TAG_LIMITS.nameMax,
  descriptionMax: 500,
  /** Étiquettes par espace. */
  perSpace: 100,
} as const;

export interface SpaceSnapshotDTO {
  id: number;
  kind: SnapshotKind;
  spaceId: number;
  name: string;
  description: string;
  /** Nom de l'espace (ou « CLÉ — nom » du projet) au moment de l'étiquette. */
  spaceName: string;
  /** Notes, tableaux ou tickets figés. */
  items: number;
  /** Fichiers figés (textes, images, pièces jointes), et leur poids total. */
  files: number;
  bytes: number;
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string;
}

/** Fichier figé de l'étiquette : son empreinte (`/api/snapshots/{id}/files/{hash}`). */
export type SnapshotFileRef = string;

export interface DocSnapshotContent {
  kind: 'docs';
  space: { name: string; description: string; obsidian: boolean };
  /** Dossiers, notes, images et modèles ; `file` : le texte ou l'image (sauf pour un dossier). */
  nodes: Array<{ id: number; path: string; kind: DocNodeKind; memo: string; icon: string | null; color: string | null; updatedAt: string; file: SnapshotFileRef | null }>;
}

export interface BoardSnapshotContent {
  kind: 'boards';
  space: { name: string; description: string };
  /** Dossiers, tableaux et modèles ; `file` : leurs éléments (JSON). */
  nodes: Array<{ id: number; path: string; kind: BoardNodeKind; updatedAt: string; file: SnapshotFileRef | null }>;
  /** Images (`asset:<clé>`) et icônes ajoutées (`icon:<id>`) que montrent les tableaux. */
  files: Array<{ ref: string; name: string; mime: string; file: SnapshotFileRef }>;
}

export interface ProjectSnapshotContent {
  kind: 'project';
  project: { key: string; name: string };
  /** L'export complet du projet (JSON : configuration, membres, tickets avec commentaires, historique, pièces jointes). */
  file: SnapshotFileRef;
  /** Fichiers joints aux tickets, par identifiant de pièce jointe. */
  attachments: Array<{ id: number; ticketId: number; name: string; mime: string; size: number; file: SnapshotFileRef }>;
}

export type SnapshotContent = DocSnapshotContent | BoardSnapshotContent | ProjectSnapshotContent;

/** Adresse d'un fichier figé d'une étiquette (`name` : nom proposé au téléchargement). */
export function snapshotFileUrl(snapshotId: number, hash: string, name?: string): string {
  return `/api/snapshots/${snapshotId}/files/${hash}${name ? `?name=${encodeURIComponent(name)}` : ''}`;
}

/** Nom d'archive d'une étiquette : `technique-v1.0.zip`. */
export function snapshotArchiveName(spaceName: string, tag: string): string {
  const safe = (text: string): string =>
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'espace';
  return `${safe(spaceName)}-${safe(tag)}.zip`;
}
