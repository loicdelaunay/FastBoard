import { reactive, watch } from 'vue';
import { OFFLINE_LIMITS } from '@shared/offline';
import { realtime } from '@/realtime/socket';

/**
 * Le serveur répond-il ? Hors ligne, l'interface montre ce qu'elle a gardé sur l'appareil, en lecture seule, et sonde
 * le serveur régulièrement pour reprendre dès qu'il revient. La coupure se voit à un appel de l'API qui échoue, ou à
 * la connexion temps réel qui tombe (vérifiée alors par une sonde).
 */
export const connection = reactive({
  offline: false,
  /** Début de la coupure. */
  since: null as string | null,
  /** Plus ancienne donnée gardée montrée depuis la coupure : l'état affiché peut dater de là. */
  oldest: null as string | null,
  /** Le serveur vient de répondre de nouveau : le bandeau le dit un instant. */
  back: false,
});

let pollTimer = 0;
let backTimer = 0;
let probing: Promise<boolean> | null = null;

export function markOffline(): void {
  if (connection.offline) return;
  Object.assign(connection, { offline: true, since: new Date().toISOString(), oldest: null, back: false });
  window.clearTimeout(backTimer);
  window.clearInterval(pollTimer);
  pollTimer = window.setInterval(() => void probe(), OFFLINE_LIMITS.probeMs);
}

export function markOnline(): void {
  if (!connection.offline) return;
  window.clearInterval(pollTimer);
  Object.assign(connection, { offline: false, since: null, oldest: null, back: true });
  window.clearTimeout(backTimer);
  backTimer = window.setTimeout(() => (connection.back = false), 8000);
  // Ce qui s'affichait venait de l'appareil : les écrans le rechargent du serveur.
  realtime.resync();
}

/** Une donnée gardée du `at` vient d'être montrée à la place de celle du serveur. */
export function noteCached(at: string): void {
  if (!connection.oldest || at < connection.oldest) connection.oldest = at;
}

/** Interroge le serveur (`/api/health`) ; met à jour l'état et rend vrai s'il répond. */
export function probe(): Promise<boolean> {
  probing ??= (async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), OFFLINE_LIMITS.probeTimeoutMs);
    let ok = false;
    try {
      const response = await fetch('/api/health', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
      ok = response.ok && ((await response.json()) as { status?: string }).status === 'ok';
    } catch {
      ok = false;
    } finally {
      window.clearTimeout(timer);
    }
    if (ok) markOnline();
    else markOffline();
    return ok;
  })().finally(() => (probing = null));
  return probing;
}

/** À appeler une fois au démarrage : la connexion temps réel qui tombe fait sonder le serveur, celle qui s'ouvre le dit revenu. */
export function watchConnection(): void {
  watch(realtime.state, (state) => {
    if (state === 'open') markOnline();
    else if (state === 'reconnecting') void probe();
  });
  window.addEventListener('online', () => connection.offline && void probe());
}
