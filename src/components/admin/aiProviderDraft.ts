import { AI_LIMITS, DEFAULT_AI_BASE_URL, type AiModelDTO, type AiProviderDTO } from '@shared/ai';

/** Fournisseur d'IA en cours d'édition dans l'administration (clé locale pour les nouveaux, sans identifiant serveur). */
export interface ProviderDraft {
  key: string;
  id?: string;
  name: string;
  baseUrl: string;
  timeoutSeconds: number;
  hasKey: boolean;
  keyHint: string | null;
  apiKey: string;
  replacingKey: boolean;
  /** Modèles retenus + modèles détectés ; `selected` = mis à disposition des utilisateurs. */
  catalog: Array<AiModelDTO & { selected: boolean; ownedBy?: string | null }>;
  open: boolean;
}

let counter = 0;

export function draftFrom(provider: AiProviderDTO, open = false): ProviderDraft {
  return {
    key: provider.id,
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    timeoutSeconds: provider.timeoutSeconds,
    hasKey: provider.hasKey,
    keyHint: provider.keyHint,
    apiKey: '',
    replacingKey: !provider.hasKey,
    catalog: provider.models.map((model) => ({ ...model, selected: true })),
    open,
  };
}

export function newDraft(): ProviderDraft {
  counter += 1;
  return { key: `draft-${Date.now()}-${counter}`, name: '', baseUrl: DEFAULT_AI_BASE_URL, timeoutSeconds: AI_LIMITS.timeoutSeconds, hasKey: false, keyHint: null, apiKey: '', replacingKey: true, catalog: [], open: true };
}

/** Modèle par défaut : fournisseur (clé locale) et identifiant du modèle. */
export interface DefaultModel {
  key: string;
  model: string;
}
