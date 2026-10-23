import type { AiChangeAction } from '@shared/ai';
import { api } from '@/api';

/**
 * Applique ou annule une modification de l'assistant IA avec l'API habituelle (droits de la personne, diffusion en
 * temps réel). Retourne l'action mise à jour (identifiants du ticket, commentaire… créés).
 */
export async function performChange(action: AiChangeAction): Promise<AiChangeAction> {
  switch (action.kind) {
    case 'ticket.create': {
      const { ticket } = await api.createTicket(action.projectId, action.fields);
      return { ...action, ticketId: ticket.id };
    }
    case 'ticket.update':
      await api.updateTicket(action.ticketId, action.after);
      return action;
    case 'comment.create': {
      const { comment } = await api.addComment(action.ticketId, action.body, null);
      return { ...action, commentId: comment.id };
    }
    case 'subtask.create': {
      const { ticket } = await api.addSubtask(action.ticketId, action.title, action.assigneeId);
      const created = ticket.subtasks.reduce<number | null>((max, subtask) => (subtask.title === action.title && (max === null || subtask.id > max) ? subtask.id : max), null);
      return { ...action, subtaskId: created };
    }
    case 'subtask.update':
      await api.updateSubtask(action.subtaskId, action.after);
      return action;
    case 'link.create': {
      const { ticket } = await api.addLink(action.ticketId, action.targetId, action.reason);
      const created = ticket.links.reduce<number | null>((max, link) => (link.targetId === action.targetId && (max === null || link.id > max) ? link.id : max), null);
      return { ...action, linkId: created };
    }
  }
}

export async function undoChange(action: AiChangeAction): Promise<AiChangeAction> {
  switch (action.kind) {
    case 'ticket.create':
      if (action.ticketId) await api.deleteTicket(action.ticketId);
      return { ...action, ticketId: null };
    case 'ticket.update':
      await api.updateTicket(action.ticketId, action.before);
      return action;
    case 'comment.create':
      if (action.commentId) await api.deleteComment(action.commentId);
      return { ...action, commentId: null };
    case 'subtask.create':
      if (action.subtaskId) await api.deleteSubtask(action.subtaskId);
      return { ...action, subtaskId: null };
    case 'subtask.update':
      await api.updateSubtask(action.subtaskId, action.before);
      return action;
    case 'link.create':
      if (action.linkId) await api.deleteLink(action.linkId);
      return { ...action, linkId: null };
  }
}
