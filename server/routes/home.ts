import express, { type Router } from 'express';
import type { FavoriteKind } from '../../shared/home.ts';
import type { AppContext } from '../context.ts';
import { badRequest } from '../http/errors.ts';
import { currentUser } from '../http/middleware.ts';
import { activityQuerySchema, favoriteKindSchema, homeLayoutSchema } from '../http/schemas.ts';
import { idParam, parse } from '../http/validate.ts';
import { listPersonalActivities } from '../services/activity.ts';
import { homeFor, listFavorites, setFavorite, setHomeLayout } from '../services/home.ts';
import { personalBoard, personalProjectIds } from '../services/personalBoard.ts';

/** Accueil de la personne connectée, et ses espaces favoris (documentation, tableaux blancs, projets). */
export function homeRouter(ctx: AppContext): Router {
  const router = express.Router();
  const kindOf = (raw: string): FavoriteKind => {
    const parsed = favoriteKindSchema.safeParse(raw);
    if (!parsed.success) throw badRequest('Type d’espace inconnu : docs, boards ou project.');
    return parsed.data as FavoriteKind;
  };

  router.get('/me/home', (_req, res) => {
    res.json({ home: homeFor(ctx, currentUser(res)) });
  });

  // Disposition de l'Accueil : blocs, ordre, tailles et réglages de chacun.
  router.put('/me/home-layout', (req, res) => {
    const body = parse(homeLayoutSchema, req.body);
    res.json({ layout: setHomeLayout(ctx, currentUser(res), body.layout) });
  });

  // « Mon tableau » : mes tickets de tous mes projets, et l'activité qui me concerne.
  router.get('/me/board', (_req, res) => {
    res.json({ board: personalBoard(ctx.db, currentUser(res)) });
  });

  router.get('/me/activity', (req, res) => {
    const user = currentUser(res);
    const query = parse(activityQuerySchema, req.query);
    res.json(
      listPersonalActivities(ctx.db, user.id, personalProjectIds(ctx.db, user), {
        limit: query.limit,
        before: query.before,
        groups: query.group,
        userId: query.userId,
        source: query.source ?? (query.viaApi ? 'api' : undefined),
        ticketId: query.ticketId,
      }),
    );
  });

  router.get('/me/favorites', (_req, res) => {
    res.json({ favorites: listFavorites(ctx, currentUser(res)) });
  });

  router.put('/me/favorites/:kind/:id', (req, res) => {
    res.json({ favorites: setFavorite(ctx, currentUser(res), kindOf(String(req.params.kind)), idParam(req.params.id), true) });
  });

  router.delete('/me/favorites/:kind/:id', (req, res) => {
    res.json({ favorites: setFavorite(ctx, currentUser(res), kindOf(String(req.params.kind)), idParam(req.params.id), false) });
  });

  return router;
}
