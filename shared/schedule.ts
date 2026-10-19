import { toDayNumber } from './dates.ts';
import type { DeliveryDTO, TicketDTO } from './types.ts';

export interface ScheduleRange {
  start: string;
  end: string;
  /** Vrai quand les dates viennent de la livraison ciblée et non du ticket lui-même. */
  inherited: boolean;
}

/**
 * Période d'un ticket : ses propres dates ; à défaut (ou s'il n'en a qu'une) complétées par la livraison ciblée.
 * Retourne `null` si le ticket ne peut pas être placé dans le temps.
 */
export function resolveRange(
  ticket: Pick<TicketDTO, 'startDate' | 'endDate'>,
  delivery: Pick<DeliveryDTO, 'startDate' | 'endDate'> | null | undefined,
): ScheduleRange | null {
  const { startDate, endDate } = ticket;
  if (startDate && endDate) {
    return { start: startDate, end: endDate, inherited: false };
  }
  if (startDate) {
    const end = delivery && delivery.endDate >= startDate ? delivery.endDate : startDate;
    return { start: startDate, end, inherited: false };
  }
  if (endDate) {
    const start = delivery && delivery.startDate <= endDate ? delivery.startDate : endDate;
    return { start, end: endDate, inherited: false };
  }
  if (delivery) {
    return { start: delivery.startDate, end: delivery.endDate, inherited: true };
  }
  return null;
}

/** Date d'échéance effective : fin du ticket, sinon fin de la livraison ciblée. */
export function dueDate(ticket: Pick<TicketDTO, 'endDate'>, delivery: Pick<DeliveryDTO, 'endDate'> | null | undefined): string | null {
  return ticket.endDate ?? delivery?.endDate ?? null;
}

export function isOverdue(
  ticket: Pick<TicketDTO, 'endDate' | 'status'>,
  delivery: Pick<DeliveryDTO, 'endDate'> | null | undefined,
  today: string,
): boolean {
  if (ticket.status === 'done') {
    return false;
  }
  const due = dueDate(ticket, delivery);
  return due !== null && toDayNumber(due) < toDayNumber(today);
}
