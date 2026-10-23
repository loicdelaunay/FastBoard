import { randomBytes } from 'node:crypto';
import {
  AI_LIMITS,
  DEFAULT_AI_BASE_URL,
  DEFAULT_AI_MODEL,
  DEFAULT_CONTEXT_WINDOW,
  guessCapabilities,
  modelRef,
  parseModelRef,
  type AiModelChoiceDTO,
  type AiModelDTO,
  type AiProviderDTO,
  type AiSettingsDTO,
  type DetectedModelDTO,
} from '../../shared/ai.ts';
import type { AppContext } from '../context.ts';
import { nowIso } from '../db/database.ts';
import { readSetting, writeSetting } from '../services/appSettings.ts';

interface StoredProvider {
  id: string;
  name: string;
  baseUrl: string;
  timeoutSeconds: number;
  models: AiModelDTO[];
  /** Clé chiffrée (SecretBox) : jamais stockée ni renvoyée en clair. */
  key: string | null;
  keyHint: string | null;
}

interface StoredAiSettings {
  enabled: boolean;
  providers: StoredProvider[];
  defaultModel: string;
  maxSteps: number;
  maxTurns: number;
  updatedAt: string | null;
}

/** Fournisseur prêt à l'emploi (clé déchiffrée). */
export interface AiEndpoint {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string | null;
  timeoutMs: number;
}

export interface AiConfig {
  enabled: boolean;
  providers: Array<AiEndpoint & { models: AiModelDTO[] }>;
  defaultModel: string;
  maxSteps: number;
  maxTurns: number;
}

function normalizeModel(raw: Partial<AiModelDTO> & { id: string }): AiModelDTO {
  return {
    id: raw.id,
    label: typeof raw.label === 'string' ? raw.label : '',
    vision: raw.vision === true,
    contextWindow: typeof raw.contextWindow === 'number' && raw.contextWindow >= 1_000 ? Math.round(raw.contextWindow) : DEFAULT_CONTEXT_WINDOW,
    reasoning: raw.reasoning === true,
  };
}

function normalizeModels(raw: unknown): AiModelDTO[] {
  const seen = new Set<string>();
  return (Array.isArray(raw) ? raw : [])
    .filter((model): model is AiModelDTO => typeof model?.id === 'string' && model.id.length > 0)
    .map(normalizeModel)
    .filter((model) => !seen.has(model.id) && seen.add(model.id));
}

const bounded = (value: unknown, fallback: number, max: number): number => (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max ? value : fallback);

function providerName(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.replace(/^api\./, '') || 'Fournisseur';
  } catch {
    return 'Fournisseur';
  }
}

export function newProviderId(): string {
  return `p${randomBytes(4).toString('hex')}`;
}

function stored(ctx: AppContext): StoredAiSettings {
  const value = readSetting<Partial<StoredAiSettings> & { baseUrl?: string; models?: unknown; model?: string; key?: string; keyHint?: string }>(ctx.db, 'ai');
  let providers: StoredProvider[];
  let defaultModel = typeof value?.defaultModel === 'string' ? value.defaultModel : '';
  if (Array.isArray(value?.providers)) {
    providers = value.providers
      .filter((entry) => typeof entry?.id === 'string' && /^[a-z0-9]+$/i.test(entry.id))
      .map((entry) => ({
        id: entry.id,
        name: typeof entry.name === 'string' && entry.name ? entry.name : providerName(entry.baseUrl),
        baseUrl: typeof entry.baseUrl === 'string' && entry.baseUrl ? entry.baseUrl : DEFAULT_AI_BASE_URL,
        timeoutSeconds: bounded(entry.timeoutSeconds, AI_LIMITS.timeoutSeconds, AI_LIMITS.timeoutMax),
        models: normalizeModels(entry.models),
        key: typeof entry.key === 'string' ? entry.key : null,
        keyHint: typeof entry.keyHint === 'string' ? entry.keyHint : null,
      }));
  } else {
    // Réglages des versions 1.3 : un seul fournisseur (et, en 1.3.0, un seul modèle `model`).
    const legacy = typeof value?.model === 'string' && value.model ? [{ id: value.model, ...guessCapabilities(value.model) }] : [];
    const models = normalizeModels(Array.isArray(value?.models) && value.models.length ? value.models : legacy.length ? legacy : [{ id: DEFAULT_AI_MODEL, ...guessCapabilities(DEFAULT_AI_MODEL) }]);
    const baseUrl = typeof value?.baseUrl === 'string' && value.baseUrl ? value.baseUrl : DEFAULT_AI_BASE_URL;
    providers = [{ id: 'p1', name: providerName(baseUrl), baseUrl, timeoutSeconds: AI_LIMITS.timeoutSeconds, models, key: typeof value?.key === 'string' ? value.key : null, keyHint: typeof value?.keyHint === 'string' ? value.keyHint : null }];
    if (defaultModel && !parseModelRef(defaultModel)) defaultModel = modelRef('p1', defaultModel);
  }
  const refs = providers.flatMap((provider) => provider.models.map((model) => modelRef(provider.id, model.id)));
  // Une ancienne référence sans fournisseur (« gpt-4o ») retrouve son fournisseur.
  if (defaultModel && !refs.includes(defaultModel)) {
    defaultModel = refs.find((ref) => parseModelRef(ref)?.modelId === defaultModel || parseModelRef(ref)?.modelId === parseModelRef(defaultModel)?.modelId) ?? '';
  }
  return {
    enabled: value?.enabled === true,
    providers,
    defaultModel: defaultModel || refs[0] || '',
    maxSteps: bounded(value?.maxSteps, AI_LIMITS.steps, AI_LIMITS.stepsMax),
    maxTurns: bounded(value?.maxTurns, AI_LIMITS.turns, AI_LIMITS.turnsMax),
    updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : null,
  };
}

function providerDTO(provider: StoredProvider): AiProviderDTO {
  return { id: provider.id, name: provider.name, baseUrl: provider.baseUrl, timeoutSeconds: provider.timeoutSeconds, models: provider.models, hasKey: provider.key !== null, keyHint: provider.keyHint };
}

export function aiSettingsDTO(ctx: AppContext): AiSettingsDTO {
  const value = stored(ctx);
  return { enabled: value.enabled, providers: value.providers.map(providerDTO), defaultModel: value.defaultModel, maxSteps: value.maxSteps, maxTurns: value.maxTurns, updatedAt: value.updatedAt };
}

function endpointOf(ctx: AppContext, provider: StoredProvider): AiEndpoint & { models: AiModelDTO[] } {
  return { id: provider.id, name: provider.name, baseUrl: provider.baseUrl, apiKey: provider.key ? ctx.secrets.open(provider.key) : null, timeoutMs: provider.timeoutSeconds * 1000, models: provider.models };
}

/** Configuration utilisable par l'agent (clés déchiffrées), ou `null` si l'IA est désactivée (sauf `evenDisabled`, pour la tester). */
export function aiConfig(ctx: AppContext, options: { evenDisabled?: boolean } = {}): AiConfig | null {
  const value = stored(ctx);
  if (!value.enabled && !options.evenDisabled) return null;
  return { enabled: value.enabled, providers: value.providers.map((provider) => endpointOf(ctx, provider)), defaultModel: value.defaultModel, maxSteps: value.maxSteps, maxTurns: value.maxTurns };
}

/** Modèle et fournisseur d'une référence (référence inconnue : modèle par défaut). */
export function resolveModel(config: AiConfig, ref: string | undefined): { endpoint: AiEndpoint; model: AiModelDTO } | null {
  const find = (wanted: string | undefined) => {
    if (!wanted) return null;
    const parsed = parseModelRef(wanted);
    for (const provider of config.providers) {
      const model = parsed && parsed.providerId === provider.id ? provider.models.find((entry) => entry.id === parsed.modelId) : undefined;
      if (model) return { endpoint: provider, model };
    }
    // Référence sans fournisseur (clients de la 1.3) : premier fournisseur qui propose ce modèle.
    for (const provider of config.providers) {
      const model = provider.models.find((entry) => entry.id === wanted);
      if (model) return { endpoint: provider, model };
    }
    return null;
  };
  const first = config.providers.find((provider) => provider.models.length);
  return find(ref) ?? find(config.defaultModel) ?? (first ? { endpoint: first, model: first.models[0]! } : null);
}

/** L'IA est activée et au moins un modèle est proposé : le bouton de l'assistant s'affiche. */
export function aiAvailable(ctx: AppContext): boolean {
  const value = stored(ctx);
  return value.enabled && value.providers.some((provider) => provider.baseUrl && provider.models.length);
}

/** Modèles proposés dans le panneau (tous fournisseurs), et celui utilisé par défaut. */
export function availableModels(ctx: AppContext): { models: AiModelChoiceDTO[]; defaultModel: string } {
  const value = stored(ctx);
  return {
    models: value.providers.flatMap((provider) => provider.models.map((model) => ({ ...model, ref: modelRef(provider.id, model.id), provider: provider.name }))),
    defaultModel: value.defaultModel,
  };
}

export interface AiProviderInput {
  /** Absent : nouveau fournisseur. */
  id?: string;
  name: string;
  baseUrl: string;
  timeoutSeconds: number;
  models: AiModelDTO[];
  /** `undefined` garde la clé actuelle, chaîne vide l'efface, sinon la remplace. */
  apiKey?: string;
}

export interface AiSettingsInput {
  enabled: boolean;
  providers: AiProviderInput[];
  defaultModel: string;
  maxSteps: number;
  maxTurns: number;
}

export function saveAiSettings(ctx: AppContext, input: AiSettingsInput): AiSettingsDTO {
  const current = new Map(stored(ctx).providers.map((provider) => [provider.id, provider]));
  const used = new Set<string>();
  const providers = input.providers.map((entry): StoredProvider => {
    const previous = entry.id ? current.get(entry.id) : undefined;
    let id = previous && !used.has(previous.id) ? previous.id : newProviderId();
    while (used.has(id)) id = newProviderId();
    used.add(id);
    let key = previous?.key ?? null;
    let keyHint = previous?.keyHint ?? null;
    if (entry.apiKey !== undefined) {
      const trimmed = entry.apiKey.trim();
      key = trimmed ? ctx.secrets.seal(trimmed) : null;
      keyHint = trimmed ? trimmed.slice(-4) : null;
    }
    const baseUrl = entry.baseUrl.trim().replace(/\/+$/, '');
    return { id, name: entry.name.trim() || providerName(baseUrl), baseUrl, timeoutSeconds: entry.timeoutSeconds, models: normalizeModels(entry.models), key, keyHint };
  });
  // Le modèle par défaut peut viser un fournisseur nouveau (identifiant pas encore attribué) : `index:modèle` → son identifiant.
  let defaultModel = input.defaultModel;
  const parsed = parseModelRef(defaultModel);
  if (parsed && /^new\d+$/.test(parsed.providerId)) {
    const provider = providers[Number(parsed.providerId.slice(3))];
    if (provider) defaultModel = modelRef(provider.id, parsed.modelId);
  }
  const refs = providers.flatMap((provider) => provider.models.map((model) => modelRef(provider.id, model.id)));
  writeSetting(ctx.db, 'ai', {
    enabled: input.enabled,
    providers,
    defaultModel: refs.includes(defaultModel) ? defaultModel : (refs[0] ?? ''),
    maxSteps: input.maxSteps,
    maxTurns: input.maxTurns,
    updatedAt: nowIso(),
  } satisfies StoredAiSettings);
  return aiSettingsDTO(ctx);
}

/** Clé à utiliser pour un essai : celle saisie dans le formulaire, sinon celle enregistrée pour ce fournisseur. */
export function keyForTest(ctx: AppContext, typed: string | undefined, providerId: string | undefined): string | null {
  if (typed !== undefined && typed.trim()) return typed.trim();
  const provider = stored(ctx).providers.find((entry) => entry.id === providerId);
  return provider?.key ? ctx.secrets.open(provider.key) : null;
}

interface ModelsResponse {
  data?: Array<{ id?: string; owned_by?: string; context_length?: number; max_context_length?: number; context_window?: number; capabilities?: { vision?: boolean } }>;
  models?: Array<{ name?: string; model?: string }>;
  error?: { message?: string };
}

/** Liste les modèles du fournisseur (`GET {baseUrl}/models`), capacités devinées d'après le nom ou fournies par l'API. */
export async function detectModels(baseUrl: string, apiKey: string | null, timeoutMs = 20_000): Promise<DetectedModelDTO[]> {
  const url = `${baseUrl.trim().replace(/\/+$/, '')}/models`;
  let response: Response;
  try {
    response = await fetch(url, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new Error(`Fournisseur d'IA injoignable (${baseUrl}) : ${(error as Error).message}`);
  }
  const text = await response.text();
  let payload: ModelsResponse | null = null;
  try {
    payload = JSON.parse(text) as ModelsResponse;
  } catch {
    // Réponse non JSON.
  }
  if (!response.ok) {
    throw new Error(`Le fournisseur d'IA a répondu ${response.status} : ${payload?.error?.message ?? text.slice(0, 200)}`);
  }
  // Format OpenAI (`data`) ou Ollama natif (`models`).
  const entries = payload?.data ?? payload?.models?.map((entry) => ({ id: entry.model ?? entry.name })) ?? [];
  const models = entries
    .filter((entry): entry is NonNullable<ModelsResponse['data']>[number] & { id: string } => typeof entry.id === 'string' && entry.id.length > 0)
    .map((entry): DetectedModelDTO => {
      const guess = guessCapabilities(entry.id);
      const context = entry.context_length ?? entry.max_context_length ?? entry.context_window;
      return {
        id: entry.id,
        label: '',
        vision: entry.capabilities?.vision ?? guess.vision,
        reasoning: guess.reasoning,
        contextWindow: typeof context === 'number' && context >= 1_000 ? context : guess.contextWindow,
        ownedBy: 'owned_by' in entry && typeof entry.owned_by === 'string' ? entry.owned_by : null,
      };
    });
  return models.sort((a, b) => a.id.localeCompare(b.id));
}
