import path from 'node:path';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { mimeOf, readAsset } from '../runtime.ts';

/**
 * Sert l'interface embarquée dans l'exécutable : fichiers de `dist/` lus dans les ressources du binaire,
 * avec repli sur `index.html` pour les pages de l'application (routage côté navigateur).
 */
export function embeddedFrontend(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api') || req.path === '/ws') {
      next();
      return;
    }
    const relative = decodeURIComponent(req.path).replace(/^\/+/, '');
    const direct = relative ? readAsset(`dist/${relative}`) : undefined;
    if (direct) {
      res.setHeader('Content-Type', mimeOf(relative));
      res.setHeader('Cache-Control', relative.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
      res.send(direct);
      return;
    }
    // Les ressources (fichiers avec extension, /assets) ne retombent jamais sur la page d'accueil.
    if (path.extname(req.path) || req.path.startsWith('/assets/')) {
      next();
      return;
    }
    const index = readAsset('dist/index.html');
    if (!index) {
      next();
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(index);
  };
}
