<script setup lang="ts">
import { computed } from 'vue';
import type { HomeBlock } from '@shared/homeLayout';
import NotificationItem from '@/components/notifications/NotificationItem.vue';
import { useNotificationActions } from '@/composables/useNotificationActions';
import { useNotificationsStore } from '@/stores/notifications';
import HomeBlockFrame from '../HomeBlockFrame.vue';
import { useHomeSources } from '../homeContext';

/** Mentions et assignations non lues, les plus récentes. */
const props = defineProps<{ block: HomeBlock }>();
const { home } = useHomeSources();
const notifications = useNotificationsStore();
const actions = useNotificationActions();
const all = computed(() => home.value?.notifications ?? []);
const shown = computed(() => all.value.slice(0, props.block.options.limit ?? 8));
</script>

<template>
  <HomeBlockFrame :block="block" :badge="all.length">
    <template #extra>
      <router-link :to="{ name: 'notifications' }" class="more small" draggable="false">{{ $t('Toutes ({n} non lues)', { n: notifications.unread }) }}</router-link>
    </template>
    <ul v-if="shown.length" class="rows">
      <li v-for="item in shown" :key="item.id">
        <NotificationItem :item="item" @open="actions.open" @remove="actions.remove" />
      </li>
    </ul>
    <p v-else class="hint muted small"><i class="pi pi-check-circle"></i> {{ $t('Aucune mention ni assignation en attente.') }}</p>
  </HomeBlockFrame>
</template>

<style scoped src="../home.css"></style>
