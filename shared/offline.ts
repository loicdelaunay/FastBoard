/**
 * Lecture seule hors ligne : quand le serveur ne répond plus, l'interface montre ce qu'elle a gardé sur l'appareil
 * (réponses de l'API déjà reçues, texte des notes et éléments des tableaux ouverts), sans rien pouvoir modifier.
 */

export const OFFLINE_LIMITS = {
  /** Réponses gardées par appareil ; au-delà, les plus anciennes partent. */
  entries: 1500,
  /** Une réponse plus lourde (en caractères JSON) n'est pas gardée. */
  payloadChars: 2_000_000,
  /** Hors ligne, le serveur est sondé à ce rythme pour reprendre dès qu'il répond. */
  probeMs: 5000,
  /** Délai au-delà duquel la sonde le considère injoignable. */
  probeTimeoutMs: 4000,
  /** Espace gardé hors ligne : un fichier joint plus lourd n'est pas copié (les images le sont toujours). */
  pinnedFileBytes: 50 * 1024 * 1024,
} as const;

/** Fichier joint d'un ticket (téléchargement ou affichage) : copié avec un projet gardé hors ligne et servi sans serveur. */
export const isPinnableFile = (pathname: string): boolean => /^\/api\/attachments\/\d+\/download$/.test(pathname);

/**
 * Réponse de l'API à garder pour la lecture hors ligne : les lectures de l'application, pas l'administration, la
 * connexion, l'assistant IA, les jetons, les sauvegardes, les exports ni les recherches (une par texte tapé).
 */
export function offlineCacheable(path: string): boolean {
  const [pathname = '', query = ''] = path.split('?');
  if (/^\/(admin|auth|ai|backups|tokens|assistant)(\/|$)/.test(pathname)) return false;
  if (/\/(tokens|export|exports|search)(\/|$)/.test(pathname)) return false;
  return !/(^|&)q=/.test(query);
}

/**
 * Le serveur ne répond pas : erreur réseau, ou 502 / 503 / 504 d'un intermédiaire (proxy inverse) sans le message
 * d'erreur que FastBoard joint toujours aux siens.
 */
export function serverUnreachable(status: number, fastboardError: boolean): boolean {
  return status === 0 || ((status === 502 || status === 503 || status === 504) && !fastboardError);
}
