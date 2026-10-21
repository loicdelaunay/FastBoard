/**
 * Catalogue des permissions.
 *
 * - Permissions « globales » : portées par le rôle global de l'utilisateur (administration, création de projets…).
 * - Permissions « projet » : portées par le rôle de l'utilisateur dans un projet donné.
 * Le joker `*` donne toutes les permissions (rôle super administrateur).
 */

export interface PermissionDef {
  key: string;
  label: string;
  description: string;
  group: string;
}

export const GLOBAL_PERMISSIONS: readonly PermissionDef[] = [
  { key: 'admin.access', group: 'Administration', label: "Accéder à l'administration", description: "Affiche le menu d'administration." },
  { key: 'users.view', group: 'Utilisateurs', label: 'Voir les comptes', description: 'Consulter la liste des utilisateurs.' },
  { key: 'users.create', group: 'Utilisateurs', label: 'Créer des comptes', description: 'Ajouter de nouveaux utilisateurs.' },
  { key: 'users.edit', group: 'Utilisateurs', label: 'Modifier des comptes', description: 'Changer le nom, le rôle, le mot de passe ou désactiver un compte.' },
  { key: 'users.delete', group: 'Utilisateurs', label: 'Supprimer des comptes', description: 'Supprimer définitivement un utilisateur.' },
  { key: 'roles.manage', group: 'Rôles', label: 'Gérer les rôles et permissions', description: 'Créer et modifier les rôles globaux et les rôles de projet.' },
  { key: 'tokens.create', group: "Jetons d'API", label: "Créer des jetons d'API", description: 'Générer ses propres jetons pour faire travailler des scripts ou des IA avec ses droits.' },
  { key: 'tokens.manage', group: "Jetons d'API", label: "Gérer tous les jetons d'API", description: 'Voir et révoquer les jetons de tous les utilisateurs.' },
  { key: 'monitoring.view', group: 'Supervision', label: 'Suivre les performances', description: "Consulter les indicateurs de performance de l'application." },
  { key: 'logs.view', group: 'Supervision', label: 'Consulter les journaux', description: "Lire les journaux du serveur (erreurs, connexions, actions d'administration)." },
  { key: 'backups.manage', group: 'Système', label: 'Gérer les sauvegardes', description: 'Configurer les destinations, la fréquence et la conservation des sauvegardes, et en lancer.' },
  { key: 'settings.manage', group: 'Système', label: "Personnaliser l'application", description: "Changer le nom et le logo de l'application et afficher des messages de maintenance." },
  { key: 'system.manage', group: 'Système', label: 'Installer en tant que service', description: "Installer ou retirer FastBoard comme service démarré automatiquement sur la machine." },
  { key: 'ai.use', group: 'Intelligence artificielle', label: "Utiliser l'assistant IA", description: "Ouvrir le panneau de l'assistant IA (selon les droits de chaque projet)." },
  { key: 'ai.manage', group: 'Intelligence artificielle', label: "Configurer l'IA", description: "Renseigner le fournisseur (URL compatible OpenAI, clé d'API, modèle) et activer l'IA sur le site." },
  { key: 'projects.create', group: 'Projets', label: 'Créer des projets', description: 'Créer ses propres projets.' },
  { key: 'projects.view_all', group: 'Projets', label: 'Voir tous les projets', description: 'Accéder en lecture à tous les projets, même sans en être membre.' },
  { key: 'projects.manage_all', group: 'Projets', label: 'Gérer tous les projets', description: 'Toutes les permissions de projet sur tous les projets.' },
];

export const PROJECT_PERMISSIONS: readonly PermissionDef[] = [
  { key: 'project.edit', group: 'Projet', label: 'Configurer le projet', description: 'Nom, description, catégories et livraisons.' },
  { key: 'project.members', group: 'Projet', label: 'Gérer les membres', description: 'Inviter, retirer et changer le rôle des membres.' },
  { key: 'project.delete', group: 'Projet', label: 'Supprimer le projet', description: 'Suppression définitive du projet et de ses tickets.' },
  { key: 'ticket.create', group: 'Tickets', label: 'Créer des tickets', description: 'Ajouter de nouveaux tickets.' },
  { key: 'ticket.edit', group: 'Tickets', label: 'Modifier les tickets', description: 'Modifier, déplacer, planifier et assigner tous les tickets.' },
  { key: 'ticket.delete', group: 'Tickets', label: 'Supprimer des tickets', description: 'Suppression définitive de tickets.' },
  { key: 'ticket.update_own_part', group: 'Tickets', label: 'Mettre à jour sa part', description: "Indiquer l'avancement et la fin de sa propre part sur un ticket assigné." },
  { key: 'attachment.create', group: 'Pièces jointes', label: 'Ajouter des pièces jointes', description: 'Joindre des fichiers aux tickets et supprimer les siens.' },
  { key: 'attachment.moderate', group: 'Pièces jointes', label: 'Modérer les pièces jointes', description: 'Supprimer les pièces jointes des autres.' },
  { key: 'comment.create', group: 'Commentaires', label: 'Commenter', description: 'Écrire et répondre aux commentaires.' },
  { key: 'comment.moderate', group: 'Commentaires', label: 'Modérer les commentaires', description: "Supprimer les commentaires des autres." },
  { key: 'ai.read', group: 'Intelligence artificielle', label: "Interroger l'IA sur le projet", description: "L'assistant peut lire et rechercher dans le projet pour répondre." },
  { key: 'ai.write', group: 'Intelligence artificielle', label: "Laisser l'IA modifier le projet", description: "L'assistant peut créer, modifier et commenter des tickets, dans la limite des autres droits de la personne." },
];

export const ALL_GLOBAL_PERMISSION_KEYS = GLOBAL_PERMISSIONS.map((p) => p.key);
export const ALL_PROJECT_PERMISSION_KEYS = PROJECT_PERMISSIONS.map((p) => p.key);

export type RoleScope = 'global' | 'project';

export function permissionCatalog(scope: RoleScope): readonly PermissionDef[] {
  return scope === 'global' ? GLOBAL_PERMISSIONS : PROJECT_PERMISSIONS;
}

/** Vrai si la liste de permissions accorde `permission` (joker `*` inclus). */
export function hasPermission(granted: Iterable<string>, permission: string): boolean {
  for (const entry of granted) {
    if (entry === '*' || entry === permission) {
      return true;
    }
  }
  return false;
}

/** Empêche l'escalade de privilèges : on ne peut accorder qu'un sous-ensemble de ses propres permissions. */
export function isSubsetOfPermissions(candidate: readonly string[], actorGranted: readonly string[]): boolean {
  if (actorGranted.includes('*')) {
    return true;
  }
  return candidate.every((permission) => permission !== '*' && actorGranted.includes(permission));
}

export interface SystemRoleSeed {
  key: string;
  scope: RoleScope;
  name: string;
  description: string;
  permissions: string[];
  /** Rôle verrouillé : ses permissions ne peuvent pas être modifiées. */
  locked?: boolean;
}

export const SYSTEM_ROLES: readonly SystemRoleSeed[] = [
  {
    key: 'super_admin',
    scope: 'global',
    name: 'Super administrateur',
    description: 'Accès total à toutes les fonctionnalités.',
    permissions: ['*'],
    locked: true,
  },
  {
    key: 'admin',
    scope: 'global',
    name: 'Administrateur',
    description: 'Gère les comptes, les rôles et tous les projets.',
    permissions: [
      'admin.access', 'users.view', 'users.create', 'users.edit', 'users.delete', 'roles.manage',
      'tokens.create', 'tokens.manage', 'monitoring.view', 'logs.view', 'backups.manage', 'system.manage', 'settings.manage', 'ai.use', 'ai.manage', 'projects.create', 'projects.view_all', 'projects.manage_all',
    ],
  },
  {
    key: 'member',
    scope: 'global',
    name: 'Membre',
    description: 'Peut créer ses projets et collaborer sur ceux auxquels il est invité.',
    permissions: ['projects.create', 'tokens.create', 'ai.use'],
  },
  {
    key: 'guest',
    scope: 'global',
    name: 'Invité',
    description: 'Ne peut que rejoindre des projets existants sur invitation.',
    permissions: [],
  },
  {
    key: 'owner',
    scope: 'project',
    name: 'Propriétaire',
    description: 'Contrôle total du projet.',
    permissions: [...ALL_PROJECT_PERMISSION_KEYS],
    locked: true,
  },
  {
    key: 'manager',
    scope: 'project',
    name: 'Gestionnaire',
    description: 'Configure le projet et gère les membres, sans pouvoir le supprimer.',
    permissions: ALL_PROJECT_PERMISSION_KEYS.filter((key) => key !== 'project.delete'),
  },
  {
    key: 'editor',
    scope: 'project',
    name: 'Éditeur',
    description: 'Crée, modifie et commente les tickets.',
    permissions: ['ticket.create', 'ticket.edit', 'ticket.update_own_part', 'attachment.create', 'comment.create', 'ai.read', 'ai.write'],
  },
  {
    key: 'contributor',
    scope: 'project',
    name: 'Contributeur',
    description: 'Met à jour sa part des tickets assignés et commente.',
    permissions: ['ticket.update_own_part', 'attachment.create', 'comment.create', 'ai.read'],
  },
  {
    key: 'viewer',
    scope: 'project',
    name: 'Lecteur',
    description: 'Consultation seule.',
    permissions: ['ai.read'],
  },
];
