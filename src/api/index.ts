import type { TicketStatus } from '@shared/constants';
import type { RoleScope, PermissionDef } from '@shared/permissions';
import type { Locale } from '@shared/locales';
import type { ProjectSettingsDTO } from '@shared/settings';
import type {
  ActivityDTO,
  ActivityGroup,
  AdminUserDTO,
  ApiTokenDTO,
  AttachmentDTO,
  ApiTokenScope,
  CategoryDTO,
  CommentDTO,
  DeliveryDTO,
  HistoryEntryDTO,
  MeDTO,
  ProjectDTO,
  ProjectSnapshotDTO,
  ProjectSummaryDTO,
  RoleDTO,
  TicketDTO,
  TokenInfoDTO,
  UserSummaryDTO,
} from '@shared/types';
import type { LogEntryDTO, LogLevel, MonitoringRange, MonitoringSnapshotDTO } from '@shared/monitoring';
import { ApiError, http, httpHeaders } from './http';

import { t } from '@/i18n';
import { translateServerMessage } from '@/i18n/server';
export interface TicketInput {
  title?: string;
  description?: string;
  status?: TicketStatus;
  categoryId?: number | null;
  deliveryId?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  progress?: number;
  assigneeIds?: number[];
}

export interface DeliveryInput {
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
  color?: string;
}

export interface RoleInput {
  scope: RoleScope;
  name: string;
  description: string;
  permissions: string[];
}

export interface TokenInput {
  name: string;
  scope: ApiTokenScope;
  projectIds: number[] | null;
  expiresInDays: number | null;
}

export interface ActivityFilters {
  group?: ActivityGroup[];
  userId?: number;
  viaApi?: boolean;
  ticketId?: number;
  before?: number;
  limit?: number;
}

export interface LogFilters {
  levels?: LogLevel[];
  sources?: string[];
  q?: string;
  userId?: number;
  requestId?: string;
  since?: string;
  before?: number;
  after?: number;
  limit?: number;
}

/** Paramètres d'URL des journaux (partagés par la liste et le lien d'export). */
export function logQuery(filters: LogFilters): string {
  const query = new URLSearchParams();
  if (filters.levels?.length) query.set('level', filters.levels.join(','));
  if (filters.sources?.length) query.set('source', filters.sources.join(','));
  if (filters.q) query.set('q', filters.q);
  if (filters.userId !== undefined) query.set('userId', String(filters.userId));
  if (filters.requestId) query.set('requestId', filters.requestId);
  if (filters.since) query.set('since', filters.since);
  if (filters.before !== undefined) query.set('before', String(filters.before));
  if (filters.after !== undefined) query.set('after', String(filters.after));
  query.set('limit', String(filters.limit ?? 100));
  return query.toString();
}

interface UploadResponse {
  attachment?: AttachmentDTO;
  error?: { message?: string; code?: string };
}

function parseUploadResponse(text: string): UploadResponse | null {
  try {
    return JSON.parse(text) as UploadResponse;
  } catch {
    return null;
  }
}

/** Envoie un fichier en corps brut (XMLHttpRequest : seul moyen d'obtenir la progression de l'envoi). */
export function uploadAttachment(ticketId: number, file: File, onProgress?: (ratio: number) => void): Promise<AttachmentDTO> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `/api/tickets/${ticketId}/attachments`);
    request.withCredentials = true;
    for (const [name, value] of Object.entries(httpHeaders())) {
      request.setRequestHeader(name, value);
    }
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    request.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(event.loaded / event.total);
      }
    };
    request.onerror = () => reject(new ApiError(0, t('Impossible de joindre le serveur : l\'envoi a échoué.'), 'network'));
    request.onabort = () => reject(new ApiError(0, t('L\'envoi a été annulé.'), 'aborted'));
    request.onload = () => {
      const payload = parseUploadResponse(request.responseText);
      if (request.status >= 200 && request.status < 300 && payload?.attachment) {
        resolve(payload.attachment);
      } else {
        reject(new ApiError(request.status, payload?.error?.message ? translateServerMessage(payload.error.message) : t('Erreur {status}', { status: request.status }), payload?.error?.code));
      }
    };
    request.send(file);
  });
}

export const api = {
  // --- Authentification et profil ---
  login: (email: string, password: string) =>
    http<{ user: MeDTO }>('POST', '/auth/login', { body: { email, password }, silent401: true }),
  logout: () => http<{ ok: true }>('POST', '/auth/logout', { silent401: true }),
  me: () => http<{ user: MeDTO; token: TokenInfoDTO | null }>('GET', '/me', { silent401: true }),
  myTokens: () => http<{ tokens: ApiTokenDTO[] }>('GET', '/me/tokens'),
  createToken: (input: TokenInput) => http<{ token: ApiTokenDTO; secret: string }>('POST', '/me/tokens', { body: input }),
  revokeToken: (tokenId: number) => http<{ ok: true }>('DELETE', `/me/tokens/${tokenId}`),
  updateMe: (patch: { name?: string; theme?: string; locale?: Locale }) => http<{ user: MeDTO }>('PATCH', '/me', { body: patch }),
  changePassword: (currentPassword: string, newPassword: string) =>
    http<{ ok: true }>('POST', '/me/password', { body: { currentPassword, newPassword } }),
  uploadAvatar: (blob: Blob) =>
    http<{ user: MeDTO }>('PUT', '/me/avatar', { rawBody: blob, contentType: blob.type || 'image/webp' }),
  removeAvatar: () => http<{ user: MeDTO }>('DELETE', '/me/avatar'),
  directory: () => http<{ users: UserSummaryDTO[] }>('GET', '/users'),
  projectRoles: () => http<{ roles: RoleDTO[] }>('GET', '/roles?scope=project'),
  globalRoles: () => http<{ roles: RoleDTO[] }>('GET', '/roles?scope=global'),

  // --- Projets ---
  projects: () => http<{ projects: ProjectSummaryDTO[] }>('GET', '/projects'),
  createProject: (input: { name: string; key?: string; description?: string }) =>
    http<{ project: ProjectDTO }>('POST', '/projects', { body: input }),
  snapshot: (projectId: number) => http<ProjectSnapshotDTO>('GET', `/projects/${projectId}`),
  updateProject: (projectId: number, patch: { name?: string; key?: string; description?: string; archived?: boolean; settings?: Partial<ProjectSettingsDTO> }) =>
    http<{ project: ProjectDTO }>('PATCH', `/projects/${projectId}`, { body: patch }),
  deleteProject: (projectId: number) => http<{ ok: true }>('DELETE', `/projects/${projectId}`),

  addMember: (projectId: number, userId: number, roleId: number) =>
    http<{ ok: true }>('POST', `/projects/${projectId}/members`, { body: { userId, roleId } }),
  changeMemberRole: (projectId: number, userId: number, roleId: number) =>
    http<{ ok: true }>('PATCH', `/projects/${projectId}/members/${userId}`, { body: { roleId } }),
  removeMember: (projectId: number, userId: number) =>
    http<{ ok: true }>('DELETE', `/projects/${projectId}/members/${userId}`),

  createCategory: (projectId: number, input: { name: string; color: string }) =>
    http<{ category: CategoryDTO }>('POST', `/projects/${projectId}/categories`, { body: input }),
  updateCategory: (projectId: number, categoryId: number, patch: { name?: string; color?: string }) =>
    http<{ category: CategoryDTO }>('PATCH', `/projects/${projectId}/categories/${categoryId}`, { body: patch }),
  deleteCategory: (projectId: number, categoryId: number) =>
    http<{ ok: true }>('DELETE', `/projects/${projectId}/categories/${categoryId}`),

  createDelivery: (projectId: number, input: DeliveryInput) =>
    http<{ delivery: DeliveryDTO }>('POST', `/projects/${projectId}/deliveries`, { body: input }),
  updateDelivery: (projectId: number, deliveryId: number, patch: Partial<DeliveryInput>) =>
    http<{ delivery: DeliveryDTO }>('PATCH', `/projects/${projectId}/deliveries/${deliveryId}`, { body: patch }),
  deleteDelivery: (projectId: number, deliveryId: number) =>
    http<{ ok: true }>('DELETE', `/projects/${projectId}/deliveries/${deliveryId}`),

  // --- Tickets ---
  createTicket: (projectId: number, input: TicketInput & { title: string }) =>
    http<{ ticket: TicketDTO }>('POST', `/projects/${projectId}/tickets`, { body: input }),
  updateTicket: (ticketId: number, patch: TicketInput) =>
    http<{ ticket: TicketDTO }>('PATCH', `/tickets/${ticketId}`, { body: patch }),
  moveTicket: (ticketId: number, status: TicketStatus, beforeId: number | null) =>
    http<{ ticket: TicketDTO }>('POST', `/tickets/${ticketId}/move`, { body: { status, beforeId } }),
  deleteTicket: (ticketId: number) => http<{ ok: true }>('DELETE', `/tickets/${ticketId}`),
  updatePart: (ticketId: number, userId: number, patch: { done?: boolean; progress?: number; note?: string }) =>
    http<{ ticket: TicketDTO }>('PATCH', `/tickets/${ticketId}/assignees/${userId}`, { body: patch }),

  comments: (ticketId: number) => http<{ comments: CommentDTO[] }>('GET', `/tickets/${ticketId}/comments`),
  addComment: (ticketId: number, body: string, parentId: number | null) =>
    http<{ comment: CommentDTO }>('POST', `/tickets/${ticketId}/comments`, { body: { body, parentId } }),
  editComment: (commentId: number, body: string) =>
    http<{ comment: CommentDTO }>('PATCH', `/comments/${commentId}`, { body: { body } }),
  deleteComment: (commentId: number) => http<{ comment: CommentDTO }>('DELETE', `/comments/${commentId}`),
  attachments: (ticketId: number) => http<{ attachments: AttachmentDTO[] }>('GET', `/tickets/${ticketId}/attachments`),
  deleteAttachment: (attachmentId: number) => http<{ ok: true }>('DELETE', `/attachments/${attachmentId}`),
  history: (ticketId: number) => http<{ history: HistoryEntryDTO[] }>('GET', `/tickets/${ticketId}/history`),

  activity: (projectId: number, filters: ActivityFilters = {}) => {
    const query = new URLSearchParams();
    if (filters.group?.length) query.set('group', filters.group.join(','));
    if (filters.userId !== undefined) query.set('userId', String(filters.userId));
    if (filters.viaApi) query.set('viaApi', 'true');
    if (filters.ticketId !== undefined) query.set('ticketId', String(filters.ticketId));
    if (filters.before !== undefined) query.set('before', String(filters.before));
    query.set('limit', String(filters.limit ?? 40));
    return http<{ activities: ActivityDTO[]; nextBefore: number | null }>('GET', `/projects/${projectId}/activity?${query}`);
  },

  // --- Administration ---
  adminUsers: () => http<{ users: AdminUserDTO[]; online: number[] }>('GET', '/admin/users'),
  adminCreateUser: (input: { email: string; name: string; password: string; roleId: number }) =>
    http<{ user: AdminUserDTO }>('POST', '/admin/users', { body: input }),
  adminUpdateUser: (
    userId: number,
    patch: { email?: string; name?: string; password?: string; roleId?: number; isActive?: boolean },
  ) => http<{ user: AdminUserDTO }>('PATCH', `/admin/users/${userId}`, { body: patch }),
  adminDeleteUser: (userId: number) => http<{ ok: true }>('DELETE', `/admin/users/${userId}`),
  adminTokens: () => http<{ tokens: ApiTokenDTO[] }>('GET', '/admin/tokens'),
  adminRevokeToken: (tokenId: number) => http<{ ok: true }>('DELETE', `/admin/tokens/${tokenId}`),
  adminMonitoring: (range: MonitoringRange) => http<MonitoringSnapshotDTO>('GET', `/admin/monitoring?range=${range}`),
  adminLogs: (filters: LogFilters) => http<{ logs: LogEntryDTO[]; nextBefore: number | null }>('GET', `/admin/logs?${logQuery(filters)}`),
  adminRoles: () =>
    http<{ roles: RoleDTO[]; catalog: { global: PermissionDef[]; project: PermissionDef[] } }>('GET', '/admin/roles'),
  adminCreateRole: (input: RoleInput) => http<{ role: RoleDTO }>('POST', '/admin/roles', { body: input }),
  adminUpdateRole: (roleId: number, patch: { name?: string; description?: string; permissions?: string[] }) =>
    http<{ role: RoleDTO }>('PATCH', `/admin/roles/${roleId}`, { body: patch }),
  adminDeleteRole: (roleId: number) => http<{ ok: true }>('DELETE', `/admin/roles/${roleId}`),
};
