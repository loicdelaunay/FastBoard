import type { ApiTokenDTO } from '@shared/types';

import { t } from '@/i18n';
export type TokenState = 'active' | 'expired' | 'revoked';

export function tokenState(token: Pick<ApiTokenDTO, 'revokedAt' | 'expiresAt'>, now = Date.now()): TokenState {
  if (token.revokedAt) {
    return 'revoked';
  }
  if (token.expiresAt && Date.parse(token.expiresAt) <= now) {
    return 'expired';
  }
  return 'active';
}

export const TOKEN_STATE_LABEL: Record<TokenState, string> = {
  active: t('Actif'),
  expired: t('Expiré'),
  revoked: t('Révoqué'),
};

export const SCOPE_LABEL = { read: t('Lecture seule'), write: t('Lecture et écriture') } as const;

/** Adresse de base de l'API pour les exemples (origine courante). */
export function apiBaseUrl(): string {
  return `${window.location.origin}/api`;
}
