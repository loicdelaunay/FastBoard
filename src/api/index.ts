import { FILE_NAME_HEADER, type NotificationLevel, type TicketStatus } from '@shared/constants';
import type { SavedFilterDTO, TicketFilterValues } from '@shared/ticketFilters';
import type { PersonalBoardDTO } from '@shared/personalBoard';
import type { GroupAccessDTO, GroupDTO, GroupMemberRole, GroupSpaceRole, ProjectGroupDTO, SpaceGroupDTO } from '@shared/groups';
import type { RoleScope, PermissionDef } from '@shared/permissions';
import type { DocBookmarkDTO, DocImportAction, DocImportCompareDTO, DocImportPreviewDTO, DocMemberDTO, DocLinksDTO, DocNodeDTO, DocNodeInfoDTO, DocRescanResultDTO, DocRole, DocSearchHitDTO, DocSiteDTO, DocSiteVisibility, DocSpaceDTO, DocVersionDTO, DocVersionFileDTO, WikiDTO, WikiPageDTO, WikiSearchHitDTO } from '@shared/docs';
import type { DocCommentDTO, DocQuote } from '@shared/docComments';
import type { BoardAssetDTO, BoardElement, BoardIconDTO, BoardLinksDTO, BoardMemberDTO, BoardNodeDTO, BoardNodeKind, BoardRole, BoardSearchHitDTO, BoardShareAudience, BoardShareDTO, BoardShareInfoDTO, BoardShareRole, BoardSpaceDTO, BoardVersionDTO } from '@shared/boards';
import type { LdapFields, LdapSettingsDTO, LdapTestResultDTO } from '@shared/ldap';
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
  ActivityCommentDTO,
  DeliveryDTO,
  HistoryEntryDTO,
  MeDTO,
  NotificationDTO,
  NotificationSettingDTO,
  MaintenanceDTO,
  AppInfoDTO,
  ProjectDTO,
  ProjectListItemDTO,
  SearchKind,
  SearchResultDTO, TicketPreviewDTO,
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
import type { AppearanceDTO, CustomThemeDef, SharedThemeDTO } from '@shared/themes';
import type { RagFormat, RagSettingsDTO, RagStatusDTO, RagTestResultDTO } from '@shared/rag';
import type { VersionTagHitDTO } from '@shared/versionTags';
import type { CustomFieldValue } from '@shared/ticketFields';
import type { CertificateFormat, CertificateInfoDTO, HttpsSettingsDTO, HttpsStatusDTO } from '@shared/https';
import type { BackupDestinationDTO, BackupOverviewDTO, BackupRunDTO } from '@shared/backup';
import type { ServiceActionResultDTO, ServiceScope, ServiceStatusDTO } from '@shared/system';
import { ApiError, http, httpHeaders } from './http';

import { t } from '@/i18n';
import { translateServerMessage } from '@/i18n/server';
import { compressImage, imageAs } from '@/utils/image';
import type { SnapshotContent, SnapshotKind, SpaceSnapshotDTO } from '@shared/snapshots';
import type { NotificationCategory, NotificationCounts } from '@shared/notificationCategories';
import type { FavoriteKind, FavoriteSpaceDTO, HomeDTO } from '@shared/home';
import type { HomeLayout } from '@shared/homeLayout';
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
  /** Champs personnalisés : `{ <id>: valeur }`, fusionnés ; `null` efface. */
  customFields?: Record<string, CustomFieldValue | null>;
  /** Avec des sous-tickets : l'avancement suit le leur. */
  progressFromChildren?: boolean;
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

/** Envoie un fichier de documentation en corps brut. */
async function uploadDocFile<T>(path: string, file: File, method: 'POST' | 'PUT' = 'POST'): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: { ...httpHeaders(), 'Content-Type': file.type || 'application/octet-stream', [FILE_NAME_HEADER]: encodeURIComponent(file.name) },
    body: file,
    credentials: 'same-origin',
  });
  const payload = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!response.ok) throw new Error(translateServerMessage(payload?.error?.message ?? `Erreur ${response.status}`));
  return payload as T;
}

/** Envoie un fichier en corps brut (XMLHttpRequest : seul moyen d'obtenir la progression de l'envoi). */
export async function uploadAttachment(ticketId: number, original: File, onProgress?: (ratio: number) => void): Promise<AttachmentDTO> {
  // Une image est allégée (WebP) avant l'envoi ; tout autre fichier part tel quel.
  const file = await compressImage(original);
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

/** Réglages du modèle d'embeddings tels que le formulaire les envoie (pour un essai : sans `enabled` ni intervalle). */
export interface RagProbeInput {
  baseUrl: string;
  model: string;
  format: RagFormat;
  queryTemplate: string;
  documentTemplate: string;
  dimensions: number | null;
  timeoutSeconds: number;
  /** Absent : garder la clé enregistrée ; chaîne vide : l'effacer. */
  apiKey?: string;
  verifyCertificate: boolean;
}

export interface RagSettingsInput extends RagProbeInput {
  enabled: boolean;
  intervalHours: number;
  chunkChars: number;
}

/** Paramètres d'une page d'activité (projet, ou « Mon tableau »). */
function activityQuery(filters: ActivityFilters): URLSearchParams {
  const query = new URLSearchParams();
  if (filters.group?.length) query.set('group', filters.group.join(','));
  if (filters.userId !== undefined) query.set('userId', String(filters.userId));
  if (filters.source) query.set('source', filters.source);
  if (filters.ticketId !== undefined) query.set('ticketId', String(filters.ticketId));
  if (filters.before !== undefined) query.set('before', String(filters.before));
  query.set('limit', String(filters.limit ?? 40));
  return query;
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
  sharedThemes: () => http<{ themes: SharedThemeDTO[] }>('GET', '/themes/shared'),
  publishTheme: (theme: Omit<CustomThemeDef, 'id'>) => http<{ theme: SharedThemeDTO }>('POST', '/themes/shared', { body: { theme } }),
  removeSharedTheme: (id: string) => http<{ ok: true }>('DELETE', `/themes/shared/${encodeURIComponent(id)}`),
  updateMe: (patch: { name?: string; theme?: string; locale?: Locale; appearance?: AppearanceDTO }) => http<{ user: MeDTO }>('PATCH', '/me', { body: patch }),
  changePassword: (currentPassword: string, newPassword: string) =>
    http<{ ok: true }>('POST', '/me/password', { body: { currentPassword, newPassword } }),
  uploadAvatar: (blob: Blob) =>
    http<{ user: MeDTO }>('PUT', '/me/avatar', { rawBody: blob, contentType: blob.type || 'image/webp' }),
  removeAvatar: () => http<{ user: MeDTO }>('DELETE', '/me/avatar'),
  directory: () => http<{ users: UserSummaryDTO[] }>('GET', '/users'),
  notifications: (options: { before?: number; category?: NotificationCategory | null; unread?: boolean; limit?: number } = {}) =>
    http<{ notifications: NotificationDTO[]; unread: number; counts: NotificationCounts; nextBefore: number | null }>(
      'GET',
      `/me/notifications?limit=${options.limit ?? 30}${options.before ? `&before=${options.before}` : ''}${options.category ? `&category=${options.category}` : ''}${options.unread ? '&unread=true' : ''}`,
    ),
  markNotificationsRead: (selection: { ids?: number[]; category?: NotificationCategory | null } = {}) =>
    http<{ unread: number; counts: NotificationCounts }>('POST', '/me/notifications/read', { body: { ...(selection.ids ? { ids: selection.ids } : {}), ...(selection.category ? { category: selection.category } : {}) } }),
  /** Efface des notifications : celles d'une catégorie, seulement les lues, ou toutes. */
  deleteNotifications: (selection: { category?: NotificationCategory | null; readOnly?: boolean } = {}) => {
    const query = [selection.category ? `category=${selection.category}` : '', selection.readOnly ? 'read=true' : ''].filter(Boolean).join('&');
    return http<{ removed: number; unread: number; counts: NotificationCounts }>('DELETE', `/me/notifications${query ? `?${query}` : ''}`);
  },
  deleteNotification: (id: number) => http<{ removed: number; unread: number; counts: NotificationCounts }>('DELETE', `/me/notifications/${id}`),
  watchTicket: (ticketId: number, watch: boolean) => http<{ ticket: TicketDTO }>(watch ? 'POST' : 'DELETE', `/tickets/${ticketId}/watch`),
  notificationSettings: () => http<{ settings: NotificationSettingDTO[]; defaultLevel: NotificationLevel }>('GET', '/me/notification-settings'),
  setNotificationLevel: (projectId: number, level: NotificationLevel) =>
    http<{ setting: NotificationSettingDTO }>('PUT', `/me/notification-settings/${projectId}`, { body: { level } }),
  userSummary: (userId: number) => http<{ summary: UserSummaryPageDTO }>('GET', `/users/${userId}/summary`),
  ticketPreview: (ticketId: number) => http<{ preview: TicketPreviewDTO }>('GET', `/tickets/${ticketId}/preview`),
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
  /** « Mon tableau » : mes tickets de tous mes projets, et l'activité qui me concerne. */
  myBoard: () => http<{ board: PersonalBoardDTO }>('GET', '/me/board'),
  /** Disposition de l'Accueil ; `null` : revenir à celle par défaut. */
  saveHomeLayout: (layout: HomeLayout | null) => http<{ layout: HomeLayout }>('PUT', '/me/home-layout', { body: { layout } }),
  myActivity: (filters: ActivityFilters = {}) => http<{ activities: ActivityDTO[]; nextBefore: number | null }>('GET', `/me/activity?${activityQuery(filters)}`),
  // Filtres enregistrés d'un projet (les siens, et ceux partagés avec le projet)
  projectFilters: (projectId: number) => http<{ filters: SavedFilterDTO[] }>('GET', `/projects/${projectId}/filters`),
  createFilter: (projectId: number, body: { name: string; description: string; filters: TicketFilterValues; shared: boolean }) => http<{ filter: SavedFilterDTO }>('POST', `/projects/${projectId}/filters`, { body }),
  updateFilter: (filterId: number, body: Partial<{ name: string; description: string; filters: TicketFilterValues; shared: boolean }>) => http<{ filter: SavedFilterDTO }>('PATCH', `/filters/${filterId}`, { body }),
  deleteFilter: (filterId: number) => http<{ ok: true }>('DELETE', `/filters/${filterId}`),
  updateProject: (projectId: number, patch: { name?: string; key?: string; description?: string; archived?: boolean; settings?: Partial<ProjectSettingsDTO>; rag?: boolean }) =>
    http<{ project: ProjectDTO }>('PATCH', `/projects/${projectId}`, { body: patch }),
  deleteProject: (projectId: number) => http<{ ok: true }>('DELETE', `/projects/${projectId}`),

  addMember: (projectId: number, userId: number, roleId: number) =>
    http<{ ok: true }>('POST', `/projects/${projectId}/members`, { body: { userId, roleId } }),
  changeMemberRole: (projectId: number, userId: number, roleId: number) =>
    http<{ ok: true }>('PATCH', `/projects/${projectId}/members/${userId}`, { body: { roleId } }),
  removeMember: (projectId: number, userId: number) =>
    http<{ ok: true }>('DELETE', `/projects/${projectId}/members/${userId}`),
  setProjectGroup: (projectId: number, groupId: number, roleId: number) =>
    http<{ groups: ProjectGroupDTO[] }>('PUT', `/projects/${projectId}/groups/${groupId}`, { body: { roleId } }),
  removeProjectGroup: (projectId: number, groupId: number) => http<{ groups: ProjectGroupDTO[] }>('DELETE', `/projects/${projectId}/groups/${groupId}`),

  // Groupes de personnes
  groups: () => http<{ groups: GroupDTO[] }>('GET', '/groups'),
  group: (groupId: number) => http<{ group: GroupDTO; access: GroupAccessDTO[] }>('GET', `/groups/${groupId}`),
  createGroup: (input: { name: string; description?: string; color?: string | null; memberIds?: number[] }) => http<{ group: GroupDTO }>('POST', '/groups', { body: input }),
  updateGroup: (groupId: number, patch: { name?: string; description?: string; color?: string | null }) => http<{ group: GroupDTO }>('PATCH', `/groups/${groupId}`, { body: patch }),
  deleteGroup: (groupId: number) => http<{ ok: true }>('DELETE', `/groups/${groupId}`),
  setGroupMember: (groupId: number, userId: number, role: GroupMemberRole) => http<{ group: GroupDTO }>('PUT', `/groups/${groupId}/members/${userId}`, { body: { role } }),
  removeGroupMember: (groupId: number, userId: number) => http<{ group: GroupDTO }>('DELETE', `/groups/${groupId}/members/${userId}`),

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

  addPart: (ticketId: number, input: { note?: string; userId?: number | null }) => http<{ ticket: TicketDTO }>('POST', `/tickets/${ticketId}/parts`, { body: input }),
  /** Chaque ligne d'avancement devient un sous-ticket. */
  splitParts: (ticketId: number) => http<{ ticket: TicketDTO; children: TicketDTO[] }>('POST', `/tickets/${ticketId}/parts/split`, { body: {} }),
  updatePart: (partId: number, patch: { note?: string; userId?: number | null; done?: boolean; progress?: number; position?: number }) =>
    http<{ ticket: TicketDTO }>('PATCH', `/parts/${partId}`, { body: patch }),
  deletePart: (partId: number) => http<{ ticket: TicketDTO }>('DELETE', `/parts/${partId}`),
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
  /** Remplace l'image d'une pièce jointe, sur place (allégée en WebP comme tout envoi). */
  replaceAttachmentImage: async (attachmentId: number, file: File) => uploadDocFile<{ attachment: AttachmentDTO }>(`/attachments/${attachmentId}/file`, await compressImage(file), 'PUT'),
  addAttachmentLink: (ticketId: number, input: { kind: 'url' | 'path'; target: string; name?: string }) =>
    http<{ attachment: AttachmentDTO }>('POST', `/tickets/${ticketId}/attachment-links`, { body: input }),
  openAttachment: (attachmentId: number) => http<{ ok: true; revealed: boolean }>('POST', `/attachments/${attachmentId}/open`),
  history: (ticketId: number) => http<{ history: HistoryEntryDTO[] }>('GET', `/tickets/${ticketId}/history`),

  addActivityComment: (activityId: number, body: string) => http<{ comment: ActivityCommentDTO }>('POST', `/activities/${activityId}/comments`, { body: { body } }),
  editActivityComment: (commentId: number, body: string) => http<{ comment: ActivityCommentDTO }>('PATCH', `/activity-comments/${commentId}`, { body: { body } }),
  deleteActivityComment: (commentId: number) => http<{ comment: ActivityCommentDTO }>('DELETE', `/activity-comments/${commentId}`),
  activity: (projectId: number, filters: ActivityFilters = {}) => http<{ activities: ActivityDTO[]; nextBefore: number | null }>('GET', `/projects/${projectId}/activity?${activityQuery(filters)}`),

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
  adminDocs: () => http<{ enabled: boolean; imageFolder: string; defaultImageFolder: string; spaces: number; files: number; bytes: number; retentionDays: number }>('GET', '/admin/documentation'),
  adminSaveDocs: (input: { enabled?: boolean; imageFolder?: string }) => http<{ enabled: boolean; imageFolder: string; app: AppInfoDTO }>('PUT', '/admin/documentation', { body: input }),

  ticket: (ticketId: number) => http<{ ticket: TicketDTO }>('GET', `/tickets/${ticketId}`),
  // Tableaux blancs
  adminBoards: () => http<{ enabled: boolean; spaces: number; boards: number }>('GET', '/admin/boards'),
  adminSetBoards: (enabled: boolean) => http<{ enabled: boolean; app: AppInfoDTO }>('PUT', '/admin/boards', { body: { enabled } }),
  boardSpaces: () => http<{ spaces: BoardSpaceDTO[] }>('GET', '/boards/spaces'),
  boardCreateSpace: (input: { name: string; description: string }) => http<{ space: BoardSpaceDTO }>('POST', '/boards/spaces', { body: input }),
  boardSpace: (spaceId: number) => http<{ space: BoardSpaceDTO; role: BoardRole; nodes: BoardNodeDTO[]; members: BoardMemberDTO[]; groups: SpaceGroupDTO[] }>('GET', `/boards/spaces/${spaceId}`),
  boardUpdateSpace: (spaceId: number, input: { name?: string; description?: string; rag?: boolean }) => http<{ space: BoardSpaceDTO }>('PATCH', `/boards/spaces/${spaceId}`, { body: input }),
  boardDeleteSpace: (spaceId: number) => http<{ ok: true }>('DELETE', `/boards/spaces/${spaceId}`),
  boardAddMember: (spaceId: number, userId: number, role: BoardRole) => http<{ members: BoardMemberDTO[] }>('POST', `/boards/spaces/${spaceId}/members`, { body: { userId, role } }),
  boardSetMember: (spaceId: number, userId: number, role: BoardRole) => http<{ members: BoardMemberDTO[] }>('PUT', `/boards/spaces/${spaceId}/members/${userId}`, { body: { role } }),
  boardRemoveMember: (spaceId: number, userId: number) => http<{ members: BoardMemberDTO[] }>('DELETE', `/boards/spaces/${spaceId}/members/${userId}`),
  boardSetGroup: (spaceId: number, groupId: number, role: GroupSpaceRole) => http<{ groups: SpaceGroupDTO[] }>('PUT', `/boards/spaces/${spaceId}/groups/${groupId}`, { body: { role } }),
  boardRemoveGroup: (spaceId: number, groupId: number) => http<{ groups: SpaceGroupDTO[] }>('DELETE', `/boards/spaces/${spaceId}/groups/${groupId}`),
  boardCreateNode: (spaceId: number, path: string, kind: BoardNodeKind, elements?: BoardElement[]) => http<{ node: BoardNodeDTO }>('POST', `/boards/spaces/${spaceId}/nodes`, { body: { path, kind, ...(elements ? { elements } : {}) } }),
  boardTrash: (spaceId: number) => http<{ nodes: BoardNodeDTO[] }>('GET', `/boards/spaces/${spaceId}/trash`),
  boardMoveNode: (nodeId: number, path: string) => http<{ node: BoardNodeDTO }>('PATCH', `/boards/nodes/${nodeId}`, { body: { path } }),
  /** Vers un autre espace (à sa racine, ou dans `folder`). */
  boardMoveToSpace: (nodeIds: number[], spaceId: number, folder = '') => http<{ nodes: BoardNodeDTO[] }>('POST', '/boards/nodes/move', { body: { nodeIds, spaceId, folder } }),
  boardDeleteNode: (nodeId: number) => http<{ ok: true }>('DELETE', `/boards/nodes/${nodeId}`),
  boardRestoreNode: (nodeId: number) => http<{ node: BoardNodeDTO }>('POST', `/boards/nodes/${nodeId}/restore`, { body: {} }),
  boardDuplicate: (nodeId: number) => http<{ node: BoardNodeDTO }>('POST', `/boards/nodes/${nodeId}/duplicate`, { body: {} }),
  boardVersions: (nodeId: number) => http<{ versions: BoardVersionDTO[]; currentVersionId: number | null }>('GET', `/boards/nodes/${nodeId}/versions`),
  boardVersion: (nodeId: number, versionId: number) => http<{ version: BoardVersionDTO; elements: BoardElement[] }>('GET', `/boards/nodes/${nodeId}/versions/${versionId}`),
  boardRestoreVersion: (nodeId: number, versionId: number) => http<{ count: number }>('POST', `/boards/nodes/${nodeId}/versions/${versionId}/restore`, { body: {} }),
  boardForkVersion: (nodeId: number, versionId: number, name?: string) => http<{ node: BoardNodeDTO }>('POST', `/boards/nodes/${nodeId}/versions/${versionId}/fork`, { body: name ? { name } : {} }),
  /** Étiquette une version (`versionId`) ou l'état actuel du tableau. */
  boardTagVersion: (nodeId: number, name: string, versionId?: number | null) => http<{ version: BoardVersionDTO }>('POST', `/boards/nodes/${nodeId}/tags`, { body: versionId ? { name, versionId } : { name } }),
  boardSetVersionTag: (nodeId: number, versionId: number, name: string | null) => http<{ version: BoardVersionDTO }>('PUT', `/boards/nodes/${nodeId}/versions/${versionId}/tag`, { body: { name } }),
  boardTags: (q: string) => http<{ tags: VersionTagHitDTO[] }>('GET', `/boards/tags?q=${encodeURIComponent(q)}`),
  // Accueil et espaces favoris
  home: () => http<{ home: HomeDTO }>('GET', '/me/home'),
  favorites: () => http<{ favorites: FavoriteSpaceDTO[] }>('GET', '/me/favorites'),
  setFavorite: (kind: FavoriteKind, spaceId: number, on: boolean) => http<{ favorites: FavoriteSpaceDTO[] }>(on ? 'PUT' : 'DELETE', `/me/favorites/${kind}/${spaceId}`),
  // Étiquettes d'espace (documentation, tableaux blancs, projets)
  spaceSnapshots: (kind: SnapshotKind, spaceId: number) => http<{ snapshots: SpaceSnapshotDTO[] }>('GET', `/snapshots?kind=${kind}&spaceId=${spaceId}`),
  createSpaceSnapshot: (kind: SnapshotKind, spaceId: number, name: string, description: string) => http<{ snapshot: SpaceSnapshotDTO }>('POST', '/snapshots', { body: { kind, spaceId, name, description } }),
  spaceSnapshot: (snapshotId: number) => http<{ snapshot: SpaceSnapshotDTO; content: SnapshotContent }>('GET', `/snapshots/${snapshotId}`),
  /** Texte figé (note, modèle) ; en JSON, gardé pour la lecture hors ligne comme les autres lectures. */
  spaceSnapshotText: (snapshotId: number, hash: string) => http<{ text: string }>('GET', `/snapshots/${snapshotId}/files/${hash}?as=json`),
  /** Fichier JSON figé : éléments d'un tableau, export d'un projet. */
  spaceSnapshotJson: <T>(snapshotId: number, hash: string) => http<T>('GET', `/snapshots/${snapshotId}/files/${hash}`),
  deleteSpaceSnapshot: (snapshotId: number) => http<{ ok: true }>('DELETE', `/snapshots/${snapshotId}`),
  restoreSpaceSnapshot: (snapshotId: number, name?: string) => http<{ kind: SnapshotKind; spaceId: number }>('POST', `/snapshots/${snapshotId}/restore`, { body: name ? { name } : {} }),
  board: (nodeId: number) => http<{ node: BoardNodeDTO; space: { id: number; name: string }; role: BoardRole; elements: BoardElement[] }>('GET', `/boards/nodes/${nodeId}`),
  boardSearch: (q: string, limit = 10) => http<{ boards: BoardSearchHitDTO[] }>('GET', `/boards/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  boardShare: (nodeId: number) => http<{ share: BoardShareDTO | null }>('GET', `/boards/nodes/${nodeId}/share`),
  boardSaveShare: (nodeId: number, input: { audience: BoardShareAudience; people: number[]; role: BoardShareRole; password?: string | null }) =>
    http<{ share: BoardShareDTO }>('PUT', `/boards/nodes/${nodeId}/share`, { body: input }),
  boardRemoveShare: (nodeId: number) => http<{ ok: true }>('DELETE', `/boards/nodes/${nodeId}/share`),
  sharedBoard: (slug: string, token: string | null) =>
    http<{ share: BoardShareInfoDTO }>('GET', `/board-shares/${encodeURIComponent(slug)}`, { silent401: true, headers: token ? { 'X-Board-Share': token } : {} }),
  sharedBoardUnlock: (slug: string, password: string) => http<{ token: string }>('POST', `/board-shares/${encodeURIComponent(slug)}/unlock`, { body: { password }, silent401: true }),
  boardPatchElements: (nodeId: number, upsert: BoardElement[], remove: string[]) => http<{ count: number }>('PATCH', `/boards/nodes/${nodeId}/elements`, { body: { upsert, remove } }),
  boardSaveElements: (nodeId: number, elements: BoardElement[]) => http<{ count: number }>('PUT', `/boards/nodes/${nodeId}/elements`, { body: { elements } }),
  boardAssets: (spaceId: number) => http<{ assets: BoardAssetDTO[] }>('GET', `/boards/spaces/${spaceId}/assets`),
  boardUploadAsset: async (spaceId: number, file: File) => uploadDocFile<{ asset: BoardAssetDTO }>(`/boards/spaces/${spaceId}/assets`, await compressImage(file)),
  boardDeleteAsset: (assetId: number) => http<{ ok: true }>('DELETE', `/boards/assets/${assetId}`),
  boardIcons: () => http<{ icons: BoardIconDTO[] }>('GET', '/boards/icons'),
  adminAddBoardIcon: (name: string, svg: string) => http<{ icon: BoardIconDTO }>('POST', '/admin/board-icons', { body: { name, svg } }),
  adminDeleteBoardIcon: (iconId: number) => http<{ ok: true }>('DELETE', `/admin/board-icons/${iconId}`),
  boardLinks: (nodeId: number) => http<BoardLinksDTO>('GET', `/boards/nodes/${nodeId}/links`),
  boardPreviewUrl: (nodeId: number, width = 640, dark = false) => `/api/boards/nodes/${nodeId}/preview?width=${width}${dark ? '&theme=dark' : ''}`,

  docSpaces: () => http<{ spaces: DocSpaceDTO[] }>('GET', '/documentation/spaces'),
  docCreateSpace: (input: { name: string; description: string; obsidian?: boolean; imageFolder?: string | null }) => http<{ space: DocSpaceDTO }>('POST', '/documentation/spaces', { body: input }),
  docSpace: (spaceId: number) => http<{ space: DocSpaceDTO; nodes: DocNodeDTO[]; templates: DocNodeDTO[]; members: DocMemberDTO[]; groups: SpaceGroupDTO[] }>('GET', `/documentation/spaces/${spaceId}`),
  docUpdateSpace: (spaceId: number, input: { name?: string; description?: string; obsidian?: boolean; imageFolder?: string | null; rag?: boolean }) => http<{ space: DocSpaceDTO }>('PATCH', `/documentation/spaces/${spaceId}`, { body: input }),
  docDeleteSpace: (spaceId: number) => http<{ ok: true }>('DELETE', `/documentation/spaces/${spaceId}`),
  docAddMember: (spaceId: number, userId: number, role: DocRole) => http<{ members: DocMemberDTO[] }>('POST', `/documentation/spaces/${spaceId}/members`, { body: { userId, role } }),
  docSetMember: (spaceId: number, userId: number, role: DocRole) => http<{ members: DocMemberDTO[] }>('PATCH', `/documentation/spaces/${spaceId}/members/${userId}`, { body: { role } }),
  docRemoveMember: (spaceId: number, userId: number) => http<{ members: DocMemberDTO[] }>('DELETE', `/documentation/spaces/${spaceId}/members/${userId}`),
  docSetGroup: (spaceId: number, groupId: number, role: GroupSpaceRole) => http<{ groups: SpaceGroupDTO[] }>('PUT', `/documentation/spaces/${spaceId}/groups/${groupId}`, { body: { role } }),
  docRemoveGroup: (spaceId: number, groupId: number) => http<{ groups: SpaceGroupDTO[] }>('DELETE', `/documentation/spaces/${spaceId}/groups/${groupId}`),
  docTrash: (spaceId: number) => http<{ nodes: DocNodeDTO[] }>('GET', `/documentation/spaces/${spaceId}/trash`),
  /** `fromId` : note ou modèle dont partir (une note créée d'après un modèle reçoit son texte, variables remplies). */
  docCreateNode: (spaceId: number, path: string, kind: 'folder' | 'markdown' | 'template', from: { content?: string; fromId?: number } = {}) =>
    http<{ node: DocNodeDTO }>('POST', `/documentation/spaces/${spaceId}/nodes`, { body: { path, kind, ...(from.content === undefined ? {} : { content: from.content }), ...(from.fromId === undefined ? {} : { fromId: from.fromId }) } }),
  docNode: (nodeId: number) => http<{ node: DocNodeDTO; role: DocRole; content: string | null }>('GET', `/documentation/nodes/${nodeId}`),
  docNodeInfo: (nodeId: number) => http<DocNodeInfoDTO>('GET', `/documentation/nodes/${nodeId}/info`),
  docSetMemo: (nodeId: number, memo: string) => http<{ node: DocNodeDTO }>('PUT', `/documentation/nodes/${nodeId}/memo`, { body: { memo } }),
  docSetFolderStyle: (nodeId: number, style: { icon?: string | null; color?: string | null }) => http<{ node: DocNodeDTO }>('PUT', `/documentation/nodes/${nodeId}/style`, { body: style }),
  docBookmarks: () => http<{ bookmarks: DocBookmarkDTO[] }>('GET', '/documentation/bookmarks'),
  docSetBookmark: (nodeId: number, on: boolean) => http<{ bookmarks: DocBookmarkDTO[] }>(on ? 'PUT' : 'DELETE', `/documentation/nodes/${nodeId}/bookmark`),
  docSite: (spaceId: number) => http<{ site: DocSiteDTO | null }>('GET', `/documentation/spaces/${spaceId}/site`),
  docSaveSite: (spaceId: number, input: { visibility: DocSiteVisibility; people: number[] }) => http<{ site: DocSiteDTO }>('PUT', `/documentation/spaces/${spaceId}/site`, { body: input }),
  docRemoveSite: (spaceId: number) => http<{ ok: true }>('DELETE', `/documentation/spaces/${spaceId}/site`),
  wiki: (slug: string) => http<WikiDTO>('GET', `/wiki/${encodeURIComponent(slug)}`, { silent401: true }),
  wikiSearch: (slug: string, q: string) => http<{ results: WikiSearchHitDTO[] }>('GET', `/wiki/${encodeURIComponent(slug)}/search?q=${encodeURIComponent(q)}`, { silent401: true }),
  wikiPage: (slug: string, nodeId: number) => http<WikiPageDTO>('GET', `/wiki/${encodeURIComponent(slug)}/pages/${nodeId}`, { silent401: true }),
  docSetContent: (nodeId: number, content: string) => http<{ ok: true }>('PUT', `/documentation/nodes/${nodeId}/content`, { body: { content } }),
  docMoveNode: (nodeId: number, path: string) => http<{ node: DocNodeDTO }>('PATCH', `/documentation/nodes/${nodeId}`, { body: { path } }),
  /** Vers un autre espace (à sa racine, ou dans `folder`). */
  docMoveToSpace: (nodeIds: number[], spaceId: number, folder = '') => http<{ nodes: DocNodeDTO[] }>('POST', '/documentation/nodes/move', { body: { nodeIds, spaceId, folder } }),
  docDeleteNode: (nodeId: number) => http<{ ok: true }>('DELETE', `/documentation/nodes/${nodeId}`),
  docRestoreNode: (nodeId: number) => http<{ node: DocNodeDTO }>('POST', `/documentation/nodes/${nodeId}/restore`, { body: {} }),
  docVersions: (nodeId: number) => http<{ versions: DocVersionDTO[]; retentionDays: number }>('GET', `/documentation/nodes/${nodeId}/versions`),
  docVersion: (versionId: number) => http<{ content: string; createdAt: string; version: DocVersionDTO; node: { id: number; spaceId: number; path: string }; files: DocVersionFileDTO[] }>('GET', `/documentation/versions/${versionId}`),
  /** Étiquette une version (`versionId`) ou l'état actuel de la note. */
  docTagVersion: (nodeId: number, name: string, versionId?: number | null) => http<{ version: DocVersionDTO }>('POST', `/documentation/nodes/${nodeId}/tags`, { body: versionId ? { name, versionId } : { name } }),
  docSetVersionTag: (versionId: number, name: string | null) => http<{ version: DocVersionDTO }>('PUT', `/documentation/versions/${versionId}/tag`, { body: { name } }),
  docForkVersion: (versionId: number) => http<{ node: DocNodeDTO }>('POST', `/documentation/versions/${versionId}/fork`, { body: {} }),
  docTags: (q: string) => http<{ tags: VersionTagHitDTO[] }>('GET', `/documentation/tags?q=${encodeURIComponent(q)}`),
  docRestoreVersion: (versionId: number, content?: string) => http<{ ok: true }>('POST', `/documentation/versions/${versionId}/restore`, { body: content === undefined ? {} : { content } }),
  docSearch: (q: string, limit = 10) => http<{ files: DocSearchHitDTO[] }>('GET', `/documentation/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  docApplyImport: (spaceId: number, importId: string, decisions: Array<{ path: string; action: DocImportAction; content?: string }>) =>
    http<{ written: number; deleted: number }>('POST', `/documentation/spaces/${spaceId}/import/${importId}/apply`, { body: { decisions } }),
  docImportCompare: (spaceId: number, importId: string, path: string) => http<DocImportCompareDTO>('GET', `/documentation/spaces/${spaceId}/import/${importId}/compare?path=${encodeURIComponent(path)}`),
  docImportPreview: (spaceId: number, file: File, folder = '') => uploadDocFile<DocImportPreviewDTO>(`/documentation/spaces/${spaceId}/import${folder ? `?folder=${encodeURIComponent(folder)}` : ''}`, file),
  docFileImportPreview: (nodeId: number, file: File) => uploadDocFile<DocImportPreviewDTO>(`/documentation/nodes/${nodeId}/import`, file),
  docLinks: (nodeId: number) => http<DocLinksDTO>('GET', `/documentation/nodes/${nodeId}/links`),
  docComments: (nodeId: number) => http<{ comments: DocCommentDTO[] }>('GET', `/documentation/nodes/${nodeId}/comments`),
  docAddComment: (nodeId: number, input: Partial<DocQuote> & { body: string; parentId?: number }) => http<{ comment: DocCommentDTO }>('POST', `/documentation/nodes/${nodeId}/comments`, { body: input }),
  docResolveComment: (commentId: number, resolved: boolean) => http<{ comment: DocCommentDTO }>('PATCH', `/documentation/comments/${commentId}`, { body: { resolved } }),
  docDeleteComment: (commentId: number) => http<{ ok: true }>('DELETE', `/documentation/comments/${commentId}`),
  docRescan: (spaceId: number) => http<{ result: DocRescanResultDTO; nodes: DocNodeDTO[]; templates: DocNodeDTO[] }>('POST', `/documentation/spaces/${spaceId}/rescan`, { body: {} }),
  /** Remplace une image sur place (même nom) ; elle est convertie au format de son nom. L'ancienne va dans la corbeille. */
  docReplaceImage: async (nodeId: number, path: string, file: File) => uploadDocFile<{ node: DocNodeDTO }>(`/documentation/nodes/${nodeId}/raw`, await imageAs(file, path), 'PUT'),
  docUploadImage: async (spaceId: number, folder: string, file: File) => uploadDocFile<{ node: DocNodeDTO }>(`/documentation/spaces/${spaceId}/images?folder=${encodeURIComponent(folder)}`, await compressImage(file)),

  adminAuth: () => http<{ ldap: LdapSettingsDTO }>('GET', '/admin/auth'),
  adminSaveAuth: (input: LdapFields & { bindPassword?: string }) => http<{ ldap: LdapSettingsDTO; app: AppInfoDTO }>('PUT', '/admin/auth', { body: input }),
  adminTestLdap: (input: LdapFields & { bindPassword?: string; login: string; password: string }) => http<LdapTestResultDTO>('POST', '/admin/auth/ldap/test', { body: input }),
  adminAi: () => http<{ settings: AiSettingsDTO }>('GET', '/admin/ai'),
  adminRag: () => http<{ settings: RagSettingsDTO; status: RagStatusDTO }>('GET', '/admin/rag'),
  adminSaveRag: (input: RagSettingsInput) => http<{ settings: RagSettingsDTO; status: RagStatusDTO }>('PUT', '/admin/rag', { body: input }),
  adminTestRag: (probe: RagProbeInput) => http<{ result: RagTestResultDTO }>('POST', '/admin/rag/test', { body: probe }),
  adminRagModels: (probe: RagProbeInput) => http<{ models: string[] }>('POST', '/admin/rag/models', { body: probe }),
  adminReindexRag: (rebuild = false) => http<{ status: RagStatusDTO }>('POST', '/admin/rag/reindex', { body: { rebuild } }),
  adminSaveAi: (input: { enabled: boolean; providers: AiProviderInput[]; defaultModel: string; maxSteps: number; maxTurns: number }) => http<{ settings: AiSettingsDTO; app: AppInfoDTO }>('PUT', '/admin/ai', { body: input }),
  adminTestAi: (probe: { providerId?: string; baseUrl: string; timeoutSeconds?: number; model?: string; apiKey?: string; verifyCertificate?: boolean }) => http<{ ok: boolean; message: string }>('POST', '/admin/ai/test', { body: probe }),
  adminDetectAiModels: (probe: { providerId?: string; baseUrl: string; apiKey?: string; verifyCertificate?: boolean }) => http<{ models: DetectedModelDTO[] }>('POST', '/admin/ai/models', { body: probe }),
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
  /** Icônes de l'application installée, tirées du logo (PNG en adresses `data:`). */
  adminSetAppIcons: (icons: Record<string, string>) => http<AppInfoDTO>('PUT', '/admin/app/icons', { body: { icons } }),
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
