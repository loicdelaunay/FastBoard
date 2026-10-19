<script setup lang="ts">
import { computed } from 'vue';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/project';

import { t } from '@/i18n';
const auth = useAuthStore();
const project = useProjectStore();

/** Collègues connectés sur ce projet (hors moi). */
const others = computed(() =>
  project.presence
    .filter((entry) => entry.userId !== auth.user?.id)
    .map((entry) => ({ entry, user: project.usersById.get(entry.userId) }))
    .filter((item): item is { entry: typeof item.entry; user: NonNullable<typeof item.user> } => item.user !== undefined),
);

const VIEW_LABELS: Record<string, string> = { analyzer: t('Analyseur'), list: t('Liste'), kanban: 'Kanban', gantt: 'Gantt', activity: t('Activités'), settings: t('Réglages') };
</script>

<template>
  <div v-if="others.length" class="presence" :aria-label="$t('Collègues connectés')">
    <span
      v-for="item in others.slice(0, 6)"
      :key="item.user.id"
      v-tooltip.bottom="`${item.user.name} — ${item.entry.views.map((v) => VIEW_LABELS[v] ?? v).join(', ') || $t('en ligne')}`"
      class="who"
    >
      <UserAvatar :user="item.user" ring="online" />
    </span>
    <span v-if="others.length > 6" class="more">+{{ others.length - 6 }}</span>
    <span class="label muted small">{{ $t('{length} en ligne', { length: others.length }) }}</span>
  </div>
</template>

<style scoped>
.presence {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.who {
  display: inline-flex;
}
.more {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--fb-muted);
}
@media (max-width: 800px) {
  .label {
    display: none;
  }
}
</style>
