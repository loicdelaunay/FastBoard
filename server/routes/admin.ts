import express, { type Response, type Router } from 'express';
import { permissionCatalog } from '../../shared/permissions.ts';
import { listAllApiTokens, revokeApiToken, updateApiToken } from '../auth/tokens.ts';
import type { AppContext } from '../context.ts';
import { currentUser, sessionOnly } from '../http/middleware.ts';
import {
  aiProbeSchema,
  aiSettingsSchema,
  appNameSchema,
  backupConfigSchema,
  maintenanceSchema,
  createRoleSchema,
  createUserSchema,
  folderTestSchema,
  httpsSettingsSchema,
  httpsTestSchema,
  selfSignedSchema,
  logQuerySchema,
  monitoringQuerySchema,
  serviceActionSchema,
  updateRoleSchema,
  updateTokenSchema,
  updateUserSchema,
  type LogQueryParams,
} from '../http/schemas.ts';
import { backupOverview, forgetDestinationRuns, runBackup, saveBackupConfig, testFolder } from '../backup/service.ts';
import { serviceAction, serviceStatus } from '../system/service.ts';
import { httpsSettingsDTO, loadTls, passphraseFor, saveHttpsSettings, writeSelfSigned } from '../system/https.ts';
import { AI_LIMITS, parseModelRef } from '../../shared/ai.ts';
import { aiSettingsDTO, detectModels, keyForTest, saveAiSettings } from '../ai/settings.ts';
import { testAiConnection } from '../ai/agent.ts';
import { appInfo } from '../services/appSettings.ts';
import { getMaintenance, setAppLogo, setAppName, setMaintenance } from '../services/appSettings.ts';
import { sniffImageMime } from '../../shared/attachments.ts';
import { badRequest, HttpError } from '../http/errors.ts';
import { LIMITS } from '../../shared/constants.ts';
import { queryLogs, type LogQuery } from '../monitoring/logger.ts';
import { buildSnapshot as buildMonitoringSnapshot } from '../monitoring/snapshot.ts';
import { idParam, parse } from '../http/validate.ts';
import { requireGlobal } from '../services/access.ts';
import { createRole, deleteRole, listRoles, updateRole } from '../services/roles.ts';
import {
  createUserByAdmin,
  deleteUserByAdmin,
  listAdminUsers,
  updateUserByAdmin,
} from '../services/users.ts';

export function adminRouter(ctx: AppContext): Router {
  const router = express.Router();

  // L'administration n'est jamais accessible avec un jeton d'API.
  router.use('/admin', sessionOnly());

  /** Inscrit une action d'administration au journal, avec son auteur. */
  function audit(res: Response, message: string, data?: unknown): void {
    ctx.logger.info('admin', message, data, currentUser(res).id, res.locals.requestId as string);
  }

  // --- Utilisateurs --------------------------------------------------------------------------------------------------

  router.get('/admin/users', (_req, res) => {
    requireGlobal(currentUser(res), 'users.view');
    res.json({ users: listAdminUsers(ctx.db), online: ctx.hub.onlineUserIds() });
  });

  router.post('/admin/users', async (req, res) => {
    const actor = currentUser(res);
    requireGlobal(actor, 'users.create');
    const user = await createUserByAdmin(ctx, actor, parse(createUserSchema, req.body));
    audit(res, `Compte créé : ${user.email}`, { targetId: user.id, role: user.roleName });
    res.status(201).json({ user });
  });

  router.patch('/admin/users/:id', async (req, res) => {
    const actor = currentUser(res);
    requireGlobal(actor, 'users.edit');
    const patch = parse(updateUserSchema, req.body);
    const user = await updateUserByAdmin(ctx, actor, idParam(req.params.id), patch);
    audit(res, `Compte modifié : ${user.email}`, { targetId: user.id, fields: Object.keys(patch) });
    res.json({ user });
  });

  router.delete('/admin/users/:id', (req, res) => {
    const actor = currentUser(res);
    requireGlobal(actor, 'users.delete');
    const targetId = idParam(req.params.id);
    const target = ctx.db.get<{ email: string }>('SELECT email FROM users WHERE id = ?', targetId);
    deleteUserByAdmin(ctx, actor, targetId);
    audit(res, `Compte supprimé : ${target?.email ?? `#${targetId}`}`, { targetId });
    res.json({ ok: true });
  });

  // --- Rôles et permissions ------------------------------------------------------------------------------------------

  router.get('/admin/roles', (_req, res) => {
    requireGlobal(currentUser(res), 'roles.manage');
    res.json({
      roles: listRoles(ctx.db),
      catalog: { global: permissionCatalog('global'), project: permissionCatalog('project') },
    });
  });

  router.post('/admin/roles', (req, res) => {
    const actor = currentUser(res);
    requireGlobal(actor, 'roles.manage');
    const role = createRole(ctx, actor, parse(createRoleSchema, req.body));
    audit(res, `Rôle créé : ${role.name}`, { roleId: role.id, scope: role.scope });
    res.status(201).json({ role });
  });

  router.patch('/admin/roles/:id', (req, res) => {
    const actor = currentUser(res);
    requireGlobal(actor, 'roles.manage');
    const role = updateRole(ctx, actor, idParam(req.params.id), parse(updateRoleSchema, req.body));
    audit(res, `Rôle modifié : ${role.name}`, { roleId: role.id, permissions: role.permissions.length });
    res.json({ role });
  });

  router.delete('/admin/roles/:id', (req, res) => {
    const actor = currentUser(res);
    requireGlobal(actor, 'roles.manage');
    const roleId = idParam(req.params.id);
    const target = ctx.db.get<{ name: string }>('SELECT name FROM roles WHERE id = ?', roleId);
    deleteRole(ctx, actor, roleId);
    audit(res, `Rôle supprimé : ${target?.name ?? `#${roleId}`}`, { roleId });
    res.json({ ok: true });
  });

  // --- Jetons d'API de tous les utilisateurs ---------------------------------------------------------------------------

  router.get('/admin/tokens', (_req, res) => {
    requireGlobal(currentUser(res), 'tokens.manage');
    res.json({ tokens: listAllApiTokens(ctx.db) });
  });

  router.patch('/admin/tokens/:id', (req, res) => {
    const actor = currentUser(res);
    requireGlobal(actor, 'tokens.manage');
    const tokenId = idParam(req.params.id);
    const token = updateApiToken(ctx, tokenId, { userId: actor.id, canManageAll: true }, parse(updateTokenSchema, req.body));
    audit(res, `Jeton d'API modifié par un administrateur (#${tokenId})`, { tokenId, expiresAt: token.expiresAt });
    res.json({ token });
  });

  router.delete('/admin/tokens/:id', (req, res) => {
    const actor = currentUser(res);
    requireGlobal(actor, 'tokens.manage');
    const tokenId = idParam(req.params.id);
    revokeApiToken(ctx, tokenId, { userId: actor.id, canManageAll: true });
    audit(res, `Jeton d'API révoqué par un administrateur (#${tokenId})`, { tokenId });
    res.json({ ok: true });
  });

  // --- Supervision : performances et journaux ------------------------------------------------------------------------

  router.get('/admin/monitoring', (req, res) => {
    requireGlobal(currentUser(res), 'monitoring.view');
    res.json(buildMonitoringSnapshot(ctx, parse(monitoringQuerySchema, req.query).range));
  });

  function logFilters(query: LogQueryParams): LogQuery {
    return {
      limit: query.limit,
      before: query.before,
      after: query.after,
      levels: query.level,
      sources: query.source?.split(',').map((entry) => entry.trim()).filter(Boolean),
      userId: query.userId,
      q: query.q,
      requestId: query.requestId,
      since: query.since,
      until: query.until,
    };
  }

  router.get('/admin/logs', (req, res) => {
    requireGlobal(currentUser(res), 'logs.view');
    const query = parse(logQuerySchema, req.query);
    res.json(queryLogs(ctx.db, logFilters(query)));
  });

  /** Export des journaux filtrés au format NDJSON (une entrée JSON par ligne, la plus récente d'abord). */
  router.get('/admin/logs/export', (req, res) => {
    requireGlobal(currentUser(res), 'logs.view');
    const query = parse(logQuerySchema, { ...req.query, limit: '500' });
    const lines: string[] = [];
    let before = query.before;
    // Jusqu'à 10 pages de 500 entrées.
    for (let page = 0; page < 10; page++) {
      const result = queryLogs(ctx.db, { ...logFilters(query), before });
      lines.push(...result.logs.map((entry) => JSON.stringify(entry)));
      if (result.nextBefore === null) break;
      before = result.nextBefore;
    }
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="fastboard-journaux-${new Date().toISOString().slice(0, 10)}.ndjson"`);
    res.send(lines.join('\n') + (lines.length ? '\n' : ''));
  });

  // --- Intelligence artificielle -------------------------------------------------------------------------------------

  router.get('/admin/ai', (_req, res) => {
    requireGlobal(currentUser(res), 'ai.manage');
    res.json({ settings: aiSettingsDTO(ctx) });
  });

  router.put('/admin/ai', (req, res) => {
    requireGlobal(currentUser(res), 'ai.manage');
    const input = parse(aiSettingsSchema, req.body);
    const settings = saveAiSettings(ctx, input);
    const models = settings.providers.reduce((sum, provider) => sum + provider.models.length, 0);
    audit(res, `Assistant IA ${settings.enabled ? 'activé' : 'désactivé'} (${settings.providers.length} fournisseur(s), ${models} modèle(s), défaut ${settings.defaultModel})`, {
      providers: settings.providers.map((provider) => provider.baseUrl),
      keysChanged: input.providers.filter((provider) => provider.apiKey !== undefined).length,
      maxSteps: settings.maxSteps,
      maxTurns: settings.maxTurns,
    });
    const app = appInfo(ctx.db);
    ctx.hub.broadcast({ t: 'app', app });
    res.json({ settings, app });
  });

  /** Essaie les valeurs du formulaire (clé saisie, sinon clé enregistrée) par un court échange avec le modèle. */
  router.post('/admin/ai/test', async (req, res) => {
    requireGlobal(currentUser(res), 'ai.manage');
    const probe = parse(aiProbeSchema, req.body);
    const model = probe.model || parseModelRef(aiSettingsDTO(ctx).defaultModel)?.modelId || '';
    const timeoutMs = (probe.timeoutSeconds ?? AI_LIMITS.timeoutSeconds) * 1000;
    res.json(await testAiConnection({ baseUrl: probe.baseUrl.replace(/\/+$/, ''), apiKey: keyForTest(ctx, probe.apiKey, probe.providerId), timeoutMs }, model));
  });

  /** Modèles proposés par le fournisseur (`GET /models`), avec des capacités devinées. */
  router.post('/admin/ai/models', async (req, res) => {
    requireGlobal(currentUser(res), 'ai.manage');
    const probe = parse(aiProbeSchema, req.body);
    try {
      res.json({ models: await detectModels(probe.baseUrl, keyForTest(ctx, probe.apiKey, probe.providerId), Math.min(60, probe.timeoutSeconds ?? 20) * 1000) });
    } catch (error) {
      throw new HttpError(502, (error as Error).message, 'ai_provider');
    }
  });

  // --- Personnalisation et maintenance -------------------------------------------------------------------------------

  router.put('/admin/app', (req, res) => {
    requireGlobal(currentUser(res), 'settings.manage');
    const { name } = parse(appNameSchema, req.body);
    audit(res, `Nom de l'application : ${name}`);
    res.json(setAppName(ctx, name));
  });

  router.put('/admin/app/logo', express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: LIMITS.avatarMaxBytes }), (req, res) => {
    requireGlobal(currentUser(res), 'settings.manage');
    const body: unknown = req.body;
    const sniffed = Buffer.isBuffer(body) && body.length ? sniffImageMime(body.subarray(0, 16)) : null;
    const mime = sniffed && ['image/png', 'image/jpeg', 'image/webp'].includes(sniffed) ? sniffed : null;
    if (!mime || !Buffer.isBuffer(body)) {
      throw badRequest("Le fichier n'est pas une image PNG, JPEG ou WebP valide (512 Ko maximum).");
    }
    audit(res, "Logo de l'application modifié");
    res.json(setAppLogo(ctx, { mime, data: body }));
  });

  router.delete('/admin/app/logo', (_req, res) => {
    requireGlobal(currentUser(res), 'settings.manage');
    audit(res, "Logo de l'application retiré");
    res.json(setAppLogo(ctx, null));
  });

  router.get('/admin/maintenance', (_req, res) => {
    requireGlobal(currentUser(res), 'settings.manage');
    res.json({ maintenance: getMaintenance(ctx.db) });
  });

  router.put('/admin/maintenance', (req, res) => {
    requireGlobal(currentUser(res), 'settings.manage');
    const input = parse(maintenanceSchema, req.body);
    if (input.startsAt && input.endsAt && input.startsAt >= input.endsAt) {
      throw badRequest('La fin de la maintenance doit suivre son début.');
    }
    audit(res, `Message de maintenance ${input.enabled ? 'affiché' : 'retiré'} (${input.level})`, { title: input.title });
    res.json({ app: setMaintenance(ctx, input), maintenance: getMaintenance(ctx.db) });
  });

  // --- Sauvegardes ---------------------------------------------------------------------------------------------------

  router.get('/admin/backups', (_req, res) => {
    requireGlobal(currentUser(res), 'backups.manage');
    res.json(backupOverview(ctx));
  });

  router.put('/admin/backups', (req, res) => {
    requireGlobal(currentUser(res), 'backups.manage');
    const config = saveBackupConfig(ctx, parse(backupConfigSchema, req.body));
    forgetDestinationRuns(ctx.db, config.destinations.map((destination) => destination.id));
    audit(res, `Sauvegardes ${config.enabled ? 'activées' : 'désactivées'} (${config.destinations.length} destination(s))`, { destinations: config.destinations.map((d) => ({ name: d.name, path: d.path })) });
    res.json(backupOverview(ctx));
  });

  router.post('/admin/backups/test-folder', (req, res) => {
    requireGlobal(currentUser(res), 'backups.manage');
    res.json(testFolder(parse(folderTestSchema, req.body).path));
  });

  /** Lance une sauvegarde et attend sa fin (le résultat est aussi visible dans l'historique). */
  router.post('/admin/backups/:destinationId/run', async (req, res) => {
    requireGlobal(currentUser(res), 'backups.manage');
    const destinationId = String(req.params.destinationId);
    audit(res, `Sauvegarde manuelle lancée (${destinationId})`);
    const run = await runBackup(ctx, destinationId, 'manual');
    res.json({ run, overview: backupOverview(ctx) });
  });

  // --- Installation en tant que service ------------------------------------------------------------------------------

  router.get('/admin/service', async (_req, res) => {
    requireGlobal(currentUser(res), 'system.manage');
    res.json({ status: await serviceStatus(ctx) });
  });

  router.post('/admin/service', async (req, res) => {
    requireGlobal(currentUser(res), 'system.manage');
    const { action, scope, dryRun } = parse(serviceActionSchema, req.body);
    if (!dryRun) audit(res, `Service : ${action} (${scope})`);
    res.json(await serviceAction(ctx, action, scope, dryRun));
  });

  // --- HTTP / HTTPS --------------------------------------------------------------------------------------------------

  const httpsStatus = (req: express.Request) => ctx.https!.status(req.secure);

  router.get('/admin/https', (req, res) => {
    requireGlobal(currentUser(res), 'system.manage');
    res.json({ settings: httpsSettingsDTO(ctx), status: httpsStatus(req) });
  });

  /** Enregistre et applique tout de suite (démarrage, rechargement des certificats ou arrêt de HTTPS, sans redémarrer). */
  router.put('/admin/https', async (req, res) => {
    requireGlobal(currentUser(res), 'system.manage');
    const input = parse(httpsSettingsSchema, req.body);
    if (input.enabled && input.port === ctx.https!.httpPort) {
      throw badRequest(`Le port HTTPS doit être différent du port HTTP (${ctx.https!.httpPort}).`);
    }
    if (input.enabled) {
      // Certificats vérifiés avant d'enregistrer : une erreur ne coupe pas un HTTPS qui fonctionne.
      try {
        loadTls(input, passphraseFor(ctx, input.passphrase));
      } catch (error) {
        throw badRequest((error as Error).message);
      }
    }
    const settings = saveHttpsSettings(ctx, input);
    await ctx.https!.apply();
    audit(res, `HTTPS ${settings.enabled ? `activé (port ${settings.port})` : 'désactivé'}`, { redirectHttp: settings.redirectHttp, hsts: settings.hsts, trustProxy: settings.trustProxy, format: settings.format });
    res.json({ settings, status: httpsStatus(req) });
  });

  /** Vérifie des certificats (même non enregistrés) : lisibles, clé correspondante, dates de validité. */
  router.post('/admin/https/test', (req, res) => {
    requireGlobal(currentUser(res), 'system.manage');
    const input = parse(httpsTestSchema, req.body);
    try {
      const material = loadTls(input, passphraseFor(ctx, input.passphrase));
      res.json({ ok: true, message: 'Certificat valide.', certificate: material.certificate });
    } catch (error) {
      res.json({ ok: false, message: (error as Error).message, certificate: null });
    }
  });

  /** Crée un certificat auto-signé (essais sur le réseau local) dans le dossier des données ; à enregistrer ensuite. */
  router.post('/admin/https/self-signed', (req, res) => {
    requireGlobal(currentUser(res), 'system.manage');
    const { hostnames } = parse(selfSignedSchema, req.body);
    const result = writeSelfSigned(ctx, hostnames);
    audit(res, `Certificat auto-signé créé (${hostnames.join(', ')})`, { certPath: result.certPath });
    res.json(result);
  });

  return router;
}
