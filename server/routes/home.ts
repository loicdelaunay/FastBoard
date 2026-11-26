import express, { type Router } from 'express';
import type { FavoriteKind } from '../../shared/home.ts';
import type { AppContext } from '../context.ts';
import { badRequest } from '../http/errors.ts';
import { currentUser } from '../http/middleware.ts';
import { favoriteKindSchema } from '../http/schemas.ts';
import { idParam } from '../http/validate.ts';
import { homeFor, listFavorites, setFavorite } from '../services/home.ts';

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
