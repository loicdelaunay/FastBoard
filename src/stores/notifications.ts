import { ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { DEFAULT_NOTIFICATION_LEVEL, type NotificationLevel } from '@shared/constants';
import type { NotificationDTO, NotificationSettingDTO } from '@shared/types';
import { emptyNotificationCounts, notificationCategory, type NotificationCategory, type NotificationCounts } from '@shared/notificationCategories';
import { api } from '@/api';
import { realtime } from '@/realtime/socket';
import { presentBrowserNotification } from '@/utils/browserNotifications';
import { setAppBadge } from '@/pwa/install';

/**
 * Notifications de l'utilisateur connecté : compteur de non lues (et par catégorie), liste paginée, filtrée par
 * catégorie, arrivée en direct (et notification système du navigateur si la personne l'a demandé), effacement, niveaux
 * de notification choisis projet par projet. La fenêtre de la cloche et la page « Notifications » partagent la liste.
 */
export const useNotificationsStore = defineStore('notifications', () => {
  const items = ref<NotificationDTO[]>([]);
  const unread = ref(0);
  // L'application installée montre le nombre de notifications non lues sur son icône (là où le système le permet).
  watch(unread, (count) => setAppBadge(count));
  const nextBefore = ref<number | null>(null);
  /** Catégorie montrée (`null` : toutes) ; la liste ne contient que celle-ci. */
  const category = ref<NotificationCategory | null>(null);
  const counts = ref<NotificationCounts>(emptyNotificationCounts());
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
      const wanted = category.value;
      const page = await api.notifications({ category: wanted });
      if (wanted !== category.value) return;
      items.value = page.notifications;
      unread.value = page.unread;
      counts.value = page.counts;
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
      const page = await api.notifications({ before: nextBefore.value, category: category.value });
      const known = new Set(items.value.map((item) => item.id));
      items.value = [...items.value, ...page.notifications.filter((item) => !known.has(item.id))];
      nextBefore.value = page.nextBefore;
    } finally {
      loading.value = false;
    }
  }

  const matches = (item: NotificationDTO, wanted: NotificationCategory | null): boolean => wanted === null || notificationCategory(item) === wanted;

  function applyRead(ids: number[] | null, wanted: NotificationCategory | null): void {
    const now = new Date().toISOString();
    for (const item of items.value) {
      if (!item.readAt && (ids ? ids.includes(item.id) : matches(item, wanted))) item.readAt = now;
    }
  }

  /** Marque comme lues des notifications précises, sinon toutes celles de la catégorie montrée. */
  async function markRead(ids?: number[]): Promise<void> {
    const wanted = ids ? null : category.value;
    applyRead(ids ?? null, wanted);
    const state = await api.markNotificationsRead({ ids, category: wanted });
    unread.value = state.unread;
    counts.value = state.counts;
  }

  function applyRemoved(ids: number[]): void {
    const gone = new Set(ids);
    items.value = items.value.filter((item) => !gone.has(item.id));
  }

  async function remove(id: number): Promise<void> {
    const state = await api.deleteNotification(id);
    applyRemoved([id]);
    unread.value = state.unread;
    counts.value = state.counts;
  }

  /** Efface les notifications de la catégorie montrée (toutes sans catégorie) ; `readOnly` : seulement les lues. */
  async function clear(readOnly: boolean): Promise<number> {
    const state = await api.deleteNotifications({ category: category.value, readOnly });
    items.value = items.value.filter((item) => readOnly && !item.readAt);
    unread.value = state.unread;
    counts.value = state.counts;
    // Il peut en rester d'autres, plus anciennes, non chargées : la liste se relit.
    if (nextBefore.value !== null || readOnly) await load();
    return state.removed;
  }

  async function setCategory(next: NotificationCategory | null): Promise<void> {
    if (category.value === next && loaded.value) return;
    category.value = next;
    nextBefore.value = null;
    await load();
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
    counts.value = emptyNotificationCounts();
    category.value = null;
    nextBefore.value = null;
    loaded.value = false;
    settings.value = [];
    settingsLoaded.value = false;
  }

  realtime.on('notification', (notification, count, perCategory) => {
    unread.value = count;
    counts.value = perCategory;
    if (matches(notification, category.value) && !items.value.some((item) => item.id === notification.id)) items.value = [notification, ...items.value];
    fresh.value = new Set(fresh.value).add(notification.id);
    presentBrowserNotification(notification, () => {
      const known = items.value.find((item) => item.id === notification.id);
      if (!known?.readAt) void markRead([notification.id]).catch(() => undefined);
    });
  });
  realtime.on('notificationsRead', (count, perCategory, ids, wanted) => {
    unread.value = count;
    counts.value = perCategory;
    applyRead(ids, wanted);
  });
  realtime.on('notificationsRemoved', (ids, count, perCategory) => {
    unread.value = count;
    counts.value = perCategory;
    applyRemoved(ids);
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

  return { items, unread, nextBefore, category, counts, loaded, loading, fresh, settings, settingsLoaded, load, loadMore, markRead, remove, clear, setCategory, loadSettings, levelOf, setLevel, reset };
});
