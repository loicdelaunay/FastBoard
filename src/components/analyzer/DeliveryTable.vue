<script setup lang="ts">
import { computed } from 'vue';
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import { diffDays, formatDateShort, todayISO } from '@shared/dates';
import { ticketProgress } from '@shared/progress';
import ProgressMeter from '@/components/common/ProgressMeter.vue';
import { usePdfExport } from '@/composables/usePdfExport';
import { useProjectStore } from '@/stores/project';
import { isOverdue } from '@/utils/tickets';

defineProps<{ activeId: number | 'all' }>();
const emit = defineEmits<{ select: [deliveryId: number] }>();

const project = useProjectStore();
const pdf = usePdfExport();
const today = todayISO();

const rows = computed(() =>
  project.deliveries.map((delivery) => {
    const tickets = project.tickets.filter((ticket) => ticket.deliveryId === delivery.id);
    const progress = tickets.length ? Math.round(tickets.reduce((sum, ticket) => sum + ticketProgress(ticket), 0) / tickets.length) : 0;
    const total = diffDays(delivery.startDate, delivery.endDate) + 1;
    const theoretical = Math.min(100, Math.max(0, Math.round(((diffDays(delivery.startDate, today) + 1) / total) * 100)));
    return {
      id: delivery.id,
      name: delivery.name,
      color: delivery.color,
      period: `${formatDateShort(delivery.startDate)} → ${formatDateShort(delivery.endDate, true)}`,
      count: tickets.length,
      done: tickets.filter((ticket) => ticket.status === 'done').length,
      late: tickets.filter((ticket) => isOverdue(ticket, delivery, today)).length,
      progress,
      theoretical,
      gap: tickets.length ? progress - theoretical : null,
    };
  }),
);
</script>

<template>
  <section class="table card">
    <header class="head"><h3 class="title">{{ $t('Livraisons') }}</h3></header>
    <DataTable :value="rows" data-key="id" size="small" row-hover :row-class="(row: { id: number }) => (row.id === activeId ? 'active-row' : '')" @row-click="(event) => emit('select', event.data.id)">
      <template #empty><p class="muted">{{ $t('Aucune livraison. Créez-en dans les réglages du projet.') }}</p></template>
      <Column :header="$t('Livraison')" style="min-width: 10rem">
        <template #body="{ data }"><span class="name"><i class="dot" :style="{ background: data.color }"></i>{{ data.name }}</span></template>
      </Column>
      <Column field="period" :header="$t('Période')" style="min-width: 11rem" />
      <Column :header="$t('Tickets')" style="width: 8rem">
        <template #body="{ data }">{{ data.done }} / {{ data.count }}</template>
      </Column>
      <Column :header="$t('Réel / théorique')" style="min-width: 12rem">
        <template #body="{ data }"><ProgressMeter :value="data.progress" :marker="data.theoretical" /></template>
      </Column>
      <Column :header="$t('Écart')" style="width: 6rem">
        <template #body="{ data }">
          <span v-if="data.gap !== null" :class="data.gap >= 0 ? 'good' : data.gap > -10 ? 'warn' : 'bad'">{{ $t('{gap} pts', { gap: (data.gap > 0 ? '+' : '') + data.gap }) }}</span>
        </template>
      </Column>
      <Column :header="$t('PDF')" style="width: 5rem">
        <template #body="{ data }">
          <Button
            icon="pi pi-file-pdf"
            text
            rounded
            size="small"
            severity="secondary"
            :loading="pdf.busy.value === data.id"
            :disabled="pdf.busy.value !== null || data.count === 0"
            :aria-label="$t('Exporter « {name} » en PDF', { name: data.name })"
            @click.stop="pdf.exportScope(data.id)"
          />
        </template>
      </Column>
      <Column :header="$t('En retard')" style="width: 6rem">
        <template #body="{ data }"><span :class="{ bad: data.late }">{{ data.late || '—' }}</span></template>
      </Column>
    </DataTable>
  </section>
</template>

<style scoped>
.table {
  padding: 1rem 1.1rem;
}
.head {
  margin-bottom: 0.6rem;
}
.title {
  font-size: 0.95rem;
  font-weight: 700;
}
.name {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
}
.dot {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 3px;
}
.good {
  color: #16a34a;
  font-weight: 700;
}
.warn {
  color: #d97706;
  font-weight: 700;
}
.bad {
  color: #dc2626;
  font-weight: 700;
}
.table :deep(tbody tr) {
  cursor: pointer;
}
.table :deep(tr.active-row) {
  background: var(--fb-accent-soft);
}
</style>
