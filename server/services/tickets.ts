import type { TicketStatus } from '../../shared/constants.ts';
import type { ProjectEvent } from '../../shared/realtime.ts';
import { CUSTOM_FIELD_LIMITS, coerceCustomValue, type CustomFieldValue } from '../../shared/ticketFields.ts';
import type { AssigneeDTO, HistoryChange, HistoryEntryDTO, NameRef, TicketDTO } from '../../shared/types.ts';
import type { Actor, AppContext } from '../context.ts';
import { nowIso, type Db, type SqlParam } from '../db/database.ts';
import { badRequest, notFound } from '../http/errors.ts';
import { logActivity } from './activity.ts';
import { removeStoredFiles, storagesOfTicket } from './attachments.ts';
import { addHistory } from './history.ts';
import { queueMentions, watchTicket } from './notifications.ts';
import { assertStatusAvailable, getProjectSettings } from './projectSettings.ts';
import { toLinkDTO, toProjectDTO, toSubtaskDTO, type AssigneeRow, type LinkRow, type ProjectRow, type SubtaskRow, type TicketRow } from './rows.ts';

const POSITION_STEP = 1024;
const MIN_GAP = 1e-6;

export interface CreateTicketInput {
  title: string;
  description?: string;
  status?: TicketStatus;
  categoryId?: number | null;
  priorityId?: number | null;
  componentIds?: number[];
  deliveryId?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  progress?: number;
  assigneeIds?: number[];
  /** Ticket parent (sous-ticket) ; `null` pour détacher. */
  parentId?: number | null;
  /** Champs personnalisés : fusionnés avec les valeurs actuelles, `null` efface. */
  customFields?: Record<string, unknown>;
}

export type UpdateTicketInput = Partial<CreateTicketInput>;

export interface PartInput {
  done?: boolean;
  progress?: number;
  /** Mission de la personne ; chaîne vide pour l'effacer. */
  note?: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------------------------------------------------

function toAssigneeDTO(row: AssigneeRow): AssigneeDTO {
  return { userId: row.user_id, done: row.done === 1, progress: row.progress, doneAt: row.done_at, note: row.note };
}

/** Données rattachées à un ticket, lues à part (une requête par type pour tout un projet). */
interface TicketExtras {
  assignees: AssigneeRow[];
  commentCount: number;
  attachmentCount: number;
  componentIds: number[];
  subtasks: SubtaskRow[];
  links: LinkRow[];
  watcherIds: number[];
}

function toTicketDTO(row: TicketRow, extras: TicketExtras): TicketDTO {
  return {
    id: row.id,
    projectId: row.project_id,
    number: row.number,
    title: row.title,
    description: row.description,
    status: row.status,
    categoryId: row.category_id,
    priorityId: row.priority_id,
    componentIds: extras.componentIds,
    parentId: row.parent_id,
    customFields: parseCustomFields(row.custom_fields),
    deliveryId: row.delivery_id,
    initialDeliveryId: row.initial_delivery_id,
    startDate: row.start_date,
    endDate: row.end_date,
    progress: row.progress,
    position: row.position,
    assignees: extras.assignees.map(toAssigneeDTO),
    commentCount: extras.commentCount,
    attachmentCount: extras.attachmentCount,
    subtasks: extras.subtasks.map(toSubtaskDTO),
    links: extras.links.map(toLinkDTO),
    watcherIds: extras.watcherIds,
    statusChangedAt: row.status_changed_at ?? row.updated_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export function findTicket(db: Db, ticketId: number): TicketRow | undefined {
  return db.get<TicketRow>('SELECT * FROM tickets WHERE id = ?', ticketId);
}

export function requireTicket(db: Db, ticketId: number): TicketRow {
  const ticket = findTicket(db, ticketId);
  if (!ticket) {
    throw notFound('Ticket introuvable.');
  }
  return ticket;
}

function groupBy<T>(rows: T[], key: (row: T) => number): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const row of rows) {
    const list = map.get(key(row));
    if (list) list.push(row);
    else map.set(key(row), [row]);
  }
  return map;
}

/** Lit les données rattachées aux tickets visés par `scope` (`t.project_id = ?` ou `t.id = ?`). */
function loadExtras(db: Db, scope: 'project' | 'ticket', id: number): (ticketId: number) => TicketExtras {
  const where = scope === 'project' ? 't.project_id = ?' : 't.id = ?';
  const assignees = groupBy(
    db.all<AssigneeRow>(`SELECT a.* FROM ticket_assignees a JOIN tickets t ON t.id = a.ticket_id WHERE ${where} ORDER BY a.assigned_at, a.user_id`, id),
    (row) => row.ticket_id,
  );
  const comments = new Map(
    db
      .all<{ ticket_id: number; n: number }>(`SELECT c.ticket_id, COUNT(*) AS n FROM ticket_comments c JOIN tickets t ON t.id = c.ticket_id WHERE ${where} AND c.deleted_at IS NULL GROUP BY c.ticket_id`, id)
      .map((entry) => [entry.ticket_id, entry.n]),
  );
  const files = new Map(
    db
      .all<{ ticket_id: number; n: number }>(`SELECT a.ticket_id, COUNT(*) AS n FROM ticket_attachments a JOIN tickets t ON t.id = a.ticket_id WHERE ${where} GROUP BY a.ticket_id`, id)
      .map((entry) => [entry.ticket_id, entry.n]),
  );
  const components = groupBy(
    db.all<{ ticket_id: number; component_id: number }>(
      `SELECT tc.ticket_id, tc.component_id FROM ticket_components tc JOIN tickets t ON t.id = tc.ticket_id JOIN components c ON c.id = tc.component_id
        WHERE ${where} ORDER BY c.position, c.id`,
      id,
    ),
    (row) => row.ticket_id,
  );
  const subtasks = groupBy(
    db.all<SubtaskRow>(`SELECT s.* FROM ticket_subtasks s JOIN tickets t ON t.id = s.ticket_id WHERE ${where} ORDER BY s.position, s.id`, id),
    (row) => row.ticket_id,
  );
  const links = groupBy(
    db.all<LinkRow>(`SELECT l.* FROM ticket_links l JOIN tickets t ON t.id = l.ticket_id WHERE ${where} ORDER BY l.id`, id),
    (row) => row.ticket_id,
  );
  const watchers = groupBy(
    db.all<{ ticket_id: number; user_id: number }>(`SELECT w.ticket_id, w.user_id FROM ticket_watchers w JOIN tickets t ON t.id = w.ticket_id WHERE ${where} ORDER BY w.created_at`, id),
    (row) => row.ticket_id,
  );
  return (ticketId) => ({
    watcherIds: (watchers.get(ticketId) ?? []).map((row) => row.user_id),
    assignees: assignees.get(ticketId) ?? [],
    commentCount: comments.get(ticketId) ?? 0,
    attachmentCount: files.get(ticketId) ?? 0,
    componentIds: (components.get(ticketId) ?? []).map((row) => row.component_id),
    subtasks: subtasks.get(ticketId) ?? [],
    links: links.get(ticketId) ?? [],
  });
}

export function getTicketDTO(db: Db, ticketId: number): TicketDTO {
  const row = requireTicket(db, ticketId);
  return toTicketDTO(row, loadExtras(db, 'ticket', ticketId)(ticketId));
}

export function listTicketDTOs(db: Db, projectId: number): TicketDTO[] {
  const rows = db.all<TicketRow>('SELECT * FROM tickets WHERE project_id = ? ORDER BY position, id', projectId);
  const extras = loadExtras(db, 'project', projectId);
  return rows.map((row) => toTicketDTO(row, extras(row.id)));
}

export interface TicketFilters {
  statuses?: TicketStatus[];
  categoryId?: number;
  priorityId?: number;
  componentId?: number;
  /** `null` = tickets sans livraison. */
  deliveryId?: number | null;
  /** `'none'` n'est pas géré ici : voir `assigneeId === undefined`. Un entier filtre sur un assigné. */
  assigneeId?: number | 'none';
  key?: string;
  text?: string;
  updatedSince?: string;
  limit: number;
  offset: number;
}

export function foldText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Liste filtrée et paginée des tickets d'un projet, triée par numéro. */
export function queryTickets(db: Db, projectId: number, filters: TicketFilters): { tickets: TicketDTO[]; total: number } {
  const projectKey = db.get<{ key: string }>('SELECT key FROM projects WHERE id = ?', projectId)?.key ?? '';
  const text = filters.text ? foldText(filters.text) : '';
  const wantedKey = filters.key?.toUpperCase();

  const matching = listTicketDTOs(db, projectId).filter((ticket) => {
    if (filters.statuses?.length && !filters.statuses.includes(ticket.status)) return false;
    if (filters.categoryId !== undefined && ticket.categoryId !== filters.categoryId) return false;
    if (filters.priorityId !== undefined && ticket.priorityId !== filters.priorityId) return false;
    if (filters.componentId !== undefined && !ticket.componentIds.includes(filters.componentId)) return false;
    if (filters.deliveryId !== undefined && ticket.deliveryId !== filters.deliveryId) return false;
    if (filters.assigneeId === 'none' && ticket.assignees.length > 0) return false;
    if (typeof filters.assigneeId === 'number' && !ticket.assignees.some((a) => a.userId === filters.assigneeId)) return false;
    if (wantedKey && `${projectKey}-${ticket.number}`.toUpperCase() !== wantedKey) return false;
    if (filters.updatedSince && ticket.updatedAt <= filters.updatedSince) return false;
    if (text && !foldText(`${projectKey}-${ticket.number} ${ticket.title} ${ticket.description}`).includes(text)) return false;
    return true;
  });
  matching.sort((a, b) => a.number - b.number);
  return { tickets: matching.slice(filters.offset, filters.offset + filters.limit), total: matching.length };
}

// ---------------------------------------------------------------------------------------------------------------------
// Aides internes
// ---------------------------------------------------------------------------------------------------------------------

function truncate(text: string, max = 140): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function endPosition(db: Db, projectId: number, status: TicketStatus, excludeId?: number): number {
  const row = db.get<{ max: number | null }>(
    'SELECT MAX(position) AS max FROM tickets WHERE project_id = ? AND status = ? AND id != ?',
    projectId,
    status,
    excludeId ?? -1,
  );
  return (row?.max ?? 0) + POSITION_STEP;
}

function assertCategory(db: Db, projectId: number, categoryId: number | null | undefined): void {
  if (categoryId == null) {
    return;
  }
  if (!db.get('SELECT 1 FROM categories WHERE id = ? AND project_id = ?', categoryId, projectId)) {
    throw badRequest("Cette catégorie n'appartient pas au projet.");
  }
}

function assertPriority(db: Db, projectId: number, priorityId: number | null | undefined): void {
  if (priorityId == null) {
    return;
  }
  if (!db.get('SELECT 1 FROM priorities WHERE id = ? AND project_id = ?', priorityId, projectId)) {
    throw badRequest("Cette priorité n'appartient pas au projet.");
  }
}

function assertComponents(db: Db, projectId: number, componentIds: number[]): void {
  for (const componentId of componentIds) {
    if (!db.get('SELECT 1 FROM components WHERE id = ? AND project_id = ?', componentId, projectId)) {
      throw badRequest("Ce composant n'appartient pas au projet.");
    }
  }
}

function priorityName(db: Db, id: number | null): string | null {
  return id === null ? null : (db.get<{ name: string }>('SELECT name FROM priorities WHERE id = ?', id)?.name ?? null);
}

function componentNames(db: Db, ticketId: number): string {
  return db
    .all<{ name: string }>('SELECT c.name FROM ticket_components tc JOIN components c ON c.id = tc.component_id WHERE tc.ticket_id = ? ORDER BY c.position, c.id', ticketId)
    .map((row) => row.name)
    .join(', ');
}

/** Remplace les composants d'un ticket ; retourne la modification pour l'historique, ou `null` si rien ne change. */
function replaceComponents(db: Db, ticketId: number, projectId: number, componentIds: number[]): HistoryChange | null {
  const next = [...new Set(componentIds)];
  assertComponents(db, projectId, next);
  const current = db.all<{ component_id: number }>('SELECT component_id FROM ticket_components WHERE ticket_id = ?', ticketId).map((row) => row.component_id);
  if (current.length === next.length && current.every((id) => next.includes(id))) {
    return null;
  }
  const before = componentNames(db, ticketId);
  db.run('DELETE FROM ticket_components WHERE ticket_id = ?', ticketId);
  for (const componentId of next) {
    db.run('INSERT INTO ticket_components (ticket_id, component_id) VALUES (?, ?)', ticketId, componentId);
  }
  return { field: 'components', from: before || null, to: componentNames(db, ticketId) || null };
}

function assertDelivery(db: Db, projectId: number, deliveryId: number | null | undefined): void {
  if (deliveryId == null) {
    return;
  }
  if (!db.get('SELECT 1 FROM deliveries WHERE id = ? AND project_id = ?', deliveryId, projectId)) {
    throw badRequest("Cette livraison n'appartient pas au projet.");
  }
}

export function assertMembers(db: Db, projectId: number, userIds: number[]): void {
  for (const userId of userIds) {
    const member = db.get(
      `SELECT 1 FROM project_members m JOIN users u ON u.id = m.user_id
        WHERE m.project_id = ? AND m.user_id = ? AND u.is_active = 1`,
      projectId,
      userId,
    );
    if (!member) {
      throw badRequest("Seuls les membres actifs du projet peuvent être assignés à un ticket.");
    }
  }
}

function assertDates(start: string | null | undefined, end: string | null | undefined): void {
  if (start && end && start > end) {
    throw badRequest('La date de début doit précéder la date de fin.');
  }
}

/**
 * Un sous-ticket appartient au même projet que son parent, et il n'y a qu'un niveau (comme les sous-tâches de Jira) :
 * le parent n'est pas lui-même un sous-ticket, et un ticket qui a des sous-tickets ne peut pas en devenir un.
 */
function assertParent(db: Db, projectId: number, ticketId: number | null, parentId: number | null | undefined): void {
  if (parentId === undefined || parentId === null) return;
  if (parentId === ticketId) throw badRequest('Un ticket ne peut pas être son propre parent.');
  const parent = db.get<{ project_id: number; parent_id: number | null }>('SELECT project_id, parent_id FROM tickets WHERE id = ?', parentId);
  if (!parent || parent.project_id !== projectId) throw badRequest('Le ticket parent doit appartenir au même projet.');
  if (parent.parent_id !== null) throw badRequest('Le ticket parent est déjà un sous-ticket : un seul niveau est possible.');
  if (ticketId !== null && db.get('SELECT 1 FROM tickets WHERE parent_id = ? LIMIT 1', ticketId)) {
    throw badRequest('Ce ticket a déjà des sous-tickets : il ne peut pas devenir un sous-ticket.');
  }
}

export function parseCustomFields(raw: string | null | undefined): Record<string, CustomFieldValue> {
  try {
    const value = JSON.parse(raw || '{}') as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, CustomFieldValue>) : {};
  } catch {
    return {};
  }
}

/** Valeur lisible d'un champ personnalisé (historique, export). */
export function customValueLabel(db: Db, type: string, value: CustomFieldValue | null | undefined): string | number | null {
  if (value === null || value === undefined) return null;
  if (type === 'user') return userRef(db, Number(value)).name;
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return value;
}

/** Vérifie et fusionne des valeurs de champs personnalisés ; retourne les valeurs à enregistrer et les changements. */
function applyCustomFields(db: Db, projectId: number, current: Record<string, CustomFieldValue>, patch: Record<string, unknown>): { next: Record<string, CustomFieldValue>; changes: HistoryChange[]; newOptions: boolean } {
  const settings = getProjectSettings(db, projectId);
  const fields = settings.customFields;
  // Listes ouvertes (réglage du champ) : un choix inconnu est ajouté à la liste du projet.
  let newOptions = false;
  for (const [id, raw] of Object.entries(patch)) {
    const field = fields.find((entry) => entry.id === id);
    if (!field?.allowNewOptions) continue;
    const values = (Array.isArray(raw) ? raw : [raw]).filter((value): value is string => typeof value === 'string').map((value) => value.trim().slice(0, CUSTOM_FIELD_LIMITS.optionMax)).filter(Boolean);
    for (const value of values) {
      if (field.options.includes(value)) continue;
      if (field.options.length >= CUSTOM_FIELD_LIMITS.options) throw badRequest(`« ${field.label} » a déjà ${CUSTOM_FIELD_LIMITS.options} choix.`);
      field.options.push(value);
      newOptions = true;
    }
    if (Array.isArray(raw)) patch[id] = raw.map((value) => (typeof value === 'string' ? value.trim().slice(0, CUSTOM_FIELD_LIMITS.optionMax) : value));
    else if (typeof raw === 'string') patch[id] = raw.trim().slice(0, CUSTOM_FIELD_LIMITS.optionMax);
  }
  if (newOptions) db.run('UPDATE projects SET settings = ?, updated_at = ? WHERE id = ?', JSON.stringify(settings), nowIso(), projectId);
  const next = { ...current };
  const changes: HistoryChange[] = [];
  for (const [id, raw] of Object.entries(patch)) {
    const field = fields.find((entry) => entry.id === id);
    if (!field) throw badRequest(`Champ personnalisé inconnu : ${id}.`);
    let value: CustomFieldValue | null;
    try {
      value = coerceCustomValue(field, raw);
    } catch (error) {
      throw badRequest((error as Error).message);
    }
    if (field.type === 'user' && value !== null) assertMembers(db, projectId, [value as number]);
    const before = current[id] ?? null;
    if (JSON.stringify(before) === JSON.stringify(value)) continue;
    if (value === null) delete next[id];
    else next[id] = value;
    changes.push({ field: 'custom', label: field.label, customType: field.type, from: customValueLabel(db, field.type, before), to: customValueLabel(db, field.type, value) });
  }
  return { next, changes, newOptions };
}

/** Nouveaux choix ajoutés depuis un ticket : les réglages du projet sont rediffusés. */
function publishProject(ctx: AppContext, actor: Actor, projectId: number): void {
  const row = ctx.db.get<ProjectRow>('SELECT * FROM projects WHERE id = ?', projectId);
  if (row) ctx.hub.publish(projectId, [{ type: 'project.updated', project: toProjectDTO(row) }], actor);
}

function parentLabel(db: Db, id: number | null): string | null {
  if (id === null) return null;
  const row = db.get<{ project_id: number; number: number; title: string }>('SELECT project_id, number, title FROM tickets WHERE id = ?', id);
  return row ? `${ticketKeyOf(db, row)} — ${row.title}` : null;
}

function categoryName(db: Db, id: number | null): string | null {
  return id === null ? null : (db.get<{ name: string }>('SELECT name FROM categories WHERE id = ?', id)?.name ?? null);
}

function deliveryName(db: Db, id: number | null): string | null {
  return id === null ? null : (db.get<{ name: string }>('SELECT name FROM deliveries WHERE id = ?', id)?.name ?? null);
}

function userRef(db: Db, userId: number): NameRef {
  const row = db.get<{ name: string }>('SELECT name FROM users WHERE id = ?', userId);
  return { id: userId, name: row?.name ?? 'Utilisateur supprimé' };
}

function applySets(db: Db, ticketId: number, sets: Record<string, SqlParam>): void {
  const columns = Object.keys(sets);
  if (columns.length === 0) {
    return;
  }
  db.run(
    `UPDATE tickets SET ${columns.map((column) => `${column} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
    ...columns.map((column) => sets[column] as SqlParam),
    nowIso(),
    ticketId,
  );
}

function statusSets(db: Db, row: TicketRow, status: TicketStatus): Record<string, SqlParam> {
  return {
    status,
    completed_at: status === 'done' ? nowIso() : null,
    status_changed_at: nowIso(),
    position: endPosition(db, row.project_id, status, row.id),
  };
}

interface Collector {
  events: ProjectEvent[];
  history: HistoryEntryDTO[];
}

/** Clé lisible d'un ticket (« APP-12 ») telle qu'elle apparaît dans le journal d'activité. */
export function ticketKeyOf(db: Db, ticket: Pick<TicketRow, 'project_id' | 'number'>): string {
  const project = db.get<{ key: string }>('SELECT key FROM projects WHERE id = ?', ticket.project_id);
  return `${project?.key ?? '#'}-${ticket.number}`;
}

/**
 * Publie une modification faite hors de ce module (sous-tâches, dépendances…) : ticket à jour, entrées d'historique
 * et journal d'activité, comme pour les modifications faites ici.
 */
export function publishTicketChange(ctx: AppContext, actor: Actor, ticketId: number, history: HistoryEntryDTO[]): TicketDTO {
  const ticket = getTicketDTO(ctx.db, ticketId);
  flush(ctx, actor, ticket.projectId, ticketId, { events: [{ type: 'ticket.updated', ticket }], history });
  return ticket;
}

/** Marque le ticket comme modifié (sans autre changement). */
export function touchTicket(db: Db, ticketId: number): void {
  db.run('UPDATE tickets SET updated_at = ? WHERE id = ?', nowIso(), ticketId);
}

/** Diffuse les évènements du ticket et les inscrit dans le journal d'activité du projet. */
function flush(ctx: AppContext, actor: Actor, projectId: number, ticketId: number, collector: Collector): void {
  const events: ProjectEvent[] = [...collector.events, ...collector.history.map((entry): ProjectEvent => ({ type: 'history.created', entry }))];
  ctx.hub.publish(projectId, events, actor);

  const ticket = findTicket(ctx.db, ticketId);
  if (!ticket) {
    return;
  }
  // À la création, « créé » et « assigné à » forment une seule ligne du journal.
  const entries = [...collector.history];
  const [first, second] = entries;
  if (first?.data.kind === 'created' && second?.data.kind === 'assignees') {
    entries.splice(0, 2, { ...first, data: { ...first.data, assignees: second.data.added } });
  }
  const ticketKey = ticketKeyOf(ctx.db, ticket);
  for (const entry of entries) {
    logActivity(ctx, actor, projectId, { kind: 'ticket', ticketId, ticketKey, ticketTitle: ticket.title, entry: entry.data });
  }
}

/**
 * Réconcilie le statut avec l'état des parts :
 * - toutes les parts terminées → le ticket passe à « Terminé » ;
 * - une part rouverte alors que le ticket est « Terminé » → il repasse « En cours ».
 */
function reconcileStatus(
  db: Db,
  actor: Actor,
  ticketId: number,
  collector: Collector,
  options: { reopened: boolean },
): void {
  const row = requireTicket(db, ticketId);
  const assignees = db.all<AssigneeRow>('SELECT * FROM ticket_assignees WHERE ticket_id = ?', ticketId);
  if (assignees.length === 0) {
    return;
  }
  const allDone = assignees.every((assignee) => assignee.done === 1);
  const settings = getProjectSettings(db, row.project_id);

  if (allDone && row.status !== 'done' && settings.autoMoveDone) {
    applySets(db, ticketId, statusSets(db, row, 'done'));
    collector.history.push(
      addHistory(db, ticketId, actor, {
        kind: 'updated',
        auto: 'all_parts_done',
        changes: [{ field: 'status', from: row.status, to: 'done' }],
      }),
    );
  } else if (!allDone && options.reopened && row.status === 'done' && settings.autoReopen) {
    applySets(db, ticketId, statusSets(db, row, 'in_progress'));
    collector.history.push(
      addHistory(db, ticketId, actor, {
        kind: 'updated',
        auto: 'part_reopened',
        changes: [{ field: 'status', from: 'done', to: 'in_progress' }],
      }),
    );
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------------------------------------------------

export function createTicket(ctx: AppContext, actor: Actor, projectId: number, input: CreateTicketInput): TicketDTO {
  const { db } = ctx;
  const collector: Collector = { events: [], history: [] };
  let optionsAdded = false;

  const ticketId = db.transaction(() => {
    assertCategory(db, projectId, input.categoryId);
    assertPriority(db, projectId, input.priorityId);
    assertDelivery(db, projectId, input.deliveryId);
    const assigneeIds = [...new Set(input.assigneeIds ?? [])];
    assertMembers(db, projectId, assigneeIds);
    assertDates(input.startDate, input.endDate);
    assertParent(db, projectId, null, input.parentId);
    const customResult = input.customFields ? applyCustomFields(db, projectId, {}, input.customFields) : null;
    if (customResult?.newOptions) optionsAdded = true;
    const custom = customResult?.next ?? {};

    const status = input.status ?? 'backlog';
    assertStatusAvailable(db, projectId, status);
    const sequence = db.get<{ ticket_seq: number }>(
      'UPDATE projects SET ticket_seq = ticket_seq + 1, updated_at = ? WHERE id = ? RETURNING ticket_seq',
      nowIso(),
      projectId,
    );
    if (!sequence) {
      throw notFound('Projet introuvable.');
    }
    const now = nowIso();
    const { lastInsertRowid } = db.run(
      `INSERT INTO tickets (project_id, number, title, description, status, category_id, priority_id, delivery_id, initial_delivery_id,
                            start_date, end_date, progress, position, created_by, created_at, updated_at, completed_at, status_changed_at, parent_id, custom_fields)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      projectId,
      sequence.ticket_seq,
      input.title,
      input.description ?? '',
      status,
      input.categoryId ?? null,
      input.priorityId ?? null,
      input.deliveryId ?? null,
      input.deliveryId ?? null,
      input.startDate ?? null,
      input.endDate ?? null,
      input.progress ?? 0,
      endPosition(db, projectId, status),
      actor.userId,
      now,
      now,
      status === 'done' ? now : null,
      now,
      input.parentId ?? null,
      JSON.stringify(custom),
    );
    if (input.componentIds?.length) {
      replaceComponents(db, lastInsertRowid, projectId, input.componentIds);
    }
    for (const userId of assigneeIds) {
      db.run(
        'INSERT INTO ticket_assignees (ticket_id, user_id, done, progress, done_at, assigned_at) VALUES (?, ?, 0, 0, NULL, ?)',
        lastInsertRowid,
        userId,
        now,
      );
    }
    // Le créateur et les assignés suivent le ticket (notifications).
    if (actor.userId !== null) watchTicket(db, lastInsertRowid, actor.userId);
    for (const userId of assigneeIds) watchTicket(db, lastInsertRowid, userId);
    collector.history.push(addHistory(db, lastInsertRowid, actor, { kind: 'created', title: input.title }));
    if (assigneeIds.length > 0) {
      collector.history.push(
        addHistory(db, lastInsertRowid, actor, {
          kind: 'assignees',
          added: assigneeIds.map((userId) => userRef(db, userId)),
          removed: [],
        }),
      );
    }
    return lastInsertRowid;
  });

  if (optionsAdded) publishProject(ctx, actor, projectId);
  const ticket = getTicketDTO(db, ticketId);
  if (input.description) queueMentions(ticketId, input.description);
  collector.events.push({ type: 'ticket.created', ticket });
  flush(ctx, actor, projectId, ticketId, collector);
  return ticket;
}

export function updateTicket(ctx: AppContext, actor: Actor, ticketId: number, input: UpdateTicketInput): TicketDTO {
  const { db } = ctx;
  const collector: Collector = { events: [], history: [] };
  let projectId = 0;
  let optionsAdded = false;

  db.transaction(() => {
    const row = requireTicket(db, ticketId);
    projectId = row.project_id;
    const sets: Record<string, SqlParam> = {};
    const changes: HistoryChange[] = [];

    if (input.title !== undefined && input.title !== row.title) {
      sets.title = input.title;
      changes.push({ field: 'title', from: row.title, to: input.title });
    }
    if (input.description !== undefined && input.description !== row.description) {
      sets.description = input.description;
      queueMentions(ticketId, input.description, row.description);
      changes.push({ field: 'description', from: truncate(row.description), to: truncate(input.description) });
    }
    if (input.categoryId !== undefined && input.categoryId !== row.category_id) {
      assertCategory(db, projectId, input.categoryId);
      sets.category_id = input.categoryId;
      changes.push({ field: 'category', from: categoryName(db, row.category_id), to: categoryName(db, input.categoryId) });
    }
    if (input.priorityId !== undefined && input.priorityId !== row.priority_id) {
      assertPriority(db, projectId, input.priorityId);
      sets.priority_id = input.priorityId;
      changes.push({ field: 'priority', from: priorityName(db, row.priority_id), to: priorityName(db, input.priorityId) });
    }
    if (input.componentIds !== undefined) {
      const change = replaceComponents(db, ticketId, projectId, input.componentIds);
      if (change) {
        changes.push(change);
        touchTicket(db, ticketId);
      }
    }
    if (input.deliveryId !== undefined && input.deliveryId !== row.delivery_id) {
      assertDelivery(db, projectId, input.deliveryId);
      sets.delivery_id = input.deliveryId;
      if (row.initial_delivery_id === null && input.deliveryId !== null) {
        sets.initial_delivery_id = input.deliveryId;
      }
      changes.push({ field: 'delivery', from: deliveryName(db, row.delivery_id), to: deliveryName(db, input.deliveryId) });
    }
    const nextStart = input.startDate !== undefined ? input.startDate : row.start_date;
    const nextEnd = input.endDate !== undefined ? input.endDate : row.end_date;
    assertDates(nextStart, nextEnd);
    if (input.startDate !== undefined && input.startDate !== row.start_date) {
      sets.start_date = input.startDate;
      changes.push({ field: 'startDate', from: row.start_date, to: input.startDate });
    }
    if (input.endDate !== undefined && input.endDate !== row.end_date) {
      sets.end_date = input.endDate;
      changes.push({ field: 'endDate', from: row.end_date, to: input.endDate });
    }
    if (input.parentId !== undefined && input.parentId !== row.parent_id) {
      assertParent(db, projectId, ticketId, input.parentId);
      sets.parent_id = input.parentId;
      changes.push({ field: 'parent', from: parentLabel(db, row.parent_id), to: parentLabel(db, input.parentId) });
    }
    if (input.customFields !== undefined) {
      const custom = applyCustomFields(db, projectId, parseCustomFields(row.custom_fields), input.customFields);
      if (custom.newOptions) optionsAdded = true;
      if (custom.changes.length) {
        sets.custom_fields = JSON.stringify(custom.next);
        changes.push(...custom.changes);
      }
    }
    if (input.progress !== undefined && input.progress !== row.progress) {
      sets.progress = input.progress;
      changes.push({ field: 'progress', from: row.progress, to: input.progress });
    }
    if (input.status !== undefined && input.status !== row.status) {
      assertStatusAvailable(db, projectId, input.status);
      Object.assign(sets, statusSets(db, row, input.status));
      changes.push({ field: 'status', from: row.status, to: input.status });
    }

    applySets(db, ticketId, sets);
    if (changes.length > 0) {
      collector.history.push(addHistory(db, ticketId, actor, { kind: 'updated', changes }));
    }

    if (input.assigneeIds !== undefined) {
      replaceAssignees(db, actor, row, [...new Set(input.assigneeIds)], collector);
    }
  });

  if (optionsAdded) publishProject(ctx, actor, projectId);
  const ticket = getTicketDTO(db, ticketId);
  collector.events.unshift({ type: 'ticket.updated', ticket });
  flush(ctx, actor, projectId, ticketId, collector);
  return ticket;
}

function replaceAssignees(db: Db, actor: Actor, row: TicketRow, nextIds: number[], collector: Collector): void {
  assertMembers(db, row.project_id, nextIds);
  const current = db.all<{ user_id: number }>('SELECT user_id FROM ticket_assignees WHERE ticket_id = ?', row.id);
  const currentIds = current.map((entry) => entry.user_id);
  const addedIds = nextIds.filter((id) => !currentIds.includes(id));
  const removedIds = currentIds.filter((id) => !nextIds.includes(id));
  if (addedIds.length === 0 && removedIds.length === 0) {
    return;
  }

  const removed = removedIds.map((id) => userRef(db, id));
  for (const id of removedIds) {
    db.run('DELETE FROM ticket_assignees WHERE ticket_id = ? AND user_id = ?', row.id, id);
  }
  const now = nowIso();
  for (const id of addedIds) {
    watchTicket(db, row.id, id);
    db.run(
      'INSERT INTO ticket_assignees (ticket_id, user_id, done, progress, done_at, assigned_at) VALUES (?, ?, 0, 0, NULL, ?)',
      row.id,
      id,
      now,
    );
  }
  db.run('UPDATE tickets SET updated_at = ? WHERE id = ?', now, row.id);
  collector.history.push(
    addHistory(db, row.id, actor, { kind: 'assignees', added: addedIds.map((id) => userRef(db, id)), removed }),
  );
  reconcileStatus(db, actor, row.id, collector, { reopened: addedIds.length > 0 });
}

export function moveTicket(
  ctx: AppContext,
  actor: Actor,
  ticketId: number,
  target: { status: TicketStatus; beforeId: number | null },
): TicketDTO {
  const { db } = ctx;
  const collector: Collector = { events: [], history: [] };
  let projectId = 0;
  const reorder: { positions: Array<{ id: number; position: number }> | null } = { positions: null };

  db.transaction(() => {
    const row = requireTicket(db, ticketId);
    projectId = row.project_id;
    if (target.status !== row.status) {
      assertStatusAvailable(db, projectId, target.status);
    }
    const siblings = db.all<{ id: number; position: number }>(
      'SELECT id, position FROM tickets WHERE project_id = ? AND status = ? AND id != ? ORDER BY position, id',
      projectId,
      target.status,
      ticketId,
    );

    let position: number;
    if (target.beforeId === null) {
      position = (siblings.at(-1)?.position ?? 0) + POSITION_STEP;
    } else {
      const index = siblings.findIndex((sibling) => sibling.id === target.beforeId);
      if (index < 0) {
        throw badRequest('Le ticket de référence ne se trouve pas dans cette colonne.');
      }
      const before = siblings[index]!;
      const previous = siblings[index - 1];
      if (!previous) {
        position = before.position - POSITION_STEP;
      } else if (before.position - previous.position < MIN_GAP) {
        const ordered = [...siblings];
        ordered.splice(index, 0, { id: ticketId, position: 0 });
        const positions = ordered.map((entry, i) => ({ id: entry.id, position: (i + 1) * POSITION_STEP }));
        for (const entry of positions) {
          db.run('UPDATE tickets SET position = ? WHERE id = ?', entry.position, entry.id);
        }
        reorder.positions = positions;
        position = positions[index]!.position;
      } else {
        position = (previous.position + before.position) / 2;
      }
    }

    const sets: Record<string, SqlParam> = { position };
    if (target.status !== row.status) {
      sets.status = target.status;
      sets.completed_at = target.status === 'done' ? nowIso() : null;
      sets.status_changed_at = nowIso();
      collector.history.push(
        addHistory(db, ticketId, actor, {
          kind: 'updated',
          changes: [{ field: 'status', from: row.status, to: target.status }],
        }),
      );
    }
    applySets(db, ticketId, sets);
  });

  const ticket = getTicketDTO(db, ticketId);
  collector.events.unshift({ type: 'ticket.updated', ticket });
  if (reorder.positions) {
    collector.events.push({ type: 'tickets.reordered', positions: reorder.positions });
  }
  flush(ctx, actor, projectId, ticketId, collector);
  return ticket;
}

export function updatePart(ctx: AppContext, actor: Actor, ticketId: number, userId: number, input: PartInput): TicketDTO {
  const { db } = ctx;
  const collector: Collector = { events: [], history: [] };
  let projectId = 0;

  db.transaction(() => {
    const row = requireTicket(db, ticketId);
    projectId = row.project_id;
    const part = db.get<AssigneeRow>('SELECT * FROM ticket_assignees WHERE ticket_id = ? AND user_id = ?', ticketId, userId);
    if (!part) {
      throw notFound("Cette personne n'est pas assignée au ticket.");
    }
    const nextDone = input.done ?? part.done === 1;
    const nextProgress = input.progress ?? part.progress;
    const nextNote = input.note !== undefined ? input.note.trim() : part.note;
    const doneChanged = nextDone !== (part.done === 1);
    const progressChanged = nextProgress !== part.progress;
    const noteChanged = nextNote !== part.note;
    if (!doneChanged && !progressChanged && !noteChanged) {
      return;
    }

    db.run(
      'UPDATE ticket_assignees SET done = ?, progress = ?, done_at = ?, note = ? WHERE ticket_id = ? AND user_id = ?',
      nextDone ? 1 : 0,
      nextProgress,
      doneChanged ? (nextDone ? nowIso() : null) : part.done_at,
      nextNote,
      ticketId,
      userId,
    );
    db.run('UPDATE tickets SET updated_at = ? WHERE id = ?', nowIso(), ticketId);

    const user = userRef(db, userId);
    if (noteChanged) {
      collector.history.push(addHistory(db, ticketId, actor, { kind: 'part', user, note: truncate(nextNote, 200) }));
    }
    if (doneChanged) {
      collector.history.push(addHistory(db, ticketId, actor, { kind: 'part', user, done: nextDone }));
      reconcileStatus(db, actor, ticketId, collector, { reopened: !nextDone });
    } else if (progressChanged) {
      collector.history.push(addHistory(db, ticketId, actor, { kind: 'part', user, progress: nextProgress }));
    }
  });

  const ticket = getTicketDTO(db, ticketId);
  collector.events.unshift({ type: 'ticket.updated', ticket });
  flush(ctx, actor, projectId, ticketId, collector);
  return ticket;
}

/** Retrouve dans un autre projet l'élément de même nom (catégorie, priorité, livraison), ou `null`. */
function sameName(db: Db, table: 'categories' | 'priorities' | 'deliveries' | 'components', sourceId: number | null, projectId: number): number | null {
  if (sourceId === null) return null;
  const name = db.get<{ name: string }>(`SELECT name FROM ${table} WHERE id = ?`, sourceId)?.name;
  if (!name) return null;
  return db.get<{ id: number }>(`SELECT id FROM ${table} WHERE project_id = ? AND name = ? COLLATE NOCASE`, projectId, name)?.id ?? null;
}

/**
 * Déplace un ticket dans un autre projet : nouveau numéro, catégorie / priorité / composants / livraison retrouvés par
 * leur nom, assignés conservés s'ils sont membres du projet cible, dépendances retirées (elles restent internes à un
 * projet). Commentaires, pièces jointes, sous-tâches et historique suivent le ticket.
 */
export function transferTicket(ctx: AppContext, actor: Actor, ticketId: number, target: { projectId: number; status: TicketStatus }): TicketDTO {
  const { db } = ctx;
  const row = requireTicket(db, ticketId);
  if (row.project_id === target.projectId) {
    throw badRequest('Le ticket est déjà dans ce projet.');
  }
  const source = db.get<{ id: number; name: string; key: string }>('SELECT id, name, key FROM projects WHERE id = ?', row.project_id)!;
  const destination = db.get<{ id: number; name: string; key: string; archived: number }>('SELECT id, name, key, archived FROM projects WHERE id = ?', target.projectId);
  if (!destination) {
    throw notFound('Projet introuvable.');
  }
  if (destination.archived === 1) {
    throw badRequest('Le projet cible est archivé.');
  }
  assertStatusAvailable(db, destination.id, target.status);
  const oldKey = ticketKeyOf(db, row);
  const neighbours = new Set<number>();
  let entry: HistoryEntryDTO | null = null;
  let newKey = '';

  db.transaction(() => {
    const sequence = db.get<{ ticket_seq: number }>('UPDATE projects SET ticket_seq = ticket_seq + 1, updated_at = ? WHERE id = ? RETURNING ticket_seq', nowIso(), destination.id)!;
    newKey = `${destination.key}-${sequence.ticket_seq}`;
    const components = db.all<{ component_id: number }>('SELECT component_id FROM ticket_components WHERE ticket_id = ?', ticketId);
    const mappedComponents = components.flatMap((entry) => sameName(db, 'components', entry.component_id, destination.id) ?? []);
    db.run('DELETE FROM ticket_components WHERE ticket_id = ?', ticketId);
    for (const componentId of new Set(mappedComponents)) {
      db.run('INSERT INTO ticket_components (ticket_id, component_id) VALUES (?, ?)', ticketId, componentId);
    }
    const members = new Set(
      db.all<{ user_id: number }>('SELECT m.user_id FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = ? AND u.is_active = 1', destination.id).map((member) => member.user_id),
    );
    for (const assignee of db.all<{ user_id: number }>('SELECT user_id FROM ticket_assignees WHERE ticket_id = ?', ticketId)) {
      if (!members.has(assignee.user_id)) db.run('DELETE FROM ticket_assignees WHERE ticket_id = ? AND user_id = ?', ticketId, assignee.user_id);
    }
    for (const subtask of db.all<{ id: number; assignee_id: number | null }>('SELECT id, assignee_id FROM ticket_subtasks WHERE ticket_id = ?', ticketId)) {
      if (subtask.assignee_id !== null && !members.has(subtask.assignee_id)) db.run('UPDATE ticket_subtasks SET assignee_id = NULL WHERE id = ?', subtask.id);
    }
    for (const link of db.all<{ ticket_id: number; target_id: number }>('SELECT ticket_id, target_id FROM ticket_links WHERE ticket_id = ? OR target_id = ?', ticketId, ticketId)) {
      neighbours.add(link.ticket_id === ticketId ? link.target_id : link.ticket_id);
    }
    db.run('DELETE FROM ticket_links WHERE ticket_id = ? OR target_id = ?', ticketId, ticketId);
    // Les liens parent / sous-tickets restent internes au projet.
    for (const child of db.all<{ id: number }>('SELECT id FROM tickets WHERE parent_id = ?', ticketId)) neighbours.add(child.id);
    if (row.parent_id !== null) neighbours.add(row.parent_id);
    db.run('UPDATE tickets SET parent_id = NULL WHERE parent_id = ?', ticketId);
    // Champs personnalisés : gardés quand le projet cible a un champ de même libellé et de même type.
    const sourceFields = getProjectSettings(db, row.project_id).customFields;
    const targetFields = getProjectSettings(db, destination.id).customFields;
    const values = parseCustomFields(row.custom_fields);
    const mapped: Record<string, CustomFieldValue> = {};
    for (const [id, value] of Object.entries(values)) {
      const source = sourceFields.find((field) => field.id === id);
      const target = source && targetFields.find((field) => field.type === source.type && field.label.toLowerCase() === source.label.toLowerCase());
      if (!target) continue;
      try {
        const coerced = coerceCustomValue(target, value);
        if (coerced !== null && !(target.type === 'user' && !members.has(coerced as number))) mapped[target.id] = coerced;
      } catch {
        // Choix absent de la liste du projet cible : valeur abandonnée.
      }
    }
    db.run('UPDATE tickets SET custom_fields = ? WHERE id = ?', JSON.stringify(mapped), ticketId);
    const delivery = sameName(db, 'deliveries', row.delivery_id, destination.id);
    db.run(
      `UPDATE tickets SET project_id = ?, number = ?, status = ?, category_id = ?, priority_id = ?, delivery_id = ?, initial_delivery_id = ?,
              position = ?, completed_at = ?, status_changed_at = ?, updated_at = ?, parent_id = NULL WHERE id = ?`,
      destination.id,
      sequence.ticket_seq,
      target.status,
      sameName(db, 'categories', row.category_id, destination.id),
      sameName(db, 'priorities', row.priority_id, destination.id),
      delivery,
      delivery,
      endPosition(db, destination.id, target.status, ticketId),
      target.status === 'done' ? (row.completed_at ?? nowIso()) : null,
      target.status !== row.status ? nowIso() : (row.status_changed_at ?? nowIso()),
      nowIso(),
      ticketId,
    );
    entry = addHistory(db, ticketId, actor, { kind: 'transferred', from: { key: oldKey, project: source.name }, to: { key: newKey, project: destination.name } });
  });

  const ticket = getTicketDTO(db, ticketId);
  const sourceEvents: ProjectEvent[] = [{ type: 'ticket.deleted', ticketId }];
  for (const id of neighbours) {
    const other = findTicket(db, id);
    if (other && other.project_id === source.id) sourceEvents.push({ type: 'ticket.updated', ticket: getTicketDTO(db, id) });
  }
  ctx.hub.publish(source.id, sourceEvents, actor);
  ctx.hub.publish(destination.id, [{ type: 'ticket.created', ticket }, { type: 'history.created', entry: entry! }], actor);
  logActivity(ctx, actor, source.id, { kind: 'ticket_transferred', direction: 'out', ticketId: null, ticketKey: oldKey, ticketTitle: row.title, otherProject: destination.name, otherKey: newKey });
  logActivity(ctx, actor, destination.id, { kind: 'ticket_transferred', direction: 'in', ticketId, ticketKey: newKey, ticketTitle: row.title, otherProject: source.name, otherKey: oldKey });
  return ticket;
}

export function deleteTicket(ctx: AppContext, actor: Actor, ticketId: number): void {
  const row = requireTicket(ctx.db, ticketId);
  const ticketKey = ticketKeyOf(ctx.db, row);
  const files = storagesOfTicket(ctx.db, ticketId);
  const children = ctx.db.all<{ id: number }>('SELECT id FROM tickets WHERE parent_id = ?', ticketId);
  // Les sous-tickets restent, détachés (clé étrangère ON DELETE SET NULL).
  ctx.db.run('DELETE FROM tickets WHERE id = ?', ticketId);
  removeStoredFiles(ctx, files);
  ctx.hub.publish(row.project_id, [{ type: 'ticket.deleted', ticketId }, ...children.map((child): ProjectEvent => ({ type: 'ticket.updated', ticket: getTicketDTO(ctx.db, child.id) }))], actor);
  logActivity(ctx, actor, row.project_id, { kind: 'ticket_deleted', ticketKey, ticketTitle: row.title });
}
