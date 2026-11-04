/** Protocole WebSocket (JSON). */

import type { DocNodeDTO } from './docs.ts';
import type { DocCommentDTO } from './docComments.ts';
import type {
  ActivityCommentDTO,
  ActivityDTO,
  AppInfoDTO,
  NotificationDTO,
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
  /** Commentaire ajouté, modifié ou supprimé sur un évènement du journal. */
  | { type: 'activity.comment'; comment: ActivityCommentDTO }
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
  /** Nom, logo ou message de maintenance de l'application modifiés. */
  | { t: 'app'; app: AppInfoDTO }
  /** Nouvelle notification pour l'utilisateur connecté. */
  | { t: 'notification'; notification: NotificationDTO; unread: number }
  /** Notifications lues (depuis un autre onglet). */
  | { t: 'notifications.read'; unread: number }
  /** Arborescence d'un espace de documentation modifiée. */
  | { t: 'docs.tree'; spaceId: number; nodes: DocNodeDTO[] }
  /** Rôle changé dans un espace : relire ses droits. */
  | { t: 'docs.access'; spaceId: number }
  /** Accès à un espace retiré (ou espace supprimé). */
  | { t: 'docs.revoked'; spaceId: number }
  /** Commentaires d'une note de l'espace, après un ajout, une réponse ou une suppression. */
  | { t: 'docs.comments'; spaceId: number; nodeId: number; comments: DocCommentDTO[] }
  /** Réponse à `doc.join` : ce qui manque au client, et ce que le serveur connaît déjà. */
  | { t: 'doc.sync'; nodeId: number; update: string; stateVector: string; canWrite: boolean; awareness: string | null }
  /** Modification du texte (Yjs, base64). */
  | { t: 'doc.update'; nodeId: number; update: string }
  /** Curseurs et sélections des participants (Yjs, base64). */
  | { t: 'doc.awareness'; nodeId: number; update: string }
  | { t: 'doc.saved'; nodeId: number; at: string }
  /** Fichier supprimé ou accès retiré pendant l'édition. */
  | { t: 'doc.closed'; nodeId: number; reason: 'deleted' | 'revoked' }
  | { t: 'pong' }
  | { t: 'error'; message: string };

export type ClientMessage =
  | { t: 'subscribe'; projectId: number }
  | { t: 'unsubscribe' }
  | { t: 'presence'; ticketId: number | null; view: string }
  | { t: 'ping' }
  /** Suit l'arborescence d'un espace (`null` : plus aucun). */
  | { t: 'docs.watch'; spaceId: number | null }
  | { t: 'doc.join'; nodeId: number; stateVector: string }
  | { t: 'doc.update'; nodeId: number; update: string }
  | { t: 'doc.awareness'; nodeId: number; update: string }
  | { t: 'doc.leave'; nodeId: number };
