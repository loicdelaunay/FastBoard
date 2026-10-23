/** Lignes SQLite brutes et conversions vers les DTO partagés. */

import type { TicketStatus } from '../../shared/constants.ts';
import { normalizeSettings, type ProjectSettingsDTO } from '../../shared/settings.ts';
import type {
  AttachmentDTO,
  CategoryDTO,
  CommentDTO,
  DeliveryDTO,
  HistoryData,
  HistoryEntryDTO,
  ProjectDTO,
  ProjectListItemDTO,
  RoleDTO,
  SubtaskDTO,
  TicketLinkDTO,
  UserSummaryDTO,
} from '../../shared/types.ts';

export interface UserRow {
  id: number;
  email: string;
  name: string;
  role_id: number;
  is_active: number;
  theme: string;
  avatar_version: number;
  created_at: string;
  last_login_at: string | null;
}

export interface RoleRow {
  id: number;
  scope: 'global' | 'project';
  key: string | null;
  name: string;
  description: string;
  permissions: string;
  is_system: number;
  created_at: string;
}

export interface ProjectRow {
  id: number;
  name: string;
  key: string;
  description: string;
  archived: number;
  owner_id: number | null;
  ticket_seq: number;
  settings: string;
  created_at: string;
  updated_at: string;
}

export interface CategoryRow {
  id: number;
  project_id: number;
  name: string;
  color: string;
  position: number;
}

export interface DeliveryRow {
  id: number;
  project_id: number;
  name: string;
  description: string;
  start_date: string;
  end_date: string;
  color: string;
  position: number;
}

export interface TicketRow {
  id: number;
  project_id: number;
  number: number;
  title: string;
  description: string;
  status: TicketStatus;
  category_id: number | null;
  delivery_id: number | null;
  initial_delivery_id: number | null;
  priority_id: number | null;
  /** Ticket parent (sous-ticket), un seul niveau. */
  parent_id: number | null;
  status_changed_at: string | null;
  start_date: string | null;
  end_date: string | null;
  progress: number;
  position: number;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface AssigneeRow {
  ticket_id: number;
  user_id: number;
  done: number;
  progress: number;
  done_at: string | null;
  note: string;
}

export interface CommentRow {
  id: number;
  ticket_id: number;
  user_id: number | null;
  parent_id: number | null;
  body: string;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
}

export interface AttachmentRow {
  id: number;
  ticket_id: number;
  user_id: number | null;
  name: string;
  mime: string;
  size: number;
  storage: string;
  created_at: string;
  kind: AttachmentDTO['kind'];
  url: string | null;
}

export function toAttachmentDTO(row: AttachmentRow): AttachmentDTO {
  return { id: row.id, ticketId: row.ticket_id, userId: row.user_id, name: row.name, mime: row.mime, size: row.size, createdAt: row.created_at, kind: row.kind ?? 'file', url: row.url ?? null };
}

export interface HistoryRow {
  id: number;
  ticket_id: number;
  user_id: number | null;
  via: string | null;
  data: string;
  created_at: string;
}

export const USER_COLUMNS =
  'u.id, u.email, u.name, u.role_id, u.is_active, u.theme, u.avatar_version, u.created_at, u.last_login_at';

export function parsePermissions(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

export function toUserSummary(row: Pick<UserRow, 'id' | 'name' | 'email' | 'avatar_version' | 'is_active'>): UserSummaryDTO {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    avatarVersion: row.avatar_version,
    isActive: row.is_active === 1,
  };
}

/** Réglages stockés en JSON ; toujours complétés et corrigés. */
export function parseSettings(raw: string | null | undefined): ProjectSettingsDTO {
  try {
    return normalizeSettings(JSON.parse(raw || '{}'));
  } catch {
    return normalizeSettings({});
  }
}

export function toProjectDTO(row: ProjectRow): ProjectDTO {
  return {
    id: row.id,
    name: row.name,
    key: row.key,
    description: row.description,
    archived: row.archived === 1,
    ownerId: row.owner_id,
    settings: parseSettings(row.settings),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toCategoryDTO(row: CategoryRow): CategoryDTO {
  return { id: row.id, projectId: row.project_id, name: row.name, color: row.color, position: row.position };
}

export function toDeliveryDTO(row: DeliveryRow): DeliveryDTO {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    startDate: row.start_date,
    endDate: row.end_date,
    color: row.color,
    position: row.position,
  };
}

export function toRoleDTO(row: RoleRow, usage: number): RoleDTO {
  return {
    id: row.id,
    scope: row.scope,
    key: row.key,
    name: row.name,
    description: row.description,
    permissions: parsePermissions(row.permissions),
    isSystem: row.is_system === 1,
    locked: row.key === 'super_admin' || row.key === 'owner',
    usage,
  };
}

export function toCommentDTO(row: CommentRow): CommentDTO {
  const deleted = row.deleted_at !== null;
  return {
    id: row.id,
    ticketId: row.ticket_id,
    userId: row.user_id,
    parentId: row.parent_id,
    body: deleted ? '' : row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deleted,
  };
}

export function toHistoryDTO(row: HistoryRow): HistoryEntryDTO {
  let data: HistoryData;
  try {
    data = JSON.parse(row.data) as HistoryData;
  } catch {
    data = { kind: 'updated', changes: [] };
  }
  return { id: row.id, ticketId: row.ticket_id, userId: row.user_id, via: row.via ?? null, data, createdAt: row.created_at };
}

export interface ListItemRow {
  id: number;
  project_id: number;
  name: string;
  color: string;
  icon: string;
  position: number;
}

export function toListItemDTO(row: ListItemRow): ProjectListItemDTO {
  return { id: row.id, projectId: row.project_id, name: row.name, color: row.color, icon: row.icon, position: row.position };
}

export interface SubtaskRow {
  id: number;
  ticket_id: number;
  title: string;
  done: number;
  position: number;
  assignee_id: number | null;
  created_by: number | null;
  created_at: string;
  done_at: string | null;
}

export function toSubtaskDTO(row: SubtaskRow): SubtaskDTO {
  return { id: row.id, ticketId: row.ticket_id, title: row.title, done: row.done === 1, assigneeId: row.assignee_id, position: row.position, createdAt: row.created_at, doneAt: row.done_at };
}

export interface LinkRow {
  id: number;
  ticket_id: number;
  target_id: number;
  reason: string;
  created_by: number | null;
  created_at: string;
}

export function toLinkDTO(row: LinkRow): TicketLinkDTO {
  return { id: row.id, ticketId: row.ticket_id, targetId: row.target_id, reason: row.reason, createdBy: row.created_by, createdAt: row.created_at };
}
