import type { TicketStatus } from '../../shared/constants.ts';
import type { ProjectEvent } from '../../shared/realtime.ts';
import type { AssigneeDTO, HistoryChange, HistoryEntryDTO, NameRef, TicketDTO } from '../../shared/types.ts';
import type { Actor, AppContext } from '../context.ts';
import { nowIso, type Db, type SqlParam } from '../db/database.ts';
import { badRequest, notFound } from '../http/errors.ts';
import { logActivity } from './activity.ts';
import { removeStoredFiles, storagesOfTicket } from './attachments.ts';
import { addHistory } from './history.ts';
import { assertStatusAvailable, getProjectSettings } from './projectSettings.ts';
import type { AssigneeRow, TicketRow } from './rows.ts';

const POSITION_STEP = 1024;
const MIN_GAP = 1e-6;

export interface CreateTicketInput {
  title: string;
  description?: string;
  status?: TicketStatus;
  categoryId?: number | null;
  deliveryId?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  progress?: number;
  assigneeIds?: number[];
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

function toTicketDTO(row: TicketRow, assignees: AssigneeRow[], commentCount: number, attachmentCount: number): TicketDTO {
  return {
    id: row.id,
    projectId: row.project_id,
    number: row.number,
    title: row.title,
    description: row.description,
    status: row.status,
    categoryId: row.category_id,
    deliveryId: row.delivery_id,
    initialDeliveryId: row.initial_delivery_id,
    startDate: row.start_date,
    endDate: row.end_date,
    progress: row.progress,
    position: row.position,
    assignees: assignees.map(toAssigneeDTO),
    commentCount,
    attachmentCount,
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

export function getTicketDTO(db: Db, ticketId: number): TicketDTO {
  const row = requireTicket(db, ticketId);
  const assignees = db.all<AssigneeRow>(
    'SELECT * FROM ticket_assignees WHERE ticket_id = ? ORDER BY assigned_at, user_id',
    ticketId,
  );
  const count = db.get<{ n: number }>(
    'SELECT COUNT(*) AS n FROM ticket_comments WHERE ticket_id = ? AND deleted_at IS NULL',
    ticketId,
  );
  const files = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ticket_attachments WHERE ticket_id = ?', ticketId);
  return toTicketDTO(row, assignees, count?.n ?? 0, files?.n ?? 0);
}

export function listTicketDTOs(db: Db, projectId: number): TicketDTO[] {
  const rows = db.all<TicketRow>('SELECT * FROM tickets WHERE project_id = ? ORDER BY position, id', projectId);
  const assigneeRows = db.all<AssigneeRow>(
    `SELECT a.* FROM ticket_assignees a JOIN tickets t ON t.id = a.ticket_id
      WHERE t.project_id = ? ORDER BY a.assigned_at, a.user_id`,
    projectId,
  );
  const counts = db.all<{ ticket_id: number; n: number }>(
    `SELECT c.ticket_id, COUNT(*) AS n FROM ticket_comments c JOIN tickets t ON t.id = c.ticket_id
      WHERE t.project_id = ? AND c.deleted_at IS NULL GROUP BY c.ticket_id`,
    projectId,
  );
  const assigneesByTicket = new Map<number, AssigneeRow[]>();
  for (const row of assigneeRows) {
    const list = assigneesByTicket.get(row.ticket_id) ?? [];
    list.push(row);
    assigneesByTicket.set(row.ticket_id, list);
  }
  const fileCounts = db.all<{ ticket_id: number; n: number }>(
    `SELECT a.ticket_id, COUNT(*) AS n FROM ticket_attachments a JOIN tickets t ON t.id = a.ticket_id
      WHERE t.project_id = ? GROUP BY a.ticket_id`,
    projectId,
  );
  const countByTicket = new Map(counts.map((entry) => [entry.ticket_id, entry.n]));
  const filesByTicket = new Map(fileCounts.map((entry) => [entry.ticket_id, entry.n]));
  return rows.map((row) => toTicketDTO(row, assigneesByTicket.get(row.id) ?? [], countByTicket.get(row.id) ?? 0, filesByTicket.get(row.id) ?? 0));
}

export interface TicketFilters {
  statuses?: TicketStatus[];
  categoryId?: number;
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

function foldText(value: string): string {
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

function assertDelivery(db: Db, projectId: number, deliveryId: number | null | undefined): void {
  if (deliveryId == null) {
    return;
  }
  if (!db.get('SELECT 1 FROM deliveries WHERE id = ? AND project_id = ?', deliveryId, projectId)) {
    throw badRequest("Cette livraison n'appartient pas au projet.");
  }
}

function assertMembers(db: Db, projectId: number, userIds: number[]): void {
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
      addHistory(db, ticketId, actor.userId, {
        kind: 'updated',
        auto: 'all_parts_done',
        changes: [{ field: 'status', from: row.status, to: 'done' }],
      }),
    );
  } else if (!allDone && options.reopened && row.status === 'done' && settings.autoReopen) {
    applySets(db, ticketId, statusSets(db, row, 'in_progress'));
    collector.history.push(
      addHistory(db, ticketId, actor.userId, {
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

  const ticketId = db.transaction(() => {
    assertCategory(db, projectId, input.categoryId);
    assertDelivery(db, projectId, input.deliveryId);
    const assigneeIds = [...new Set(input.assigneeIds ?? [])];
    assertMembers(db, projectId, assigneeIds);
    assertDates(input.startDate, input.endDate);

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
      `INSERT INTO tickets (project_id, number, title, description, status, category_id, delivery_id, initial_delivery_id,
                            start_date, end_date, progress, position, created_by, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      projectId,
      sequence.ticket_seq,
      input.title,
      input.description ?? '',
      status,
      input.categoryId ?? null,
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
    );
    for (const userId of assigneeIds) {
      db.run(
        'INSERT INTO ticket_assignees (ticket_id, user_id, done, progress, done_at, assigned_at) VALUES (?, ?, 0, 0, NULL, ?)',
        lastInsertRowid,
        userId,
        now,
      );
    }
    collector.history.push(addHistory(db, lastInsertRowid, actor.userId, { kind: 'created', title: input.title }));
    if (assigneeIds.length > 0) {
      collector.history.push(
        addHistory(db, lastInsertRowid, actor.userId, {
          kind: 'assignees',
          added: assigneeIds.map((userId) => userRef(db, userId)),
          removed: [],
        }),
      );
    }
    return lastInsertRowid;
  });

  const ticket = getTicketDTO(db, ticketId);
  collector.events.push({ type: 'ticket.created', ticket });
  flush(ctx, actor, projectId, ticketId, collector);
  return ticket;
}

export function updateTicket(ctx: AppContext, actor: Actor, ticketId: number, input: UpdateTicketInput): TicketDTO {
  const { db } = ctx;
  const collector: Collector = { events: [], history: [] };
  let projectId = 0;

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
      changes.push({ field: 'description', from: truncate(row.description), to: truncate(input.description) });
    }
    if (input.categoryId !== undefined && input.categoryId !== row.category_id) {
      assertCategory(db, projectId, input.categoryId);
      sets.category_id = input.categoryId;
      changes.push({ field: 'category', from: categoryName(db, row.category_id), to: categoryName(db, input.categoryId) });
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
      collector.history.push(addHistory(db, ticketId, actor.userId, { kind: 'updated', changes }));
    }

    if (input.assigneeIds !== undefined) {
      replaceAssignees(db, actor, row, [...new Set(input.assigneeIds)], collector);
    }
  });

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
    db.run(
      'INSERT INTO ticket_assignees (ticket_id, user_id, done, progress, done_at, assigned_at) VALUES (?, ?, 0, 0, NULL, ?)',
      row.id,
      id,
      now,
    );
  }
  db.run('UPDATE tickets SET updated_at = ? WHERE id = ?', now, row.id);
  collector.history.push(
    addHistory(db, row.id, actor.userId, { kind: 'assignees', added: addedIds.map((id) => userRef(db, id)), removed }),
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
      collector.history.push(
        addHistory(db, ticketId, actor.userId, {
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
      collector.history.push(addHistory(db, ticketId, actor.userId, { kind: 'part', user, note: truncate(nextNote, 200) }));
    }
    if (doneChanged) {
      collector.history.push(addHistory(db, ticketId, actor.userId, { kind: 'part', user, done: nextDone }));
      reconcileStatus(db, actor, ticketId, collector, { reopened: !nextDone });
    } else if (progressChanged) {
      collector.history.push(addHistory(db, ticketId, actor.userId, { kind: 'part', user, progress: nextProgress }));
    }
  });

  const ticket = getTicketDTO(db, ticketId);
  collector.events.unshift({ type: 'ticket.updated', ticket });
  flush(ctx, actor, projectId, ticketId, collector);
  return ticket;
}

export function deleteTicket(ctx: AppContext, actor: Actor, ticketId: number): void {
  const row = requireTicket(ctx.db, ticketId);
  const ticketKey = ticketKeyOf(ctx.db, row);
  const files = storagesOfTicket(ctx.db, ticketId);
  ctx.db.run('DELETE FROM tickets WHERE id = ?', ticketId);
  removeStoredFiles(ctx, files);
  ctx.hub.publish(row.project_id, [{ type: 'ticket.deleted', ticketId }], actor);
  logActivity(ctx, actor, row.project_id, { kind: 'ticket_deleted', ticketKey, ticketTitle: row.title });
}
