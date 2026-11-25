/**
 * Groupes de personnes, à la manière de Google Drive : un groupe s'ajoute d'un coup à un projet, à un espace de
 * documentation ou à un espace de tableaux blancs, avec un rôle. Les droits d'une personne y sont ceux de son rôle
 * direct et de ceux de ses groupes : le plus large l'emporte (un groupe en lecture, et une de ses personnes en plus en
 * éditrice). Ajouter quelqu'un à un groupe lui donne aussitôt ces accès ; l'en retirer les lui reprend.
 */

import type { DocRole } from './docs.ts';

/** `manager` : renomme le groupe, ajoute et retire des personnes ; `member` : en fait partie. */
export const GROUP_MEMBER_ROLES = ['member', 'manager'] as const;
export type GroupMemberRole = (typeof GROUP_MEMBER_ROLES)[number];

export const GROUP_MEMBER_ROLE_LABELS: Record<GroupMemberRole, string> = { member: 'Membre', manager: 'Gestionnaire' };

/** Rôles qu'un groupe peut recevoir dans un espace (documentation, tableaux) : pas propriétaire. */
export const GROUP_SPACE_ROLES = ['reader', 'editor'] as const satisfies readonly DocRole[];
export type GroupSpaceRole = (typeof GROUP_SPACE_ROLES)[number];

export const GROUP_LIMITS = { nameMax: 80, descriptionMax: 500, membersMax: 500 };

/** Couleurs proposées pour repérer un groupe. */
export const GROUP_COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#64748b'] as const;

export interface GroupMemberDTO {
  userId: number;
  role: GroupMemberRole;
  addedAt: string;
}

export interface GroupDTO {
  id: number;
  name: string;
  description: string;
  /** #RRGGBB, ou `null` (couleur par défaut). */
  color: string | null;
  members: GroupMemberDTO[];
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
  /** La personne qui lit peut renommer le groupe et changer ses membres (gestionnaire, ou `groups.manage`). */
  canManage: boolean;
}

/** Où un groupe a accès, parmi ce que la personne qui regarde peut voir. */
export interface GroupAccessDTO {
  kind: 'project' | 'docs' | 'boards';
  id: number;
  name: string;
  /** Nom du rôle de projet, ou rôle dans l'espace (`reader`, `editor`). */
  role: string;
}

/** Un groupe ajouté à un projet, avec son rôle de projet. */
export interface ProjectGroupDTO {
  groupId: number;
  name: string;
  color: string | null;
  memberIds: number[];
  roleId: number;
}

/** Un groupe ajouté à un espace de documentation ou de tableaux blancs. */
export interface SpaceGroupDTO {
  groupId: number;
  name: string;
  color: string | null;
  memberIds: number[];
  role: GroupSpaceRole;
}
