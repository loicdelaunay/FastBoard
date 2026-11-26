<script setup lang="ts">
import { computed } from 'vue';
import type { NotificationCategory } from '@shared/notificationCategories';
import { useNotificationsStore } from '@/stores/notifications';
import { notificationCategoryOptions } from '@/utils/notificationText';
import { notifyError } from '@/utils/notify';

/** Pastilles de tri des notifications par catégorie, avec le nombre de non lues (ou de notifications) de chacune. */
defineProps<{ compact?: boolean }>();
const store = useNotificationsStore();
const options = computed(() =>
  notificationCategoryOptions().map((option) => {
    const counts = option.value ? store.counts[option.value] : { total: Object.values(store.counts).reduce((sum, entry) => sum + entry.total, 0), unread: store.unread };
    return { ...option, ...counts };
  }),
);

async function pick(value: NotificationCategory | null): Promise<void> {
  try {
    await store.setCategory(value);
  } catch (error) {
    notifyError(error);
  }
}
</script>

<template>
  <div class="filters" :class="{ compact }" role="tablist" :aria-label="$t('Catégories de notifications')">
    <button
      v-for="option in options"
      :key="option.value ?? 'all'"
      type="button"
      role="tab"
      class="chip"
      :class="{ active: store.category === option.value, empty: !option.total }"
      :aria-selected="store.category === option.value"
      :title="$t('{n} notification|{n} notifications', { n: option.total })"
      @click="pick(option.value)"
    >
      <i :class="option.icon"></i>
      <span>{{ option.label }}</span>
      <span v-if="option.unread" class="count">{{ option.unread > 99 ? '99+' : option.unread }}</span>
    </button>
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.25rem 0.65rem;
  border: 1px solid var(--fb-border);
  border-radius: 999px;
  background: var(--fb-panel);
  color: var(--fb-text);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
.chip i {
  font-size: 0.75rem;
  color: var(--fb-muted);
}
.chip:hover {
  border-color: var(--fb-accent);
}
.chip.active {
  border-color: var(--fb-accent);
  background: color-mix(in srgb, var(--fb-accent) 14%, transparent);
  color: var(--fb-accent);
}
.chip.active i {
  color: inherit;
}
.chip.empty:not(.active) {
  opacity: 0.6;
}
.count {
  min-width: 1.1rem;
  padding: 0 0.3rem;
  border-radius: 999px;
  background: var(--fb-accent);
  color: #fff;
  font-size: 0.65rem;
  font-weight: 800;
  line-height: 1.1rem;
  text-align: center;
}
.compact .chip {
  padding: 0.2rem 0.5rem;
  font-size: 0.75rem;
}
</style>
