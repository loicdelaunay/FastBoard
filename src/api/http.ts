import { CLIENT_ID_HEADER, USER_ID_HEADER } from '@shared/constants';

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
}

/** En-têtes communs (onglet, compte) pour les appels qui ne passent pas par `http` (envoi de fichiers). */
export function httpHeaders(): Record<string, string> {
  const headers: Record<string, string> = { [CLIENT_ID_HEADER]: clientId };
  if (currentUserId !== null) {
    headers[USER_ID_HEADER] = String(currentUserId);
  }
  return headers;
}

export async function http<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { [CLIENT_ID_HEADER]: clientId };
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
    throw new ApiError(0, t('Impossible de joindre le serveur. Vérifiez votre connexion.'), 'network');
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

  if (!response.ok) {
    const error = (payload as { error?: { message?: string; code?: string; details?: unknown } } | null)?.error;
    if (response.status === 401 && error?.code === 'session_changed') {
      sessionChangedHandler?.();
    } else if (response.status === 401 && !options.silent401) {
      unauthorizedHandler?.();
    }
    throw new ApiError(response.status, error?.message ? translateServerMessage(error.message) : t('Erreur {status}', { status: response.status }), error?.code, error?.details);
  }
  return payload as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : t('Une erreur est survenue.');
}
