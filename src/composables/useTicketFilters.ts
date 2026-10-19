import { computed, reactive } from 'vue';
import type { TicketStatus } from '@shared/constants';
import { todayISO } from '@shared/dates';
import type { TicketDTO } from '@shared/types';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/project';
import { matchesQuery } from '@/utils/search';
import { isOverdue, ticketKey } from '@/utils/tickets';

import { t } from '@/i18n';
export type NoneOr<T> = T | 'none';

/** Filtres partagés par les vues Liste, Kanban et Gantt : ils suivent l'utilisateur d'une vue à l'autre. */
const state = reactive({
  search: '',
  categoryIds: [] as Array<NoneOr<number>>,
  deliveryIds: [] as Array<NoneOr<number>>,
  assigneeIds: [] as Array<NoneOr<number>>,
  statuses: [] as TicketStatus[],
  overdueOnly: false,
  mineOnly: false,
});

export function resetTicketFilters(): void {
  state.search = '';
  state.categoryIds = [];
  state.deliveryIds = [];
  state.assigneeIds = [];
  state.statuses = [];
  state.overdueOnly = false;
  state.mineOnly = false;
}

export function useTicketFilters() {
  const project = useProjectStore();
  const auth = useAuthStore();

  function matches(ticket: TicketDTO, today: string): boolean {
    if (state.statuses.length && !state.statuses.includes(ticket.status)) {
      return false;
    }
    if (state.categoryIds.length && !state.categoryIds.includes(ticket.categoryId ?? 'none')) {
      return false;
    }
    if (state.deliveryIds.length && !state.deliveryIds.includes(ticket.deliveryId ?? 'none')) {
      return false;
    }
    if (state.assigneeIds.length) {
      const ids: Array<NoneOr<number>> = ticket.assignees.length ? ticket.assignees.map((assignee) => assignee.userId) : ['none'];
      if (!ids.some((id) => state.assigneeIds.includes(id))) {
        return false;
      }
    }
    if (state.mineOnly && !ticket.assignees.some((assignee) => assignee.userId === auth.user?.id)) {
      return false;
    }
    const delivery = ticket.deliveryId ? project.deliveriesById.get(ticket.deliveryId) : undefined;
    if (state.overdueOnly && !isOverdue(ticket, delivery, today)) {
      return false;
    }
    if (state.search.trim()) {
      return matchesQuery(state.search, [
        ticketKey(project.project, ticket),
        ticket.title,
        ticket.description,
        ticket.categoryId ? project.categoriesById.get(ticket.categoryId)?.name : t('sans catégorie'),
        delivery?.name,
        project.statusMeta(ticket.status).label,
        ...ticket.assignees.map((assignee) => project.usersById.get(assignee.userId)?.name),
        ...ticket.assignees.map((assignee) => assignee.note),
      ]);
    }
    return true;
  }

  const filtered = computed(() => {
    const today = todayISO();
    return project.tickets.filter((ticket) => matches(ticket, today));
  });

  const activeCount = computed(
    () =>
      Number(Boolean(state.search.trim())) +
      Number(state.categoryIds.length > 0) +
      Number(state.deliveryIds.length > 0) +
      Number(state.assigneeIds.length > 0) +
      Number(state.statuses.length > 0) +
      Number(state.overdueOnly) +
      Number(state.mineOnly),
  );

  return { filters: state, filtered, activeCount, reset: resetTicketFilters };
}
