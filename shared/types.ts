/** Objets échangés entre l'API REST / WebSocket et l'interface. */

import type { TicketStatus } from './constants.ts';
import type { RoleScope } from './permissions.ts';
import type { Locale } from './locales.ts';
import type { ProjectSettingsDTO } from './settings.ts';
import type { CustomFieldType, CustomFieldValue } from './ticketFields.ts';
import type { AppearanceDTO } from './themes.ts';

export interface UserSummaryDTO {
  id: number;
  name: string;
  email: string;
  /** Incrémenté à chaque changement d'image : sert à invalider le cache navigateur. 0 = pas d'image. */
  avatarVersion: number;
  isActive: boolean;
}

/** Origine d'un compte : `local` (mot de passe FastBoard) ou `ldap` (mot de passe vérifié par l'annuaire). */
export type AuthSource = 'local' | 'ldap';

export interface MeDTO extends UserSummaryDTO {
  authSource: AuthSource;
  theme: string;
  /** Thèmes et polices personnalisés de la personne. */
  appearance: AppearanceDTO;
  /** Langue choisie ; `null` tant que la personne n'a rien choisi (l'interface suit alors le navigateur). */
  locale: Locale | null;
  roleId: number;
  roleName: string;
  roleKey: string | null;
  permissions: string[];
}

export interface AdminUserDTO extends UserSummaryDTO {
  authSource: AuthSource;
  theme: string;
  roleId: number;
  roleName: string;
  roleKey: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  /** Dernière requête ou déconnexion temps réel (la session est réutilisée sans nouvelle connexion). */
  lastSeenAt: string | null;
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
  /** Livraison en cours aujourd'hui (la plus proche de sa fin), avec son avancement et le temps écoulé. */
  currentDelivery: CurrentDeliveryDTO | null;
}

export interface CurrentDeliveryDTO {
  id: number;
  name: string;
  color: string;
  startDate: string;
  endDate: string;
  /** Avancement moyen des tickets de la livraison (0–100). */
  progress: number;
  /** Part du temps de la livraison déjà écoulée (0–100). */
  timeElapsed: number;
  ticketCount: number;
  doneCount: number;
  daysLeft: number;
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

/** Ligne d'avancement d'un ticket : plusieurs lignes possibles par personne, ou aucune personne. */
export interface PartDTO {
  id: number;
  userId: number | null;
  /** Ce qu'il y a à faire (texte libre, vide seulement si une personne est indiquée). */
  note: string;
  done: boolean;
  /** Avancement (0–100). */
  progress: number;
  doneAt: string | null;
  position: number;
}

/** Personne présente sur un ticket, résumée à partir de ses lignes. */
export interface AssigneeDTO {
  userId: number;
  /** Toutes ses lignes sont terminées. */
  done: boolean;
  /** Moyenne de ses lignes (0–100). */
  progress: number;
  doneAt: string | null;
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
  /** Ticket parent quand c'est un sous-ticket (même projet, un seul niveau). */
  parentId: number | null;
  /** Valeurs des champs personnalisés du projet, par identifiant de champ (`cf_…`). */
  customFields: Record<string, CustomFieldValue>;
  /** Avec des sous-tickets : l'avancement suit le leur (vrai par défaut). */
  progressFromChildren: boolean;
  startDate: string | null;
  endDate: string | null;
  /** Avancement saisi à la main (utilisé quand le ticket n'a aucune ligne d'avancement). */
  progress: number;
  position: number;
  /** Lignes d'avancement, dans l'ordre d'affichage. */
  parts: PartDTO[];
  /** Personnes qui ont au moins une ligne. */
  assignees: AssigneeDTO[];
  commentCount: number;
  attachmentCount: number;
  links: TicketLinkDTO[];
  /** Dernier changement de colonne : sert à l'indicateur d'inactivité. */
  statusChangedAt: string;
  /** Personnes qui suivent le ticket (notifications). */
  watcherIds: number[];
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** Rattachement à la livraison actuelle (`null` sans livraison) : tickets ajoutés en cours de sprint. */
  deliveryAddedAt: string | null;
}

/** Résumé d'un ticket affiché au survol d'une mention, avec les noms déjà résolus. */
export interface TicketPreviewDTO {
  id: number;
  key: string;
  title: string;
  projectId: number;
  projectName: string;
  status: TicketStatus;
  statusLabel: string;
  statusColor: string;
  priority: { name: string; color: string } | null;
  delivery: string | null;
  endDate: string | null;
  /** Avancement, en pourcentage. */
  progress: number;
  commentCount: number;
  assignees: UserSummaryDTO[];
  /** Début de la description, sans sa mise en forme. */
  excerpt: string;
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
  /** `file` : fichier envoyé ; `url` : lien web ; `path` : chemin vers un fichier ou un dossier du poste ou du réseau. */
  kind: AttachmentKind;
  /** Cible d'un lien (`url` ou `path`) ; `null` pour un fichier. */
  url: string | null;
}

export type AttachmentKind = 'file' | 'url' | 'path';

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
  | 'components'
  | 'parent'
  | 'custom'
  | 'progressFromChildren';

export interface HistoryChange {
  field: HistoryField;
  from: string | number | null;
  to: string | number | null;
  /** Champ personnalisé (`field: 'custom'`) : son libellé et son type au moment du changement. */
  label?: string;
  customType?: CustomFieldType;
}

export type HistoryData =
  | { kind: 'created'; title: string; assignees?: NameRef[] }
  | { kind: 'updated'; changes: HistoryChange[]; auto?: 'all_parts_done' | 'part_reopened' }
  | { kind: 'assignees'; added: NameRef[]; removed: NameRef[] }
  /** `note` : mission définie ou modifiée (chaîne vide = mission effacée). */
  /** `user` : personne de la ligne ; `line` : son texte ; `action` : ligne ajoutée, retirée ou confiée à quelqu'un. */
  | { kind: 'part'; user: NameRef | null; line?: string; action?: 'added' | 'removed' | 'assigned'; done?: boolean; progress?: number; note?: string }
  | { kind: 'attachment'; action: 'added' | 'removed'; name: string; size: number; link?: 'url' | 'path' }
  /** Historique antérieur à la version 2 : les sous-tâches sont devenues des lignes d'avancement. */
  | { kind: 'subtask'; action: 'added' | 'done' | 'reopened' | 'renamed' | 'removed'; title: string; previousTitle?: string }
  | { kind: 'link'; action: 'added' | 'removed'; reason: string; target: { id: number; key: string; title: string } }
  | { kind: 'transferred'; from: { key: string; project: string }; to: { key: string; project: string } };

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
  /** Ticket déplacé vers un autre projet (`out`) ou reçu d'un autre projet (`in`). */
  | { kind: 'ticket_transferred'; direction: 'in' | 'out'; ticketId: number | null; ticketKey: string; ticketTitle: string; otherProject: string; otherKey: string }
  | { kind: 'comment'; action: 'created' | 'deleted'; ticketId: number; ticketKey: string; ticketTitle: string; excerpt: string; reply: boolean }
  | { kind: 'category'; action: 'created' | 'updated' | 'deleted'; name: string; previousName?: string }
  | { kind: 'priority'; action: 'created' | 'updated' | 'deleted'; name: string; previousName?: string }
  | { kind: 'component'; action: 'created' | 'updated' | 'deleted'; name: string; previousName?: string }
  | { kind: 'delivery'; action: 'created' | 'updated' | 'deleted'; name: string; startDate?: string; endDate?: string; previousName?: string }
  | { kind: 'member'; action: 'added' | 'removed' | 'left' | 'role_changed'; user: NameRef; role?: string; previousRole?: string }
  | { kind: 'project'; changes: ProjectChange[] };

/** Commentaire sur un évènement du journal d'activité (mentions `@[Nom](user:12)` possibles). */
export interface ActivityCommentDTO {
  id: number;
  activityId: number;
  /** Auteur ; `null` si le compte a été supprimé. */
  userId: number | null;
  /** Vide si le commentaire a été supprimé. */
  body: string;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
}

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
  /** Discussion sur l'évènement. */
  comments: ActivityCommentDTO[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Recherche globale et page utilisateur
// ---------------------------------------------------------------------------------------------------------------------

export type SearchKind = 'projects' | 'tickets' | 'users' | 'docs';

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

/** Note de documentation trouvée par son titre ou son texte. */
export interface SearchDocHit {
  id: number;
  spaceId: number;
  spaceName: string;
  path: string;
  title: string;
  /** Ligne du texte où figure la recherche (vide si seul le titre correspond). */
  excerpt: string;
  updatedAt: string;
}

export interface SearchResultDTO {
  query: string;
  projects: { items: SearchProjectHit[]; total: number };
  tickets: { items: SearchTicketHit[]; total: number };
  users: { items: UserSummaryDTO[]; total: number };
  docs: { items: SearchDocHit[]; total: number };
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

// ---------------------------------------------------------------------------------------------------------------------
// Application : nom, logo, maintenance
// ---------------------------------------------------------------------------------------------------------------------

export type MaintenanceLevel = 'info' | 'warning' | 'danger';

export interface MaintenanceDTO {
  enabled: boolean;
  level: MaintenanceLevel;
  title: string;
  message: string;
  /** Début annoncé (affiché « prévue le … » tant qu'il n'est pas atteint) ; `null` = maintenant. */
  startsAt: string | null;
  /** Le message disparaît tout seul à cette date ; `null` = jusqu'à désactivation. */
  endsAt: string | null;
  updatedAt: string;
}

export interface AppInfoDTO {
  name: string;
  /** 0 = logo par défaut ; sinon `GET /api/app/logo?v=<version>`. */
  logoVersion: number;
  version: string;
  /** Message de maintenance actif ou annoncé (absent une fois terminé ou désactivé). */
  maintenance: MaintenanceDTO | null;
  /** L'assistant IA est activé sur le site. */
  ai: boolean;
  /** Connexion par annuaire LDAP activée ; `loginLabel` : libellé du champ d'identifiant (vide : « Identifiant »). */
  ldap: { loginLabel: string } | null;
  /** La documentation est activée sur le site. */
  docs: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------------------------------------------------

/** `activity` : changement sur un ticket suivi ; `mention` : on vous a mentionné ; `assigned` : on vous a assigné. */
export type NotificationType = 'activity' | 'mention' | 'assigned';

export interface NotificationDTO {
  id: number;
  type: NotificationType;
  projectId: number | null;
  projectKey: string | null;
  projectName: string | null;
  ticketId: number | null;
  ticketKey: string | null;
  ticketTitle: string | null;
  actorId: number | null;
  actorName: string | null;
  via: string | null;
  activity: ActivityData | null;
  /** Extrait du texte où l'on vous mentionne. */
  excerpt: string | null;
  /** Fichier de documentation où l'on vous mentionne. */
  doc: { nodeId: number; title: string } | null;
  createdAt: string;
  readAt: string | null;
}
