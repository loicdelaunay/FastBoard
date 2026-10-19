import express, { type Response, type Router } from 'express';
import { permissionCatalog } from '../../shared/permissions.ts';
import { listAllApiTokens, revokeApiToken } from '../auth/tokens.ts';
import type { AppContext } from '../context.ts';
import { currentUser, sessionOnly } from '../http/middleware.ts';
import { createRoleSchema, createUserSchema, logQuerySchema, monitoringQuerySchema, updateRoleSchema, updateUserSchema, type LogQueryParams } from '../http/schemas.ts';
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

  return router;
}
