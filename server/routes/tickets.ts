import express, { type Router } from 'express';
import type { AppContext } from '../context.ts';
import { forbidden } from '../http/errors.ts';
import { actorOf, currentUser } from '../http/middleware.ts';
import { idParam, parse } from '../http/validate.ts';
import { requireProject, type AuthUser } from '../services/access.ts';
import { createComment, deleteComment, listComments, requireComment, updateComment } from '../services/comments.ts';
import { listHistory } from '../services/history.ts';
import { deleteTicket, getTicketDTO, moveTicket, requireTicket, ticketKeyOf, updatePart, updateTicket } from '../services/tickets.ts';
import { commentEditSchema, commentSchema, moveTicketSchema, partSchema, updateTicketSchema } from '../http/schemas.ts';

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

  router.delete('/tickets/:id', (req, res) => {
    const ticketId = idParam(req.params.id);
    ticketAccess(currentUser(res), ticketId, 'ticket.delete');
    deleteTicket(ctx, actorOf(req, res), ticketId);
    res.json({ ok: true });
  });

  /** Avancement / fin de « sa part » : chaque assigné gère la sienne ; `ticket.edit` permet de corriger celle d'un autre. */
  router.patch('/tickets/:id/assignees/:userId', (req, res) => {
    const user = currentUser(res);
    const ticketId = idParam(req.params.id);
    const targetUserId = idParam(req.params.userId);
    const { access } = ticketAccess(user, ticketId);
    const ownPart = targetUserId === user.id && access.permissions.has('ticket.update_own_part');
    if (!ownPart && !access.permissions.has('ticket.edit')) {
      throw forbidden("Seule la personne assignée peut mettre à jour sa part.");
    }
    requireProject(ctx, user, access.project.id, ownPart ? 'ticket.update_own_part' : 'ticket.edit');
    res.json({ ticket: updatePart(ctx, actorOf(req, res), ticketId, targetUserId, parse(partSchema, req.body)) });
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
