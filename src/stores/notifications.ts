import { ref } from 'vue';
import { defineStore } from 'pinia';
import type { NotificationDTO } from '@shared/types';
import { api } from '@/api';
import { realtime } from '@/realtime/socket';

/** Notifications de l'utilisateur connecté : compteur de non lues, liste paginée, arrivée en direct. */
export const useNotificationsStore = defineStore('notifications', () => {
  const items = ref<NotificationDTO[]>([]);
  const unread = ref(0);
  const nextBefore = ref<number | null>(null);
  const loaded = ref(false);
  const loading = ref(false);
  /** Identifiants arrivés en direct depuis l'ouverture de l'application (petite animation). */
  const fresh = ref(new Set<number>());

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

  function reset(): void {
    items.value = [];
    unread.value = 0;
    nextBefore.value = null;
    loaded.value = false;
  }

  realtime.on('notification', (notification, count) => {
    unread.value = count;
    if (!items.value.some((item) => item.id === notification.id)) items.value = [notification, ...items.value];
    fresh.value = new Set(fresh.value).add(notification.id);
  });
  realtime.on('notificationsRead', (count) => {
    unread.value = count;
    if (count === 0) {
      const now = new Date().toISOString();
      for (const item of items.value) item.readAt ??= now;
    }
  });
  realtime.on('resync', () => {
    if (loaded.value) void load();
  });

  return { items, unread, nextBefore, loaded, loading, fresh, load, loadMore, markRead, reset };
});
