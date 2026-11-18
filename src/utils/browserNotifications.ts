import { computed, ref } from 'vue';
import type { NotificationDTO } from '@shared/types';
import router from '@/router';
import { useAppStore } from '@/stores/app';
import { useAuthStore } from '@/stores/auth';
import { notificationRoute, notificationSentence } from '@/utils/notificationText';

import { currentLocale, t } from '@/i18n';

/**
 * Notifications système du navigateur (API Notification), sur demande de la personne et pour ce navigateur seulement :
 * une notification reçue en direct s'affiche quand aucun onglet de FastBoard n'est au premier plan. Le serveur a déjà
 * appliqué les réglages de notification du projet : tout ce qui arrive ici est à montrer.
 */

/** `unsupported` : pas d'API Notification ; `insecure` : page servie en HTTP (l'API exige HTTPS ou localhost). */
export type BrowserNotificationSupport = 'ok' | 'unsupported' | 'insecure';

const STORAGE_PREFIX = 'fb.browserNotifications.';
const CHANNEL_NAME = 'fb.browserNotifications';

export function browserNotificationSupport(): BrowserNotificationSupport {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (!window.isSecureContext) return 'insecure';
  return 'ok';
}

function readPermission(): NotificationPermission {
  return browserNotificationSupport() === 'ok' ? Notification.permission : 'denied';
}

const permission = ref<NotificationPermission>(readPermission());
/** Change quand le choix enregistré dans ce navigateur change (le stockage local n'est pas réactif). */
const choiceVersion = ref(0);

function readChoice(userId: number): boolean {
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${userId}`) === '1';
  } catch {
    return false;
  }
}

function writeChoice(userId: number, enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(`${STORAGE_PREFIX}${userId}`, '1');
    else localStorage.removeItem(`${STORAGE_PREFIX}${userId}`);
  } catch {
    /* stockage indisponible : le choix ne sera pas retenu */
  }
  choiceVersion.value += 1;
}

// L'autorisation peut changer dans les réglages du navigateur pendant que la page est ouverte.
if (browserNotificationSupport() === 'ok') {
  navigator.permissions
    ?.query({ name: 'notifications' })
    .then((status) => {
      status.onchange = () => (permission.value = readPermission());
    })
    .catch(() => undefined);
  window.addEventListener('storage', (event) => {
    if (event.key?.startsWith(STORAGE_PREFIX)) choiceVersion.value += 1;
  });
}

// --- Un seul onglet affiche chaque notification ----------------------------------------------------------------------

/** Notifications déjà prises en charge par un onglet (affichées, ou vues dans l'onglet au premier plan). */
const handled = new Set<number>();
let channel: BroadcastChannel | null | undefined;

function sharedChannel(): BroadcastChannel | null {
  if (channel === undefined) {
    channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);
    if (channel) channel.onmessage = (event: MessageEvent<{ id?: unknown }>) => typeof event.data?.id === 'number' && handled.add(event.data.id);
  }
  return channel;
}

function claim(id: number): void {
  handled.add(id);
  if (handled.size > 500) handled.delete(handled.values().next().value!);
  sharedChannel()?.postMessage({ id });
}

function showSystemNotification(title: string, options: { body: string; tag: string; onClick?: () => void }): void {
  const app = useAppStore();
  const shown = new Notification(title, { body: options.body, tag: options.tag, icon: app.logoUrl, lang: currentLocale() });
  shown.onclick = () => {
    window.focus();
    shown.close();
    options.onClick?.();
  };
}

/** Texte de la notification système : « Alice vous a assigné APP-12 », puis le titre du ticket, l'extrait et le projet. */
function describe(item: NotificationDTO): { title: string; body: string } {
  const subject = item.doc?.title ?? item.ticketKey ?? '';
  const title = [item.actorName ?? t('Quelqu’un'), notificationSentence(item), subject].filter(Boolean).join(' ');
  const body = [item.ticketTitle ? `« ${item.ticketTitle} »` : '', item.excerpt ?? '', item.projectName ?? ''].filter(Boolean).join('\n');
  return { title, body };
}

/**
 * À appeler pour chaque notification reçue en direct. Rien ne s'affiche si la personne ne l'a pas demandé dans ce
 * navigateur, ou si un onglet de FastBoard est au premier plan (la cloche suffit). `onOpen` : marquer comme lue.
 */
export function presentBrowserNotification(item: NotificationDTO, onOpen: () => void): void {
  const auth = useAuthStore();
  if (!auth.user || browserNotificationSupport() !== 'ok' || Notification.permission !== 'granted' || !readChoice(auth.user.id)) return;
  if (document.visibilityState === 'visible' && document.hasFocus()) {
    // La personne regarde cet onglet : les autres onglets s'abstiennent.
    claim(item.id);
    return;
  }
  // Court délai : l'onglet au premier plan, ou un autre onglet plus rapide, l'emporte (pas de doublon).
  window.setTimeout(() => {
    if (handled.has(item.id)) return;
    claim(item.id);
    const { title, body } = describe(item);
    try {
      showSystemNotification(title, {
        body,
        tag: `fastboard-${item.id}`,
        onClick: () => {
          onOpen();
          const route = notificationRoute(item);
          if (route) void router.push(route);
        },
      });
    } catch {
      /* navigateur qui refuse `new Notification` (certains mobiles) : la cloche reste */
    }
  }, 150 + Math.round(Math.random() * 250));
}

/** Choix « notifications du navigateur » de la personne connectée, pour ce navigateur. */
export function useBrowserNotifications() {
  const auth = useAuthStore();
  const support = browserNotificationSupport();
  const enabled = computed(() => {
    void choiceVersion.value;
    return auth.user !== null && permission.value === 'granted' && readChoice(auth.user.id);
  });

  /** Demande l'autorisation (à appeler depuis un clic) puis active ; retourne la réponse du navigateur. */
  async function enable(): Promise<NotificationPermission> {
    if (support !== 'ok' || !auth.user) return 'denied';
    let answer = Notification.permission;
    if (answer === 'default') answer = await Notification.requestPermission();
    permission.value = answer;
    if (answer === 'granted') writeChoice(auth.user.id, true);
    return answer;
  }

  function disable(): void {
    if (auth.user) writeChoice(auth.user.id, false);
  }

  function refresh(): void {
    permission.value = readPermission();
    choiceVersion.value += 1;
  }

  /** Notification d'essai, affichée même si l'onglet est au premier plan. */
  function test(): void {
    showSystemNotification(useAppStore().name, { body: t('Les notifications du navigateur fonctionnent : vous serez prévenu ainsi quand l’application n’est pas au premier plan.'), tag: 'fastboard-test' });
  }

  return { support, permission, enabled, enable, disable, refresh, test };
}
