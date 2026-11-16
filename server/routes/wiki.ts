import express, { type Router } from 'express';
import { sniffImageMime } from '../../shared/attachments.ts';
import type { AppContext } from '../context.ts';
import { wikiAccess, wikiFile, wikiPage, wikiSearch, wikiTree } from '../docs/sites.ts';
import { notFound } from '../http/errors.ts';
import { docSearchSchema } from '../http/schemas.ts';
import { idParam, parse } from '../http/validate.ts';

/** Sites web des espaces de documentation : lecture seule, avec ou sans compte selon le réglage du site. */
export function wikiRouter(ctx: AppContext): Router {
  const router = express.Router();
  const slugOf = (raw: unknown): string => {
    const slug = String(raw ?? '');
    if (!/^[a-z0-9-]{3,80}$/.test(slug)) throw notFound('Site introuvable.');
    return slug;
  };
  // Un wiki interne n'a rien à faire dans un moteur de recherche, même ouvert à tous.
  router.use('/wiki', (_req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'private, no-cache');
    next();
  });

  router.get('/wiki/:slug', (req, res) => {
    res.json(wikiTree(ctx, req, wikiAccess(ctx, req, slugOf(req.params.slug))));
  });

  router.get('/wiki/:slug/search', (req, res) => {
    const site = wikiAccess(ctx, req, slugOf(req.params.slug));
    res.json({ results: wikiSearch(ctx, site, parse(docSearchSchema, req.query).q) });
  });

  router.get('/wiki/:slug/pages/:id', (req, res) => {
    res.json(wikiPage(ctx, wikiAccess(ctx, req, slugOf(req.params.slug)), idParam(req.params.id)));
  });

  router.get('/wiki/:slug/files/:id', (req, res) => {
    const data = wikiFile(ctx, wikiAccess(ctx, req, slugOf(req.params.slug)), idParam(req.params.id));
    const mime = data ? sniffImageMime(data.subarray(0, 16)) : null;
    if (!data || !mime) throw notFound('Image introuvable.');
    res.setHeader('Content-Type', mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.send(data);
  });

  return router;
}
