<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import Button from 'primevue/button';
import Menu from 'primevue/menu';
import Popover from 'primevue/popover';
import NotificationFilters from '@/components/notifications/NotificationFilters.vue';
import NotificationItem from '@/components/notifications/NotificationItem.vue';
import { useNotificationActions } from '@/composables/useNotificationActions';
import { useNotificationsStore } from '@/stores/notifications';

/**
 * Cloche : notifications des tickets suivis, assignations et mentions, triées par catégorie ; « Voir toutes les
 * notifications » ouvre leur page. `label` : avec son nom, dans la barre latérale.
 */
defineProps<{ label?: string }>();
const store = useNotificationsStore();
const router = useRouter();
const panel = ref<InstanceType<typeof Popover> | null>(null);
const actionsMenu = ref<InstanceType<typeof Menu> | null>(null);
const onlyUnread = ref(false);
const actions = useNotificationActions({ beforeNavigate: () => panel.value?.hide() });

onMounted(() => {
  store.load().catch(() => undefined);
});

const visible = computed(() => (onlyUnread.value ? store.items.filter((item) => !item.readAt) : store.items));
const badge = computed(() => (store.unread > 99 ? '99+' : String(store.unread)));

function seeAll(): void {
  panel.value?.hide();
  void router.push({ name: 'notifications' });
}
</script>

<template>
  <button v-tooltip.right="label ? undefined : $t('Notifications')" type="button" class="bell" :class="{ active: store.unread > 0, labelled: label }" :aria-label="$t('Notifications ({n} non lues)', { n: store.unread })" aria-haspopup="dialog" @click="panel?.toggle($event)">
    <span class="icon"><i class="pi pi-bell"></i><span v-if="store.unread" class="badge">{{ badge }}</span></span>
    <span v-if="label" class="bell-label">{{ label }}</span>
  </button>
  <Popover ref="panel" class="notifications-panel">
    <div class="panel">
      <header class="head">
        <strong>{{ $t('Notifications') }}</strong>
        <label class="row small toggle"><input v-model="onlyUnread" type="checkbox" /> {{ $t('Non lues') }}</label>
        <Button v-tooltip.bottom="$t('Actions')" icon="pi pi-ellipsis-v" text rounded size="small" severity="secondary" :aria-label="$t('Actions')" aria-haspopup="true" @click="actionsMenu?.toggle($event)" />
        <Menu ref="actionsMenu" :model="actions.menu.value" popup />
      </header>
      <NotificationFilters compact class="filters" />
      <ul v-if="visible.length" class="list">
        <li v-for="item in visible" :key="item.id">
          <NotificationItem :item="item" :fresh="store.fresh.has(item.id)" @open="actions.open" @remove="actions.remove" />
        </li>
      </ul>
      <p v-else-if="store.loaded" class="empty muted">
        <i class="pi pi-bell-slash"></i>
        {{ onlyUnread ? $t('Aucune notification non lue.') : store.category ? $t('Aucune notification dans cette catégorie.') : $t('Aucune notification. Suivez un ticket ou attendez qu’on vous mentionne avec @.') }}
      </p>
      <footer class="foot">
        <Button v-if="store.nextBefore !== null && !onlyUnread" :label="$t('Plus anciennes')" text size="small" :loading="store.loading" @click="store.loadMore" />
        <Button :label="$t('Voir toutes les notifications')" icon="pi pi-arrow-right" icon-pos="right" text size="small" class="see-all" @click="seeAll" />
      </footer>
    </div>
  </Popover>
</template>

<style scoped>
.bell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  min-width: 2.3rem;
  height: 2.3rem;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--fb-muted);
  font: inherit;
  cursor: pointer;
}
.icon {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: 1.75rem;
}
.bell.labelled {
  justify-content: flex-start;
  width: 100%;
  padding: 0 0.5rem 0 0.35rem;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 600;
}
.bell:hover,
.bell:focus-visible {
  background: var(--fb-panel-alt);
  color: var(--fb-text);
}
.bell.active {
  color: var(--fb-text);
}
.badge {
  position: absolute;
  top: -0.5rem;
  right: -0.1rem;
  min-width: 1.05rem;
  height: 1.05rem;
  padding: 0 0.25rem;
  border-radius: 999px;
  background: var(--fb-danger);
  color: #fff;
  font-size: 0.62rem;
  font-weight: 800;
  line-height: 1.05rem;
  text-align: center;
}
.panel {
  width: min(26rem, 90vw);
  max-height: min(70vh, 34rem);
  display: flex;
  flex-direction: column;
}
.head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding-bottom: 0.4rem;
  border-bottom: 1px solid var(--fb-border);
}
.head strong {
  flex: 1;
}
.toggle {
  gap: 0.3rem;
  cursor: pointer;
}
.filters {
  padding: 0.5rem 0 0.2rem;
}
.list {
  margin: 0;
  padding: 0.3rem 0;
  overflow-y: auto;
  list-style: none;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  padding: 1.5rem 1rem;
  text-align: center;
}
.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  padding-top: 0.3rem;
  border-top: 1px solid var(--fb-border);
}
.see-all {
  margin-left: auto;
}
</style>
