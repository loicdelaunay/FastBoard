/** Protocole WebSocket (JSON). */

import type {
  ActivityDTO,
  AttachmentDTO,
  CategoryDTO,
  CommentDTO,
  ComponentDTO,
  PriorityDTO,
  DeliveryDTO,
  HistoryEntryDTO,
  ProjectDTO,
  ProjectMemberDTO,
  TicketDTO,
  UserSummaryDTO,
} from './types.ts';

export type ProjectEvent =
  | { type: 'ticket.created'; ticket: TicketDTO }
  | { type: 'ticket.updated'; ticket: TicketDTO }
  | { type: 'ticket.deleted'; ticketId: number }
  | { type: 'tickets.reordered'; positions: Array<{ id: number; position: number }> }
  | { type: 'comment.created'; comment: CommentDTO; commentCount: number }
  | { type: 'comment.updated'; comment: CommentDTO; commentCount: number }
  | { type: 'comment.deleted'; comment: CommentDTO; commentCount: number }
  | { type: 'attachment.created'; attachment: AttachmentDTO; attachmentCount: number }
  | { type: 'attachment.deleted'; attachment: AttachmentDTO; attachmentCount: number }
  | { type: 'history.created'; entry: HistoryEntryDTO }
  | { type: 'activity.created'; activity: ActivityDTO }
  | { type: 'category.upserted'; category: CategoryDTO }
  | { type: 'category.deleted'; categoryId: number }
  | { type: 'priority.upserted'; priority: PriorityDTO }
  | { type: 'priority.deleted'; priorityId: number }
  | { type: 'component.upserted'; component: ComponentDTO }
  | { type: 'component.deleted'; componentId: number }
  | { type: 'delivery.upserted'; delivery: DeliveryDTO }
  | { type: 'delivery.deleted'; deliveryId: number }
  | { type: 'project.updated'; project: ProjectDTO }
  | { type: 'members.changed'; members: ProjectMemberDTO[]; users: UserSummaryDTO[] };

export interface PresenceUser {
  userId: number;
  /** Tickets actuellement ouverts par cet utilisateur (un par onglet au plus). */
  ticketIds: number[];
  /** Vues consultées (analyzer, list, kanban, gantt…). */
  views: string[];
}

export type ServerMessage =
  | { t: 'hello'; userId: number }
  | { t: 'subscribed'; projectId: number }
  | { t: 'presence'; projectId: number; users: PresenceUser[] }
  | { t: 'event'; projectId: number; event: ProjectEvent; origin: string | null; actorId: number | null; at: string }
  /** Le profil ou les permissions de l'utilisateur ont changé : recharger `/api/me`. */
  | { t: 'me.refresh' }
  /** La liste des projets accessibles a changé. */
  | { t: 'projects.refresh' }
  /** L'accès à un projet a été retiré (ou le projet supprimé). */
  | { t: 'project.revoked'; projectId: number }
  | { t: 'pong' }
  | { t: 'error'; message: string };

export type ClientMessage =
  | { t: 'subscribe'; projectId: number }
  | { t: 'unsubscribe' }
  | { t: 'presence'; ticketId: number | null; view: string }
  | { t: 'ping' };
