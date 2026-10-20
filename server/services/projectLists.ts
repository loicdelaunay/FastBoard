import type { ProjectEvent } from '../../shared/realtime.ts';
import type { ProjectListItemDTO } from '../../shared/types.ts';
import type { Actor, AppContext } from '../context.ts';
import type { Db } from '../db/database.ts';
import { conflict, notFound } from '../http/errors.ts';
import { logActivity } from './activity.ts';
import { toListItemDTO, type ListItemRow } from './rows.ts';

/** Listes réglables par projet qui partagent la même forme : nom, couleur, icône, ordre. */
export type ProjectListKind = 'priority' | 'component';

const LISTS: Record<ProjectListKind, { table: string; notFound: string; duplicate: string }> = {
  priority: { table: 'priorities', notFound: 'Priorité introuvable.', duplicate: 'Une priorité porte déjà ce nom dans le projet.' },
  component: { table: 'components', notFound: 'Composant introuvable.', duplicate: 'Un composant porte déjà ce nom dans le projet.' },
};

export interface ListItemInput {
  name: string;
  color: string;
  icon: string;
}

function upserted(kind: ProjectListKind, item: ProjectListItemDTO): ProjectEvent {
  return kind === 'priority' ? { type: 'priority.upserted', priority: item } : { type: 'component.upserted', component: item };
}

export function listItems(db: Db, kind: ProjectListKind, projectId: number): ProjectListItemDTO[] {
  return db.all<ListItemRow>(`SELECT * FROM ${LISTS[kind].table} WHERE project_id = ? ORDER BY position, id`, projectId).map(toListItemDTO);
}

function requireItem(db: Db, kind: ProjectListKind, projectId: number, itemId: number): ListItemRow {
  const row = db.get<ListItemRow>(`SELECT * FROM ${LISTS[kind].table} WHERE id = ? AND project_id = ?`, itemId, projectId);
  if (!row) {
    throw notFound(LISTS[kind].notFound);
  }
  return row;
}

function assertNameFree(db: Db, kind: ProjectListKind, projectId: number, name: string, exceptId?: number): void {
  const existing = db.get<{ id: number }>(`SELECT id FROM ${LISTS[kind].table} WHERE project_id = ? AND name = ? COLLATE NOCASE`, projectId, name);
  if (existing && existing.id !== exceptId) {
    throw conflict(LISTS[kind].duplicate);
  }
}

export function createItem(ctx: AppContext, actor: Actor, kind: ProjectListKind, projectId: number, input: ListItemInput): ProjectListItemDTO {
  const { table } = LISTS[kind];
  assertNameFree(ctx.db, kind, projectId, input.name);
  const next = ctx.db.get<{ n: number }>(`SELECT COALESCE(MAX(position), -1) + 1 AS n FROM ${table} WHERE project_id = ?`, projectId);
  const { lastInsertRowid } = ctx.db.run(`INSERT INTO ${table} (project_id, name, color, icon, position) VALUES (?, ?, ?, ?, ?)`, projectId, input.name, input.color, input.icon, next?.n ?? 0);
  const item = toListItemDTO(requireItem(ctx.db, kind, projectId, lastInsertRowid));
  ctx.hub.publish(projectId, [upserted(kind, item)], actor);
  logActivity(ctx, actor, projectId, { kind, action: 'created', name: item.name });
  return item;
}

/** Modifie un élément ; `position` le déplace dans la liste (les autres sont renumérotés). */
export function updateItem(
  ctx: AppContext,
  actor: Actor,
  kind: ProjectListKind,
  projectId: number,
  itemId: number,
  patch: Partial<ListItemInput> & { position?: number },
): ProjectListItemDTO {
  const { db } = ctx;
  const { table } = LISTS[kind];
  const row = requireItem(db, kind, projectId, itemId);
  if (patch.name !== undefined) {
    assertNameFree(db, kind, projectId, patch.name, itemId);
  }
  const events: ProjectEvent[] = [];
  db.transaction(() => {
    db.run(`UPDATE ${table} SET name = ?, color = ?, icon = ? WHERE id = ?`, patch.name ?? row.name, patch.color ?? row.color, patch.icon ?? row.icon, itemId);
    if (patch.position !== undefined) {
      const ordered = listItems(db, kind, projectId).filter((item) => item.id !== itemId);
      ordered.splice(Math.max(0, Math.min(patch.position, ordered.length)), 0, toListItemDTO(requireItem(db, kind, projectId, itemId)));
      ordered.forEach((item, index) => {
        if (item.position !== index || item.id === itemId) {
          db.run(`UPDATE ${table} SET position = ? WHERE id = ?`, index, item.id);
        }
      });
      for (const item of listItems(db, kind, projectId)) {
        if (item.id !== itemId) events.push(upserted(kind, item));
      }
    }
  });
  const item = toListItemDTO(requireItem(db, kind, projectId, itemId));
  ctx.hub.publish(projectId, [upserted(kind, item), ...events], actor);
  if (patch.name !== undefined || patch.color !== undefined || patch.icon !== undefined) {
    logActivity(ctx, actor, projectId, { kind, action: 'updated', name: item.name, ...(row.name !== item.name ? { previousName: row.name } : {}) });
  }
  return item;
}

export function deleteItem(ctx: AppContext, actor: Actor, kind: ProjectListKind, projectId: number, itemId: number): void {
  const row = requireItem(ctx.db, kind, projectId, itemId);
  ctx.db.run(`DELETE FROM ${LISTS[kind].table} WHERE id = ?`, itemId);
  ctx.hub.publish(projectId, [kind === 'priority' ? { type: 'priority.deleted', priorityId: itemId } : { type: 'component.deleted', componentId: itemId }], actor);
  logActivity(ctx, actor, projectId, { kind, action: 'deleted', name: row.name });
}
