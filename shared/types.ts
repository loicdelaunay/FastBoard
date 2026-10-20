/** Objets échangés entre l'API REST / WebSocket et l'interface. */

import type { TicketStatus } from './constants.ts';
import type { RoleScope } from './permissions.ts';
import type { Locale } from './locales.ts';
import type { ProjectSettingsDTO } from './settings.ts';

export interface UserSummaryDTO {
  id: number;
  name: string;
  email: string;
  /** Incrémenté à chaque changement d'image : sert à invalider le cache navigateur. 0 = pas d'image. */
  avatarVersion: number;
  isActive: boolean;
}

export interface MeDTO extends UserSummaryDTO {
  theme: string;
  /** Langue choisie ; `null` tant que la personne n'a rien choisi (l'interface suit alors le navigateur). */
  locale: Locale | null;
  roleId: number;
  roleName: string;
  roleKey: string | null;
  permissions: string[];
}

export interface AdminUserDTO extends UserSummaryDTO {
  theme: string;
  roleId: number;
  roleName: string;
  roleKey: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface RoleDTO {
  id: number;
  scope: RoleScope;
  key: string | null;
  name: string;
  description: string;
  permissions: string[];
  isSystem: boolean;
  /** Permissions non modifiables. */
  locked: boolean;
  /** Nombre d'utilisateurs (rôle global) ou de membres (rôle de projet) qui l'utilisent. */
  usage: number;
}

export interface ProjectDTO {
  id: number;
  name: string;
  key: string;
  description: string;
  archived: boolean;
  ownerId: number | null;
  /** Automatisations et colonnes du Kanban. */
  settings: ProjectSettingsDTO;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummaryDTO extends ProjectDTO {
  memberCount: number;
  ticketCount: number;
  doneCount: number;
  /** Avancement global (0–100) calculé sur les tickets. */
  progress: number;
  myRoleId: number | null;
  myRoleName: string | null;
  /** Aperçu des membres pour l'affichage en pile d'avatars. */
  memberPreview: UserSummaryDTO[];
}

export interface ProjectMemberDTO {
  userId: number;
  roleId: number;
  joinedAt: string;
}

export interface CategoryDTO {
  id: number;
  projectId: number;
  name: string;
  color: string;
  position: number;
}

/** Élément d'une liste réglable par projet : priorité ou composant. */
export interface ProjectListItemDTO {
  id: number;
  projectId: number;
  name: string;
  color: string;
  /** Classe PrimeIcons, ex. `pi pi-flag`. */
  icon: string;
  position: number;
}
export type PriorityDTO = ProjectListItemDTO;
export type ComponentDTO = ProjectListItemDTO;

export interface SubtaskDTO {
  id: number;
  ticketId: number;
  title: string;
  done: boolean;
  assigneeId: number | null;
  position: number;
  createdAt: string;
  doneAt: string | null;
}

/** Dépendance d'un ticket vers un autre (lien sortant ; les liens entrants se lisent sur les autres tickets). */
export interface TicketLinkDTO {
  id: number;
  ticketId: number;
  targetId: number;
  /** Raison : une valeur proposée (`LINK_REASONS`) ou un texte libre. */
  reason: string;
  createdBy: number | null;
  createdAt: string;
}

export interface DeliveryDTO {
  id: number;
  projectId: number;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  color: string;
  position: number;
}

export interface AssigneeDTO {
  userId: number;
  /** La personne a terminé sa part. */
  done: boolean;
  /** Avancement personnel (0–100) ; ignoré tant que `done` est faux et que la valeur n'est pas renseignée. */
  progress: number;
  doneAt: string | null;
  /** Mission facultative : ce que cette personne doit faire sur le ticket (texte libre, peut être vide). */
  note: string;
}

export interface TicketDTO {
  id: number;
  projectId: number;
  number: number;
  title: string;
  description: string;
  status: TicketStatus;
  categoryId: number | null;
  deliveryId: number | null;
  /** Première livraison ciblée : permet de repérer les tickets reportés. */
  initialDeliveryId: number | null;
  /** Priorité (liste réglable par projet). */
  priorityId: number | null;
  /** Composants (liste réglable par projet). */
  componentIds: number[];
  startDate: string | null;
  endDate: string | null;
  /** Avancement saisi à la main (utilisé quand le ticket n'a aucun assigné). */
  progress: number;
  position: number;
  assignees: AssigneeDTO[];
  commentCount: number;
  attachmentCount: number;
  subtasks: SubtaskDTO[];
  links: TicketLinkDTO[];
  /** Dernier changement de colonne : sert à l'indicateur d'inactivité. */
  statusChangedAt: string;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface AttachmentDTO {
  id: number;
  ticketId: number;
  /** Auteur de l'envoi ; `null` si le compte a été supprimé. */
  userId: number | null;
  name: string;
  /** Type détecté par le serveur (les images sont vérifiées d'après leur contenu). */
  mime: string;
  size: number;
  createdAt: string;
}

export interface CommentDTO {
  id: number;
  ticketId: number;
  userId: number | null;
  parentId: number | null;
  body: string;
  createdAt: string;
  updatedAt: string | null;
  deleted: boolean;
}

export interface NameRef {
  id: number;
  name: string;
}

export type HistoryField =
  | 'title'
  | 'description'
  | 'status'
  | 'category'
  | 'delivery'
  | 'startDate'
  | 'endDate'
  | 'progress'
  | 'priority'
  | 'components';

export interface HistoryChange {
  field: HistoryField;
  from: string | number | null;
  to: string | number | null;
}

export type HistoryData =
  | { kind: 'created'; title: string; assignees?: NameRef[] }
  | { kind: 'updated'; changes: HistoryChange[]; auto?: 'all_parts_done' | 'part_reopened' }
  | { kind: 'assignees'; added: NameRef[]; removed: NameRef[] }
  /** `note` : mission définie ou modifiée (chaîne vide = mission effacée). */
  | { kind: 'part'; user: NameRef; done?: boolean; progress?: number; note?: string }
  | { kind: 'attachment'; action: 'added' | 'removed'; name: string; size: number }
  | { kind: 'subtask'; action: 'added' | 'done' | 'reopened' | 'renamed' | 'removed'; title: string; previousTitle?: string }
  | { kind: 'link'; action: 'added' | 'removed'; reason: string; target: { id: number; key: string; title: string } };

export interface HistoryEntryDTO {
  id: number;
  ticketId: number;
  userId: number | null;
  /** Nom affiché du jeton d'API quand la modification vient de l'API (agent, script). */
  via: string | null;
  data: HistoryData;
  createdAt: string;
}

export interface ProjectSnapshotDTO {
  project: ProjectDTO;
  members: ProjectMemberDTO[];
  /** Informations des membres du projet. */
  users: UserSummaryDTO[];
  categories: CategoryDTO[];
  priorities: PriorityDTO[];
  components: ComponentDTO[];
  deliveries: DeliveryDTO[];
  tickets: TicketDTO[];
  /** Permissions effectives de l'utilisateur courant dans ce projet. */
  permissions: string[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Jetons d'API
// ---------------------------------------------------------------------------------------------------------------------

export type ApiTokenScope = 'read' | 'write';

export interface ApiTokenDTO {
  id: number;
  name: string;
  /** Nom affiché dans l'activité et l'historique (« via … ») ; `null` = `name`. */
  displayName: string | null;
  /** Le secret peut être réaffiché (jetons créés depuis la version 1.1). */
  revealable: boolean;
  /** Début du jeton (non secret) pour l'identifier dans une liste, ex. `fb_Ab3dEf`. */
  prefix: string;
  scope: ApiTokenScope;
  /** Projets accessibles avec ce jeton ; `null` = tous ceux auxquels son propriétaire a accès. */
  projectIds: number[] | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  /** Renseignés dans la vue d'administration. */
  userId?: number;
  userName?: string;
}

/** Description du jeton utilisé par la requête courante (retournée par `GET /api/me`). */
export interface TokenInfoDTO {
  id: number;
  name: string;
  displayName: string | null;
  scope: ApiTokenScope;
  projectIds: number[] | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Journal d'activité d'un projet
// ---------------------------------------------------------------------------------------------------------------------

export type ActivityGroup = 'ticket' | 'comment' | 'config' | 'member';

export interface ProjectChange {
  field: 'name' | 'key' | 'description' | 'archived' | 'settings';
  from: string | boolean | null;
  to: string | boolean | null;
}

export type ActivityData =
  /** Création / modification / assignation / part d'un ticket (mêmes données que l'historique du ticket). */
  | { kind: 'ticket'; ticketId: number; ticketKey: string; ticketTitle: string; entry: HistoryData }
  | { kind: 'ticket_deleted'; ticketKey: string; ticketTitle: string }
  | { kind: 'comment'; action: 'created' | 'deleted'; ticketId: number; ticketKey: string; ticketTitle: string; excerpt: string; reply: boolean }
  | { kind: 'category'; action: 'created' | 'updated' | 'deleted'; name: string; previousName?: string }
  | { kind: 'priority'; action: 'created' | 'updated' | 'deleted'; name: string; previousName?: string }
  | { kind: 'component'; action: 'created' | 'updated' | 'deleted'; name: string; previousName?: string }
  | { kind: 'delivery'; action: 'created' | 'updated' | 'deleted'; name: string; startDate?: string; endDate?: string; previousName?: string }
  | { kind: 'member'; action: 'added' | 'removed' | 'left' | 'role_changed'; user: NameRef; role?: string; previousRole?: string }
  | { kind: 'project'; changes: ProjectChange[] };

export interface ActivityDTO {
  id: number;
  projectId: number;
  /** Auteur ; `null` si le compte a été supprimé. */
  userId: number | null;
  /** Nom du jeton d'API quand l'action a été faite via l'API (agent, script…). */
  via: string | null;
  group: ActivityGroup;
  data: ActivityData;
  createdAt: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// Recherche globale et page utilisateur
// ---------------------------------------------------------------------------------------------------------------------

export type SearchKind = 'projects' | 'tickets' | 'users';

export interface SearchProjectHit {
  id: number;
  key: string;
  name: string;
  description: string;
  archived: boolean;
}

export interface SearchTicketHit {
  id: number;
  projectId: number;
  projectKey: string;
  projectName: string;
  number: number;
  key: string;
  title: string;
  status: TicketStatus;
  updatedAt: string;
}

export interface SearchResultDTO {
  query: string;
  projects: { items: SearchProjectHit[]; total: number };
  tickets: { items: SearchTicketHit[]; total: number };
  users: { items: UserSummaryDTO[]; total: number };
}

export interface UserProjectDTO {
  id: number;
  key: string;
  name: string;
  roleName: string;
}

export interface UserAssignedTicketDTO extends SearchTicketHit {
  endDate: string | null;
  /** Avancement de la part de l'utilisateur. */
  partProgress: number;
  partDone: boolean;
}

export interface UserActivityDTO extends ActivityDTO {
  projectKey: string;
  projectName: string;
}

export interface UserSummaryPageDTO {
  user: UserSummaryDTO;
  /** Projets communs visibles par la personne qui consulte. */
  projects: UserProjectDTO[];
  stats: {
    openTickets: number;
    donePartsLast30: number;
    commentsLast30: number;
    actionsLast30: number;
    viaApiLast30: number;
  };
  /** Nombre d'actions par jour sur les 30 derniers jours (le plus ancien d'abord), `YYYY-MM-DD`. */
  activityByDay: Array<{ day: string; count: number }>;
  assigned: UserAssignedTicketDTO[];
  recent: UserActivityDTO[];
}
