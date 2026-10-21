<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useAppStore } from '@/stores/app';
import { formatDateTime } from '@/utils/format';

import { t } from '@/i18n';
/** Bandeau du message de maintenance, visible de tous (page de connexion comprise). Les messages « information » se ferment. */
const app = useAppStore();
const DISMISS_KEY = 'fb.maintenance.dismissed';
const now = ref(Date.now());
const timer = window.setInterval(() => (now.value = Date.now()), 30_000);
onBeforeUnmount(() => window.clearInterval(timer));

function readDismissed(): string | null {
  try {
    return sessionStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}
const dismissed = ref(readDismissed());

const maintenance = computed(() => {
  const value = app.info.maintenance;
  if (!value || (value.endsAt && Date.parse(value.endsAt) <= now.value)) return null;
  return value;
});
const upcoming = computed(() => Boolean(maintenance.value?.startsAt && Date.parse(maintenance.value.startsAt) > now.value));
const visible = computed(() => maintenance.value !== null && !(maintenance.value.level === 'info' && dismissed.value === maintenance.value.updatedAt));

const ICONS = { info: 'pi pi-info-circle', warning: 'pi pi-exclamation-triangle', danger: 'pi pi-ban' } as const;
const DEFAULT_TITLES = computed(() => ({ info: t('Information'), warning: t('Maintenance en cours'), danger: t('Service interrompu') }));

function dismiss(): void {
  if (!maintenance.value) return;
  dismissed.value = maintenance.value.updatedAt;
  try {
    sessionStorage.setItem(DISMISS_KEY, maintenance.value.updatedAt);
  } catch {
    // Stockage indisponible : le bandeau reviendra au rechargement.
  }
}
</script>

<template>
  <div v-if="visible && maintenance" class="maintenance" :class="maintenance.level" role="status" aria-live="polite">
    <i :class="ICONS[maintenance.level]" class="icon" aria-hidden="true"></i>
    <div class="body">
      <strong>{{ maintenance.title || (upcoming ? $t('Maintenance prévue') : DEFAULT_TITLES[maintenance.level]) }}</strong>
      <span v-if="maintenance.message" class="message">{{ maintenance.message }}</span>
      <span v-if="upcoming || maintenance.endsAt" class="when">
        <template v-if="upcoming">{{ $t('À partir du {date}', { date: formatDateTime(maintenance.startsAt!) }) }}</template>
        <template v-if="maintenance.endsAt"> · {{ $t('Fin prévue : {date}', { date: formatDateTime(maintenance.endsAt) }) }}</template>
      </span>
    </div>
    <button v-if="maintenance.level === 'info'" type="button" class="close" :aria-label="$t('Masquer')" @click="dismiss"><i class="pi pi-times"></i></button>
  </div>
</template>

<style scoped>
.maintenance {
  --tone: #3b82f6;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex: none;
  padding: 0.5rem 1rem;
  background: color-mix(in srgb, var(--tone) 16%, var(--fb-panel));
  border-bottom: 1px solid color-mix(in srgb, var(--tone) 45%, transparent);
  color: var(--fb-text);
  font-size: 0.88rem;
  z-index: 30;
}
.maintenance.warning {
  --tone: #f59e0b;
}
.maintenance.danger {
  --tone: #ef4444;
  background: color-mix(in srgb, var(--tone) 85%, #000);
  color: #fff;
}
.icon {
  color: var(--tone);
  font-size: 1.1rem;
}
.danger .icon {
  color: #fff;
}
.body {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.2rem 0.6rem;
  min-width: 0;
}
.message {
  white-space: pre-line;
}
.when {
  opacity: 0.8;
  font-size: 0.8rem;
}
.close {
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
}
</style>
