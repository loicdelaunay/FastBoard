import { ticketProgress } from '@shared/progress';
import { useProjectStore } from '@/stores/project';

/** Avancement d'un ticket du projet ouvert, avec ses colonnes « terminées » (réglages du projet). */
export function progressOf(ticket: Parameters<typeof ticketProgress>[0]): number {
  return ticketProgress(ticket, useProjectStore().settings.completeStatuses);
}
