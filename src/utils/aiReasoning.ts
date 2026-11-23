import type { AiReasoningOption } from '@shared/ai';
import { t } from '@/i18n';

/** Nom habituel des identifiants de réglage de réflexion courants, quand le réglage n'a pas de nom propre. */
const KNOWN_LABELS: Record<string, string> = {
  off: t('Sans réflexion'),
  none: t('Sans réflexion'),
  on: t('Avec réflexion'),
  minimal: t('Minimale'),
  low: t('Faible'),
  medium: t('Moyenne'),
  high: t('Élevée'),
  xhigh: t('Très élevée'),
  max: t('Maximale'),
};

/** Nom affiché d'un réglage de réflexion : le sien, sinon celui de son identifiant, sinon l'identifiant. */
export function reasoningLabel(option: Pick<AiReasoningOption, 'id' | 'label'>): string {
  return option.label.trim() || (KNOWN_LABELS[option.id] ? t(KNOWN_LABELS[option.id]!) : option.id);
}
