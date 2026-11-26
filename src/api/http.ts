import { CLIENT_ID_HEADER, USER_ID_HEADER } from '@shared/constants';
import { offlineCacheable, serverUnreachable } from '@shared/offline';
import { offlineKey, readOffline, writeOffline } from '@/offline/cache';
import { markOffline, markOnline, noteCached } from '@/offline/connection';

import { t } from '@/i18n';
import { translateServerMessage } from '@/i18n/server';
/** Identifiant propre à cet onglet : permet au serveur de nous renvoyer l'origine de nos propres modifications. */
export const clientId = makeId();

export function makeId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, message: string, code = 'error', details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let unauthorizedHandler: (() => void) | null = null;
let sessionChangedHandler: (() => void) | null = null;
let currentUserId: number | null = null;

/** Compte avec lequel cet onglet est connecté : transmis au serveur pour détecter un changement de compte ailleurs. */
export function setCurrentUserId(id: number | null): void {
  currentUserId = id;
}

/** Appelé quand le cookie de session appartient désormais à un autre compte (connexion dans un autre onglet). */
export function onSessionChanged(handler: () => void): void {
  sessionChangedHandler = handler;
}

/** Appelé quand l'API répond 401 sur une route protégée (session expirée). */
export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler;
}

interface RequestOptions {
  body?: unknown;
  rawBody?: Blob | ArrayBuffer;
  contentType?: string;
  /** Ne déclenche pas le handler de session expirée (ex. formulaire de connexion). */
  silent401?: boolean;
  /** En-têtes en plus (accès à un tableau partagé…). */
  headers?: Record<string, string>;
}

/** En-têtes communs (onglet, compte) pour les appels qui ne passent pas par `http` (envoi de fichiers). */
export function httpHeaders(): Record<string, string> {
  const headers: Record<string, string> = { [CLIENT_ID_HEADER]: clientId };
  if (currentUserId !== null) {
    headers[USER_ID_HEADER] = String(currentUserId);
  }
  return headers;
}

/** Clé de la réponse gardée pour la lecture hors ligne, ou `null` (écriture, réponse à ne pas garder, visiteur sans compte). */
function offlineCacheKey(method: string, path: string, options: RequestOptions): string | null {
  if (method !== 'GET' || options.headers) return null;
  // Le compte connecté et les informations du site (modules activés) se lisent au démarrage, avant de savoir qui l'on
  // est : ils ont leur place à part (effacée à la déconnexion).
  if (path === '/me' || path === '/app') return offlineKey(0, `api:${path}`);
  return currentUserId !== null && offlineCacheable(path) ? offlineKey(currentUserId, `api:${path}`) : null;
}

/** Clé sous laquelle la réponse à `GET /api{path}` est gardée pour la lecture hors ligne (`null` : elle ne l'est pas). */
export function offlineApiKey(path: string): string | null {
  return offlineCacheKey('GET', path, {});
}

/** Le serveur ne répond pas : une lecture reçoit ce qui a été gardé sur l'appareil, une écriture est refusée (lecture seule). */
async function fromOffline<T>(method: string, key: string | null): Promise<T> {
  markOffline();
  if (method !== 'GET') throw new ApiError(0, t('Serveur injoignable : lecture seule. La modification n’a pas été enregistrée.'), 'network');
  const kept = key ? await readOffline<T>(key) : null;
  if (!kept) throw new ApiError(0, t('Impossible de joindre le serveur. Vérifiez votre connexion.'), 'network');
  noteCached(kept.at);
  return kept.payload;
}

export async function http<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const cacheKey = offlineCacheKey(method, path, options);
  const headers: Record<string, string> = { [CLIENT_ID_HEADER]: clientId, ...options.headers };
  if (currentUserId !== null) {
    headers[USER_ID_HEADER] = String(currentUserId);
  }
  let body: BodyInit | undefined;
  if (options.rawBody !== undefined) {
    headers['Content-Type'] = options.contentType ?? 'application/octet-stream';
    body = options.rawBody as BodyInit;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(`/api${path}`, { method, headers, body, credentials: 'same-origin' });
  } catch {
    return fromOffline<T>(method, cacheKey);
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  const error = (payload as { error?: { message?: string; code?: string; details?: unknown } } | null)?.error;
  if (serverUnreachable(response.status, Boolean(error))) return fromOffline<T>(method, cacheKey);
  markOnline();
  if (!response.ok) {
    if (response.status === 401 && error?.code === 'session_changed') {
      sessionChangedHandler?.();
    } else if (response.status === 401 && !options.silent401) {
      unauthorizedHandler?.();
    }
    throw new ApiError(response.status, error?.message ? translateServerMessage(error.message) : t('Erreur {status}', { status: response.status }), error?.code, error?.details);
  }
  if (cacheKey) void writeOffline(cacheKey, payload);
  return payload as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : t('Une erreur est survenue.');
}
