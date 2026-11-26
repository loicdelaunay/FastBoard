<script setup lang="ts">
import { computed } from 'vue';
import { pinned, pinnedEntry, pinTag, type PinKind } from '@/offline/pinned';
import { formatRelative } from '@/utils/format';
import { t } from '@/i18n';

/** Pastille d'un espace gardé hors ligne : copie à jour (et de quand), en cours, ou en échec. */
const props = defineProps<{ kind: PinKind; id: number }>();

const entry = computed(() => pinnedEntry(props.kind, props.id));
const syncing = computed(() => pinned.syncing === pinTag(props.kind, props.id));
const tip = computed(() => {
  const current = entry.value;
  if (!current) return '';
  if (syncing.value) return t('Copie hors ligne en cours… {done} / {total}', { done: pinned.progress.done, total: pinned.progress.total });
  if (current.failed) return t('Gardé hors ligne, mais la dernière copie a échoué : elle sera retentée.');
  if (!current.syncedAt) return t('Gardé hors ligne : la copie va commencer.');
  return t('Disponible hors ligne · copie {when} ({count}), actualisée toutes les heures', { when: formatRelative(current.syncedAt), count: t('{n} élément|{n} éléments', { n: current.items }) });
});
</script>

<template>
  <span v-if="entry" v-tooltip.top="{ value: tip, showDelay: 150 }" class="offline-pin" :class="{ failed: entry.failed && !syncing }" role="img" :aria-label="tip" tabindex="0" @click.stop>
    <i :class="syncing ? 'pi pi-spin pi-sync' : entry.failed ? 'pi pi-exclamation-triangle' : 'pi pi-cloud-download'"></i>
  </span>
</template>

<style scoped>
.offline-pin {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 999px;
  background: color-mix(in srgb, #0ea5e9 14%, transparent);
  color: #0284c7;
  font-size: 0.8rem;
  cursor: help;
}
.offline-pin.failed {
  background: color-mix(in srgb, #f59e0b 16%, transparent);
  color: #b45309;
}
:global(.app-dark) .offline-pin {
  color: #38bdf8;
}
</style>
