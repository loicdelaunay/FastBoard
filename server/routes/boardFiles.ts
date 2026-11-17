import express, { type Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { BOARD_ASSET_LIMITS } from '../../shared/boards.ts';
import { FILE_NAME_HEADER } from '../../shared/constants.ts';
import { assetByKey, assetFile, iconSvg, storeAsset } from '../boards/assets.ts';
import { requireBoardSpace, requireBoardsEnabled } from '../boards/store.ts';
import type { AppContext } from '../context.ts';
import { badRequest, notFound } from '../http/errors.ts';
import { actorOf, csrfGuard, currentUser, requireAuth } from '../http/middleware.ts';
import { idParam } from '../http/validate.ts';
import { contentDisposition } from '../services/attachments.ts';

function decodedName(raw: string | undefined): string {
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Une image, rien d'autre : un SVG ouvert seul n'exécute rien et ne charge rien d'extérieur. */
const IMAGE_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  'X-Content-Type-Options': 'nosniff',
};

/** Envoi d'une image ou d'un SVG dans un espace : le corps EST le fichier, la route passe avant l'analyse JSON. */
export function boardUploadRouter(ctx: AppContext): Router {
  const router = express.Router();
  router.post('/boards/spaces/:id/assets', csrfGuard(ctx), requireAuth(ctx), express.raw({ type: () => true, limit: BOARD_ASSET_LIMITS.bytes }), (req, res) => {
    requireBoardsEnabled(ctx.db);
    const spaceId = idParam(req.params.id);
    requireBoardSpace(ctx, currentUser(res), spaceId, 'editor');
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest('Fichier vide.');
    res.status(201).json({ asset: storeAsset(ctx, actorOf(req, res), spaceId, decodedName(req.get(FILE_NAME_HEADER)), body) });
  });
  return router;
}

/**
 * Lecture des fichiers des tableaux, sans compte : une image d'espace par sa clé aléatoire (affichée aussi aux visiteurs
 * d'un tableau partagé), une icône ajoutée par son numéro.
 */
export function boardFilesRouter(ctx: AppContext): Router {
  const router = express.Router();

  router.get('/board-assets/:key', (req, res) => {
    const asset = /^[A-Za-z0-9_-]{16,64}$/.test(req.params.key) ? assetByKey(ctx.db, req.params.key) : null;
    const file = asset ? assetFile(ctx, asset.key) : '';
    if (!asset || !fs.existsSync(file)) throw notFound('Image introuvable.');
    res.set({ ...IMAGE_HEADERS, 'Content-Type': asset.mime, 'Cache-Control': 'private, max-age=31536000, immutable', 'Content-Disposition': contentDisposition(asset.name, true) });
    res.sendFile(path.resolve(file));
  });

  router.get('/board-icons/:id', (req, res) => {
    const svg = iconSvg(ctx.db, idParam(req.params.id));
    if (svg === null) throw notFound('Icône introuvable.');
    res.set({ ...IMAGE_HEADERS, 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'private, max-age=86400' });
    res.send(svg);
  });

  return router;
}
