import type { ProjectDTO, TicketDTO } from '@shared/types';

export { dueDate, isOverdue, resolveRange, type ScheduleRange } from '@shared/schedule';

export function ticketKey(project: Pick<ProjectDTO, 'key'> | null | undefined, ticket: Pick<TicketDTO, 'number'>): string {
  return `${project?.key ?? '#'}-${ticket.number}`;
}
