import type { UserSummaryDTO } from '@shared/types';
import { api } from '@/api';
import { t } from '@/i18n';
import type { MentionKind } from '@/utils/mentions';
import { matchesQuery } from '@/utils/search';

/**
 * Ce que propose `@` : personnes, tickets, notes, tableaux blancs et versions étiquetées, filtrables par type. Partagé
 * par les zones de texte (commentaires, descriptions), l'éditeur de notes et la fenêtre « Voir tout ».
 */

export type MentionGroup = 'user' | 'ticket' | 'doc' | 'board' | 'tag';
export type MentionFilter = 'all' | MentionGroup;

export interface MentionFilterInfo {
  key: MentionFilter;
  /** Libellé français (clé de traduction). */
  label: string;
  icon: string;
  color: string;
}

/** Un type, son icône et sa couleur (celles des modules quand il y en a une). */
export const MENTION_FILTERS: readonly MentionFilterInfo[] = [
  { key: 'all', label: 'Tout', icon: 'pi pi-asterisk', color: 'var(--fb-accent)' },
  { key: 'user', label: 'Personnes', icon: 'pi pi-user', color: '#14b8a6' },
  { key: 'ticket', label: 'Tickets', icon: 'pi pi-ticket', color: '#6366f1' },
  { key: 'doc', label: 'Documents', icon: 'pi pi-file', color: 'var(--fb-module-docs)' },
  { key: 'board', label: 'Tableaux blancs', icon: 'pi pi-objects-column', color: 'var(--fb-module-boards)' },
  { key: 'tag', label: 'Versions', icon: 'pi pi-tag', color: '#a855f7' },
];

export const mentionFilterInfo = (key: MentionFilter): MentionFilterInfo => MENTION_FILTERS.find((entry) => entry.key === key)!;

export interface MentionSuggestion {
  kind: MentionKind;
  group: MentionGroup;
  id: number;
  label: string;
  hint: string;
  /** Version étiquetée d'une note ou d'un tableau : `v:345`. */
  suffix?: string;
}

export interface MentionSources {
  people: readonly UserSummaryDTO[];
  /** Tickets du projet ouvert, cherchés sur place ; sans eux, la recherche du serveur. */
  tickets?: (query: string) => MentionSuggestion[];
  docs: boolean;
  boards: boolean;
}

export interface MentionResults {
  items: MentionSuggestion[];
  /** D'autres éléments correspondent que ceux montrés : « Voir tout » les liste. */
  more: boolean;
}

/** Filtres utiles ici (sans la documentation ni les tableaux s'ils sont désactivés). */
export function mentionFilters(sources: Pick<MentionSources, 'docs' | 'boards'>): MentionFilterInfo[] {
  return MENTION_FILTERS.filter((entry) => (entry.key !== 'doc' || sources.docs) && (entry.key !== 'board' || sources.boards) && (entry.key !== 'tag' || sources.docs || sources.boards));
}

async function group(kind: MentionGroup, query: string, limit: number, sources: MentionSources, browsing: boolean): Promise<MentionSuggestion[]> {
  switch (kind) {
    case 'user':
      return sources.people
        .filter((user) => user.isActive && (!query || matchesQuery(query, [user.name, user.email])))
        .slice(0, limit)
        .map((user) => ({ kind: 'user', group: 'user', id: user.id, label: user.name, hint: user.email }));
    case 'ticket': {
      if (!query && !browsing) return [];
      if (sources.tickets) return sources.tickets(query).slice(0, limit);
      if (!query) return [];
      const result = await api.search(query, { type: ['tickets'], limit }).catch(() => null);
      return (result?.tickets.items ?? []).map((ticket) => ({ kind: 'ticket', group: 'ticket', id: ticket.id, label: ticket.key, hint: ticket.title }));
    }
    case 'doc': {
      // Sans texte, les notes récentes ne se proposent que quand on les demande (filtre ou « Voir tout »).
      if (!sources.docs || (!query && !browsing)) return [];
      const result = await api.docSearch(query, limit).catch(() => null);
      return (result?.files ?? []).map((file) => ({ kind: 'doc', group: 'doc', id: file.id, label: file.title, hint: `${file.spaceName} · ${file.path}` }));
    }
    case 'board': {
      if (!sources.boards || (!query && !browsing)) return [];
      const result = await api.boardSearch(query, limit).catch(() => null);
      return (result?.boards ?? []).map((board) => ({ kind: 'board', group: 'board', id: board.id, label: board.title, hint: `${t('Tableau blanc')} · ${board.spaceName}` }));
    }
    case 'tag': {
      if (!query && !browsing) return [];
      const [docs, boards] = await Promise.all([sources.docs ? api.docTags(query).catch(() => null) : null, sources.boards ? api.boardTags(query).catch(() => null) : null]);
      return [...(docs?.tags ?? []), ...(boards?.tags ?? [])]
        .slice(0, limit)
        .map((hit) => ({ kind: hit.kind, group: 'tag', id: hit.id, label: `${hit.title} · ${hit.tag}`, hint: `${t('Version étiquetée')} · ${hit.spaceName}`, suffix: `v:${hit.versionId}` }));
    }
  }
}

/**
 * Suggestions pour `query` : `limit` par type au plus. `browse` : même sans texte, proposer les notes, tableaux et
 * versions récents (par défaut quand un type est demandé seul). On en cherche un de plus que montré pour savoir s'il en
 * reste.
 */
export async function searchMentions(query: string, filter: MentionFilter, limit: number, sources: MentionSources, browse = filter !== 'all'): Promise<MentionResults> {
  const kinds = filter === 'all' ? mentionFilters(sources).flatMap((entry) => (entry.key === 'all' ? [] : [entry.key])) : [filter];
  const browsing = browse;
  const found = await Promise.all(kinds.map((kind) => group(kind, query, limit + 1, sources, browsing)));
  return {
    items: found.flatMap((list) => list.slice(0, limit)),
    more: found.some((list) => list.length > limit),
  };
}
