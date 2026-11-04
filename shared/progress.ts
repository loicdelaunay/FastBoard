import type { TicketStatus } from './constants.ts';
import type { AssigneeDTO, PartDTO } from './types.ts';

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Avancement d'une ligne : 100 % dès qu'elle est terminée. */
export function partProgress(part: Pick<PartDTO, 'done' | 'progress'>): number {
  return part.done ? 100 : clampPercent(part.progress);
}

interface ProgressInput {
  status: TicketStatus;
  progress: number;
  parts: Array<Pick<PartDTO, 'done' | 'progress'>>;
  /** Avec des sous-tickets : l'avancement suit le leur (`false` : celui du ticket lui-même). */
  progressFromChildren?: boolean;
}

/**
 * Avancement global d'un ticket (0–100) :
 * - un ticket dans une colonne « terminée » (« Terminé », et celles choisies dans les réglages du projet) vaut 100 % ;
 * - avec des sous-tickets (réglage du ticket, activé par défaut) : moyenne de l'avancement des sous-tickets ;
 * - avec des lignes d'avancement : moyenne de ces lignes ;
 * - sans ligne : avancement saisi manuellement.
 */
export function ticketProgress(ticket: ProgressInput, completeStatuses: readonly TicketStatus[] = ['done'], children: readonly ProgressInput[] = []): number {
  if (ticket.status === 'done' || completeStatuses.includes(ticket.status)) {
    return 100;
  }
  if (children.length > 0 && ticket.progressFromChildren !== false) {
    const total = children.reduce((sum, child) => sum + ticketProgress(child, completeStatuses), 0);
    return clampPercent(total / children.length);
  }
  if (ticket.parts.length > 0) {
    const total = ticket.parts.reduce((sum, part) => sum + partProgress(part), 0);
    return clampPercent(total / ticket.parts.length);
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

export function partsSummary(ticket: Pick<ProgressInput, 'parts'>): { done: number; total: number } {
  return {
    done: ticket.parts.filter((part) => part.done).length,
    total: ticket.parts.length,
  };
}

/** Personnes d'une liste de lignes : une entrée par personne, terminée quand toutes ses lignes le sont. */
export function assigneesOf(parts: readonly PartDTO[]): AssigneeDTO[] {
  const people = new Map<number, PartDTO[]>();
  for (const part of parts) {
    if (part.userId === null) continue;
    people.set(part.userId, [...(people.get(part.userId) ?? []), part]);
  }
  return [...people].map(([userId, lines]) => {
    const done = lines.every((line) => line.done);
    const doneAt = lines.reduce<string | null>((latest, line) => (line.doneAt && (!latest || line.doneAt > latest) ? line.doneAt : latest), null);
    return { userId, done, progress: clampPercent(lines.reduce((sum, line) => sum + partProgress(line), 0) / lines.length), doneAt: done ? doneAt : null };
  });
}
