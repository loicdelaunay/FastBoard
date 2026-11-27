import { computed, reactive } from 'vue';
import type { TicketStatus } from '@shared/constants';
import { todayISO } from '@shared/dates';
import { emptyTicketFilters, type FilterId, type TicketFilterValues } from '@shared/ticketFilters';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/project';
import { ticketMatchesFilters } from '@/utils/ticketFilterMatch';
import { ticketKey } from '@/utils/tickets';

export type NoneOr<T> = T | 'none';

/**
 * Filtres partagés par les vues Liste, Kanban et Gantt : ils suivent l'utilisateur d'une vue à l'autre, et l'adresse
 * de la page (voir `useFilterQuery`) pour qu'un lien copié montre la même vue filtrée.
 */
const state = reactive<TicketFilterValues>(emptyTicketFilters());

/** Remplace tous les filtres. */
export function applyTicketFilters(values: TicketFilterValues): void {
  state.search = values.search;
  state.categoryIds = [...values.categoryIds];
  state.deliveryIds = [...values.deliveryIds];
  state.assigneeIds = [...values.assigneeIds];
  state.statuses = [...values.statuses] as TicketStatus[];
  state.overdueOnly = values.overdueOnly;
  state.mineOnly = values.mineOnly;
  state.projectIds = [...values.projectIds];
}

export function resetTicketFilters(): void {
  applyTicketFilters(emptyTicketFilters());
}

/** Copie des filtres en cours. */
export function currentTicketFilters(): TicketFilterValues {
  return {
    search: state.search,
    categoryIds: [...state.categoryIds] as FilterId[],
    deliveryIds: [...state.deliveryIds] as FilterId[],
    assigneeIds: [...state.assigneeIds] as FilterId[],
    statuses: [...state.statuses],
    overdueOnly: state.overdueOnly,
    mineOnly: state.mineOnly,
    projectIds: [...state.projectIds],
  };
}

export function useTicketFilters() {
  const project = useProjectStore();
  const auth = useAuthStore();

  const filtered = computed(() => {
    const context = {
      today: todayISO(),
      userId: auth.user?.id,
      deliveriesById: project.deliveriesById,
      categoriesById: project.categoriesById,
      usersById: project.usersById,
      key: (ticket: Parameters<typeof ticketKey>[1]) => ticketKey(project.project, ticket),
      statusLabel: (status: TicketStatus) => project.statusMeta(status).label,
    };
    return project.tickets.filter((ticket) => ticketMatchesFilters(ticket, state, context));
  });

  const activeCount = computed(
    () =>
      Number(Boolean(state.search.trim())) +
      Number(state.categoryIds.length > 0) +
      Number(state.deliveryIds.length > 0) +
      Number(state.assigneeIds.length > 0) +
      Number(state.statuses.length > 0) +
      Number(state.overdueOnly) +
      Number(state.mineOnly) +
      Number(state.projectIds.length > 0),
  );

  /**
   * Valeurs d'un ticket créé pendant que des filtres sont actifs : il reprend la catégorie, la livraison et les
   * personnes filtrées (et « Mes tickets »), pour rester visible là où on l'a créé.
   */
  function creationDefaults(): { categoryId?: number; deliveryId?: number; assigneeIds?: number[] } {
    const first = (ids: Array<NoneOr<number>>) => ids.find((id): id is number => id !== 'none');
    const members = new Set(project.users.filter((user) => user.isActive).map((user) => user.id));
    const assignees = state.assigneeIds.filter((id): id is number => id !== 'none' && members.has(id));
    if (state.mineOnly && auth.user && members.has(auth.user.id) && !assignees.includes(auth.user.id)) assignees.push(auth.user.id);
    const categoryId = first(state.categoryIds);
    const deliveryId = first(state.deliveryIds);
    return {
      ...(categoryId !== undefined && project.categoriesById.has(categoryId) ? { categoryId } : {}),
      ...(deliveryId !== undefined && project.deliveriesById.has(deliveryId) ? { deliveryId } : {}),
      ...(assignees.length ? { assigneeIds: assignees } : {}),
    };
  }

  return { filters: state, filtered, activeCount, reset: resetTicketFilters, creationDefaults };
}
