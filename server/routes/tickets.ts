import express, { type Router } from 'express';
import type { AppContext } from '../context.ts';
import { forbidden } from '../http/errors.ts';
import { actorOf, currentUser } from '../http/middleware.ts';
import { idParam, parse } from '../http/validate.ts';
import { requireProject, type AuthUser } from '../services/access.ts';
import { createComment, deleteComment, listComments, requireComment, updateComment } from '../services/comments.ts';
import { listHistory } from '../services/history.ts';
import { deleteTicket, getTicketDTO, moveTicket, requireTicket, ticketKeyOf, ticketPreview, transferTicket, updateTicket } from '../services/tickets.ts';
import { commentEditSchema, commentSchema, linkSchema, moveTicketSchema, partCreateSchema, partPatchSchema, transferTicketSchema, updateTicketSchema } from '../http/schemas.ts';
import { createLink, deleteLink, requireLink } from '../services/links.ts';
import { createPart, deletePart, requirePart, updatePart } from '../services/parts.ts';
import { unwatchTicket, watchTicket } from '../services/notifications.ts';
import { publishTicketChange } from '../services/tickets.ts';

export function ticketsRouter(ctx: AppContext): Router {
  const router = express.Router();

  /** Charge le ticket puis vérifie les droits de l'utilisateur sur son projet. */
  function ticketAccess(user: AuthUser, ticketId: number, permission?: string) {
    const ticket = requireTicket(ctx.db, ticketId);
    const access = requireProject(ctx, user, ticket.project_id, permission);
    return { ticket, access };
  }

  router.get('/tickets/:id', (req, res) => {
    const ticketId = idParam(req.params.id);
    const { ticket } = ticketAccess(currentUser(res), ticketId);
    res.json({ ticket: getTicketDTO(ctx.db, ticketId), key: ticketKeyOf(ctx.db, ticket) });
  });

  router.get('/tickets/:id/preview', (req, res) => {
    const ticketId = idParam(req.params.id);
    ticketAccess(currentUser(res), ticketId);
    res.json({ preview: ticketPreview(ctx.db, ticketId) });
  });

  router.patch('/tickets/:id', (req, res) => {
    const ticketId = idParam(req.params.id);
    ticketAccess(currentUser(res), ticketId, 'ticket.edit');
    res.json({ ticket: updateTicket(ctx, actorOf(req, res), ticketId, parse(updateTicketSchema, req.body)) });
  });

  router.post('/tickets/:id/move', (req, res) => {
    const ticketId = idParam(req.params.id);
    ticketAccess(currentUser(res), ticketId, 'ticket.edit');
    const { status, beforeId } = parse(moveTicketSchema, req.body);
    res.json({ ticket: moveTicket(ctx, actorOf(req, res), ticketId, { status, beforeId }) });
  });

  /** Déplacement vers un autre projet : `ticket.edit` dans le projet d'origine, `ticket.create` dans le projet cible. */
  router.post('/tickets/:id/transfer', (req, res) => {
    const user = currentUser(res);
    const ticketId = idParam(req.params.id);
    ticketAccess(user, ticketId, 'ticket.edit');
    const target = parse(transferTicketSchema, req.body);
    requireProject(ctx, user, target.projectId, 'ticket.create');
    const ticket = transferTicket(ctx, actorOf(req, res), ticketId, target);
    res.json({ ticket, key: ticketKeyOf(ctx.db, requireTicket(ctx.db, ticketId)) });
  });

  router.delete('/tickets/:id', (req, res) => {
    const ticketId = idParam(req.params.id);
    ticketAccess(currentUser(res), ticketId, 'ticket.delete');
    deleteTicket(ctx, actorOf(req, res), ticketId);
    res.json({ ok: true });
  });

  // --- Lignes d'avancement ------------------------------------------------------------------------------------------

  router.post('/tickets/:id/parts', (req, res) => {
    const ticketId = idParam(req.params.id);
    ticketAccess(currentUser(res), ticketId, 'ticket.edit');
    res.status(201).json({ ticket: createPart(ctx, actorOf(req, res), ticketId, parse(partCreateSchema, req.body)) });
  });

  /** `ticket.edit` modifie tout ; chacun gère ses propres lignes (texte, avancement, fin) avec `ticket.update_own_part`. */
  router.patch('/parts/:id', (req, res) => {
    const user = currentUser(res);
    const partId = idParam(req.params.id);
    const row = requirePart(ctx.db, partId);
    const patch = parse(partPatchSchema, req.body);
    const { access } = ticketAccess(user, row.ticket_id);
    const ownFields = patch.userId === undefined && patch.position === undefined;
    const own = ownFields && row.user_id === user.id && access.permissions.has('ticket.update_own_part');
    if (!own && !access.permissions.has('ticket.edit')) {
      throw forbidden('Seule la personne de la ligne peut la mettre à jour.');
    }
    requireProject(ctx, user, access.project.id, own ? 'ticket.update_own_part' : 'ticket.edit');
    res.json({ ticket: updatePart(ctx, actorOf(req, res), partId, patch) });
  });

  router.delete('/parts/:id', (req, res) => {
    const partId = idParam(req.params.id);
    const row = requirePart(ctx.db, partId);
    ticketAccess(currentUser(res), row.ticket_id, 'ticket.edit');
    res.json({ ticket: deletePart(ctx, actorOf(req, res), partId) });
  });

  // --- Suivi (notifications) -----------------------------------------------------------------------------------------

  router.post('/tickets/:id/watch', (req, res) => {
    const user = currentUser(res);
    const ticketId = idParam(req.params.id);
    ticketAccess(user, ticketId);
    watchTicket(ctx.db, ticketId, user.id);
    res.json({ ticket: publishTicketChange(ctx, actorOf(req, res), ticketId, []) });
  });

  router.delete('/tickets/:id/watch', (req, res) => {
    const user = currentUser(res);
    const ticketId = idParam(req.params.id);
    ticketAccess(user, ticketId);
    unwatchTicket(ctx.db, ticketId, user.id);
    res.json({ ticket: publishTicketChange(ctx, actorOf(req, res), ticketId, []) });
  });

  // --- Dépendances ---------------------------------------------------------------------------------------------------

  router.post('/tickets/:id/links', (req, res) => {
    const ticketId = idParam(req.params.id);
    ticketAccess(currentUser(res), ticketId, 'ticket.edit');
    res.status(201).json({ ticket: createLink(ctx, actorOf(req, res), ticketId, parse(linkSchema, req.body)) });
  });

  router.delete('/links/:id', (req, res) => {
    const linkId = idParam(req.params.id);
    const row = requireLink(ctx.db, linkId);
    ticketAccess(currentUser(res), row.ticket_id, 'ticket.edit');
    res.json({ ticket: deleteLink(ctx, actorOf(req, res), linkId) });
  });

  // --- Commentaires --------------------------------------------------------------------------------------------------

  router.get('/tickets/:id/comments', (req, res) => {
    const ticketId = idParam(req.params.id);
    ticketAccess(currentUser(res), ticketId);
    res.json({ comments: listComments(ctx.db, ticketId) });
  });

  router.post('/tickets/:id/comments', (req, res) => {
    const ticketId = idParam(req.params.id);
    ticketAccess(currentUser(res), ticketId, 'comment.create');
    const comment = createComment(ctx, actorOf(req, res), ticketId, parse(commentSchema, req.body));
    res.status(201).json({ comment });
  });

  router.patch('/comments/:id', (req, res) => {
    const commentId = idParam(req.params.id);
    const row = requireComment(ctx.db, commentId);
    ticketAccess(currentUser(res), row.ticket_id, 'comment.create');
    res.json({ comment: updateComment(ctx, actorOf(req, res), commentId, parse(commentEditSchema, req.body).body) });
  });

  router.delete('/comments/:id', (req, res) => {
    const commentId = idParam(req.params.id);
    const row = requireComment(ctx.db, commentId);
    const { access } = ticketAccess(currentUser(res), row.ticket_id);
    const canModerate = access.permissions.has('comment.moderate');
    res.json({ comment: deleteComment(ctx, actorOf(req, res), commentId, canModerate) });
  });

  // --- Historique ----------------------------------------------------------------------------------------------------

  router.get('/tickets/:id/history', (req, res) => {
    const ticketId = idParam(req.params.id);
    ticketAccess(currentUser(res), ticketId);
    res.json({ history: listHistory(ctx.db, ticketId) });
  });

  return router;
}
