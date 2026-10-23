import express, { type Router } from 'express';
import type { AiStreamEvent } from '../../shared/ai.ts';
import { AiError, runAgent } from '../ai/agent.ts';
import { deleteConversation, getConversation, listConversations, saveConversation } from '../ai/conversations.ts';
import { aiAvailable, availableModels } from '../ai/settings.ts';
import type { AppContext } from '../context.ts';
import { HttpError, badRequest } from '../http/errors.ts';
import { currentUser, sessionOnly } from '../http/middleware.ts';
import { aiChatSchema, aiConversationSchema } from '../http/schemas.ts';
import { parse } from '../http/validate.ts';
import { requireGlobal, requireProject } from '../services/access.ts';
import { requireTicket } from '../services/tickets.ts';

/** Assistant IA du panneau latéral (interface uniquement : il agit avec la session de la personne). */
export function aiRouter(ctx: AppContext): Router {
  const router = express.Router();

  /** Modèles proposés dans le panneau (réglage de l'icône engrenage). */
  router.get('/ai/models', sessionOnly(), (_req, res) => {
    requireGlobal(currentUser(res), 'ai.use');
    res.json(availableModels(ctx));
  });

  router.post('/ai/chat', sessionOnly(), async (req, res) => {
    const user = currentUser(res);
    requireGlobal(user, 'ai.use');
    if (!aiAvailable(ctx)) {
      throw new HttpError(409, "L'assistant IA n'est pas activé sur ce site.", 'ai_disabled');
    }
    const request = parse(aiChatSchema, req.body);
    // Le contexte ouvert doit être lisible par l'assistant ; le ticket doit appartenir au projet.
    if (request.context.ticketId) {
      const ticket = requireTicket(ctx.db, request.context.ticketId);
      request.context.projectId ??= ticket.project_id;
      if (ticket.project_id !== request.context.projectId) request.context.ticketId = null;
    }
    if (request.context.projectId) {
      const access = requireProject(ctx, user, request.context.projectId);
      if (!access.permissions.has('ai.read')) {
        throw new HttpError(403, "Vous n'avez pas accès à l'assistant IA dans ce projet.", 'forbidden');
      }
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    const emit = (event: AiStreamEvent): void => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      await runAgent(ctx, user, request, emit, abort.signal);
    } catch (error) {
      if (!abort.signal.aborted) {
        const message = error instanceof AiError || error instanceof HttpError ? error.message : "Erreur interne de l'assistant.";
        if (!(error instanceof AiError)) ctx.logger.error('ai', `Assistant IA : ${(error as Error).message}`, { stack: (error as Error).stack }, user.id);
        else ctx.logger.warn('ai', message, undefined, user.id);
        emit({ type: 'error', message });
      }
    } finally {
      res.end();
    }
  });

  // --- Conversations enregistrées (les 50 dernières de chaque personne) ---

  const conversationId = (raw: unknown): string => {
    const value = String(raw ?? '');
    if (!/^[A-Za-z0-9-]{8,64}$/.test(value)) throw badRequest('Identifiant de conversation invalide.');
    return value;
  };

  router.get('/ai/conversations', sessionOnly(), (_req, res) => {
    const user = currentUser(res);
    requireGlobal(user, 'ai.use');
    res.json({ conversations: listConversations(ctx.db, user.id) });
  });

  router.get('/ai/conversations/:id', sessionOnly(), (req, res) => {
    const user = currentUser(res);
    requireGlobal(user, 'ai.use');
    res.json({ conversation: getConversation(ctx.db, user.id, conversationId(req.params.id)) });
  });

  router.put('/ai/conversations/:id', sessionOnly(), (req, res) => {
    const user = currentUser(res);
    requireGlobal(user, 'ai.use');
    const input = parse(aiConversationSchema, req.body);
    res.json({ conversation: saveConversation(ctx.db, user.id, conversationId(req.params.id), input) });
  });

  router.delete('/ai/conversations/:id', sessionOnly(), (req, res) => {
    const user = currentUser(res);
    requireGlobal(user, 'ai.use');
    deleteConversation(ctx.db, user.id, conversationId(req.params.id));
    res.json({ ok: true });
  });

  return router;
}
