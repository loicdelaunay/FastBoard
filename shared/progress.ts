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
  /** Avec des sous-tickets : l'avancement suit le leur (`false` : celui du ticket lui-même). */
  progressFromChildren?: boolean;
}

/**
 * Avancement global d'un ticket (0–100) :
 * - un ticket dans une colonne « terminée » (« Terminé », et celles choisies dans les réglages du projet) vaut 100 % ;
 * - avec des sous-tickets (réglage du ticket, activé par défaut) : moyenne de l'avancement des sous-tickets ;
 * - avec des assignés : moyenne de l'avancement de chaque part ;
 * - sans assigné : avancement saisi manuellement.
 */
export function ticketProgress(ticket: ProgressInput, completeStatuses: readonly TicketStatus[] = ['done'], children: readonly ProgressInput[] = []): number {
  if (ticket.status === 'done' || completeStatuses.includes(ticket.status)) {
    return 100;
  }
  if (children.length > 0 && ticket.progressFromChildren !== false) {
    const total = children.reduce((sum, child) => sum + ticketProgress(child, completeStatuses), 0);
    return clampPercent(total / children.length);
  }
  if (ticket.assignees.length > 0) {
    const total = ticket.assignees.reduce((sum, assignee) => sum + assigneeProgress(assignee), 0);
    return clampPercent(total / ticket.assignees.length);
  }
  return clampPercent(ticket.progress);
}

/** Sous-tickets de chaque ticket parent d'une liste (pour calculer l'avancement des parents). */
export function childrenByParent<T extends { parentId: number | null }>(tickets: readonly T[]): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const ticket of tickets) {
    if (ticket.parentId === null) continue;
    const list = map.get(ticket.parentId) ?? [];
    list.push(ticket);
    map.set(ticket.parentId, list);
  }
  return map;
}

export function partsSummary(ticket: Pick<ProgressInput, 'assignees'>): { done: number; total: number } {
  return {
    done: ticket.assignees.filter((assignee) => assignee.done).length,
    total: ticket.assignees.length,
  };
}
