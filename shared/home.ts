import type { TicketStatus } from './constants.ts';
import type { DocBookmarkDTO } from './docs.ts';
import type { NotificationDTO } from './types.ts';

/**
 * Accueil : ce qu'on a modifié récemment, ce qui nous est assigné, nos espaces et nos documents favoris, et les
 * notifications importantes (mentions et assignations non lues), pour tout retrouver d'un coup d'œil.
 */

export type FavoriteKind = 'docs' | 'boards' | 'project';
export const FAVORITE_KINDS: readonly FavoriteKind[] = ['docs', 'boards', 'project'];

export const HOME_LIMITS = {
  recent: 12,
  assigned: 40,
  notifications: 8,
} as const;

/** Espace (ou projet) mis en favori. */
export interface FavoriteSpaceDTO {
  kind: FavoriteKind;
  id: number;
  name: string;
  description: string;
  /** Clé du projet ; `null` pour un espace. */
  key: string | null;
  /** Mis en favori le. */
  createdAt: string;
}

/** Élément modifié récemment par la personne. */
export interface HomeRecentDTO {
  kind: 'note' | 'board' | 'ticket';
  /** Note, tableau ou ticket. */
  id: number;
  title: string;
  /** Espace ou projet qui le contient. */
  spaceId: number;
  spaceName: string;
  /** Clé du ticket (`WEB-12`). */
  key: string | null;
  at: string;
}

/** Ticket ouvert assigné à la personne (sa part n'est pas finie). */
export interface HomeTicketDTO {
  id: number;
  projectId: number;
  projectKey: string;
  projectName: string;
  key: string;
  title: string;
  status: TicketStatus;
  startDate: string | null;
  endDate: string | null;
  /** Avancement de sa part (0–100). */
  progress: number;
}

export interface HomeDTO {
  recent: HomeRecentDTO[];
  assigned: HomeTicketDTO[];
  favorites: FavoriteSpaceDTO[];
  bookmarks: DocBookmarkDTO[];
  /** Mentions et assignations non lues, les plus récentes. */
  notifications: NotificationDTO[];
  unread: number;
}
