import type { IncomingMessage } from 'node:http';
import type { AppConfig } from '../config.ts';

/**
 * Protection CSRF / CSWSH : si le navigateur envoie un en-tête `Origin`, il doit pointer vers le même hôte
 * que la requête (ou figurer dans `ALLOWED_ORIGINS`). Les clients sans `Origin` (outils, tests) sont acceptés,
 * l'authentification par cookie restant obligatoire.
 */
export function isAllowedOrigin(request: IncomingMessage, config: AppConfig): boolean {
  const origin = request.headers.origin;
  if (!origin) {
    return true;
  }
  if (config.allowedOrigins.includes(origin)) {
    return true;
  }
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}
