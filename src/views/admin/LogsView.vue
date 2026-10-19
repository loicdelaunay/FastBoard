<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import MultiSelect from 'primevue/multiselect';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import ToggleSwitch from 'primevue/toggleswitch';
import { LOG_LEVEL_META, LOG_LEVELS, LOG_SOURCES, type LogEntryDTO, type LogLevel } from '@shared/monitoring';
import { api, logQuery, type LogFilters } from '@/api';
import { copyText } from '@/utils/clipboard';
import { formatDateTime } from '@/utils/format';
import { logDay, logTime } from '@/utils/monitoring';
import { notify, notifyError } from '@/utils/notify';

import { t } from '@/i18n';
const PAGE = 100;
const LIVE_MS = 2500;

const SOURCE_LABELS: Record<string, string> = {
  system: t('Système'),
  http: 'HTTP',
  auth: t('Authentification'),
  admin: t('Administration'),
  project: t('Projets'),
  storage: t('Pièces jointes'),
  db: t('Base de données'),
  realtime: t('Temps réel'),
};
const sourceOptions = LOG_SOURCES.map((value) => ({ value, label: SOURCE_LABELS[value] ?? value }));
const periodOptions = [
  { value: '1h', label: t('Dernière heure') },
  { value: '24h', label: t('Dernières 24 h') },
  { value: '7d', label: t('7 derniers jours') },
  { value: 'all', label: t('Tout (14 jours)') },
];
const PERIOD_MS: Record<string, number> = { '1h': 3_600_000, '24h': 86_400_000, '7d': 7 * 86_400_000 };

const filters = reactive({
  levels: [] as LogLevel[],
  sources: [] as string[],
  q: '',
  period: '24h',
  requestId: '',
});
const logs = ref<LogEntryDTO[]>([]);
const nextBefore = ref<number | null>(null);
const loading = ref(true);
const loadingMore = ref(false);
const live = ref(false);
const expanded = ref<Record<number, boolean>>({});
let seq = 0;
let liveTimer: number | null = null;
let debounce: number | null = null;

function currentFilters(extra: Partial<LogFilters> = {}): LogFilters {
  const since = PERIOD_MS[filters.period];
  return {
    levels: filters.levels,
    sources: filters.sources,
    q: filters.q.trim() || undefined,
    requestId: filters.requestId || undefined,
    since: since ? new Date(Date.now() - since).toISOString() : undefined,
    limit: PAGE,
    ...extra,
  };
}

async function load(): Promise<void> {
  const mine = ++seq;
  loading.value = true;
  try {
    const result = await api.adminLogs(currentFilters());
    if (mine === seq) {
      logs.value = result.logs;
      nextBefore.value = result.nextBefore;
      expanded.value = {};
    }
  } catch (error) {
    if (mine === seq) {
      notifyError(error, t('Journaux indisponibles'));
    }
  } finally {
    if (mine === seq) {
      loading.value = false;
    }
  }
}

async function more(): Promise<void> {
  if (nextBefore.value === null || loadingMore.value) return;
  loadingMore.value = true;
  try {
    const result = await api.adminLogs(currentFilters({ before: nextBefore.value }));
    logs.value = [...logs.value, ...result.logs];
    nextBefore.value = result.nextBefore;
  } catch (error) {
    notifyError(error);
  } finally {
    loadingMore.value = false;
  }
}

/** Suivi en direct : seules les entrées plus récentes que la dernière affichée sont demandées. */
async function poll(): Promise<void> {
  if (document.hidden || loading.value) return;
  const mine = seq;
  try {
    const newest = logs.value[0]?.id ?? 0;
    const result = await api.adminLogs(currentFilters({ after: newest, since: undefined, limit: 200 }));
    if (mine === seq && result.logs.length > 0) {
      const known = new Set(logs.value.map((entry) => entry.id));
      logs.value = [...result.logs.filter((entry) => !known.has(entry.id)), ...logs.value];
    }
  } catch {
    /* une coupure passagère ne doit pas inonder d'erreurs */
  }
}

function scheduleLive(): void {
  if (liveTimer !== null) {
    window.clearInterval(liveTimer);
    liveTimer = null;
  }
  if (live.value) {
    void poll();
    liveTimer = window.setInterval(() => void poll(), LIVE_MS);
  }
}

watch(live, scheduleLive);
watch(() => [filters.levels, filters.sources, filters.period, filters.requestId], () => void load(), { deep: true });
watch(() => filters.q, () => {
  if (debounce !== null) window.clearTimeout(debounce);
  debounce = window.setTimeout(() => void load(), 300);
});
onMounted(() => void load());
onBeforeUnmount(() => {
  if (liveTimer !== null) window.clearInterval(liveTimer);
  if (debounce !== null) window.clearTimeout(debounce);
});

const LEVEL_ICONS: Record<LogLevel, string> = { debug: 'pi pi-code', info: 'pi pi-info-circle', warn: 'pi pi-exclamation-triangle', error: 'pi pi-times-circle' };
const levelOptions = LOG_LEVELS.filter((level) => level !== 'debug').map((value) => ({ value, label: t(LOG_LEVEL_META[value].label), icon: LEVEL_ICONS[value] }));

function toggleLevel(level: LogLevel): void {
  filters.levels = filters.levels.includes(level) ? filters.levels.filter((entry) => entry !== level) : [...filters.levels, level];
}

const activeFilters = computed(() => filters.levels.length + filters.sources.length + Number(Boolean(filters.q.trim())) + Number(Boolean(filters.requestId)));

function reset(): void {
  filters.levels = [];
  filters.sources = [];
  filters.q = '';
  filters.requestId = '';
}

const exportUrl = computed(() => `/api/admin/logs/export?${logQuery({ ...currentFilters(), limit: 500 })}`);

function dataText(entry: LogEntryDTO): string {
  return JSON.stringify(entry.data, null, 2);
}

function stack(entry: LogEntryDTO): string | null {
  const value = (entry.data as { stack?: unknown } | null)?.stack;
  return typeof value === 'string' ? value : null;
}

function otherData(entry: LogEntryDTO): string | null {
  if (entry.data === null || typeof entry.data !== 'object') return entry.data === null ? null : String(entry.data);
  const { stack: _stack, ...rest } = entry.data as Record<string, unknown>;
  return Object.keys(rest).length ? JSON.stringify(rest, null, 2) : null;
}

async function copy(entry: LogEntryDTO): Promise<void> {
  const text = `${entry.ts} ${entry.level.toUpperCase()} ${entry.source} ${entry.message}${entry.requestId ? ` [${entry.requestId}]` : ''}${entry.data ? `\n${dataText(entry)}` : ''}`;
  if (await copyText(text)) notify('success', t('Entrée copiée'));
}

function followRequest(entry: LogEntryDTO): void {
  filters.requestId = entry.requestId ?? '';
  filters.period = 'all';
}

function rowClass(entry: LogEntryDTO): string {
  return `row-${entry.level}`;
}
</script>

<template>
  <div class="page logs">
    <header class="head">
      <div>
        <h1 class="page-title">{{ $t('Journaux') }}</h1>
        <p class="muted">{{ $t('Erreurs, accès refusés, connexions et actions d\'administration. Conservés 14 jours.') }}</p>
      </div>
      <div class="controls">
        <label class="row" :title="$t('Affiche les nouvelles entrées dès qu\'elles arrivent')"><ToggleSwitch v-model="live" /><span class="small">{{ $t('Suivi en direct') }}</span></label>
        <Button icon="pi pi-refresh" severity="secondary" text rounded :aria-label="$t('Actualiser')" :loading="loading" @click="load" />
        <a :href="exportUrl" class="export" download><Button :label="$t('Exporter')" icon="pi pi-download" severity="secondary" size="small" outlined tabindex="-1" /></a>
      </div>
    </header>

    <div class="toolbar card">
      <div class="levels" role="group" :aria-label="$t('Niveaux')">
        <button v-for="level in levelOptions" :key="level.value" type="button" class="level-chip" :class="[`lv-${level.value}`, { on: filters.levels.includes(level.value) }]" :aria-pressed="filters.levels.includes(level.value)" @click="toggleLevel(level.value)">
          <i :class="level.icon"></i>{{ level.label }}
        </button>
      </div>
      <MultiSelect v-model="filters.sources" :options="sourceOptions" option-label="label" option-value="value" :placeholder="$t('Toutes les sources')" :max-selected-labels="2" :selected-items-label="$t('{0} sources')" class="filter" display="comma" />
      <Select v-model="filters.period" :options="periodOptions" option-label="label" option-value="value" class="filter" :aria-label="$t('Période')" />
      <IconField class="search">
        <InputIcon class="pi pi-search" />
        <InputText v-model="filters.q" :placeholder="$t('Rechercher un message, une personne…')" fluid />
      </IconField>
      <Button v-if="activeFilters" :label="$t('Réinitialiser')" icon="pi pi-filter-slash" size="small" text severity="secondary" @click="reset" />
    </div>

    <p v-if="filters.requestId" class="request-filter small">
      <i class="pi pi-link"></i> {{ $t('Requête') }} <code>{{ filters.requestId }}</code>
      <Button icon="pi pi-times" text rounded size="small" severity="secondary" :aria-label="$t('Retirer le filtre')" @click="filters.requestId = ''" />
    </p>

    <section class="card table-card">
      <DataTable v-model:expanded-rows="expanded" :value="logs" data-key="id" size="small" :loading="loading" :row-class="rowClass" row-hover>
        <template #empty><span class="muted">{{ loading ? $t('Chargement…') : $t('Aucune entrée ne correspond à ces filtres.') }}</span></template>
        <Column expander style="width: 2.5rem" />
        <Column :header="$t('Heure')" style="width: 7.5rem">
          <template #body="{ data }">
            <time :datetime="data.ts" :title="formatDateTime(data.ts)" class="time">{{ logTime(data.ts) }}<span class="muted small day">{{ logDay(data.ts) }}</span></time>
          </template>
        </Column>
        <Column :header="$t('Niveau')" style="width: 6.5rem">
          <template #body="{ data }"><Tag :value="t(LOG_LEVEL_META[data.level as LogLevel].label)" :severity="LOG_LEVEL_META[data.level as LogLevel].severity" :icon="LEVEL_ICONS[data.level as LogLevel]" /></template>
        </Column>
        <Column :header="$t('Source')" style="width: 9.5rem">
          <template #body="{ data }"><span class="source">{{ SOURCE_LABELS[data.source] ?? data.source }}</span></template>
        </Column>
        <Column :header="$t('Message')">
          <template #body="{ data }"><span class="message">{{ data.message }}</span></template>
        </Column>
        <Column :header="$t('Personne')" style="width: 10rem" class="user-col">
          <template #body="{ data }"><span v-if="data.userName" class="truncate user">{{ data.userName }}</span><span v-else class="muted">—</span></template>
        </Column>
        <template #expansion="{ data }">
          <div class="details">
            <div class="meta small">
              <span><strong>{{ $t('Date') }}</strong> {{ formatDateTime(data.ts) }}</span>
              <span v-if="data.requestId"><strong>{{ $t('Requête') }}</strong> <code>{{ data.requestId }}</code> <a href="#" @click.prevent="followRequest(data)">{{ $t('voir toutes les entrées') }}</a></span>
              <Button :label="$t('Copier')" icon="pi pi-copy" size="small" text severity="secondary" @click="copy(data)" />
            </div>
            <pre v-if="otherData(data)" class="json">{{ otherData(data) }}</pre>
            <pre v-if="stack(data)" class="json stack">{{ stack(data) }}</pre>
            <p v-if="!otherData(data) && !stack(data)" class="muted small">{{ $t('Aucun détail supplémentaire.') }}</p>
          </div>
        </template>
      </DataTable>

      <footer class="foot">
        <span class="muted small">{{ $t('{n} entrée affichée|{n} entrées affichées', { n: logs.length }) }}<template v-if="live"> {{ $t('· en direct') }}</template></span>
        <Button v-if="nextBefore !== null" :label="$t('Charger plus')" icon="pi pi-angle-down" severity="secondary" size="small" outlined :loading="loadingMore" @click="more" />
      </footer>
    </section>
  </div>
</template>

<style scoped>
.logs {
  max-width: 1280px;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
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
.export {
  text-decoration: none;
}
.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.6rem 0.75rem;
  padding: 0.7rem 0.9rem;
}
.levels {
  display: inline-flex;
  gap: 0.35rem;
}
.level-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.7rem;
  border: 1px solid var(--fb-border);
  border-radius: 999px;
  background: transparent;
  color: var(--fb-muted);
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
}
.level-chip:hover {
  color: var(--fb-text);
}
.level-chip.on {
  color: #fff;
  border-color: transparent;
}
.lv-info.on {
  background: #0ea5e9;
}
.lv-warn.on {
  background: #d97706;
}
.lv-error.on {
  background: var(--fb-danger);
}
.filter {
  min-width: 12rem;
}
.search {
  flex: 1;
  min-width: 14rem;
}
.request-filter {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--fb-muted);
}
.table-card {
  overflow: hidden;
}
.time {
  display: flex;
  flex-direction: column;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
.day {
  text-transform: capitalize;
}
.source {
  font-size: 0.82rem;
  color: var(--fb-muted);
}
.message {
  overflow-wrap: anywhere;
}
.user {
  display: block;
  max-width: 9rem;
}
.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.7rem 1rem;
  border-top: 1px solid var(--fb-border);
}
.details {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.25rem 0.5rem 0.5rem 2.5rem;
}
.meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem 1.25rem;
  color: var(--fb-muted);
}
.meta strong {
  color: var(--fb-text);
  margin-right: 0.3rem;
}
.json {
  max-height: 22rem;
  margin: 0;
  padding: 0.7rem 0.85rem;
  overflow: auto;
  border: 1px solid var(--fb-border);
  border-radius: 8px;
  background: var(--fb-panel-alt);
  font-size: 0.78rem;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.stack {
  border-color: color-mix(in srgb, var(--fb-danger) 45%, var(--fb-border));
}
:deep(.row-error) {
  background: color-mix(in srgb, var(--fb-danger) 7%, transparent) !important;
}
:deep(.row-warn) {
  background: color-mix(in srgb, #f59e0b 8%, transparent) !important;
}
@media (max-width: 760px) {
  :deep(.user-col) {
    display: none;
  }
}
</style>
