<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import Menu from 'primevue/menu';
import ToggleSwitch from 'primevue/toggleswitch';
import NotificationFilters from '@/components/notifications/NotificationFilters.vue';
import NotificationItem from '@/components/notifications/NotificationItem.vue';
import { useNotificationActions } from '@/composables/useNotificationActions';
import { t } from '@/i18n';
import { connection } from '@/offline/connection';
import { useNotificationsStore } from '@/stores/notifications';
import { notifyError } from '@/utils/notify';

/**
 * Toutes les notifications, sur une page : triées par catégorie, regroupées par jour, avec les plus anciennes à la
 * demande, et les actions de la cloche (tout lire, effacer les lues, tout effacer, réglages).
 */
const store = useNotificationsStore();
const actions = useNotificationActions();
const actionsMenu = ref<InstanceType<typeof Menu> | null>(null);
const onlyUnread = ref(false);

onMounted(() => {
  store.load().catch((error) => notifyError(error));
});

const visible = computed(() => (onlyUnread.value ? store.items.filter((item) => !item.readAt) : store.items));
const dayKey = (iso: string): string => {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};
function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return t('Aujourd’hui');
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return t('Hier');
  return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
}
/** Les notifications par jour, du plus récent au plus ancien. */
const days = computed(() => {
  const groups: Array<{ key: string; label: string; items: typeof visible.value }> = [];
  for (const item of visible.value) {
    const key = dayKey(item.createdAt);
    const last = groups.at(-1);
    if (last?.key === key) last.items.push(item);
    else groups.push({ key, label: dayLabel(item.createdAt), items: [item] });
  }
  return groups;
});
const unreadHere = computed(() => (store.category ? store.counts[store.category].unread : store.unread));
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <h1 class="page-title">{{ $t('Notifications') }}</h1>
        <p class="muted">{{ $t('Mentions, assignations et activité des tickets que vous suivez, des 90 derniers jours.') }}</p>
      </div>
      <div class="head-actions">
        <Button :label="$t('Tout marquer comme lu')" icon="pi pi-check" severity="secondary" outlined :disabled="!unreadHere || connection.offline" @click="actions.readAll" />
        <Button v-tooltip.bottom="$t('Actions')" icon="pi pi-ellipsis-v" severity="secondary" text rounded :aria-label="$t('Actions')" aria-haspopup="true" @click="actionsMenu?.toggle($event)" />
        <Menu ref="actionsMenu" :model="actions.menu.value" popup />
      </div>
    </header>

    <div class="toolbar">
      <NotificationFilters />
      <label class="unread-toggle small"><ToggleSwitch v-model="onlyUnread" input-id="only-unread" /> <span>{{ $t('Non lues seulement') }}</span></label>
    </div>

    <div v-if="store.loading && !store.loaded" class="empty muted"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</div>
    <section v-for="day in days" :key="day.key" class="day">
      <h2 class="day-title muted small">{{ day.label }}</h2>
      <ul class="list">
        <li v-for="item in day.items" :key="item.id">
          <NotificationItem :item="item" :fresh="store.fresh.has(item.id)" @open="actions.open" @remove="actions.remove" />
        </li>
      </ul>
    </section>
    <p v-if="store.loaded && !visible.length" class="empty muted">
      <i class="pi pi-bell-slash"></i>
      {{ onlyUnread ? $t('Aucune notification non lue.') : store.category ? $t('Aucune notification dans cette catégorie.') : $t('Aucune notification. Suivez un ticket ou attendez qu’on vous mentionne avec @.') }}
    </p>
    <Button v-if="store.nextBefore !== null" :label="$t('Plus anciennes')" icon="pi pi-angle-down" text class="more" :loading="store.loading" @click="store.loadMore" />
  </div>
</template>

<style scoped>
.page {
  max-width: 52rem;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.head > div:first-child {
  flex: 1;
  min-width: min(18rem, 100%);
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.6rem 1rem;
  margin: 1rem 0 0.6rem;
}
.unread-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}
.day {
  margin-top: 0.8rem;
}
.day-title {
  margin: 0 0 0.3rem 0.4rem;
  text-transform: capitalize;
  font-weight: 600;
}
.list {
  margin: 0;
  padding: 0.3rem;
  list-style: none;
  background: var(--fb-panel);
  border: 1px solid var(--fb-border);
  border-radius: 12px;
  display: grid;
  gap: 0.15rem;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  padding: 2.5rem 1rem;
  text-align: center;
}
.more {
  display: flex;
  margin: 1rem auto 0;
}
</style>
