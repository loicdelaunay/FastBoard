import express, { type Router } from 'express';
import type { AppContext } from '../context.ts';
import { notFound } from '../http/errors.ts';
import { buildOpenApiDocument } from '../openapi/spec.ts';
import { mimeOf, readAsset } from '../runtime.ts';

/** Seuls ces fichiers de Swagger UI sont servis (ils sont aussi embarqués dans l'exécutable). */
const SWAGGER_FILES = new Set(['swagger-ui.css', 'swagger-ui-bundle.js']);

const DOCS_PAGE = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>FastBoard — Documentation de l'API</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="stylesheet" href="/api/docs/assets/swagger-ui.css" />
    <style>
      body { margin: 0; background: #fafafa; }
      .fb-banner { display: flex; flex-wrap: wrap; gap: 0.5rem 1.5rem; align-items: center; padding: 0.75rem 1.5rem; background: #1e1b4b; color: #e0e7ff; font: 14px system-ui, sans-serif; }
      .fb-banner strong { font-size: 16px; color: #fff; }
      .fb-banner a { color: #a5b4fc; }
    </style>
  </head>
  <body>
    <div class="fb-banner">
      <strong>FastBoard API</strong>
      <span>Faire travailler une IA ou un script sur le tableau :</span>
      <a href="/api/docs/guide.md">Guide pour les IA (Markdown)</a>
      <a href="/api/openapi.json">openapi.json</a>
      <span>Jeton : menu du compte → « Jetons d'API ». Cliquez sur <em>Authorize</em> pour le renseigner.</span>
    </div>
    <div id="swagger-ui"></div>
    <script src="/api/docs/assets/swagger-ui-bundle.js"></script>
    <script src="/api/docs/init.js"></script>
  </body>
</html>
`;

const INIT_SCRIPT = `window.ui = SwaggerUIBundle({
  url: '/api/openapi.json',
  dom_id: '#swagger-ui',
  deepLinking: true,
  persistAuthorization: true,
  displayRequestDuration: true,
  defaultModelsExpandDepth: 0,
  docExpansion: 'list',
  tryItOutEnabled: true,
});
`;

/** Documentation de l'API : publique (elle ne contient aucun secret) pour qu'un agent puisse la lire avant de s'authentifier. */
export function docsRouter(_ctx: AppContext): Router {
  const router = express.Router();
  let document: ReturnType<typeof buildOpenApiDocument> | null = null;

  router.get('/openapi.json', (_req, res) => {
    document ??= buildOpenApiDocument();
    res.json(document);
  });

  router.get('/docs', (_req, res) => {
    res.type('html').send(DOCS_PAGE);
  });

  router.get('/docs/init.js', (_req, res) => {
    res.type('application/javascript').send(INIT_SCRIPT);
  });

  router.get('/docs/guide.md', (_req, res) => {
    const guide = readAsset('docs/API.md');
    if (!guide) {
      throw notFound('Guide introuvable.');
    }
    res.type('text/markdown; charset=utf-8').send(guide.toString('utf8'));
  });

  router.get('/docs/assets/:file', (req, res) => {
    const file = String(req.params.file);
    const content = SWAGGER_FILES.has(file) ? readAsset(`swagger/${file}`) : undefined;
    if (!content) {
      throw notFound('Fichier introuvable.');
    }
    res.setHeader('Content-Type', mimeOf(file));
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(content);
  });

  return router;
}
