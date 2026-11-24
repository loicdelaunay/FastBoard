import { reactive } from 'vue';

/**
 * Application installable (PWA) : enregistrement du service worker, invite d'installation du navigateur (Chrome, Edge,
 * Android), et consignes pour Safari (iPhone, iPad, Mac), qui n'en propose pas. L'état est global : le menu du compte
 * montre « Installer l'application » tant qu'elle ne l'est pas et que le navigateur le permet.
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Où l'installer à la main : Safari sur iPhone ou iPad, Safari sur Mac ; `null` : le navigateur propose son invite. */
export type ManualInstall = 'ios' | 'mac-safari' | null;

function standalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: minimal-ui)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function manualInstall(): ManualInstall {
  const agent = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(agent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) return 'ios';
  // Safari sur Mac (pas Chrome, Edge ni Firefox, qui se présentent aussi comme « Safari ») : « Ajouter au Dock ».
  if (/Macintosh/.test(agent) && /Version\/\d+.*Safari/.test(agent) && !/Chrome|Chromium|Edg|Firefox|FxiOS/.test(agent)) return 'mac-safari';
  return null;
}

let deferred: InstallPromptEvent | null = null;

export const pwa = reactive({
  /** L'application tourne déjà installée (fenêtre à elle). */
  installed: false,
  /** Le navigateur propose son invite d'installation. */
  canPrompt: false,
  manual: null as ManualInstall,
});

/** À appeler une fois, au démarrage : l'invite du navigateur peut arriver avant que l'interface soit prête. */
export function setupPwa(): void {
  pwa.installed = standalone();
  pwa.manual = pwa.installed ? null : manualInstall();
  window.addEventListener('beforeinstallprompt', (event) => {
    // Le navigateur garde son icône d'installation ; on propose la nôtre dans le menu du compte.
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    pwa.canPrompt = true;
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    pwa.canPrompt = false;
    pwa.installed = true;
  });
  window.matchMedia('(display-mode: standalone)').addEventListener('change', () => (pwa.installed = standalone()));

  // Le service worker : seulement l'interface construite, et dans un contexte sûr (HTTPS, ou localhost).
  if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
    const register = (): void => void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }
}

/** Ouvre l'invite d'installation du navigateur ; vrai si la personne a accepté. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null;
  pwa.canPrompt = false;
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome === 'accepted';
}

/** Pastille sur l'icône de l'application installée (notifications non lues), là où le système la gère. */
export function setAppBadge(count: number): void {
  const nav = navigator as Navigator & { setAppBadge?: (count?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  if (!nav.setAppBadge || !nav.clearAppBadge) return;
  void (count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge()).catch(() => undefined);
}
