import { emptyTicketFilters, SAVED_FILTER_LIMITS, type SavedFilterDTO, type TicketFilterValues } from '../../shared/ticketFilters.ts';
import type { Actor, AppContext } from '../context.ts';
import { nowIso, type Db } from '../db/database.ts';
import { conflict, forbidden, notFound } from '../http/errors.ts';
import { requireProject, type AuthUser, type ProjectAccess } from './access.ts';

/**
 * Filtres enregistrés d'un projet : chacun garde les siens, et peut en partager avec tout le projet. Un filtre partagé
 * porte le nom de qui l'a créé ; il se modifie et se supprime par son auteur, ou par qui gère le projet (`project.edit`).
 */

interface FilterRow {
  id: number;
  project_id: number;
  user_id: number | null;
  name: string;
  description: string;
  filters: string;
  shared: number;
  created_at: string;
  updated_at: string;
  author: string | null;
}

const SELECT = 'SELECT f.*, u.name AS author FROM ticket_filters f LEFT JOIN users u ON u.id = f.user_id';

/** Filtres relus en base : ce qui manque prend sa valeur par défaut. */
function parseFilters(raw: string): TicketFilterValues {
  try {
    return { ...emptyTicketFilters(), ...(JSON.parse(raw) as Partial<TicketFilterValues>) };
  } catch {
    return emptyTicketFilters();
  }
}

function canEdit(row: Pick<FilterRow, 'user_id'>, user: AuthUser, access: ProjectAccess): boolean {
  return row.user_id === user.id || access.permissions.has('project.edit');
}

function toDTO(row: FilterRow, user: AuthUser | null, access: ProjectAccess | null): SavedFilterDTO {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    filters: parseFilters(row.filters),
    shared: row.shared === 1,
    createdBy: row.user_id,
    createdByName: row.author,
    canEdit: user !== null && access !== null && canEdit(row, user, access),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Filtres visibles par la personne : les siens, puis ceux partagés par les autres. */
export function listSavedFilters(db: Db, user: AuthUser, access: ProjectAccess): SavedFilterDTO[] {
  // Ordre alphabétique à la française (« À tester » avant « Mes urgences »), les siens d'abord.
  return db
    .all<FilterRow>(`${SELECT} WHERE f.project_id = ? AND (f.user_id = ? OR f.shared = 1) ORDER BY f.id`, access.project.id, user.id)
    .sort((a, b) => Number(b.user_id === user.id) - Number(a.user_id === user.id) || a.name.localeCompare(b.name, 'fr', { sensitivity: 'base', numeric: true }))
    .map((row) => toDTO(row, user, access));
}

function requireFilter(ctx: AppContext, user: AuthUser, filterId: number): { row: FilterRow; access: ProjectAccess } {
  const row = ctx.db.get<FilterRow>(`${SELECT} WHERE f.id = ?`, filterId);
  // Le filtre personnel d'un autre n'existe pas pour elle.
  if (!row || (row.user_id !== user.id && row.shared !== 1)) throw notFound('Filtre introuvable.');
  return { row, access: requireProject(ctx, user, row.project_id) };
}

export interface SavedFilterInput {
  name: string;
  description: string;
  filters: TicketFilterValues;
  shared: boolean;
}

/** Un filtre partagé est un évènement du projet (tous le voient) ; un filtre personnel ne regarde que son auteur. */
function publishShared(ctx: AppContext, actor: Actor, row: FilterRow, wasShared: boolean): void {
  if (row.shared === 1) ctx.hub.publish(row.project_id, [{ type: 'filter.saved', filter: toDTO(row, null, null) }], actor);
  else if (wasShared) ctx.hub.publish(row.project_id, [{ type: 'filter.deleted', filterId: row.id, keepFor: row.user_id }], actor);
}

export function createSavedFilter(ctx: AppContext, actor: Actor, user: AuthUser, projectId: number, input: SavedFilterInput): SavedFilterDTO {
  const access = requireProject(ctx, user, projectId);
  const count = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ticket_filters WHERE project_id = ? AND user_id = ?', projectId, user.id)?.n ?? 0;
  if (count >= SAVED_FILTER_LIMITS.perUser) throw conflict(`Vous ne pouvez pas garder plus de ${SAVED_FILTER_LIMITS.perUser} filtres dans un projet.`);
  const now = nowIso();
  const id = ctx.db.run(
    'INSERT INTO ticket_filters (project_id, user_id, name, description, filters, shared, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    projectId,
    user.id,
    input.name,
    input.description,
    JSON.stringify(input.filters),
    input.shared ? 1 : 0,
    now,
    now,
  ).lastInsertRowid;
  const row = ctx.db.get<FilterRow>(`${SELECT} WHERE f.id = ?`, id)!;
  publishShared(ctx, actor, row, false);
  return toDTO(row, user, access);
}

export function updateSavedFilter(ctx: AppContext, actor: Actor, user: AuthUser, filterId: number, patch: Partial<SavedFilterInput>): SavedFilterDTO {
  const { row, access } = requireFilter(ctx, user, filterId);
  if (!canEdit(row, user, access)) throw forbidden('Seul son auteur, ou qui gère le projet, modifie ce filtre.');
  // Un filtre partagé repasse personnel seulement par son auteur (il le garde).
  if (patch.shared === false && row.user_id !== user.id) throw forbidden('Seul son auteur peut ne plus partager ce filtre.');
  ctx.db.run(
    'UPDATE ticket_filters SET name = ?, description = ?, filters = ?, shared = ?, updated_at = ? WHERE id = ?',
    patch.name ?? row.name,
    patch.description ?? row.description,
    patch.filters ? JSON.stringify(patch.filters) : row.filters,
    patch.shared === undefined ? row.shared : patch.shared ? 1 : 0,
    nowIso(),
    filterId,
  );
  const fresh = ctx.db.get<FilterRow>(`${SELECT} WHERE f.id = ?`, filterId)!;
  publishShared(ctx, actor, fresh, row.shared === 1);
  return toDTO(fresh, user, access);
}

export function deleteSavedFilter(ctx: AppContext, actor: Actor, user: AuthUser, filterId: number): void {
  const { row, access } = requireFilter(ctx, user, filterId);
  if (!canEdit(row, user, access)) throw forbidden('Seul son auteur, ou qui gère le projet, supprime ce filtre.');
  ctx.db.run('DELETE FROM ticket_filters WHERE id = ?', filterId);
  if (row.shared === 1) ctx.hub.publish(row.project_id, [{ type: 'filter.deleted', filterId, keepFor: null }], actor);
}
