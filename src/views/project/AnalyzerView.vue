<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Select from 'primevue/select';
import Button from 'primevue/button';
import { formatDateShort, todayISO } from '@shared/dates';
import AlertList from '@/components/analyzer/AlertList.vue';
import ChartCard from '@/components/analyzer/ChartCard.vue';
import DeliveryTable from '@/components/analyzer/DeliveryTable.vue';
import KpiCards from '@/components/analyzer/KpiCards.vue';
import PriorityList from '@/components/analyzer/PriorityList.vue';
import ScheduleCard from '@/components/analyzer/ScheduleCard.vue';
import { useAnalysis, type AnalysisScope } from '@/composables/useAnalysis';
import { usePdfExport } from '@/composables/usePdfExport';
import { useChartColors } from '@/composables/useChartColors';
import { useTicketRoute } from '@/composables/useTicketRoute';
import { useProjectStore } from '@/stores/project';
import { useUiStore } from '@/stores/ui';

import { t } from '@/i18n';
const project = useProjectStore();
const ui = useUiStore();
const colors = useChartColors();
const { openTicket } = useTicketRoute();

const scope = ref<AnalysisScope>('all');
const pdf = usePdfExport();
const analysis = useAnalysis(scope);

// Si la livraison affichée disparaît (supprimée par un collègue), on revient à la vue globale.
watch(
  () => project.deliveries.map((delivery) => delivery.id),
  (ids) => {
    if (scope.value !== 'all' && !ids.includes(scope.value)) {
      scope.value = 'all';
    }
  },
);

const scopeOptions = computed(() => [
  { label: t('Toutes les livraisons'), value: 'all' as AnalysisScope, color: null as string | null, dates: '' },
  ...project.deliveries.map((delivery) => ({
    label: delivery.name,
    value: delivery.id as AnalysisScope,
    color: delivery.color as string | null,
    dates: `${formatDateShort(delivery.startDate)} → ${formatDateShort(delivery.endDate)}`,
  })),
]);

/**
 * Livraison en cours (aujourd'hui dans sa période ; la première à finir s'il y en a plusieurs), à défaut la prochaine :
 * raccourci à côté du choix de la version analysée.
 */
const currentDelivery = computed(() => {
  const today = todayISO();
  const running = project.deliveries.filter((delivery) => delivery.startDate <= today && today <= delivery.endDate).sort((a, b) => a.endDate.localeCompare(b.endDate))[0];
  if (running) return { delivery: running, upcoming: false };
  const next = project.deliveries.filter((delivery) => delivery.startDate > today).sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  return next ? { delivery: next, upcoming: true } : null;
});

const scopeTitle = computed(() => (analysis.delivery.value ? t('Livraison « {name} »', { name: analysis.delivery.value.name }) : t('Ensemble du projet')));
const hasTickets = computed(() => analysis.tickets.value.length > 0);

const statusData = computed(() => ({
  labels: project.visibleColumns.map((column) => column.label),
  datasets: [
    {
      data: project.visibleColumns.map((column) => analysis.byStatus.value[column.status]),
      backgroundColor: project.visibleColumns.map((column) => column.color),
      borderColor: colors.value.panel,
      borderWidth: 2,
    },
  ],
}));
const statusOptions = { cutout: '62%', plugins: { legend: { position: 'right' } } };

const burndownData = computed(() => {
  const series = analysis.burndown.value;
  return {
    labels: series.labels,
    datasets: [
      { label: t('Idéal'), data: series.ideal, borderColor: colors.value.muted, borderDash: [6, 6], borderWidth: 2, pointRadius: 0, tension: 0 },
      { label: t('Réel'), data: series.actual, borderColor: colors.value.accent, backgroundColor: `${colors.value.accent}22`, fill: true, borderWidth: 3, pointRadius: 0, stepped: 'before', spanGaps: false },
      // « À tester » compté comme fait : l'écart avec la courbe réelle montre ce qui attend la recette.
      ...(series.hasReview
        ? [{ label: t('Réel, « {column} » compris', { column: project.statusMeta('review').label }), data: series.withReview, borderColor: '#f97316', backgroundColor: '#f9731618', fill: false, borderWidth: 2, borderDash: [4, 3], pointRadius: 0, stepped: 'before', spanGaps: false }]
        : []),
    ],
  };
});
const burndownOptions = computed(() => ({
  interaction: { mode: 'index', intersect: false },
  plugins: { legend: { position: 'bottom' } },
  scales: {
    x: { ticks: { maxTicksLimit: 8, autoSkip: true, callback: (_value: unknown, index: number) => formatDateShort(analysis.burndown.value.labels[index]) } },
    y: { beginAtZero: true, title: { display: true, text: t('Tickets restants'), color: colors.value.muted }, ticks: { precision: 0 } },
  },
}));

const workloadData = computed(() => ({
  labels: analysis.workload.value.map((row) => row.label),
  // Une série par colonne du Kanban (nom et couleur du projet), dans l'ordre du tableau.
  datasets: project.visibleColumns.map((column) => ({ label: column.label, data: analysis.workload.value.map((row) => row.byStatus[column.status]), backgroundColor: column.color })),
}));
const workloadOptions = {
  indexAxis: 'y',
  plugins: { legend: { position: 'bottom' } },
  scales: { x: { stacked: true, ticks: { precision: 0 } }, y: { stacked: true, grid: { display: false } } },
};
const workloadHeight = computed(() => Math.max(190, analysis.workload.value.length * 38 + 70));

const categoryData = computed(() => ({
  labels: analysis.byCategory.value.map((entry) => entry.name),
  datasets: [{ label: t('Tickets'), data: analysis.byCategory.value.map((entry) => entry.count), backgroundColor: analysis.byCategory.value.map((entry) => entry.color), borderRadius: 6 }],
}));
const categoryOptions = {
  indexAxis: 'y',
  plugins: { legend: { display: false } },
  scales: { x: { ticks: { precision: 0 }, beginAtZero: true }, y: { grid: { display: false } } },
};
</script>

<template>
  <div class="analyzer">
    <div class="scroll">
      <div class="inner">
        <div class="scope-bar">
          <label class="scope-field">
            <span class="muted small">{{ $t('Version analysée') }}</span>
            <Select v-model="scope" :options="scopeOptions" option-label="label" option-value="value" filter :filter-placeholder="$t('Rechercher une livraison')" class="scopes" :aria-label="$t('Périmètre de l\'analyse')">
              <template #value="{ value }">
                <span class="scope-option">
                  <i class="pi" :class="value === 'all' ? 'pi-th-large' : 'pi-truck'" :style="{ color: scopeOptions.find((o) => o.value === value)?.color ?? undefined }"></i>
                  <strong>{{ scopeOptions.find((o) => o.value === value)?.label }}</strong>
                  <span v-if="scopeOptions.find((o) => o.value === value)?.dates" class="muted small">{{ scopeOptions.find((o) => o.value === value)?.dates }}</span>
                </span>
              </template>
              <template #option="{ option }">
                <span class="scope-option">
                  <i class="pi" :class="option.value === 'all' ? 'pi-th-large' : 'pi-truck'" :style="{ color: option.color ?? undefined }"></i>
                  <span>{{ option.label }}</span>
                  <span v-if="option.dates" class="muted small">{{ option.dates }}</span>
                </span>
              </template>
            </Select>
          </label>
          <button
            v-if="currentDelivery"
            type="button"
            class="current-delivery"
            :class="{ active: scope === currentDelivery.delivery.id }"
            :style="{ '--d': currentDelivery.delivery.color }"
            :aria-pressed="scope === currentDelivery.delivery.id"
            v-tooltip.bottom="`${formatDateShort(currentDelivery.delivery.startDate)} → ${formatDateShort(currentDelivery.delivery.endDate)}`"
            @click="scope = scope === currentDelivery.delivery.id ? 'all' : currentDelivery.delivery.id"
          >
            <i class="pi pi-truck"></i>
            <span class="muted">{{ currentDelivery.upcoming ? $t('Prochaine version') : $t('Version en cours') }}</span>
            <strong>{{ currentDelivery.delivery.name }}</strong>
            <i v-if="scope === currentDelivery.delivery.id" class="pi pi-times close"></i>
          </button>
          <Button
            v-if="project.tickets.length"
            class="pdf-button"
            :label="$t('Exporter en PDF')"
            icon="pi pi-file-pdf"
            severity="secondary"
            outlined
            size="small"
            :loading="pdf.busy.value === scope"
            :disabled="pdf.busy.value !== null"
            @click="pdf.exportScope(scope)"
          />
        </div>

        <div v-if="!project.tickets.length" class="empty card">
          <i class="pi pi-chart-bar icon"></i>
          <h3>{{ $t('Rien à analyser pour l\'instant') }}</h3>
          <p class="muted">{{ $t('Créez des tickets et des livraisons pour suivre l\'avancement du projet.') }}</p>
          <Button v-if="project.can('ticket.create') && !project.archived" :label="$t('Créer un ticket')" icon="pi pi-plus" @click="ui.openCreate()" />
        </div>

        <template v-else>
          <KpiCards :total="analysis.tickets.value.length" :progress="analysis.progress.value" :by-status="analysis.byStatus.value" :overdue="analysis.overdue.value" :unassigned="analysis.unassigned.value" />

          <ScheduleCard :title="scopeTitle" :period="analysis.period.value" :today="analysis.today" :progress="analysis.progress.value" :theoretical="analysis.theoretical.value" :gap="analysis.gap.value" :days-left="analysis.daysLeft.value" />

          <div v-if="hasTickets" class="charts">
            <ChartCard :title="$t('Répartition par statut')" type="doughnut" :data="statusData" :options="statusOptions" :height="240" />
            <ChartCard :title="$t('Reste à faire')" :subtitle="$t('burn-down en nombre de tickets')" type="line" :data="burndownData" :options="burndownOptions" :height="240" />
            <ChartCard :title="$t('Charge par personne')" type="bar" :data="workloadData" :options="workloadOptions" :height="workloadHeight" />
            <ChartCard :title="$t('Tickets par catégorie')" type="bar" :data="categoryData" :options="categoryOptions" :height="workloadHeight" :empty="!analysis.byCategory.value.length" />
          </div>
          <p v-else class="muted center">{{ $t('Aucun ticket n\'est rattaché à cette livraison.') }}</p>

          <div class="duo">
            <AlertList :alerts="analysis.alerts.value" @open="openTicket" />
            <PriorityList :items="analysis.priorities.value" @open="openTicket" />
          </div>

          <DeliveryTable v-if="project.deliveries.length" :active-id="scope" @select="(id) => (scope = id)" />
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.analyzer {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.inner {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
  padding: 1rem 1rem 3rem;
}
.scope-bar {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
}
.scope-field {
  display: flex;
  flex: 0 1 auto;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
}
.scopes {
  width: 20rem;
  max-width: 100%;
}
.current-delivery {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.75rem;
  border: 1px solid color-mix(in srgb, var(--d) 45%, var(--fb-border));
  border-radius: 999px;
  background: color-mix(in srgb, var(--d) 8%, transparent);
  color: var(--fb-text);
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.current-delivery i {
  color: var(--d);
}
.current-delivery:hover {
  background: color-mix(in srgb, var(--d) 16%, transparent);
}
.current-delivery.active {
  border-color: var(--d);
  background: color-mix(in srgb, var(--d) 22%, transparent);
}
.current-delivery .close {
  font-size: 0.65rem;
  color: var(--fb-muted);
}
.pdf-button {
  margin-left: auto;
}
.scope-option {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.charts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 28rem), 1fr));
  gap: 1rem;
}
.duo {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 28rem), 1fr));
  gap: 1rem;
  align-items: start;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  padding: 3rem 1rem;
  text-align: center;
}
.icon {
  font-size: 2.5rem;
  color: var(--fb-muted);
}
.center {
  text-align: center;
}
</style>
