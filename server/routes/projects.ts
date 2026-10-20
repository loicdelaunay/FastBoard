import express, { type Router } from 'express';
import { isSubsetOfPermissions } from '../../shared/permissions.ts';
import type { AppContext } from '../context.ts';
import { forbidden } from '../http/errors.ts';
import { actorOf, currentUser, sessionOnly } from '../http/middleware.ts';
import {
  activityQuerySchema,
  categoryPatchSchema,
  categorySchema,
  createProjectSchema,
  createTicketSchema,
  deliveryPatchSchema,
  deliverySchema,
  listItemPatchSchema,
  listItemSchema,
  memberRoleSchema,
  memberSchema,
  ticketQuerySchema,
  updateProjectSchema,
} from '../http/schemas.ts';
import { idParam, parse } from '../http/validate.ts';
import { requireGlobal, requireProject } from '../services/access.ts';
import { listActivities } from '../services/activity.ts';
import {
  addMember,
  buildSnapshot,
  changeMemberRole,
  createProject,
  deleteProject,
  listProjectSummaries,
  removeMember,
  updateProject,
} from '../services/projects.ts';
import {
  createCategory,
  createDelivery,
  deleteCategory,
  deleteDelivery,
  updateCategory,
  updateDelivery,
} from '../services/projectConfig.ts';
import { parsePermissions } from '../services/rows.ts';
import { createItem, deleteItem, updateItem } from '../services/projectLists.ts';
import { createTicket, queryTickets } from '../services/tickets.ts';

export function projectsRouter(ctx: AppContext): Router {
  const router = express.Router();

  router.get('/projects', (_req, res) => {
    res.json({ projects: listProjectSummaries(ctx.db, currentUser(res)) });
  });

  router.post('/projects', (req, res) => {
    const user = currentUser(res);
    requireGlobal(user, 'projects.create');
    if (user.token?.projectIds) {
      throw forbidden('Ce jeton est limité à certains projets : il ne peut pas en créer de nouveau.');
    }
    const project = createProject(ctx, user, parse(createProjectSchema, req.body));
    res.status(201).json({ project });
  });

  router.get('/projects/:id', (req, res) => {
    const access = requireProject(ctx, currentUser(res), idParam(req.params.id));
    res.json(buildSnapshot(ctx.db, access));
  });

  router.patch('/projects/:id', (req, res) => {
    const projectId = idParam(req.params.id);
    requireProject(ctx, currentUser(res), projectId, 'project.edit');
    const project = updateProject(ctx, actorOf(req, res), projectId, parse(updateProjectSchema, req.body));
    res.json({ project });
  });

  router.delete('/projects/:id', sessionOnly(), (req, res) => {
    const projectId = idParam(req.params.id);
    requireProject(ctx, currentUser(res), projectId, 'project.delete');
    deleteProject(ctx, projectId);
    res.json({ ok: true });
  });

  // --- Membres -------------------------------------------------------------------------------------------------------

  /** Un membre ne peut attribuer / modifier que des rôles dont les permissions sont un sous-ensemble des siennes. */
  function assertCanGrant(roleId: number, actorPermissions: Set<string>): void {
    const role = ctx.db.get<{ permissions: string }>("SELECT permissions FROM roles WHERE id = ? AND scope = 'project'", roleId);
    if (!role || !isSubsetOfPermissions(parsePermissions(role.permissions), [...actorPermissions])) {
      throw forbidden("Vous ne pouvez pas attribuer un rôle plus privilégié que le vôtre.");
    }
  }

  router.post('/projects/:id/members', (req, res) => {
    const projectId = idParam(req.params.id);
    const access = requireProject(ctx, currentUser(res), projectId, 'project.members');
    const { userId, roleId } = parse(memberSchema, req.body);
    assertCanGrant(roleId, access.permissions);
    addMember(ctx, actorOf(req, res), projectId, userId, roleId);
    res.status(201).json({ ok: true });
  });

  router.patch('/projects/:id/members/:userId', (req, res) => {
    const projectId = idParam(req.params.id);
    const access = requireProject(ctx, currentUser(res), projectId, 'project.members');
    const userId = idParam(req.params.userId);
    const { roleId } = parse(memberRoleSchema, req.body);
    assertCanGrant(roleId, access.permissions);
    const current = ctx.db.get<{ permissions: string }>(
      'SELECT r.permissions FROM project_members m JOIN roles r ON r.id = m.role_id WHERE m.project_id = ? AND m.user_id = ?',
      projectId,
      userId,
    );
    if (current && !isSubsetOfPermissions(parsePermissions(current.permissions), [...access.permissions])) {
      throw forbidden('Vous ne pouvez pas modifier un membre plus privilégié que vous.');
    }
    changeMemberRole(ctx, actorOf(req, res), projectId, userId, roleId);
    res.json({ ok: true });
  });

  router.delete('/projects/:id/members/:userId', (req, res) => {
    const projectId = idParam(req.params.id);
    const user = currentUser(res);
    const userId = idParam(req.params.userId);
    if (userId === user.id) {
      // Quitter un projet est toujours permis (sauf pour le dernier propriétaire, vérifié par le service).
      requireProject(ctx, user, projectId);
    } else {
      const access = requireProject(ctx, user, projectId, 'project.members');
      const target = ctx.db.get<{ permissions: string }>(
        'SELECT r.permissions FROM project_members m JOIN roles r ON r.id = m.role_id WHERE m.project_id = ? AND m.user_id = ?',
        projectId,
        userId,
      );
      if (target && !isSubsetOfPermissions(parsePermissions(target.permissions), [...access.permissions])) {
        throw forbidden('Vous ne pouvez pas retirer un membre plus privilégié que vous.');
      }
    }
    removeMember(ctx, actorOf(req, res), projectId, userId);
    res.json({ ok: true });
  });

  // --- Catégories ----------------------------------------------------------------------------------------------------

  router.post('/projects/:id/categories', (req, res) => {
    const projectId = idParam(req.params.id);
    requireProject(ctx, currentUser(res), projectId, 'project.edit');
    res.status(201).json({ category: createCategory(ctx, actorOf(req, res), projectId, parse(categorySchema, req.body)) });
  });

  router.patch('/projects/:id/categories/:categoryId', (req, res) => {
    const projectId = idParam(req.params.id);
    requireProject(ctx, currentUser(res), projectId, 'project.edit');
    const category = updateCategory(ctx, actorOf(req, res), projectId, idParam(req.params.categoryId), parse(categoryPatchSchema, req.body));
    res.json({ category });
  });

  router.delete('/projects/:id/categories/:categoryId', (req, res) => {
    const projectId = idParam(req.params.id);
    requireProject(ctx, currentUser(res), projectId, 'project.edit');
    deleteCategory(ctx, actorOf(req, res), projectId, idParam(req.params.categoryId));
    res.json({ ok: true });
  });

  // --- Priorités et composants (même forme : nom, couleur, icône, ordre) --------------------------------------------

  router.post('/projects/:id/priorities', (req, res) => {
    const projectId = idParam(req.params.id);
    requireProject(ctx, currentUser(res), projectId, 'project.edit');
    res.status(201).json({ priority: createItem(ctx, actorOf(req, res), 'priority', projectId, parse(listItemSchema, req.body)) });
  });

  router.patch('/projects/:id/priorities/:priorityId', (req, res) => {
    const projectId = idParam(req.params.id);
    requireProject(ctx, currentUser(res), projectId, 'project.edit');
    res.json({ priority: updateItem(ctx, actorOf(req, res), 'priority', projectId, idParam(req.params.priorityId), parse(listItemPatchSchema, req.body)) });
  });

  router.delete('/projects/:id/priorities/:priorityId', (req, res) => {
    const projectId = idParam(req.params.id);
    requireProject(ctx, currentUser(res), projectId, 'project.edit');
    deleteItem(ctx, actorOf(req, res), 'priority', projectId, idParam(req.params.priorityId));
    res.json({ ok: true });
  });

  router.post('/projects/:id/components', (req, res) => {
    const projectId = idParam(req.params.id);
    requireProject(ctx, currentUser(res), projectId, 'project.edit');
    res.status(201).json({ component: createItem(ctx, actorOf(req, res), 'component', projectId, parse(listItemSchema, req.body)) });
  });

  router.patch('/projects/:id/components/:componentId', (req, res) => {
    const projectId = idParam(req.params.id);
    requireProject(ctx, currentUser(res), projectId, 'project.edit');
    res.json({ component: updateItem(ctx, actorOf(req, res), 'component', projectId, idParam(req.params.componentId), parse(listItemPatchSchema, req.body)) });
  });

  router.delete('/projects/:id/components/:componentId', (req, res) => {
    const projectId = idParam(req.params.id);
    requireProject(ctx, currentUser(res), projectId, 'project.edit');
    deleteItem(ctx, actorOf(req, res), 'component', projectId, idParam(req.params.componentId));
    res.json({ ok: true });
  });

  // --- Livraisons ----------------------------------------------------------------------------------------------------

  router.post('/projects/:id/deliveries', (req, res) => {
    const projectId = idParam(req.params.id);
    requireProject(ctx, currentUser(res), projectId, 'project.edit');
    res.status(201).json({ delivery: createDelivery(ctx, actorOf(req, res), projectId, parse(deliverySchema, req.body)) });
  });

  router.patch('/projects/:id/deliveries/:deliveryId', (req, res) => {
    const projectId = idParam(req.params.id);
    requireProject(ctx, currentUser(res), projectId, 'project.edit');
    const delivery = updateDelivery(ctx, actorOf(req, res), projectId, idParam(req.params.deliveryId), parse(deliveryPatchSchema, req.body));
    res.json({ delivery });
  });

  router.delete('/projects/:id/deliveries/:deliveryId', (req, res) => {
    const projectId = idParam(req.params.id);
    requireProject(ctx, currentUser(res), projectId, 'project.edit');
    deleteDelivery(ctx, actorOf(req, res), projectId, idParam(req.params.deliveryId));
    res.json({ ok: true });
  });

  // --- Tickets (création) --------------------------------------------------------------------------------------------

  /** Liste filtrée et paginée des tickets (pratique pour un agent : évite de charger tout le projet). */
  router.get('/projects/:id/tickets', (req, res) => {
    const user = currentUser(res);
    const projectId = idParam(req.params.id);
    requireProject(ctx, user, projectId);
    const query = parse(ticketQuerySchema, req.query);
    res.json(
      queryTickets(ctx.db, projectId, {
        statuses: query.status,
        categoryId: query.categoryId,
        priorityId: query.priorityId,
        componentId: query.componentId,
        deliveryId: query.deliveryId === 'none' ? null : query.deliveryId,
        assigneeId: query.assigneeId === 'me' ? user.id : query.assigneeId,
        key: query.key,
        text: query.q,
        updatedSince: query.updatedSince,
        limit: query.limit,
        offset: query.offset,
      }),
    );
  });

  /** Journal d'activité du projet (le plus récent d'abord), paginé par curseur. */
  router.get('/projects/:id/activity', (req, res) => {
    const projectId = idParam(req.params.id);
    requireProject(ctx, currentUser(res), projectId);
    const query = parse(activityQuerySchema, req.query);
    res.json(
      listActivities(ctx.db, projectId, {
        limit: query.limit,
        before: query.before,
        groups: query.group,
        userId: query.userId,
        source: query.source ?? (query.viaApi ? 'api' : undefined),
        ticketId: query.ticketId,
      }),
    );
  });

  router.post('/projects/:id/tickets', (req, res) => {
    const projectId = idParam(req.params.id);
    requireProject(ctx, currentUser(res), projectId, 'ticket.create');
    const ticket = createTicket(ctx, actorOf(req, res), projectId, parse(createTicketSchema, req.body));
    res.status(201).json({ ticket });
  });

  return router;
}
