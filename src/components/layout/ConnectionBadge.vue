<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@/i18n';
import { realtime } from '@/realtime/socket';

const state = computed(() => realtime.state.value);
const label = computed(() => {
  switch (state.value) {
    case 'open':
      return t('En direct');
    case 'connecting':
      return t('Connexion…');
    case 'reconnecting':
      return t('Reconnexion…');
    default:
      return t('Hors ligne');
  }
});
</script>

<template>
  <span v-tooltip.bottom="$t('Synchronisation temps réel (WebSocket)')" class="conn" :class="`conn-${state}`">
    <i class="dot"></i>
    <span class="text">{{ label }}</span>
  </span>
</template>

<style scoped>
.conn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--fb-muted);
  background: var(--fb-panel-alt);
  white-space: nowrap;
}
.dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: #94a3b8;
}
.conn-open {
  color: #15803d;
  background: color-mix(in srgb, #22c55e 14%, transparent);
}
:root.app-dark .conn-open {
  color: #4ade80;
}
.conn-open .dot {
  background: #22c55e;
  box-shadow: 0 0 0 0 rgb(34 197 94 / 60%);
  animation: pulse 2.4s infinite;
}
.conn-connecting .dot,
.conn-reconnecting .dot {
  background: #f59e0b;
}
@keyframes pulse {
  70% {
    box-shadow: 0 0 0 6px rgb(34 197 94 / 0%);
  }
  100% {
    box-shadow: 0 0 0 0 rgb(34 197 94 / 0%);
  }
}
@media (max-width: 640px) {
  .text {
    display: none;
  }
}
</style>
