import { createHash } from 'node:crypto';
import { RAG_FORMATS, RAG_LIMITS, ragTemplates, type RagFormat, type RagSettingsDTO, type RagTemplates } from '../../shared/rag.ts';
import type { AppContext } from '../context.ts';
import { nowIso } from '../db/database.ts';
import { readSetting, writeSetting } from '../services/appSettings.ts';

/** Réglages du RAG, enregistrés sous la clé `rag` ; la clé d'API est chiffrée (SecretBox), jamais renvoyée. */
interface StoredRagSettings {
  enabled: boolean;
  baseUrl: string;
  key: string | null;
  keyHint: string | null;
  verifyCertificate: boolean;
  timeoutSeconds: number;
  model: string;
  format: RagFormat;
  queryTemplate: string;
  documentTemplate: string;
  dimensions: number | null;
  intervalHours: number;
  chunkChars: number;
  updatedAt: string | null;
}

export const DEFAULT_RAG_BASE_URL = 'http://localhost:11434/v1';

const bounded = (value: unknown, fallback: number, min: number, max: number): number => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
};

function stored(ctx: AppContext): StoredRagSettings {
  const value = readSetting<Partial<StoredRagSettings>>(ctx.db, 'rag');
  const dimensions = Number(value?.dimensions);
  return {
    enabled: value?.enabled === true,
    baseUrl: typeof value?.baseUrl === 'string' && value.baseUrl ? value.baseUrl : DEFAULT_RAG_BASE_URL,
    key: typeof value?.key === 'string' ? value.key : null,
    keyHint: typeof value?.keyHint === 'string' ? value.keyHint : null,
    verifyCertificate: value?.verifyCertificate !== false,
    timeoutSeconds: bounded(value?.timeoutSeconds, RAG_LIMITS.timeoutSeconds, 5, RAG_LIMITS.timeoutMax),
    model: typeof value?.model === 'string' ? value.model : '',
    format: (RAG_FORMATS as readonly string[]).includes(value?.format ?? '') ? value!.format! : 'auto',
    queryTemplate: typeof value?.queryTemplate === 'string' ? value.queryTemplate : '',
    documentTemplate: typeof value?.documentTemplate === 'string' ? value.documentTemplate : '',
    dimensions: Number.isInteger(dimensions) && dimensions >= 8 ? Math.min(RAG_LIMITS.dimensionsMax, dimensions) : null,
    intervalHours: bounded(value?.intervalHours, RAG_LIMITS.intervalHoursDefault, RAG_LIMITS.intervalHoursMin, RAG_LIMITS.intervalHoursMax),
    chunkChars: bounded(value?.chunkChars, RAG_LIMITS.chunkChars, RAG_LIMITS.chunkCharsMin, RAG_LIMITS.chunkCharsMax),
    updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : null,
  };
}

export function ragSettingsDTO(ctx: AppContext): RagSettingsDTO {
  const { key, ...rest } = stored(ctx);
  return { ...rest, hasKey: key !== null };
}

/** Point d'accès aux embeddings, prêt à l'emploi (clé déchiffrée). */
export interface RagEndpoint {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  timeoutMs: number;
  verifyCertificate: boolean;
  dimensions: number | null;
  templates: RagTemplates;
}

export interface RagConfig extends RagEndpoint {
  intervalHours: number;
  chunkChars: number;
  /** Ce qui rend les vecteurs comparables : s'il change, l'index est reconstruit. */
  signature: string;
}

export function ragSignature(settings: { model: string; dimensions: number | null; chunkChars: number }, templates: RagTemplates): string {
  return createHash('sha256').update(JSON.stringify([settings.model.trim(), settings.dimensions, settings.chunkChars, templates.query, templates.document])).digest('hex').slice(0, 16);
}

/** Configuration utilisable, ou `null` si le RAG est désactivé ou sans modèle (sauf `evenDisabled`). */
export function ragConfig(ctx: AppContext, options: { evenDisabled?: boolean } = {}): RagConfig | null {
  const value = stored(ctx);
  if ((!value.enabled && !options.evenDisabled) || !value.model.trim()) return null;
  const templates = ragTemplates(value);
  return {
    baseUrl: value.baseUrl,
    apiKey: value.key ? ctx.secrets.open(value.key) : null,
    model: value.model.trim(),
    timeoutMs: value.timeoutSeconds * 1000,
    verifyCertificate: value.verifyCertificate,
    dimensions: value.dimensions,
    templates,
    intervalHours: value.intervalHours,
    chunkChars: value.chunkChars,
    signature: ragSignature(value, templates),
  };
}

export function ragEnabled(ctx: AppContext): boolean {
  return ragConfig(ctx) !== null;
}

export interface RagSettingsInput {
  enabled: boolean;
  baseUrl: string;
  /** `undefined` garde la clé actuelle, chaîne vide l'efface, sinon la remplace. */
  apiKey?: string;
  verifyCertificate: boolean;
  timeoutSeconds: number;
  model: string;
  format: RagFormat;
  queryTemplate: string;
  documentTemplate: string;
  dimensions: number | null;
  intervalHours: number;
  chunkChars: number;
}

export function saveRagSettings(ctx: AppContext, input: RagSettingsInput): RagSettingsDTO {
  const current = stored(ctx);
  let key = current.key;
  let keyHint = current.keyHint;
  if (input.apiKey !== undefined) {
    const trimmed = input.apiKey.trim();
    key = trimmed ? ctx.secrets.seal(trimmed) : null;
    keyHint = trimmed ? trimmed.slice(-4) : null;
  }
  writeSetting(ctx.db, 'rag', {
    enabled: input.enabled,
    baseUrl: input.baseUrl.trim().replace(/\/+$/, ''),
    key,
    keyHint,
    verifyCertificate: input.verifyCertificate,
    timeoutSeconds: input.timeoutSeconds,
    model: input.model.trim(),
    format: input.format,
    queryTemplate: input.queryTemplate,
    documentTemplate: input.documentTemplate,
    dimensions: input.dimensions,
    intervalHours: input.intervalHours,
    chunkChars: input.chunkChars,
    updatedAt: nowIso(),
  } satisfies StoredRagSettings);
  return ragSettingsDTO(ctx);
}

/** Clé pour un essai : celle saisie dans le formulaire, sinon celle enregistrée. */
export function ragKeyForTest(ctx: AppContext, typed: string | undefined): string | null {
  if (typed !== undefined && typed.trim()) return typed.trim();
  const { key } = stored(ctx);
  return key ? ctx.secrets.open(key) : null;
}
