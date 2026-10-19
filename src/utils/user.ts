import type { UserSummaryDTO } from '@shared/types';

type AvatarSource = Pick<UserSummaryDTO, 'id' | 'avatarVersion'>;

export function avatarUrl(user: AvatarSource | null | undefined): string | null {
  return user && user.avatarVersion > 0 ? `/api/users/${user.id}/avatar?v=${user.avatarVersion}` : null;
}

export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return '?';
  }
  const letters = words.length === 1 ? words[0]!.slice(0, 2) : `${words[0]![0]}${words[words.length - 1]![0]}`;
  return letters.toUpperCase();
}

const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316', '#64748b'];

/** Couleur stable dérivée de l'identifiant, pour les avatars sans image. */
export function avatarColor(id: number): string {
  return AVATAR_COLORS[Math.abs(id) % AVATAR_COLORS.length]!;
}
