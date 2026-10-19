<script setup lang="ts">
import { computed } from 'vue';
import type { TicketStatus } from '@shared/constants';
import { useProjectStore } from '@/stores/project';

const props = defineProps<{ status: TicketStatus; compact?: boolean }>();
const project = useProjectStore();
const meta = computed(() => project.statusMeta(props.status));
</script>

<template>
  <span class="status-tag" :class="{ compact }" :style="{ '--tag': meta.color }">
    <i class="dot"></i>
    <span class="label">{{ meta.label }}</span>
  </span>
</template>

<style scoped>
.status-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.15rem 0.6rem 0.15rem 0.5rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--tag) 16%, transparent);
  color: color-mix(in srgb, var(--tag) 70%, var(--fb-text));
  font-size: 0.78rem;
  font-weight: 600;
  white-space: nowrap;
}
.dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--tag);
}
.compact {
  padding: 0.05rem 0.5rem 0.05rem 0.4rem;
  font-size: 0.72rem;
}
</style>
