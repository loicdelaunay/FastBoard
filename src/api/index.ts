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
  NotificationDTO,
  MaintenanceDTO,
  AppInfoDTO,
  ProjectDTO,
  ProjectListItemDTO,
  SearchKind,
  SearchResultDTO,
  UserSummaryPageDTO,
  ProjectSnapshotDTO,
  ProjectSummaryDTO,
  RoleDTO,
  TicketDTO,
  TokenInfoDTO,
  UserSummaryDTO,
} from '@shared/types';
import type { LogEntryDTO, LogLevel, MonitoringRange, MonitoringSnapshotDTO } from '@shared/monitoring';
import type { AiContext, AiConversationDTO, AiConversationSummaryDTO, AiModelChoiceDTO, AiModelDTO, AiSettingsDTO, DetectedModelDTO } from '@shared/ai';
import type { CertificateFormat, CertificateInfoDTO, HttpsSettingsDTO, HttpsStatusDTO } from '@shared/https';
import type { BackupDestinationDTO, BackupOverviewDTO, BackupRunDTO } from '@shared/backup';
import type { ServiceActionResultDTO, ServiceScope, ServiceStatusDTO } from '@shared/system';
import { ApiError, http, httpHeaders } from './http';

import { t } from '@/i18n';
import { translateServerMessage } from '@/i18n/server';
export interface TicketInput {
  title?: string;
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
}

/** Fournisseur d'IA tel qu'envoyé par l'administration (sans `id` : nouveau). */
export interface AiProviderInput {
  id?: string;
  name: string;
  baseUrl: string;
  timeoutSeconds: number;
  models: AiModelDTO[];
  apiKey?: string;
}

export interface CertificateFiles {
  format: CertificateFormat;
  certPath: string;
  keyPath: string;
  caPath: string;
  pfxPath: string;
  passphrase?: string;
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
  displayName?: string | null;
  scope: ApiTokenScope;
  projectIds: number[] | null;
  expiresInDays: number | null;
}

export interface ActivityFilters {
  group?: ActivityGroup[];
  userId?: number;
  /** `api` : actions faites via un jeton ; `ui` : depuis l'interface. */
  source?: 'api' | 'ui';
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
  updateToken: (tokenId: number, patch: { displayName?: string | null; expiresInDays?: number | null }) =>
    http<{ token: ApiTokenDTO }>('PATCH', `/me/tokens/${tokenId}`, { body: patch }),
  revealToken: (tokenId: number, password: string) => http<{ secret: string }>('POST', `/me/tokens/${tokenId}/reveal`, { body: { password } }),
  updateMe: (patch: { name?: string; theme?: string; locale?: Locale }) => http<{ user: MeDTO }>('PATCH', '/me', { body: patch }),
  changePassword: (currentPassword: string, newPassword: string) =>
    http<{ ok: true }>('POST', '/me/password', { body: { currentPassword, newPassword } }),
  uploadAvatar: (blob: Blob) =>
    http<{ user: MeDTO }>('PUT', '/me/avatar', { rawBody: blob, contentType: blob.type || 'image/webp' }),
  removeAvatar: () => http<{ user: MeDTO }>('DELETE', '/me/avatar'),
  directory: () => http<{ users: UserSummaryDTO[] }>('GET', '/users'),
  notifications: (before?: number) =>
    http<{ notifications: NotificationDTO[]; unread: number; nextBefore: number | null }>('GET', `/me/notifications?limit=30${before ? `&before=${before}` : ''}`),
  markNotificationsRead: (ids?: number[]) => http<{ unread: number }>('POST', '/me/notifications/read', { body: ids ? { ids } : {} }),
  watchTicket: (ticketId: number, watch: boolean) => http<{ ticket: TicketDTO }>(watch ? 'POST' : 'DELETE', `/tickets/${ticketId}/watch`),
  userSummary: (userId: number) => http<{ summary: UserSummaryPageDTO }>('GET', `/users/${userId}/summary`),
  search: (q: string, options: { limit?: number; type?: SearchKind[] } = {}) => {
    const query = new URLSearchParams({ q, limit: String(options.limit ?? 6) });
    if (options.type?.length) query.set('type', options.type.join(','));
    return http<SearchResultDTO>('GET', `/search?${query}`);
  },
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

  createListItem: (projectId: number, kind: 'priority' | 'component', input: { name: string; color: string; icon: string }) =>
    http<Record<'priority' | 'component', ProjectListItemDTO>>('POST', `/projects/${projectId}/${kind === 'priority' ? 'priorities' : 'components'}`, { body: input }).then((r) => r[kind]),
  updateListItem: (projectId: number, kind: 'priority' | 'component', itemId: number, patch: { name?: string; color?: string; icon?: string; position?: number }) =>
    http<Record<'priority' | 'component', ProjectListItemDTO>>('PATCH', `/projects/${projectId}/${kind === 'priority' ? 'priorities' : 'components'}/${itemId}`, { body: patch }).then((r) => r[kind]),
  deleteListItem: (projectId: number, kind: 'priority' | 'component', itemId: number) =>
    http<{ ok: true }>('DELETE', `/projects/${projectId}/${kind === 'priority' ? 'priorities' : 'components'}/${itemId}`),

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
  transferTicket: (ticketId: number, projectId: number, status: TicketStatus) =>
    http<{ ticket: TicketDTO; key: string }>('POST', `/tickets/${ticketId}/transfer`, { body: { projectId, status } }),
  updatePart: (ticketId: number, userId: number, patch: { done?: boolean; progress?: number; note?: string }) =>
    http<{ ticket: TicketDTO }>('PATCH', `/tickets/${ticketId}/assignees/${userId}`, { body: patch }),

  addSubtask: (ticketId: number, title: string, assigneeId: number | null = null) =>
    http<{ ticket: TicketDTO }>('POST', `/tickets/${ticketId}/subtasks`, { body: { title, assigneeId } }),
  updateSubtask: (subtaskId: number, patch: { title?: string; done?: boolean; assigneeId?: number | null; position?: number }) =>
    http<{ ticket: TicketDTO }>('PATCH', `/subtasks/${subtaskId}`, { body: patch }),
  deleteSubtask: (subtaskId: number) => http<{ ticket: TicketDTO }>('DELETE', `/subtasks/${subtaskId}`),
  addLink: (ticketId: number, targetId: number, reason: string) =>
    http<{ ticket: TicketDTO }>('POST', `/tickets/${ticketId}/links`, { body: { targetId, reason } }),
  deleteLink: (linkId: number) => http<{ ticket: TicketDTO }>('DELETE', `/links/${linkId}`),

  comments: (ticketId: number) => http<{ comments: CommentDTO[] }>('GET', `/tickets/${ticketId}/comments`),
  addComment: (ticketId: number, body: string, parentId: number | null) =>
    http<{ comment: CommentDTO }>('POST', `/tickets/${ticketId}/comments`, { body: { body, parentId } }),
  editComment: (commentId: number, body: string) =>
    http<{ comment: CommentDTO }>('PATCH', `/comments/${commentId}`, { body: { body } }),
  deleteComment: (commentId: number) => http<{ comment: CommentDTO }>('DELETE', `/comments/${commentId}`),
  attachments: (ticketId: number) => http<{ attachments: AttachmentDTO[] }>('GET', `/tickets/${ticketId}/attachments`),
  deleteAttachment: (attachmentId: number) => http<{ ok: true }>('DELETE', `/attachments/${attachmentId}`),
  addAttachmentLink: (ticketId: number, input: { kind: 'url' | 'path'; target: string; name?: string }) =>
    http<{ attachment: AttachmentDTO }>('POST', `/tickets/${ticketId}/attachment-links`, { body: input }),
  openAttachment: (attachmentId: number) => http<{ ok: true; revealed: boolean }>('POST', `/attachments/${attachmentId}/open`),
  history: (ticketId: number) => http<{ history: HistoryEntryDTO[] }>('GET', `/tickets/${ticketId}/history`),

  activity: (projectId: number, filters: ActivityFilters = {}) => {
    const query = new URLSearchParams();
    if (filters.group?.length) query.set('group', filters.group.join(','));
    if (filters.userId !== undefined) query.set('userId', String(filters.userId));
    if (filters.source) query.set('source', filters.source);
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
  adminUpdateToken: (tokenId: number, patch: { displayName?: string | null; expiresInDays?: number | null }) =>
    http<{ token: ApiTokenDTO }>('PATCH', `/admin/tokens/${tokenId}`, { body: patch }),
  adminAi: () => http<{ settings: AiSettingsDTO }>('GET', '/admin/ai'),
  adminSaveAi: (input: { enabled: boolean; providers: AiProviderInput[]; defaultModel: string; maxSteps: number; maxTurns: number }) => http<{ settings: AiSettingsDTO; app: AppInfoDTO }>('PUT', '/admin/ai', { body: input }),
  adminTestAi: (probe: { providerId?: string; baseUrl: string; timeoutSeconds?: number; model?: string; apiKey?: string }) => http<{ ok: boolean; message: string }>('POST', '/admin/ai/test', { body: probe }),
  adminDetectAiModels: (probe: { providerId?: string; baseUrl: string; apiKey?: string }) => http<{ models: DetectedModelDTO[] }>('POST', '/admin/ai/models', { body: probe }),
  aiModels: () => http<{ models: AiModelChoiceDTO[]; defaultModel: string }>('GET', '/ai/models'),
  aiConversations: () => http<{ conversations: AiConversationSummaryDTO[] }>('GET', '/ai/conversations'),
  aiConversation: (id: string) => http<{ conversation: AiConversationDTO }>('GET', `/ai/conversations/${id}`),
  aiSaveConversation: (id: string, input: { title: string; context: AiContext; turns: unknown[] }) => http<{ conversation: AiConversationSummaryDTO }>('PUT', `/ai/conversations/${id}`, { body: input }),
  aiDeleteConversation: (id: string) => http<{ ok: true }>('DELETE', `/ai/conversations/${id}`),
  adminHttps: () => http<{ settings: HttpsSettingsDTO; status: HttpsStatusDTO }>('GET', '/admin/https'),
  adminSaveHttps: (input: Omit<HttpsSettingsDTO, 'hasPassphrase' | 'updatedAt'> & { passphrase?: string }) => http<{ settings: HttpsSettingsDTO; status: HttpsStatusDTO }>('PUT', '/admin/https', { body: input }),
  adminSelfSigned: (hostnames: string[]) => http<{ certPath: string; keyPath: string; certificate: CertificateInfoDTO }>('POST', '/admin/https/self-signed', { body: { hostnames } }),
  adminTestHttps: (files: CertificateFiles) => http<{ ok: boolean; message: string; certificate: CertificateInfoDTO | null }>('POST', '/admin/https/test', { body: files }),
  adminSetAppName: (name: string) => http<AppInfoDTO>('PUT', '/admin/app', { body: { name } }),
  adminSetAppLogo: (blob: Blob) => http<AppInfoDTO>('PUT', '/admin/app/logo', { rawBody: blob, contentType: blob.type || 'image/png' }),
  adminRemoveAppLogo: () => http<AppInfoDTO>('DELETE', '/admin/app/logo'),
  adminMaintenance: () => http<{ maintenance: MaintenanceDTO }>('GET', '/admin/maintenance'),
  adminSetMaintenance: (input: Omit<MaintenanceDTO, 'updatedAt'>) => http<{ app: AppInfoDTO; maintenance: MaintenanceDTO }>('PUT', '/admin/maintenance', { body: input }),
  adminBackups: () => http<BackupOverviewDTO>('GET', '/admin/backups'),
  adminSaveBackups: (config: { enabled: boolean; destinations: Array<Omit<BackupDestinationDTO, 'id'> & { id?: string }> }) =>
    http<BackupOverviewDTO>('PUT', '/admin/backups', { body: config }),
  adminTestFolder: (path: string) => http<{ ok: boolean; message: string }>('POST', '/admin/backups/test-folder', { body: { path } }),
  adminRunBackup: (destinationId: string) => http<{ run: BackupRunDTO; overview: BackupOverviewDTO }>('POST', `/admin/backups/${destinationId}/run`),
  adminService: () => http<{ status: ServiceStatusDTO }>('GET', '/admin/service'),
  adminServiceAction: (action: 'install' | 'uninstall' | 'start' | 'stop', scope: ServiceScope, dryRun = false) =>
    http<ServiceActionResultDTO>('POST', '/admin/service', { body: { action, scope, dryRun } }),
  adminMonitoring: (range: MonitoringRange) => http<MonitoringSnapshotDTO>('GET', `/admin/monitoring?range=${range}`),
  adminLogs: (filters: LogFilters) => http<{ logs: LogEntryDTO[]; nextBefore: number | null }>('GET', `/admin/logs?${logQuery(filters)}`),
  adminRoles: () =>
    http<{ roles: RoleDTO[]; catalog: { global: PermissionDef[]; project: PermissionDef[] } }>('GET', '/admin/roles'),
  adminCreateRole: (input: RoleInput) => http<{ role: RoleDTO }>('POST', '/admin/roles', { body: input }),
  adminUpdateRole: (roleId: number, patch: { name?: string; description?: string; permissions?: string[] }) =>
    http<{ role: RoleDTO }>('PATCH', `/admin/roles/${roleId}`, { body: patch }),
  adminDeleteRole: (roleId: number) => http<{ ok: true }>('DELETE', `/admin/roles/${roleId}`),
};
