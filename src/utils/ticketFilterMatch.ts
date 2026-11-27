import type { TicketStatus } from '@shared/constants';
import type { TicketFilterValues } from '@shared/ticketFilters';
import type { DeliveryDTO, TicketDTO } from '@shared/types';
import { t } from '@/i18n';
import { matchesQuery } from '@/utils/search';
import { isOverdue } from '@/utils/tickets';

/** Ce qu'il faut savoir du projet d'un ticket pour lui appliquer des filtres. */
export interface FilterMatchContext {
  today: string;
  /** Personne qui utilise le filtre (« Mes tickets »). */
  userId: number | null | undefined;
  deliveriesById: ReadonlyMap<number, Pick<DeliveryDTO, 'name' | 'endDate'>>;
  categoriesById: ReadonlyMap<number, { name: string }>;
  usersById: ReadonlyMap<number, { name: string }>;
  key: (ticket: TicketDTO) => string;
  statusLabel: (status: TicketStatus) => string;
}

/** Le ticket passe-t-il ces filtres ? (Liste, Kanban, Gantt, et le bloc « Filtre enregistré » de l'Accueil.) */
export function ticketMatchesFilters(ticket: TicketDTO, filters: TicketFilterValues, context: FilterMatchContext): boolean {
  if (filters.projectIds.length && !filters.projectIds.includes(ticket.projectId)) return false;
  if (filters.statuses.length && !filters.statuses.includes(ticket.status)) return false;
  if (filters.categoryIds.length && !filters.categoryIds.includes(ticket.categoryId ?? 'none')) return false;
  if (filters.deliveryIds.length && !filters.deliveryIds.includes(ticket.deliveryId ?? 'none')) return false;
  if (filters.assigneeIds.length) {
    const ids: Array<number | 'none'> = ticket.assignees.length ? ticket.assignees.map((assignee) => assignee.userId) : ['none'];
    if (!ids.some((id) => filters.assigneeIds.includes(id))) return false;
  }
  if (filters.mineOnly && !ticket.assignees.some((assignee) => assignee.userId === context.userId)) return false;
  const delivery = ticket.deliveryId ? context.deliveriesById.get(ticket.deliveryId) : undefined;
  if (filters.overdueOnly && !isOverdue(ticket, delivery, context.today)) return false;
  if (filters.search.trim()) {
    return matchesQuery(filters.search, [
      context.key(ticket),
      ticket.title,
      ticket.description,
      ticket.categoryId ? context.categoriesById.get(ticket.categoryId)?.name : t('sans catégorie'),
      delivery?.name,
      context.statusLabel(ticket.status),
      ...ticket.assignees.map((assignee) => context.usersById.get(assignee.userId)?.name),
      ...ticket.parts.map((part) => part.note),
    ]);
  }
  return true;
}
