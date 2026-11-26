import type { DeliveryDTO, TicketDTO } from './types.ts';

/**
 * Tickets terminés montrés dans la colonne « Terminé » du tableau : tous, tous sauf ceux d'une livraison passée (sa date
 * de fin est avant aujourd'hui), ou aucun. L'automatisation du projet (`hidePastDeliveryDone`) choisit le mode par
 * défaut ; chacun peut en changer d'un clic (menu « ⋯ » de la colonne). Une recherche montre toujours tout.
 */
export const DONE_VISIBILITIES = ['all', 'current', 'none'] as const;
export type DoneVisibility = (typeof DONE_VISIBILITIES)[number];

export const isDoneVisibility = (value: unknown): value is DoneVisibility => (DONE_VISIBILITIES as readonly unknown[]).includes(value);

/** Mode par défaut d'un projet, d'après son automatisation. */
export const defaultDoneVisibility = (settings: { hidePastDeliveryDone: boolean }): DoneVisibility => (settings.hidePastDeliveryDone ? 'current' : 'all');

/** Le ticket appartient à une livraison passée : finie avant `today` (`AAAA-MM-JJ`, le jour de fin compte encore). */
export function inPastDelivery(ticket: Pick<TicketDTO, 'deliveryId'>, deliveries: ReadonlyMap<number, Pick<DeliveryDTO, 'endDate'>>, today: string): boolean {
  if (ticket.deliveryId === null) return false;
  const delivery = deliveries.get(ticket.deliveryId);
  return Boolean(delivery && delivery.endDate < today);
}

/** Le ticket est masqué du tableau dans ce mode (seuls les tickets terminés peuvent l'être). */
export function doneTicketHidden(ticket: Pick<TicketDTO, 'status' | 'deliveryId'>, mode: DoneVisibility, deliveries: ReadonlyMap<number, Pick<DeliveryDTO, 'endDate'>>, today: string): boolean {
  if (ticket.status !== 'done' || mode === 'all') return false;
  return mode === 'none' || inPastDelivery(ticket, deliveries, today);
}
