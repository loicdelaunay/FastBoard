import { ticketProgress } from '@shared/progress';
import { useProjectStore } from '@/stores/project';

/**
 * Avancement d'un ticket du projet ouvert, avec ses colonnes « terminées » (réglages du projet) et, pour un ticket
 * parent, l'avancement de ses sous-tickets (sauf si le ticket le désactive).
 */
export function progressOf(ticket: Parameters<typeof ticketProgress>[0] & { id?: number }): number {
  const project = useProjectStore();
  const children = ticket.id !== undefined && project.fieldOn('children') ? project.childrenOf(ticket.id) : [];
  return ticketProgress(ticket, project.settings.completeStatuses, children);
}
