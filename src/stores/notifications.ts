import { ref } from 'vue';
import { defineStore } from 'pinia';
import { DEFAULT_NOTIFICATION_LEVEL, type NotificationLevel } from '@shared/constants';
import type { NotificationDTO, NotificationSettingDTO } from '@shared/types';
import { api } from '@/api';
import { realtime } from '@/realtime/socket';
import { presentBrowserNotification } from '@/utils/browserNotifications';

/**
 * Notifications de l'utilisateur connecté : compteur de non lues, liste paginée, arrivée en direct (et notification
 * système du navigateur si la personne l'a demandé), niveaux de notification choisis projet par projet.
 */
export const useNotificationsStore = defineStore('notifications', () => {
  const items = ref<NotificationDTO[]>([]);
  const unread = ref(0);
  const nextBefore = ref<number | null>(null);
  const loaded = ref(false);
  const loading = ref(false);
  /** Identifiants arrivés en direct depuis l'ouverture de l'application (petite animation). */
  const fresh = ref(new Set<number>());
  /** Réglages par projet (projets visibles), chargés à la demande. */
  const settings = ref<NotificationSettingDTO[]>([]);
  const settingsLoaded = ref(false);

  async function load(): Promise<void> {
    loading.value = true;
    try {
      const page = await api.notifications();
      items.value = page.notifications;
      unread.value = page.unread;
      nextBefore.value = page.nextBefore;
      loaded.value = true;
    } finally {
      loading.value = false;
    }
  }

  async function loadMore(): Promise<void> {
    if (nextBefore.value === null || loading.value) return;
    loading.value = true;
    try {
      const page = await api.notifications(nextBefore.value);
      const known = new Set(items.value.map((item) => item.id));
      items.value = [...items.value, ...page.notifications.filter((item) => !known.has(item.id))];
      nextBefore.value = page.nextBefore;
    } finally {
      loading.value = false;
    }
  }

  async function markRead(ids?: number[]): Promise<void> {
    const now = new Date().toISOString();
    for (const item of items.value) {
      if (!item.readAt && (!ids || ids.includes(item.id))) item.readAt = now;
    }
    unread.value = (await api.markNotificationsRead(ids)).unread;
  }

  async function loadSettings(): Promise<void> {
    settings.value = (await api.notificationSettings()).settings;
    settingsLoaded.value = true;
  }

  function levelOf(projectId: number): NotificationLevel {
    return settings.value.find((setting) => setting.projectId === projectId)?.level ?? DEFAULT_NOTIFICATION_LEVEL;
  }

  function patchLevel(projectId: number, level: NotificationLevel): void {
    const setting = settings.value.find((entry) => entry.projectId === projectId);
    if (setting) setting.level = level;
  }

  /** Change le niveau d'un projet (affiché tout de suite, rétabli si le serveur refuse). */
  async function setLevel(projectId: number, level: NotificationLevel): Promise<void> {
    const previous = levelOf(projectId);
    patchLevel(projectId, level);
    try {
      const { setting } = await api.setNotificationLevel(projectId, level);
      if (settings.value.some((entry) => entry.projectId === projectId)) patchLevel(projectId, setting.level);
      else settings.value = [...settings.value, setting];
    } catch (error) {
      patchLevel(projectId, previous);
      throw error;
    }
  }

  function reset(): void {
    items.value = [];
    unread.value = 0;
    nextBefore.value = null;
    loaded.value = false;
    settings.value = [];
    settingsLoaded.value = false;
  }

  realtime.on('notification', (notification, count) => {
    unread.value = count;
    if (!items.value.some((item) => item.id === notification.id)) items.value = [notification, ...items.value];
    fresh.value = new Set(fresh.value).add(notification.id);
    presentBrowserNotification(notification, () => {
      const known = items.value.find((item) => item.id === notification.id);
      if (!known?.readAt) void markRead([notification.id]).catch(() => undefined);
    });
  });
  realtime.on('notificationsRead', (count) => {
    unread.value = count;
    if (count === 0) {
      const now = new Date().toISOString();
      for (const item of items.value) item.readAt ??= now;
    }
  });
  realtime.on('notificationSettings', (projectId, level) => {
    if (settings.value.some((entry) => entry.projectId === projectId)) patchLevel(projectId, level);
    else if (settingsLoaded.value) void loadSettings().catch(() => undefined);
  });
  // Projet rejoint ou quitté : la liste des réglages change.
  realtime.on('projectsRefresh', () => {
    if (settingsLoaded.value) void loadSettings().catch(() => undefined);
  });
  realtime.on('resync', () => {
    if (loaded.value) void load();
    if (settingsLoaded.value) void loadSettings().catch(() => undefined);
  });

  return { items, unread, nextBefore, loaded, loading, fresh, settings, settingsLoaded, load, loadMore, markRead, loadSettings, levelOf, setLevel, reset };
});
