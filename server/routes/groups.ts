import express, { type Router } from 'express';
import type { AppContext } from '../context.ts';
import { actorOf, currentUser } from '../http/middleware.ts';
import { groupMemberSchema, groupPatchSchema, groupSchema } from '../http/schemas.ts';
import { idParam, parse } from '../http/validate.ts';
import { requireGlobal } from '../services/access.ts';
import { createGroup, deleteGroup, getGroup, groupAccess, listGroups, removeGroupMember, setGroupMember, updateGroup } from '../services/groups.ts';

/**
 * Groupes de personnes. Chacun voit tous les groupes (pour les ajouter à ce qu'il partage) ; `groups.create` en crée,
 * leurs gestionnaires (ou `groups.manage`) les modifient. Leurs accès aux projets et aux espaces se donnent depuis
 * ces projets et espaces.
 */
export function groupsRouter(ctx: AppContext): Router {
  const router = express.Router();

  router.get('/groups', (_req, res) => {
    res.json({ groups: listGroups(ctx.db, currentUser(res)) });
  });

  router.post('/groups', (req, res) => {
    const user = currentUser(res);
    requireGlobal(user, 'groups.create');
    res.status(201).json({ group: createGroup(ctx, user, parse(groupSchema, req.body)) });
  });

  router.get('/groups/:id', (req, res) => {
    const user = currentUser(res);
    const groupId = idParam(req.params.id);
    res.json({ group: getGroup(ctx.db, user, groupId), access: groupAccess(ctx, user, groupId) });
  });

  router.patch('/groups/:id', (req, res) => {
    res.json({ group: updateGroup(ctx, actorOf(req, res), currentUser(res), idParam(req.params.id), parse(groupPatchSchema, req.body)) });
  });

  router.delete('/groups/:id', (req, res) => {
    deleteGroup(ctx, actorOf(req, res), currentUser(res), idParam(req.params.id));
    res.json({ ok: true });
  });

  router.put('/groups/:id/members/:userId', (req, res) => {
    const { role } = parse(groupMemberSchema, req.body ?? {});
    res.json({ group: setGroupMember(ctx, actorOf(req, res), currentUser(res), idParam(req.params.id), idParam(req.params.userId), role) });
  });

  router.delete('/groups/:id/members/:userId', (req, res) => {
    res.json({ group: removeGroupMember(ctx, actorOf(req, res), currentUser(res), idParam(req.params.id), idParam(req.params.userId)) });
  });

  return router;
}
