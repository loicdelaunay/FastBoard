import express, { type Request, type Router } from 'express';
import { boardPreviewSvg } from '../../shared/boardPreview.ts';
import { authenticate } from '../auth/authenticate.ts';
import { previewResources } from '../boards/assets.ts';
import { readBoardElements } from '../boards/store.ts';
import { resolveShare, shareInfo, unlockShare } from '../boards/shares.ts';
import type { AppContext } from '../context.ts';
import { boardUnlockSchema } from '../http/schemas.ts';
import { parse } from '../http/validate.ts';
import type { AuthUser } from '../services/access.ts';

/** En-tête qui porte l'accès ouvert par le mot de passe d'un tableau partagé. */
export const BOARD_SHARE_HEADER = 'x-board-share';

/**
 * Tableaux partagés par lien : ouverts selon le partage, sans compte s'il est public. Montées avant l'authentification ;
 * la personne connectée, s'il y en a une, est reconnue pour ses droits.
 */
export function boardSharesRouter(ctx: AppContext): Router {
  const router = express.Router();

  const visitor = (req: Request): AuthUser | null => {
    const attempt = authenticate(ctx, req);
    return attempt.kind === 'session' || attempt.kind === 'token' ? attempt.user : null;
  };
  const token = (req: Request): string | null => req.get(BOARD_SHARE_HEADER) ?? null;

  router.use('/board-shares', (_req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'private, no-cache');
    next();
  });

  router.get('/board-shares/:slug', (req, res) => {
    const slug = String(req.params.slug);
    const grant = resolveShare(ctx, visitor(req), slug, token(req));
    res.json({ share: shareInfo(ctx, slug, grant) });
  });

  router.post('/board-shares/:slug/unlock', async (req, res) => {
    const { password } = parse(boardUnlockSchema, req.body);
    res.json(await unlockShare(ctx, visitor(req), String(req.params.slug), password, req.ip ?? ''));
  });

  router.get('/board-shares/:slug/preview', (req, res) => {
    const grant = resolveShare(ctx, visitor(req), String(req.params.slug), token(req));
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(boardPreviewSvg(readBoardElements(ctx, { id: grant.boardId }), { maxWidth: 1200, ...previewResources(ctx) }));
  });

  return router;
}
