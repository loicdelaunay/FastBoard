import type { TicketStatus } from './constants.ts';
import type { AssigneeDTO } from './types.ts';

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Avancement d'une personne sur sa part : 100 % dès qu'elle l'a déclarée terminée. */
export function assigneeProgress(assignee: Pick<AssigneeDTO, 'done' | 'progress'>): number {
  return assignee.done ? 100 : clampPercent(assignee.progress);
}

interface ProgressInput {
  status: TicketStatus;
  progress: number;
  assignees: Array<Pick<AssigneeDTO, 'done' | 'progress'>>;
}

/**
 * Avancement global d'un ticket (0–100) :
 * - un ticket dans une colonne « terminée » (« Terminé », et celles choisies dans les réglages du projet) vaut 100 % ;
 * - avec des assignés : moyenne de l'avancement de chaque part ;
 * - sans assigné : avancement saisi manuellement.
 */
export function ticketProgress(ticket: ProgressInput, completeStatuses: readonly TicketStatus[] = ['done']): number {
  if (ticket.status === 'done' || completeStatuses.includes(ticket.status)) {
    return 100;
  }
  if (ticket.assignees.length > 0) {
    const total = ticket.assignees.reduce((sum, assignee) => sum + assigneeProgress(assignee), 0);
    return clampPercent(total / ticket.assignees.length);
  }
  return clampPercent(ticket.progress);
}

export function partsSummary(ticket: Pick<ProgressInput, 'assignees'>): { done: number; total: number } {
  return {
    done: ticket.assignees.filter((assignee) => assignee.done).length,
    total: ticket.assignees.length,
  };
}
