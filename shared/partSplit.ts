import { LIMITS, type TicketStatus } from './constants.ts';
import type { PartDTO } from './types.ts';

/**
 * « Découper en sous-tickets » : chaque ligne d'avancement d'un ticket devient un sous-ticket, pour la suivre à part
 * (statut, dates, commentaires…). Le sous-ticket reprend la personne et l'avancement de la ligne ; son titre est la
 * première ligne du texte (le texte entier va dans sa description s'il en a plusieurs), ou, sans texte, le titre du
 * ticket et le nom de la personne.
 */

export interface SplitPlan {
  title: string;
  /** Texte complet de la ligne, quand il ne tient pas dans le titre. */
  description: string;
  status: TicketStatus;
}

const clip = (text: string): string => (text.length > LIMITS.titleMax ? `${text.slice(0, LIMITS.titleMax - 1).trimEnd()}…` : text);

/**
 * Ce que devient une ligne. `available(statut)` dit si la colonne existe dans le projet (une colonne peut être masquée) :
 * une ligne terminée donne un sous-ticket terminé, une ligne commencée un sous-ticket « En cours », les autres prennent
 * le statut du ticket s'il n'est pas avancé (« Backlog », « À faire »), sinon « À faire ».
 */
export function splitPlan(
  part: Pick<PartDTO, 'note' | 'done' | 'progress'>,
  parent: { title: string; status: TicketStatus },
  personName: string | null,
  available: (status: TicketStatus) => boolean = () => true,
): SplitPlan {
  const note = part.note.trim();
  const [first = '', ...rest] = note.split('\n');
  const title = clip(first.trim() || (personName ? `${parent.title} — ${personName}` : parent.title));
  const description = rest.join('\n').trim() !== '' || first.trim().length > LIMITS.titleMax ? note : '';
  const fallback: TicketStatus = parent.status === 'backlog' || parent.status === 'todo' ? parent.status : 'todo';
  const wanted: TicketStatus = part.done ? 'done' : part.progress > 0 ? 'in_progress' : fallback;
  // « Terminé » ne se masque jamais ; « À faire » sert de dernier repli.
  const status = available(wanted) ? wanted : available(fallback) ? fallback : 'todo';
  return { title, description, status };
}
