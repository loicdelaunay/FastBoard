/**
 * Rappel d'avancement : pendant une livraison en cours, chaque personne qui a une ligne pas terminée sur un ticket
 * « En cours » est invitée à mettre à jour son avancement (le pourcentage de sa ligne ou un commentaire) quand elle ne
 * l'a pas fait depuis le nombre de jours réglé dans le projet.
 */

import type { ProjectSettingsDTO } from './settings.ts';
import type { AssigneeDTO, DeliveryDTO, TicketDTO } from './types.ts';

const DAY = 86_400_000;

/** Livraison en cours : commencée et pas encore finie (dates `AAAA-MM-JJ`, bornes comprises). */
export function deliveryOngoing(delivery: Pick<DeliveryDTO, 'startDate' | 'endDate'>, today: string): boolean {
  return delivery.startDate <= today && today <= delivery.endDate;
}

type ReminderTicket = Pick<TicketDTO, 'status' | 'deliveryId' | 'progressUpdates' | 'statusChangedAt' | 'deliveryAddedAt'> & {
  assignees: Array<Pick<AssigneeDTO, 'userId' | 'done' | 'progress'>>;
};

/**
 * Personnes qui devraient mettre à jour leur avancement sur ce ticket. Le délai part de leur dernière mise à jour, sans
 * remonter avant l'arrivée du ticket dans sa colonne ou dans sa livraison : un ticket tout juste commencé n'est pas signalé.
 */
export function progressReminderUsers(
  ticket: ReminderTicket,
  delivery: Pick<DeliveryDTO, 'startDate' | 'endDate'> | undefined,
  settings: Pick<ProjectSettingsDTO, 'progressReminder' | 'progressReminderDays'>,
  today: string,
  now = Date.now(),
): number[] {
  if (!settings.progressReminder || ticket.status !== 'in_progress' || ticket.deliveryId === null || !delivery || !deliveryOngoing(delivery, today)) return [];
  const floor = Math.max(Date.parse(ticket.statusChangedAt) || 0, ticket.deliveryAddedAt ? Date.parse(ticket.deliveryAddedAt) || 0 : 0);
  const limit = Math.max(1, settings.progressReminderDays) * DAY;
  return ticket.assignees
    .filter((assignee) => !assignee.done && assignee.progress < 100)
    .filter((assignee) => {
      const last = ticket.progressUpdates.find((update) => update.userId === assignee.userId);
      return now - Math.max(floor, last ? Date.parse(last.at) || 0 : 0) >= limit;
    })
    .map((assignee) => assignee.userId);
}

/** Note une mise à jour de l'avancement (commentaire reçu en direct, par exemple), sans dupliquer la personne. */
export function withProgressUpdate(updates: TicketDTO['progressUpdates'], userId: number, at: string): TicketDTO['progressUpdates'] {
  const current = updates.find((update) => update.userId === userId);
  if (current && current.at >= at) return updates;
  return [...updates.filter((update) => update.userId !== userId), { userId, at }];
}
