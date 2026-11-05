import type { AiChangeAction } from '@shared/ai';
import { replacePassage } from '@shared/docDiff';
import { api } from '@/api';
import { t } from '@/i18n';

/** Conversation enregistrée avant la version 2 : ses sous-tâches n'existent plus. */
const OUTDATED = () => t('Cette modification date d’une version précédente : elle ne peut plus être rejouée.');

/** Remplace le passage dans le texte actuel : ce qui a été écrit ailleurs dans la note entre-temps est respecté. */
async function rewriteNote(nodeId: number, from: string, to: string): Promise<void> {
  const { content } = await api.docNode(nodeId);
  const next = replacePassage(content ?? '', from, to);
  if (next === null) throw new Error(t('Le passage a changé depuis : modifiez la note à la main.'));
  await api.docSetContent(nodeId, next);
}

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
    case 'part.create': {
      const { ticket } = await api.addPart(action.ticketId, { note: action.note, userId: action.userId });
      const created = ticket.parts.reduce<number | null>((max, part) => (part.note === action.note && (max === null || part.id > max) ? part.id : max), null);
      return { ...action, partId: created };
    }
    case 'part.update':
      await api.updatePart(action.partId, action.after);
      return action;
    case 'link.create': {
      const { ticket } = await api.addLink(action.ticketId, action.targetId, action.reason);
      const created = ticket.links.reduce<number | null>((max, link) => (link.targetId === action.targetId && (max === null || link.id > max) ? link.id : max), null);
      return { ...action, linkId: created };
    }
    case 'doc.create': {
      const { node } = await api.docCreateNode(action.spaceId, action.path, 'markdown', action.content);
      return { ...action, nodeId: node.id };
    }
    case 'doc.edit':
      await rewriteNote(action.nodeId, action.before, action.after);
      return action;
    default:
      throw new Error(OUTDATED());
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
    case 'part.create':
      if (action.partId) await api.deletePart(action.partId);
      return { ...action, partId: null };
    case 'part.update':
      await api.updatePart(action.partId, action.before);
      return action;
    case 'link.create':
      if (action.linkId) await api.deleteLink(action.linkId);
      return { ...action, linkId: null };
    case 'doc.create':
      if (action.nodeId) await api.docDeleteNode(action.nodeId);
      return { ...action, nodeId: null };
    case 'doc.edit':
      await rewriteNote(action.nodeId, action.after, action.before);
      return action;
    default:
      throw new Error(OUTDATED());
  }
}
