import type { CategoryDTO, ComponentDTO, DeliveryDTO, PriorityDTO, ProjectDTO, TicketDTO, UserSummaryDTO } from './types.ts';

/**
 * « Mon tableau » (Accueil) : les tickets assignés à la personne connectée dans tous ses projets, montrés comme un
 * projet (Analyseur, Liste, Kanban, Gantt, Activités). Chaque ticket garde son projet, ses listes et ses droits.
 */

export interface PersonalProjectDTO {
  project: ProjectDTO;
  /** Permissions de la personne dans ce projet (un ticket se modifie selon celles de son projet). */
  permissions: string[];
  /** Personnes du projet (assignables à ses tickets). */
  memberIds: number[];
}

export interface PersonalBoardDTO {
  /** Projets non archivés où la personne a au moins un ticket assigné. */
  projects: PersonalProjectDTO[];
  /** Personnes de ces projets. */
  users: UserSummaryDTO[];
  categories: CategoryDTO[];
  priorities: PriorityDTO[];
  components: ComponentDTO[];
  deliveries: DeliveryDTO[];
  /** Tickets dont la personne a une ligne d'avancement. */
  tickets: TicketDTO[];
}
