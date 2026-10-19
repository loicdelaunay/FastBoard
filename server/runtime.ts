import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { getAsset, isSea } from 'node:sea';

/**
 * Environnement d'exécution : Node classique (développement, `npm start`) ou exécutable autonome (Node SEA).
 * Dans l'exécutable, l'interface et les ressources statiques sont embarquées dans le binaire (« assets ») ;
 * en dehors, elles sont lues sur le disque. Les deux cas passent par `readAsset`.
 */

export const runningAsExecutable: boolean = isSea();

/** Dossier de l'application : à côté de l'exécutable, ou racine du projet. */
export function appRoot(): string {
  return runningAsExecutable ? path.dirname(process.execPath) : path.resolve(import.meta.dirname, '..');
}

let swaggerDir: string | null = null;

/** Dossier d'une ressource hors exécutable : `dist/`, `docs/` ou les fichiers de Swagger UI. */
function diskPath(key: string): string | null {
  const slash = key.indexOf('/');
  const area = key.slice(0, slash);
  const rest = key.slice(slash + 1);
  if (rest.split('/').includes('..')) {
    return null;
  }
  if (area === 'swagger') {
    swaggerDir ??= path.dirname(createRequire(import.meta.url).resolve('swagger-ui-dist/package.json'));
    return path.join(swaggerDir, rest);
  }
  return path.join(appRoot(), area, rest);
}

const cache = new Map<string, Buffer | null>();

/** Contenu d'une ressource statique (`dist/index.html`, `docs/API.md`, `swagger/swagger-ui.css`…), ou `undefined`. */
export function readAsset(key: string): Buffer | undefined {
  if (runningAsExecutable) {
    if (!cache.has(key)) {
      try {
        cache.set(key, Buffer.from(getAsset(key)));
      } catch {
        cache.set(key, null);
      }
    }
    return cache.get(key) ?? undefined;
  }
  const file = diskPath(key);
  try {
    return file && fs.statSync(file).isFile() ? fs.readFileSync(file) : undefined;
  } catch {
    return undefined;
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

export function mimeOf(key: string): string {
  return MIME[path.extname(key).toLowerCase()] ?? 'application/octet-stream';
}
