import express, { type Router } from 'express';
import type { AppContext } from '../context.ts';
import { actorOf, currentUser } from '../http/middleware.ts';
import { savedFilterPatchSchema, savedFilterSchema } from '../http/schemas.ts';
import { idParam, parse } from '../http/validate.ts';
import { requireProject } from '../services/access.ts';
import { createSavedFilter, deleteSavedFilter, listSavedFilters, updateSavedFilter } from '../services/savedFilters.ts';

/**
 * Filtres enregistrés d'un projet (Liste, Kanban, Gantt). Chaque membre garde les siens et peut en partager avec tout
 * le projet ; un filtre partagé se modifie et se supprime par son auteur, ou par qui gère le projet.
 */
export function savedFiltersRouter(ctx: AppContext): Router {
  const router = express.Router();

  router.get('/projects/:id/filters', (req, res) => {
    const user = currentUser(res);
    const access = requireProject(ctx, user, idParam(req.params.id));
    res.json({ filters: listSavedFilters(ctx.db, user, access) });
  });

  router.post('/projects/:id/filters', (req, res) => {
    const user = currentUser(res);
    res.status(201).json({ filter: createSavedFilter(ctx, actorOf(req, res), user, idParam(req.params.id), parse(savedFilterSchema, req.body)) });
  });

  router.patch('/filters/:id', (req, res) => {
    const user = currentUser(res);
    res.json({ filter: updateSavedFilter(ctx, actorOf(req, res), user, idParam(req.params.id), parse(savedFilterPatchSchema, req.body)) });
  });

  router.delete('/filters/:id', (req, res) => {
    deleteSavedFilter(ctx, actorOf(req, res), currentUser(res), idParam(req.params.id));
    res.json({ ok: true });
  });

  return router;
}
