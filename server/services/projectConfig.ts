import type { CategoryDTO, DeliveryDTO } from '../../shared/types.ts';
import type { Actor, AppContext } from '../context.ts';
import { badRequest, conflict, notFound } from '../http/errors.ts';
import { logActivity } from './activity.ts';
import { toCategoryDTO, toDeliveryDTO, type CategoryRow, type DeliveryRow } from './rows.ts';

// --- Catégories (réglables par projet) -------------------------------------------------------------------------------

function requireCategory(ctx: AppContext, projectId: number, categoryId: number): CategoryRow {
  const row = ctx.db.get<CategoryRow>('SELECT * FROM categories WHERE id = ? AND project_id = ?', categoryId, projectId);
  if (!row) {
    throw notFound('Catégorie introuvable.');
  }
  return row;
}

function assertCategoryNameFree(ctx: AppContext, projectId: number, name: string, exceptId?: number): void {
  const existing = ctx.db.get<{ id: number }>(
    'SELECT id FROM categories WHERE project_id = ? AND name = ? COLLATE NOCASE',
    projectId,
    name,
  );
  if (existing && existing.id !== exceptId) {
    throw conflict('Une catégorie porte déjà ce nom dans le projet.');
  }
}

export function createCategory(ctx: AppContext, actor: Actor, projectId: number, input: { name: string; color: string }): CategoryDTO {
  assertCategoryNameFree(ctx, projectId, input.name);
  const next = ctx.db.get<{ n: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM categories WHERE project_id = ?', projectId);
  const { lastInsertRowid } = ctx.db.run(
    'INSERT INTO categories (project_id, name, color, position) VALUES (?, ?, ?, ?)',
    projectId,
    input.name,
    input.color,
    next?.n ?? 0,
  );
  const category = toCategoryDTO(requireCategory(ctx, projectId, lastInsertRowid));
  ctx.hub.publish(projectId, [{ type: 'category.upserted', category }], actor);
  logActivity(ctx, actor, projectId, { kind: 'category', action: 'created', name: category.name });
  return category;
}

export function updateCategory(
  ctx: AppContext,
  actor: Actor,
  projectId: number,
  categoryId: number,
  patch: { name?: string; color?: string },
): CategoryDTO {
  const row = requireCategory(ctx, projectId, categoryId);
  if (patch.name !== undefined) {
    assertCategoryNameFree(ctx, projectId, patch.name, categoryId);
  }
  ctx.db.run(
    'UPDATE categories SET name = ?, color = ? WHERE id = ?',
    patch.name ?? row.name,
    patch.color ?? row.color,
    categoryId,
  );
  const category = toCategoryDTO(requireCategory(ctx, projectId, categoryId));
  ctx.hub.publish(projectId, [{ type: 'category.upserted', category }], actor);
  logActivity(ctx, actor, projectId, {
    kind: 'category',
    action: 'updated',
    name: category.name,
    ...(row.name !== category.name ? { previousName: row.name } : {}),
  });
  return category;
}

export function deleteCategory(ctx: AppContext, actor: Actor, projectId: number, categoryId: number): void {
  const row = requireCategory(ctx, projectId, categoryId);
  ctx.db.run('DELETE FROM categories WHERE id = ?', categoryId);
  ctx.hub.publish(projectId, [{ type: 'category.deleted', categoryId }], actor);
  logActivity(ctx, actor, projectId, { kind: 'category', action: 'deleted', name: row.name });
}

// --- Livraisons ------------------------------------------------------------------------------------------------------

function requireDelivery(ctx: AppContext, projectId: number, deliveryId: number): DeliveryRow {
  const row = ctx.db.get<DeliveryRow>('SELECT * FROM deliveries WHERE id = ? AND project_id = ?', deliveryId, projectId);
  if (!row) {
    throw notFound('Livraison introuvable.');
  }
  return row;
}

export interface DeliveryInput {
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
  color?: string;
}

export function createDelivery(ctx: AppContext, actor: Actor, projectId: number, input: DeliveryInput): DeliveryDTO {
  if (input.startDate > input.endDate) {
    throw badRequest('La date de début doit précéder la date de fin.');
  }
  const next = ctx.db.get<{ n: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM deliveries WHERE project_id = ?', projectId);
  const { lastInsertRowid } = ctx.db.run(
    'INSERT INTO deliveries (project_id, name, description, start_date, end_date, color, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
    projectId,
    input.name,
    input.description ?? '',
    input.startDate,
    input.endDate,
    input.color ?? '#0ea5e9',
    next?.n ?? 0,
  );
  const delivery = toDeliveryDTO(requireDelivery(ctx, projectId, lastInsertRowid));
  ctx.hub.publish(projectId, [{ type: 'delivery.upserted', delivery }], actor);
  logActivity(ctx, actor, projectId, { kind: 'delivery', action: 'created', name: delivery.name, startDate: delivery.startDate, endDate: delivery.endDate });
  return delivery;
}

export function updateDelivery(
  ctx: AppContext,
  actor: Actor,
  projectId: number,
  deliveryId: number,
  patch: Partial<DeliveryInput>,
): DeliveryDTO {
  const row = requireDelivery(ctx, projectId, deliveryId);
  const startDate = patch.startDate ?? row.start_date;
  const endDate = patch.endDate ?? row.end_date;
  if (startDate > endDate) {
    throw badRequest('La date de début doit précéder la date de fin.');
  }
  ctx.db.run(
    'UPDATE deliveries SET name = ?, description = ?, start_date = ?, end_date = ?, color = ? WHERE id = ?',
    patch.name ?? row.name,
    patch.description ?? row.description,
    startDate,
    endDate,
    patch.color ?? row.color,
    deliveryId,
  );
  const delivery = toDeliveryDTO(requireDelivery(ctx, projectId, deliveryId));
  ctx.hub.publish(projectId, [{ type: 'delivery.upserted', delivery }], actor);
  logActivity(ctx, actor, projectId, {
    kind: 'delivery',
    action: 'updated',
    name: delivery.name,
    startDate: delivery.startDate,
    endDate: delivery.endDate,
    ...(row.name !== delivery.name ? { previousName: row.name } : {}),
  });
  return delivery;
}

export function deleteDelivery(ctx: AppContext, actor: Actor, projectId: number, deliveryId: number): void {
  const row = requireDelivery(ctx, projectId, deliveryId);
  ctx.db.run('DELETE FROM deliveries WHERE id = ?', deliveryId);
  ctx.hub.publish(projectId, [{ type: 'delivery.deleted', deliveryId }], actor);
  logActivity(ctx, actor, projectId, { kind: 'delivery', action: 'deleted', name: row.name });
}
