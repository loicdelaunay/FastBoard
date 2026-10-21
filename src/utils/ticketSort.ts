import type { ColumnSort, ProjectSettingsDTO } from '@shared/settings';
import type { DeliveryDTO, TicketDTO } from '@shared/types';
import { diffDays } from '@shared/dates';
import { dueDate } from '@shared/schedule';
import { useProjectStore } from '@/stores/project';
import { progressOf } from '@/utils/progress';

/** Comparateur d'un tri automatique de colonne ; les valeurs absentes passent toujours en dernier. */
export function ticketComparator(sort: ColumnSort): (a: TicketDTO, b: TicketDTO) => number {
  const project = useProjectStore();
  const sign = sort.direction === 'asc' ? 1 : -1;
  const value = (ticket: TicketDTO): string | number | null => {
    switch (sort.field) {
      case 'priority':
        return ticket.priorityId === null ? null : (project.priorityRank.get(ticket.priorityId) ?? null);
      case 'dueDate':
        return dueDate(ticket, ticket.deliveryId ? project.deliveriesById.get(ticket.deliveryId) : undefined) ?? null;
      case 'title':
        return ticket.title.toLocaleLowerCase();
      case 'number':
        return ticket.number;
      case 'createdAt':
        return ticket.createdAt;
      case 'updatedAt':
        return ticket.updatedAt;
      case 'progress':
        return progressOf(ticket);
    }
  };
  return (a, b) => {
    const left = value(a);
    const right = value(b);
    if (left === right) return a.number - b.number;
    if (left === null) return 1;
    if (right === null) return -1;
    return (typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right))) * sign;
  };
}

export type DeliveryUrgency = 'none' | 'soon' | 'urgent' | 'late';

/** Urgence d'une livraison pour un ticket non terminé (pastille colorée, réglable dans les automatisations). */
export function deliveryUrgency(
  ticket: Pick<TicketDTO, 'status'>,
  delivery: Pick<DeliveryDTO, 'endDate'> | undefined,
  settings: Pick<ProjectSettingsDTO, 'deliveryAlert' | 'deliveryWarnDays' | 'deliveryDangerDays' | 'completeStatuses'>,
  today: string,
): { level: DeliveryUrgency; daysLeft: number } {
  if (!delivery || !settings.deliveryAlert || ticket.status === 'done' || settings.completeStatuses.includes(ticket.status)) {
    return { level: 'none', daysLeft: 0 };
  }
  const daysLeft = diffDays(today, delivery.endDate);
  if (daysLeft < 0) return { level: 'late', daysLeft };
  if (daysLeft <= settings.deliveryDangerDays) return { level: 'urgent', daysLeft };
  if (daysLeft <= settings.deliveryWarnDays) return { level: 'soon', daysLeft };
  return { level: 'none', daysLeft };
}
