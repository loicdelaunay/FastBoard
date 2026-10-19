<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import SelectButton from 'primevue/selectbutton';
import Tag from 'primevue/tag';
import ToggleSwitch from 'primevue/toggleswitch';
import { LATENCY_BOUNDS_MS, MONITORING_RANGES, type MonitoringRange, type MonitoringSnapshotDTO } from '@shared/monitoring';
import { api } from '@/api';
import ChartCard from '@/components/analyzer/ChartCard.vue';
import MetricTile from '@/components/admin/MetricTile.vue';
import { useChartColors } from '@/composables/useChartColors';
import { formatDateTime, formatRelative } from '@/utils/format';
import { formatMb, formatMs, formatNumber, formatUptime, pointLabel } from '@/utils/monitoring';
import { notifyError } from '@/utils/notify';
import { matchesQuery } from '@/utils/search';

import { t } from '@/i18n';
import { translateServerMessage } from '@/i18n/server';
const REFRESH_MS = 10_000;
const rangeOptions = (Object.keys(MONITORING_RANGES) as MonitoringRange[]).map((value) => ({ value, label: t(MONITORING_RANGES[value].label) }));

const colors = useChartColors();
const range = ref<MonitoringRange>('1h');
const snapshot = ref<MonitoringSnapshotDTO | null>(null);
const loading = ref(true);
const failed = ref(false);
const auto = ref(true);
const search = ref('');
let timer: number | null = null;
let requestSeq = 0;

async function load(): Promise<void> {
  const seq = ++requestSeq;
  try {
    const result = await api.adminMonitoring(range.value);
    if (seq === requestSeq) {
      snapshot.value = result;
      failed.value = false;
    }
  } catch (error) {
    if (seq === requestSeq) {
      if (!failed.value) {
        notifyError(error, t('Indicateurs indisponibles'));
      }
      failed.value = true;
    }
  } finally {
    loading.value = false;
  }
}

function schedule(): void {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
  if (auto.value) {
    timer = window.setInterval(() => !document.hidden && void load(), REFRESH_MS);
  }
}

onMounted(() => {
  void load();
  schedule();
});
onBeforeUnmount(() => timer !== null && window.clearInterval(timer));
watch(auto, schedule);
watch(range, () => {
  loading.value = true;
  void load();
});

// --- Indicateurs ----------------------------------------------------------------------------------------------------

const overview = computed(() => snapshot.value?.overview);
const summary = computed(() => snapshot.value?.summary);
const rangeLabel = computed(() => t(MONITORING_RANGES[range.value].label).toLowerCase());

const HEALTH = {
  ok: { label: t('Tout va bien'), severity: 'success', icon: 'pi pi-check-circle' },
  degraded: { label: t('Performances dégradées'), severity: 'warn', icon: 'pi pi-exclamation-triangle' },
  critical: { label: t('Situation critique'), severity: 'danger', icon: 'pi pi-times-circle' },
} as const;
const health = computed(() => HEALTH[snapshot.value?.health.status ?? 'ok']);

const errorTone = computed(() => ((summary.value?.errorRate ?? 0) >= 5 ? 'danger' : (summary.value?.errorRate ?? 0) >= 1 ? 'warn' : 'good'));
const latencyTone = computed(() => ((summary.value?.p95Ms ?? 0) >= 2000 ? 'danger' : (summary.value?.p95Ms ?? 0) >= 500 ? 'warn' : 'good'));
const lagTone = computed(() => ((overview.value?.process.lagMs ?? 0) >= 500 ? 'danger' : (overview.value?.process.lagMs ?? 0) >= 100 ? 'warn' : 'good'));

// --- Courbes ----------------------------------------------------------------------------------------------------------

const GREEN = '#22c55e';
const AMBER = '#f59e0b';
const RED = '#ef4444';
const SKY = '#38bdf8';

const points = computed(() => snapshot.value?.series ?? []);
const labels = computed(() => points.value.map((point) => pointLabel(point.t, range.value)));
const noSeries = computed(() => points.value.length === 0);

const line = (label: string, data: number[], color: string, extra: Record<string, unknown> = {}) => ({
  label,
  data,
  borderColor: color,
  backgroundColor: color,
  borderWidth: 2,
  pointRadius: points.value.length > 60 ? 0 : 2,
  pointHoverRadius: 4,
  tension: 0.3,
  ...extra,
});

const baseScales = {
  x: { ticks: { maxTicksLimit: 8, maxRotation: 0 }, grid: { display: false } },
  y: { beginAtZero: true },
};

const trafficData = computed(() => ({
  labels: labels.value,
  datasets: [
    { label: t('Réussies'), data: points.value.map((p) => p.requests - p.errors4xx - p.errors5xx), backgroundColor: GREEN },
    { label: t('Erreurs client (4xx)'), data: points.value.map((p) => p.errors4xx), backgroundColor: AMBER },
    { label: t('Erreurs serveur (5xx)'), data: points.value.map((p) => p.errors5xx), backgroundColor: RED },
  ],
}));
const trafficOptions = { scales: { x: { ...baseScales.x, stacked: true }, y: { beginAtZero: true, stacked: true, ticks: { precision: 0 } } } };

const latencyData = computed(() => ({
  labels: labels.value,
  datasets: [
    line(t('Médiane'), points.value.map((p) => round(p.p50Ms)), SKY),
    line('p95', points.value.map((p) => round(p.p95Ms)), AMBER),
    line('p99', points.value.map((p) => round(p.p99Ms)), RED),
  ],
}));
const latencyOptions = { interaction: { mode: 'index', intersect: false }, scales: { ...baseScales, y: { beginAtZero: true, title: { display: true, text: t('ms') } } } };

const memoryData = computed(() => ({
  labels: labels.value,
  datasets: [
    line(t('Mémoire du processus (RSS)'), points.value.map((p) => round(p.rssMb)), colors.value.accent, { fill: true, backgroundColor: `${colors.value.accent}22` }),
    line(t('Tas JavaScript'), points.value.map((p) => round(p.heapMb)), SKY),
  ],
}));
const memoryOptions = { interaction: { mode: 'index', intersect: false }, scales: { ...baseScales, y: { beginAtZero: true, title: { display: true, text: t('Mo') } } } };

const cpuData = computed(() => ({
  labels: labels.value,
  datasets: [
    line(t('Processeur (% d’un cœur)'), points.value.map((p) => round(p.cpu)), colors.value.accent, { yAxisID: 'y' }),
    line(t('Retard de la boucle (ms)'), points.value.map((p) => round(p.lagMs, 2)), AMBER, { yAxisID: 'y1' }),
  ],
}));
const cpuOptions = {
  interaction: { mode: 'index', intersect: false },
  scales: {
    x: baseScales.x,
    y: { beginAtZero: true, position: 'left', title: { display: true, text: '%' } },
    y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: t('ms') } },
  },
};

const dbData = computed(() => ({
  labels: labels.value,
  datasets: [
    { type: 'bar', label: t('Requêtes SQL'), data: points.value.map((p) => p.dbQueries), backgroundColor: `${colors.value.accent}88`, yAxisID: 'y' },
    line(t('Durée moyenne (ms)'), points.value.map((p) => round(p.dbAvgMs, 3)), AMBER, { type: 'line', yAxisID: 'y1' }),
  ],
}));
const dbOptions = {
  interaction: { mode: 'index', intersect: false },
  scales: {
    x: baseScales.x,
    y: { beginAtZero: true, position: 'left', ticks: { precision: 0 } },
    y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: t('ms') } },
  },
};

const realtimeData = computed(() => ({
  labels: labels.value,
  datasets: [line(t('Connexions WebSocket'), points.value.map((p) => p.wsClients), GREEN, { stepped: true, tension: 0 })],
}));
const realtimeOptions = { scales: { ...baseScales, y: { beginAtZero: true, ticks: { precision: 0 } } } };

const histogramLabels = [...LATENCY_BOUNDS_MS.map((bound) => `≤ ${bound < 1000 ? `${bound} ms` : `${bound / 1000} s`}`), `> ${LATENCY_BOUNDS_MS.at(-1)! / 1000} s`];
const histogramData = computed(() => ({
  labels: histogramLabels,
  datasets: [{ label: t('Requêtes'), data: summary.value?.histogram ?? [], backgroundColor: histogramLabels.map((_, index) => (index >= 9 ? RED : index >= 7 ? AMBER : GREEN)) }],
}));
const histogramOptions = { plugins: { legend: { display: false } }, scales: { x: { ticks: { maxRotation: 0 }, grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } } };

function round(value: number, digits = 1): number {
  return Math.round(value * 10 ** digits) / 10 ** digits;
}

// --- Routes -------------------------------------------------------------------------------------------------------------

const routes = computed(() => (snapshot.value?.routes ?? []).filter((route) => matchesQuery(search.value, [route.route, route.method])));
const METHOD_SEVERITY: Record<string, 'success' | 'info' | 'warn' | 'danger' | 'secondary'> = { GET: 'success', POST: 'info', PATCH: 'warn', PUT: 'warn', DELETE: 'danger' };
const slowTone = (ms: number): string => (ms >= 1000 ? 'bad' : ms >= 300 ? 'warn' : '');

const tables = computed(() => overview.value?.database.tables ?? []);
const memoryRatio = computed(() => {
  const system = overview.value?.system;
  return system ? Math.round(((system.totalMemMb - system.freeMemMb) / system.totalMemMb) * 100) : 0;
});
</script>

<template>
  <div class="page perf">
    <header class="head">
      <div>
        <h1 class="page-title">{{ $t('Performances') }}</h1>
        <p class="muted">{{ $t('Trafic, latences, ressources du serveur et base de données — {rangeLabel} glissantes.', { rangeLabel }) }}</p>
      </div>
      <div class="controls">
        <SelectButton v-model="range" :options="rangeOptions" option-label="label" option-value="value" :allow-empty="false" :aria-label="$t('Période')" />
        <label class="row" :title="$t('Rafraîchit toutes les 10 secondes')"><ToggleSwitch v-model="auto" /><span class="small">{{ $t('Auto') }}</span></label>
        <Button icon="pi pi-refresh" severity="secondary" text rounded :aria-label="$t('Actualiser')" :loading="loading" @click="load" />
      </div>
    </header>

    <p v-if="loading && !snapshot" class="muted"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</p>
    <p v-else-if="!snapshot" class="muted">{{ $t('Les indicateurs sont indisponibles.') }} <a href="#" @click.prevent="load">{{ $t('Réessayer') }}</a></p>

    <template v-else-if="overview && summary">
      <div class="health card" :class="`health-${snapshot.health.status}`" role="status">
        <i :class="health.icon" aria-hidden="true"></i>
        <div class="health-text">
          <strong>{{ health.label }}</strong>
          <span v-if="snapshot.health.reasons.length" class="small">{{ snapshot.health.reasons.map(translateServerMessage).join(' · ') }}</span>
          <span v-else class="small muted">{{ $t('Latences, erreurs et boucle d\'évènements dans les normes sur les 15 dernières minutes.') }}</span>
        </div>
        <span class="muted small updated" :title="formatDateTime(snapshot.generatedAt)">{{ $t('Mis à jour {value}', { value: formatRelative(snapshot.generatedAt) }) }}</span>
      </div>

      <div class="tiles">
        <MetricTile :label="$t('Requêtes')" icon="pi pi-send" :value="formatNumber(summary.requests)" :hint="$t('{value} / min', { value: formatNumber(summary.requestsPerMinute, 1) })" />
        <MetricTile :label="$t('Erreurs serveur')" icon="pi pi-exclamation-circle" :value="`${formatNumber(summary.errorRate, 1)} %`" :hint="$t('{errors5xx} en 5xx · {errors4xx} en 4xx', { errors5xx: formatNumber(summary.errors5xx), errors4xx: formatNumber(summary.errors4xx) })" :tone="errorTone" />
        <MetricTile :label="$t('Latence p95')" icon="pi pi-stopwatch" :value="formatMs(summary.p95Ms)" :hint="$t('médiane {value} · max {value2}', { value: formatMs(summary.p50Ms), value2: formatMs(summary.maxMs) })" :tone="latencyTone" />
        <MetricTile :label="$t('Mémoire du processus')" icon="pi pi-server" :value="formatMb(overview.process.rssMb)" :hint="$t('tas {value} / {value2}', { value: formatMb(overview.process.heapUsedMb), value2: formatMb(overview.process.heapTotalMb) })" />
        <MetricTile :label="$t('Processeur')" icon="pi pi-microchip" :value="`${formatNumber(overview.process.cpuPercent, 1)} %`" :hint="$t('{cpuCount} cœurs', { cpuCount: overview.cpuCount })" />
        <MetricTile :label="$t('Boucle d\'évènements')" icon="pi pi-sync" :value="formatMs(overview.process.lagMs)" :hint="$t('retard p99 (5 dernières s)')" :tone="lagTone" />
        <MetricTile :label="$t('Temps réel')" icon="pi pi-bolt" :value="`${overview.realtime.clients}`" :hint="$t('{n} personne en ligne|{n} personnes en ligne', { n: overview.realtime.usersOnline })" />
        <MetricTile :label="$t('Disponibilité')" icon="pi pi-clock" :value="formatUptime(overview.uptimeSeconds)" :hint="$t('depuis le {value}', { value: formatDateTime(overview.startedAt) })" />
      </div>

      <div class="charts">
        <ChartCard :title="$t('Trafic')" :subtitle="$t('{value} requêtes', { value: formatNumber(summary.requests) })" type="bar" :data="trafficData" :options="trafficOptions" :empty="noSeries" :height="230" />
        <ChartCard :title="$t('Latence des réponses')" :subtitle="$t('médiane, p95, p99')" type="line" :data="latencyData" :options="latencyOptions" :empty="noSeries" :height="230" />
        <ChartCard :title="$t('Mémoire')" type="line" :data="memoryData" :options="memoryOptions" :empty="noSeries" :height="230" />
        <ChartCard :title="$t('Processeur et boucle d\'évènements')" type="line" :data="cpuData" :options="cpuOptions" :empty="noSeries" :height="230" />
        <ChartCard :title="$t('Base de données')" :subtitle="$t('requêtes SQL et durée moyenne')" type="bar" :data="dbData" :options="dbOptions" :empty="noSeries" :height="230" />
        <ChartCard :title="$t('Connexions temps réel')" :subtitle="$t('WebSocket')" type="line" :data="realtimeData" :options="realtimeOptions" :empty="noSeries" :height="230" />
        <ChartCard class="wide" :title="$t('Répartition des latences')" :subtitle="$t('{value} requêtes sur {rangeLabel}', { value: formatNumber(summary.requests), rangeLabel })" type="bar" :data="histogramData" :options="histogramOptions" :empty="summary.requests === 0" :height="210" />
      </div>

      <section class="card block">
        <header class="block-head">
          <h2 class="block-title">{{ $t('Routes de l\'API') }}</h2>
          <IconField class="search">
            <InputIcon class="pi pi-search" />
            <InputText v-model="search" :placeholder="$t('Filtrer une route…')" fluid />
          </IconField>
        </header>
        <DataTable :value="routes" size="small" data-key="route" sort-field="count" :sort-order="-1" paginator :rows="10" :rows-per-page-options="[10, 25, 50]" striped-rows removable-sort>
          <template #empty><span class="muted">{{ $t('Aucune requête sur cette période.') }}</span></template>
          <Column field="route" :header="$t('Route')" sortable>
            <template #body="{ data }">
              <Tag :value="data.method" :severity="METHOD_SEVERITY[data.method] ?? 'secondary'" class="method" />
              <code class="route">{{ translateServerMessage(data.route) }}</code>
            </template>
          </Column>
          <Column field="count" :header="$t('Appels')" sortable class="num"><template #body="{ data }">{{ formatNumber(data.count) }}</template></Column>
          <Column field="errors" :header="$t('Erreurs 5xx')" sortable class="num"><template #body="{ data }"><span :class="{ bad: data.errors > 0 }">{{ formatNumber(data.errors) }}</span></template></Column>
          <Column field="avgMs" :header="$t('Moyenne')" sortable class="num"><template #body="{ data }"><span :class="slowTone(data.avgMs)">{{ formatMs(data.avgMs) }}</span></template></Column>
          <Column field="p95Ms" header="p95" sortable class="num"><template #body="{ data }"><span :class="slowTone(data.p95Ms)">{{ formatMs(data.p95Ms) }}</span></template></Column>
          <Column field="maxMs" :header="$t('Max')" sortable class="num"><template #body="{ data }"><span :class="slowTone(data.maxMs)">{{ formatMs(data.maxMs) }}</span></template></Column>
        </DataTable>
      </section>

      <div class="info-grid">
        <section class="card block">
          <h2 class="block-title">{{ $t('Serveur') }}</h2>
          <dl class="kv">
            <div><dt>{{ $t('Node.js') }}</dt><dd>{{ overview.nodeVersion }}</dd></div>
            <div><dt>{{ $t('Système') }}</dt><dd>{{ overview.platform }}</dd></div>
            <div><dt>{{ $t('Processus') }}</dt><dd>{{ $t('PID {pid}', { pid: overview.pid }) }}</dd></div>
            <div><dt>{{ $t('Mémoire externe') }}</dt><dd>{{ formatMb(overview.process.externalMb) }}</dd></div>
            <div><dt>{{ $t('Mémoire machine') }}</dt><dd>{{ formatMb(overview.system.totalMemMb - overview.system.freeMemMb) }} / {{ formatMb(overview.system.totalMemMb) }} ({{ memoryRatio }} %)</dd></div>
            <div v-if="overview.system.loadAverage.some((value) => value > 0)"><dt>{{ $t('Charge (1 / 5 / 15 min)') }}</dt><dd>{{ overview.system.loadAverage.join(' · ') }}</dd></div>
            <div><dt>{{ $t('Journaux (24 h)') }}</dt><dd><router-link :to="{ name: 'admin-logs' }">{{ $t('{n} erreur|{n} erreurs', { n: overview.logs.errors24h }) }} · {{ $t('{n} alerte|{n} alertes', { n: overview.logs.warnings24h }) }}</router-link></dd></div>
          </dl>
        </section>

        <section class="card block">
          <h2 class="block-title">{{ $t('Base de données SQLite') }}</h2>
          <dl class="kv">
            <div><dt>{{ $t('Fichier') }}</dt><dd>{{ formatMb(overview.database.fileMb) }}</dd></div>
            <div><dt>{{ $t('Journal WAL') }}</dt><dd>{{ formatMb(overview.database.walMb) }}</dd></div>
            <div><dt>{{ $t('Requêtes depuis le démarrage') }}</dt><dd>{{ formatNumber(overview.database.queries) }}</dd></div>
            <div><dt>{{ $t('Durée moyenne') }}</dt><dd>{{ formatMs(overview.database.avgQueryMs) }}</dd></div>
            <div><dt>{{ $t('Requêtes lentes (≥ 100 ms)') }}</dt><dd :class="{ bad: overview.database.slowQueries > 0 }">{{ overview.database.slowQueries }}</dd></div>
            <div><dt>{{ $t('Pièces jointes') }}</dt><dd>{{ $t('{n} fichier · {value}|{n} fichiers · {value}', { n: overview.storage.attachments, value: formatMb(overview.storage.attachmentsMb) }) }}</dd></div>
          </dl>
        </section>

        <section class="card block">
          <h2 class="block-title">{{ $t('Contenu') }}</h2>
          <dl class="kv">
            <div v-for="table in tables" :key="table.name"><dt>{{ $t(table.name) }}</dt><dd>{{ formatNumber(table.rows) }}</dd></div>
          </dl>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.perf {
  max-width: 1280px;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem 1.5rem;
}
.controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
}
.health {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.8rem 1rem;
  border-left: 4px solid var(--fb-border);
}
.health > i {
  font-size: 1.4rem;
}
.health-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.health-ok {
  border-left-color: #22c55e;
}
.health-ok > i {
  color: #22c55e;
}
.health-degraded {
  border-left-color: #f59e0b;
}
.health-degraded > i {
  color: #d97706;
}
.health-critical {
  border-left-color: var(--fb-danger);
}
.health-critical > i {
  color: var(--fb-danger);
}
.updated {
  white-space: nowrap;
}
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
  gap: 0.75rem;
}
.charts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 26rem), 1fr));
  gap: 0.75rem;
}
.charts .wide {
  grid-column: 1 / -1;
}
.block {
  padding: 1rem 1.1rem;
  min-width: 0;
}
.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}
.block-title {
  margin: 0 0 0.6rem;
  font-size: 1rem;
  font-weight: 700;
}
.block-head .block-title {
  margin: 0;
}
.search {
  width: min(100%, 18rem);
}
.method {
  min-width: 4.2rem;
  margin-right: 0.5rem;
  font-size: 0.68rem;
}
.route {
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}
:deep(.num) {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
:deep(.p-datatable-column-header-content) {
  white-space: nowrap;
}
.bad {
  color: var(--fb-danger);
  font-weight: 700;
}
.warn {
  color: #d97706;
  font-weight: 600;
}
.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
  gap: 0.75rem;
}
.kv {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0;
  font-size: 0.88rem;
}
.kv > div {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 0.4rem;
  border-bottom: 1px solid var(--fb-border);
}
.kv > div:last-child {
  border-bottom: 0;
}
.kv dt {
  color: var(--fb-muted);
}
.kv dd {
  margin: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
