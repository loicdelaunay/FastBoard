import { DEFAULT_AI_BASE_URL, DEFAULT_AI_MODEL, DEFAULT_CONTEXT_WINDOW, guessCapabilities, type AiModelDTO, type AiSettingsDTO, type DetectedModelDTO } from '../../shared/ai.ts';
import type { AppContext } from '../context.ts';
import { nowIso } from '../db/database.ts';
import { readSetting, writeSetting } from '../services/appSettings.ts';

interface StoredAiSettings {
  enabled: boolean;
  baseUrl: string;
  models: AiModelDTO[];
  defaultModel: string;
  /** Clé chiffrée (SecretBox) : jamais stockée ni renvoyée en clair. */
  key: string | null;
  keyHint: string | null;
  updatedAt: string | null;
}

export interface AiConfig {
  enabled: boolean;
  baseUrl: string;
  models: AiModelDTO[];
  defaultModel: string;
  apiKey: string | null;
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

function stored(ctx: AppContext): StoredAiSettings {
  const value = readSetting<Partial<StoredAiSettings> & { model?: string }>(ctx.db, 'ai');
  // Réglages de la 1.3.0 : un seul modèle (`model`) devient la liste des modèles disponibles.
  const legacy = typeof value?.model === 'string' && value.model ? [{ id: value.model, ...guessCapabilities(value.model) }] : [];
  const models = (Array.isArray(value?.models) && value.models.length ? value.models : legacy.length ? legacy : [{ id: DEFAULT_AI_MODEL, ...guessCapabilities(DEFAULT_AI_MODEL) }])
    .filter((model): model is AiModelDTO => typeof model?.id === 'string' && model.id.length > 0)
    .map(normalizeModel);
  const defaultModel = typeof value?.defaultModel === 'string' && models.some((model) => model.id === value.defaultModel) ? value.defaultModel : (models[0]?.id ?? DEFAULT_AI_MODEL);
  return {
    enabled: value?.enabled === true,
    baseUrl: typeof value?.baseUrl === 'string' && value.baseUrl ? value.baseUrl : DEFAULT_AI_BASE_URL,
    models,
    defaultModel,
    key: typeof value?.key === 'string' ? value.key : null,
    keyHint: typeof value?.keyHint === 'string' ? value.keyHint : null,
    updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : null,
  };
}

export function aiSettingsDTO(ctx: AppContext): AiSettingsDTO {
  const value = stored(ctx);
  return { enabled: value.enabled, baseUrl: value.baseUrl, models: value.models, defaultModel: value.defaultModel, hasKey: value.key !== null, keyHint: value.keyHint, updatedAt: value.updatedAt };
}

/** Configuration utilisable par l'agent (clé déchiffrée), ou `null` si l'IA est désactivée (sauf `evenDisabled`, pour la tester). */
export function aiConfig(ctx: AppContext, options: { evenDisabled?: boolean } = {}): AiConfig | null {
  const value = stored(ctx);
  if (!value.enabled && !options.evenDisabled) return null;
  return { enabled: value.enabled, baseUrl: value.baseUrl, models: value.models, defaultModel: value.defaultModel, apiKey: value.key ? ctx.secrets.open(value.key) : null };
}

/** L'IA est activée et configurée : le bouton de l'assistant s'affiche. */
export function aiAvailable(ctx: AppContext): boolean {
  const value = stored(ctx);
  return value.enabled && Boolean(value.baseUrl && value.models.length);
}

/** Modèles proposés dans le panneau, et celui utilisé par défaut. */
export function availableModels(ctx: AppContext): { models: AiModelDTO[]; defaultModel: string } {
  const value = stored(ctx);
  return { models: value.models, defaultModel: value.defaultModel };
}

export interface AiSettingsInput {
  enabled: boolean;
  baseUrl: string;
  models: AiModelDTO[];
  defaultModel: string;
  /** `undefined` garde la clé actuelle, chaîne vide l'efface, sinon la remplace. */
  apiKey?: string;
}

export function saveAiSettings(ctx: AppContext, input: AiSettingsInput): AiSettingsDTO {
  const current = stored(ctx);
  let key = current.key;
  let keyHint = current.keyHint;
  if (input.apiKey !== undefined) {
    const trimmed = input.apiKey.trim();
    key = trimmed ? ctx.secrets.seal(trimmed) : null;
    keyHint = trimmed ? trimmed.slice(-4) : null;
  }
  const seen = new Set<string>();
  const models = input.models.map(normalizeModel).filter((model) => !seen.has(model.id) && seen.add(model.id));
  const defaultModel = models.some((model) => model.id === input.defaultModel) ? input.defaultModel : (models[0]?.id ?? DEFAULT_AI_MODEL);
  writeSetting(ctx.db, 'ai', { enabled: input.enabled, baseUrl: input.baseUrl.trim().replace(/\/+$/, ''), models, defaultModel, key, keyHint, updatedAt: nowIso() } satisfies StoredAiSettings);
  return aiSettingsDTO(ctx);
}

/** Clé à utiliser pour un essai : celle saisie dans le formulaire, sinon celle enregistrée. */
export function keyForTest(ctx: AppContext, typed: string | undefined): string | null {
  if (typed !== undefined && typed.trim()) return typed.trim();
  const value = stored(ctx);
  return value.key ? ctx.secrets.open(value.key) : null;
}

interface ModelsResponse {
  data?: Array<{ id?: string; owned_by?: string; context_length?: number; max_context_length?: number; context_window?: number; capabilities?: { vision?: boolean } }>;
  models?: Array<{ name?: string; model?: string }>;
  error?: { message?: string };
}

/** Liste les modèles du fournisseur (`GET {baseUrl}/models`), capacités devinées d'après le nom ou fournies par l'API. */
export async function detectModels(baseUrl: string, apiKey: string | null): Promise<DetectedModelDTO[]> {
  const url = `${baseUrl.trim().replace(/\/+$/, '')}/models`;
  let response: Response;
  try {
    response = await fetch(url, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(20_000) });
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
