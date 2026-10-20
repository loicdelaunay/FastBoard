<script setup lang="ts">
import { computed } from 'vue';
import type { TicketDTO } from '@shared/types';
import { useProjectStore } from '@/stores/project';
import { staleInfo } from '@/utils/stale';

import { t } from '@/i18n';
/**
 * Indicateur d'inactivité (à la manière de Jira) : une rangée de petits points, un de plus à chaque étape, qui
 * montre depuis combien de temps le ticket n'a pas changé de colonne.
 */
const props = defineProps<{ ticket: Pick<TicketDTO, 'status' | 'statusChangedAt'>; compact?: boolean }>();

const DOTS = 5;
const project = useProjectStore();
const info = computed(() => staleInfo(props.ticket, project.settings));
/** Points allumés : de 1 (premier jour) à 5 (deux fois le seuil atteint). */
const lit = computed(() => (info.value ? Math.max(1, Math.ceil(info.value.ratio * DOTS)) : 0));
const label = computed(() => {
  if (!info.value) return '';
  const column = project.statusMeta(props.ticket.status).label;
  return info.value.days === 0
    ? t("Dans « {column} » depuis aujourd'hui", { column })
    : t('Inactif depuis {n} jour dans « {column} »|Inactif depuis {n} jours dans « {column} »', { n: info.value.days, column });
});
</script>

<template>
  <div v-if="info && (!compact || info.days > 0)" v-tooltip.top="compact ? label : undefined" class="stale" :class="[info.level, { compact }]" :aria-label="label" role="img">
    <span class="dots" aria-hidden="true">
      <i v-for="index in DOTS" :key="index" class="dot" :class="{ on: index <= lit }"></i>
    </span>
    <span v-if="!compact" class="text small">{{ label }}</span>
  </div>
</template>

<style scoped>
.stale {
  --tone: var(--fb-muted);
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}
.stale.stale {
  --tone: #f59e0b;
}
.stale.critical {
  --tone: #ef4444;
}
.dots {
  display: inline-flex;
  gap: 3px;
}
.dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--fb-muted) 25%, transparent);
}
.dot.on {
  background: var(--tone);
}
.compact .dot {
  width: 4px;
  height: 4px;
}
.compact.fresh {
  opacity: 0.7;
}
.text {
  color: var(--fb-muted);
}
.stale.stale .text,
.stale.critical .text {
  color: color-mix(in srgb, var(--tone) 75%, var(--fb-text));
  font-weight: 600;
}
</style>
