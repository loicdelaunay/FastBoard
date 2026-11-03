import { addDays, diffDays } from './dates.ts';

/** Un ticket du burn-down, réduit à ses jours (AAAA-MM-JJ, jour local). */
export interface BurndownTicket {
  /** Ajout au périmètre : création, ou rattachement à la livraison analysée. */
  added: string;
  /** Ticket terminé : jour de fin. */
  done?: string | null;
  /** Ticket « À tester » : jour d'arrivée dans la colonne. */
  review?: string | null;
}

export interface BurndownSeries {
  labels: string[];
  ideal: Array<number | null>;
  actual: Array<number | null>;
  /** Reste à faire en comptant les tickets « À tester » comme faits (à partir du jour où ils y sont arrivés). */
  withReview: Array<number | null>;
  /** Des tickets sont « À tester » : la courbe orange apporte quelque chose. */
  hasReview: boolean;
  /** Mode « tickets ajoutés » : tickets ajoutés chaque jour après le début (`null` hors mode ou après aujourd'hui). */
  added: Array<number | null>;
  /** Le mode « tickets ajoutés » est actif. */
  tracksAdded: boolean;
}

const laterDay = (a: string, b: string): string => (a > b ? a : b);

/**
 * Reste à faire jour par jour sur une période. Sans le mode « tickets ajoutés », tout le périmètre compte dès le premier
 * jour ; avec, un ticket n'entre dans le reste à faire que le jour de son ajout (la courbe remonte) et n'en sort
 * (terminé, ou « À tester ») qu'après y être entré ; l'idéal remonte lui aussi du nombre de tickets ajoutés.
 */
export function burndownSeries(tickets: readonly BurndownTicket[], range: { start: string; end: string; today: string }, tracksAdded: boolean): BurndownSeries {
  const { start, end, today } = range;
  const enteredDay = new Map<string, number>();
  const doneDay = new Map<string, number>();
  const reviewDay = new Map<string, number>();
  const bump = (map: Map<string, number>, day: string): void => {
    map.set(day, (map.get(day) ?? 0) + 1);
  };
  for (const ticket of tickets) {
    const entered = tracksAdded ? ticket.added : '';
    bump(enteredDay, entered);
    if (ticket.done) {
      bump(doneDay, laterDay(ticket.done, entered));
    } else if (ticket.review) {
      bump(reviewDay, laterDay(ticket.review, entered));
    }
  }
  const before = (map: Map<string, number>): number => [...map].reduce((sum, [day, count]) => (day < start ? sum + count : sum), 0);
  let inScope = before(enteredDay);
  let done = before(doneDay);
  let inReview = before(reviewDay);
  const days = Math.max(1, diffDays(start, end) + 1);
  const labels: string[] = [];
  const ideal: Array<number | null> = [];
  const actual: Array<number | null> = [];
  const withReview: Array<number | null> = [];
  const added: Array<number | null> = [];
  // Idéal : ligne droite vers zéro à la fin de la période ; un ajout la fait remonter d'autant, puis elle repart vers zéro.
  let idealLeft = days > 1 ? inScope + (enteredDay.get(start) ?? 0) - done : 0;
  for (let index = 0; index < days; index++) {
    const day = addDays(start, index);
    labels.push(day);
    if (index > 0) {
      idealLeft += (enteredDay.get(day) ?? 0) - idealLeft / (days - index);
    }
    ideal.push(Math.round(idealLeft * 100) / 100);
    inScope += enteredDay.get(day) ?? 0;
    done += doneDay.get(day) ?? 0;
    inReview += reviewDay.get(day) ?? 0;
    const remaining = inScope - done;
    actual.push(day <= today ? remaining : null);
    withReview.push(day <= today ? Math.max(0, remaining - inReview) : null);
    added.push(tracksAdded && day <= today ? (index > 0 ? (enteredDay.get(day) ?? 0) : 0) : null);
  }
  return { labels, ideal, actual, withReview, hasReview: reviewDay.size > 0, added, tracksAdded };
}
