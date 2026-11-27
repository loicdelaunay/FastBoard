import type { ProjectDTO, TicketDTO } from '@shared/types';

export { dueDate, isOverdue, resolveRange, type ScheduleRange } from '@shared/schedule';

/** Clés des projets de « Mon tableau », où les tickets de plusieurs projets se côtoient. */
const projectKeys = new Map<number, string>();
export function registerProjectKeys(entries: Iterable<[number, string]>): void {
  projectKeys.clear();
  for (const [id, key] of entries) projectKeys.set(id, key);
}

/** Clé d'un ticket (`APP-12`) : celle de son projet, même affiché ailleurs (« Mon tableau »). */
export function ticketKey(project: Pick<ProjectDTO, 'key'> & Partial<Pick<ProjectDTO, 'id'>> | null | undefined, ticket: Pick<TicketDTO, 'number'> & Partial<Pick<TicketDTO, 'projectId'>>): string {
  const own = ticket.projectId !== undefined && project?.id !== ticket.projectId ? projectKeys.get(ticket.projectId) : undefined;
  return `${own ?? (project?.key || '#')}-${ticket.number}`;
}
