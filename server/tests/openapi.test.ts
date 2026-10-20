import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { documentedOperations } from '../openapi/spec.ts';
import { bootServer, TestClient } from './helpers.ts';

type Booted = Awaited<ReturnType<typeof bootServer>>;
type Json = Record<string, any>;

const routesDir = path.resolve(import.meta.dirname, '..', 'routes');

/** Routes réellement déclarées dans le code (`router.get('/x', …)`), au format OpenAPI (`{id}`). */
function declaredRoutes(): Array<{ method: string; path: string }> {
  const found: Array<{ method: string; path: string }> = [];
  const sources = [
    ...fs.readdirSync(routesDir).filter((file) => file.endsWith('.ts')).map((file) => fs.readFileSync(path.join(routesDir, file), 'utf8')),
    fs.readFileSync(path.resolve(import.meta.dirname, '..', 'app.ts'), 'utf8'),
  ];
  for (const source of sources) {
    for (const match of source.matchAll(/\b(?:router|api)\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
      found.push({ method: match[1]!, path: match[2]!.replace(/:(\w+)/g, '{$1}') });
    }
  }
  return found;
}

/** Routes volontairement non décrites : page Swagger et ses ressources statiques. */
const UNDOCUMENTED = new Set(['get /docs', 'get /docs/init.js', 'get /docs/assets/:file', 'get /docs/assets/{file}']);

describe("documentation de l'API (OpenAPI / Swagger)", () => {
  let app: Booted;
  let admin: TestClient;
  let spec: Json;

  before(async () => {
    app = await bootServer();
    admin = app.client();
    await admin.login('admin@admin.com', 'admin1234');
    spec = (await app.client().get('/api/openapi.json')).body;
  });

  after(async () => {
    await app.running.close();
  });

  it('est publique et structurée en OpenAPI 3.1', async () => {
    const response = await app.client().get('/api/openapi.json');
    assert.equal(response.status, 200, 'accessible sans authentification : un agent doit pouvoir la lire avant tout');
    assert.equal(spec.openapi, '3.1.0');
    assert.equal(spec.info.title, 'FastBoard API');
    assert.ok(spec.info.description.includes('Bearer'));
    assert.deepEqual(Object.keys(spec.components.securitySchemes).sort(), ['bearerAuth', 'cookieAuth']);
    assert.deepEqual(spec.servers, [{ url: '/api', description: 'Serveur courant' }]);
  });

  it('décrit chaque route du code, et seulement elles (pas de divergence)', () => {
    const declared = new Set(declaredRoutes().map((route) => `${route.method} ${route.path}`));
    const documented = new Set(documentedOperations().map((route) => `${route.method} ${route.path}`));

    const missing = [...declared].filter((key) => !documented.has(key) && !UNDOCUMENTED.has(key));
    const phantom = [...documented].filter((key) => !declared.has(key));
    assert.deepEqual(missing, [], `routes du code absentes de la documentation : ${missing.join(', ')}`);
    assert.deepEqual(phantom, [], `opérations documentées sans route : ${phantom.join(', ')}`);
    assert.ok(declared.size > 40, 'le scan des routes ne doit pas être vide');
  });

  it('est cohérente : références résolues, operationId uniques, paramètres de chemin déclarés', () => {
    const schemas = spec.components.schemas as Json;
    const unresolved: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node as Json)) {
          if (key === '$ref' && typeof value === 'string' && !(value.replace('#/components/schemas/', '') in schemas)) unresolved.push(value);
          walk(value);
        }
      }
    };
    walk(spec);
    assert.deepEqual(unresolved, []);

    const operationIds = new Set<string>();
    for (const [route, methods] of Object.entries(spec.paths as Json)) {
      const pathParams = [...route.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      for (const [method, operation] of Object.entries(methods as Json)) {
        assert.ok(operation.summary, `${method} ${route} : résumé manquant`);
        assert.ok(operation.tags?.length === 1, `${method} ${route} : tag manquant`);
        assert.ok(operation.responses && Object.keys(operation.responses).length > 0, `${method} ${route} : réponses manquantes`);
        assert.ok(!operationIds.has(operation.operationId), `operationId en double : ${operation.operationId}`);
        operationIds.add(operation.operationId);
        const declaredParams = (operation.parameters ?? []).filter((p: Json) => p.in === 'path').map((p: Json) => p.name);
        assert.deepEqual(declaredParams.sort(), [...pathParams].sort(), `${method} ${route} : paramètres de chemin`);
      }
    }
  });

  it("génère les corps de requête depuis les schémas de validation réels", () => {
    const move = spec.paths['/tickets/{id}/move'].post.requestBody.content['application/json'].schema;
    assert.deepEqual(move.properties.status.enum, ['backlog', 'todo', 'in_progress', 'blocked', 'review', 'done']);
    assert.match(move.properties.beforeId.description, /juste avant/);

    const createToken = spec.paths['/me/tokens'].post.requestBody.content['application/json'].schema;
    assert.deepEqual(createToken.required, ['name']);
    assert.deepEqual(createToken.properties.scope.enum, ['read', 'write']);
    assert.equal(createToken.properties.expiresInDays.default, 90);

    const query = spec.paths['/projects/{id}/tickets'].get.parameters.filter((p: Json) => p.in === 'query').map((p: Json) => p.name);
    assert.deepEqual(query.sort(), ['assigneeId', 'categoryId', 'componentId', 'deliveryId', 'key', 'limit', 'offset', 'priorityId', 'q', 'status', 'updatedSince']);
    const activityQuery = spec.paths['/projects/{id}/activity'].get.parameters.filter((p: Json) => p.in === 'query').map((p: Json) => p.name);
    assert.ok(activityQuery.includes('before') && activityQuery.includes('viaApi'));
  });

  it("indique l'accès (jeton / session) et la permission de chaque opération", () => {
    const admin = spec.paths['/admin/users'].get;
    assert.deepEqual(admin.security, [{ cookieAuth: [] }]);
    assert.match(admin.description, /interface uniquement/);
    assert.match(admin.description, /users\.view/);
    const patch = spec.paths['/tickets/{id}'].patch;
    assert.deepEqual(patch.security, [{ bearerAuth: [] }, { cookieAuth: [] }]);
    assert.match(patch.description, /ticket\.edit/);
    assert.match(patch.description, /write/);
    assert.deepEqual(spec.paths['/health'].get.security, []);
    assert.deepEqual(spec.paths['/auth/login'].post.security, []);
  });

  it('sert Swagger UI, ses ressources et le guide, sans authentification', async () => {
    const anonymous = app.client();
    const page = await fetch(`${app.base}/api/docs`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type') ?? '', /text\/html/);
    const html = await page.text();
    assert.ok(html.includes('/api/docs/assets/swagger-ui-bundle.js') && html.includes('/api/docs/init.js'));
    assert.ok(!/<script>[^<]/.test(html), 'aucun script en ligne (compatible avec la CSP)');

    const bundle = await fetch(`${app.base}/api/docs/assets/swagger-ui-bundle.js`);
    assert.equal(bundle.status, 200);
    assert.ok((await bundle.text()).length > 100_000);
    assert.equal((await fetch(`${app.base}/api/docs/assets/swagger-ui.css`)).status, 200);
    const init = await fetch(`${app.base}/api/docs/init.js`);
    assert.match(await init.text(), /\/api\/openapi\.json/);

    const guide = await anonymous.get('/api/docs/guide.md');
    assert.equal(guide.status, 200);
    assert.ok(String(guide.body).includes("Jetons d'API"));
    assert.ok(String(guide.body).includes('Authorization: Bearer'));
  });

  it("le guide ne décrit que des routes qui existent", () => {
    const guide = fs.readFileSync(path.resolve(import.meta.dirname, '..', '..', 'docs', 'API.md'), 'utf8');
    const documented = new Set(documentedOperations().map((route) => route.path.replace(/\{\w+\}/g, '{}')));
    // Les identifiants d'exemple (`/projects/1`) valent un paramètre de chemin.
    const mentioned = [...guide.matchAll(/(?:GET|POST|PATCH|PUT|DELETE)\s+`?(\/[\w/{}-]+)/g)].map((m) => m[1]!.replace(/\{\w+\}/g, '{}').replace(/\/\d+/g, '/{}'));
    const unknown = mentioned.filter((route) => !documented.has(route));
    assert.deepEqual(unknown, [], `routes citées dans le guide mais inexistantes : ${unknown.join(', ')}`);
  });

  it("toutes les opérations documentées répondent (aucune ne tombe sur « Route inconnue »)", async () => {
    // Session super administrateur ; les requêtes sont volontairement vides ou ciblent des ressources inexistantes.
    const skip = new Set(['post /auth/logout', 'post /auth/login', 'delete /me/avatar', 'put /me/avatar', 'patch /me']);
    const unknownRoute: string[] = [];
    for (const { method, path: route } of documentedOperations()) {
      if (skip.has(`${method} ${route}`)) continue;
      const url = `/api${route.replace(/\{\w+\}/g, '987654')}`;
      const response = await admin.request(method.toUpperCase(), url, method === 'get' || method === 'delete' ? undefined : {});
      if (response.status === 404 && (response.body as Json | null)?.error?.message === 'Route inconnue.') unknownRoute.push(`${method} ${route}`);
      assert.ok(response.status < 500, `${method} ${route} → ${response.status}`);
    }
    assert.deepEqual(unknownRoute, []);
  });
});
