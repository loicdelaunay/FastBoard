<script setup lang="ts">
import { computed } from 'vue';
import type { TicketStatus } from '@shared/constants';
import type { TicketDTO } from '@shared/types';

import { t } from '@/i18n';
const props = defineProps<{
  total: number;
  progress: number;
  byStatus: Record<TicketStatus, number>;
  overdue: TicketDTO[];
  unassigned: TicketDTO[];
}>();

const cards = computed(() => [
  { key: 'progress', label: t('Avancement global'), value: `${props.progress} %`, icon: 'pi pi-percentage', tone: 'accent' },
  { key: 'total', label: t('Tickets'), value: String(props.total), icon: 'pi pi-ticket', tone: 'neutral' },
  { key: 'done', label: t('Terminés'), value: `${props.byStatus.done}`, hint: props.total ? `${Math.round((props.byStatus.done / props.total) * 100)} %` : '', icon: 'pi pi-check-circle', tone: 'good' },
  { key: 'active', label: t('En cours'), value: String(props.byStatus.in_progress + props.byStatus.review), icon: 'pi pi-spinner', tone: 'accent' },
  { key: 'blocked', label: t('Bloqués'), value: String(props.byStatus.blocked), icon: 'pi pi-ban', tone: props.byStatus.blocked ? 'bad' : 'neutral' },
  { key: 'overdue', label: t('En retard'), value: String(props.overdue.length), icon: 'pi pi-clock', tone: props.overdue.length ? 'bad' : 'neutral' },
  { key: 'unassigned', label: t('Sans responsable'), value: String(props.unassigned.length), icon: 'pi pi-user-minus', tone: props.unassigned.length ? 'warn' : 'neutral' },
]);
</script>

<template>
  <div class="kpis">
    <article v-for="card in cards" :key="card.key" class="kpi card" :class="`tone-${card.tone}`">
      <i :class="card.icon" class="icon"></i>
      <div>
        <p class="value">{{ card.value }} <small v-if="card.hint" class="hint">{{ card.hint }}</small></p>
        <p class="label muted small">{{ card.label }}</p>
      </div>
    </article>
  </div>
</template>

<style scoped>
.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10.5rem, 1fr));
  gap: 0.75rem;
}
.kpi {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  padding: 0.85rem 1rem;
}
.icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 10px;
  background: color-mix(in srgb, var(--tone) 14%, transparent);
  color: var(--tone);
  font-size: 1.05rem;
}
.value {
  margin: 0;
  font-size: 1.45rem;
  font-weight: 800;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.hint {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--fb-muted);
}
.label {
  margin: 0;
}
.tone-accent {
  --tone: var(--p-primary-color);
}
.tone-neutral {
  --tone: var(--p-text-muted-color);
}
.tone-good {
  --tone: #22c55e;
}
.tone-bad {
  --tone: #ef4444;
}
.tone-warn {
  --tone: #f59e0b;
}
</style>
