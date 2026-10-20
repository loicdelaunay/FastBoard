<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Dialog from 'primevue/dialog';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import SelectButton from 'primevue/selectbutton';
import Tag from 'primevue/tag';
import ToggleSwitch from 'primevue/toggleswitch';
import { parseRetentionRules, SMART_RETENTION_RULES, type BackupDestinationDTO, type BackupOverviewDTO, type BackupRunDTO, type BackupSchedule, type RetentionPolicy } from '@shared/backup';
import { api } from '@/api';
import { translateServerMessage } from '@/i18n/server';
import { formatBytes } from '@/utils/files';
import { formatDateTime, formatRelative } from '@/utils/format';
import { notify, notifyError } from '@/utils/notify';

import { t } from '@/i18n';
type Draft = Omit<BackupDestinationDTO, 'id'> & { id?: string };

const confirm = useConfirm();
const overview = ref<BackupOverviewDTO | null>(null);
const loading = ref(true);
const saving = ref(false);
const running = ref<string | null>(null);
let timer: number | null = null;

async function load(): Promise<void> {
  try {
    overview.value = await api.adminBackups();
  } catch (error) {
    notifyError(error, t('Sauvegardes indisponibles'));
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  await load();
  timer = window.setInterval(load, 20_000);
});
onBeforeUnmount(() => timer !== null && window.clearInterval(timer));

const config = computed(() => overview.value?.config ?? { enabled: false, destinations: [] });
const statusOf = (id: string) => overview.value?.statuses.find((status) => status.destinationId === id);
const nameOf = (id: string) => config.value.destinations.find((destination) => destination.id === id)?.name ?? id;

async function persist(next: { enabled: boolean; destinations: Draft[] }, message?: string): Promise<boolean> {
  saving.value = true;
  try {
    overview.value = await api.adminSaveBackups(next);
    if (message) notify('success', message);
    return true;
  } catch (error) {
    notifyError(error, t('Configuration non enregistrée'));
    return false;
  } finally {
    saving.value = false;
  }
}

function toggleEnabled(enabled: boolean): void {
  void persist({ enabled, destinations: config.value.destinations }, enabled ? t('Sauvegardes activées') : t('Sauvegardes désactivées'));
}

// --- Formulaire d'une destination ---

const WEEKDAYS = computed(() => [1, 2, 3, 4, 5, 6, 0].map((day) => ({ value: day, label: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(2026, 0, 4 + day)) })));
const scheduleModes = computed(() => [
  { value: 'daily', label: t('Chaque jour à heure fixe') },
  { value: 'interval', label: t('Toutes les N heures') },
  { value: 'manual', label: t('Manuelle uniquement') },
]);
const retentionModes = computed(() => [
  { value: 'smart', label: t('Conservation intelligente'), help: t('Une par jour sur la dernière semaine, une par semaine sur le dernier mois, une par mois sur la dernière année.') },
  { value: 'count', label: t('Garder un nombre de sauvegardes'), help: t('Les plus récentes sont gardées, les plus anciennes supprimées.') },
  { value: 'age', label: t('Supprimer les sauvegardes trop anciennes'), help: t('Au-delà de la durée choisie, les sauvegardes sont supprimées.') },
  { value: 'custom', label: t('Règles personnalisées'), help: t('« durée:intervalle » séparés par des virgules. Unités : s, m, h, D (jour), W (semaine), M (mois), Y (an) ; U = tout garder. Exemple : 7D:0s,4W:1D,12M:1W.') },
  { value: 'all', label: t('Tout garder'), help: t('Aucune sauvegarde n\'est jamais supprimée : surveillez l\'espace disque.') },
]);

const dialogOpen = ref(false);
const draft = ref<Draft>(blankDraft());
const scheduleMode = ref<BackupSchedule['mode']>('daily');
const time = ref('02:00');
const weekdays = ref<number[]>([]);
const hours = ref(6);
const retentionMode = ref<RetentionPolicy['mode']>('smart');
const keep = ref(14);
const days = ref(30);
const rules = ref(SMART_RETENTION_RULES);
const folderCheck = ref<{ ok: boolean; message: string } | null>(null);

function blankDraft(): Draft {
  return { type: 'folder', name: t('Dossier local'), enabled: true, path: '', schedule: { mode: 'daily', time: '02:00', weekdays: [] }, incremental: true, fullEvery: 7, retention: { mode: 'smart' } };
}

function openDialog(destination?: BackupDestinationDTO): void {
  draft.value = destination ? structuredClone({ ...destination }) : blankDraft();
  const schedule = draft.value.schedule;
  scheduleMode.value = schedule.mode;
  time.value = schedule.mode === 'daily' ? schedule.time : '02:00';
  weekdays.value = schedule.mode === 'daily' ? [...schedule.weekdays] : [];
  hours.value = schedule.mode === 'interval' ? schedule.hours : 6;
  const retention = draft.value.retention;
  retentionMode.value = retention.mode;
  keep.value = retention.mode === 'count' ? retention.keep : 14;
  days.value = retention.mode === 'age' ? retention.days : 30;
  rules.value = retention.mode === 'custom' ? retention.rules : SMART_RETENTION_RULES;
  folderCheck.value = null;
  dialogOpen.value = true;
}

const rulesValid = computed(() => retentionMode.value !== 'custom' || parseRetentionRules(rules.value) !== null);
const timeValid = computed(() => /^([01]\d|2[0-3]):[0-5]\d$/.test(time.value));
const formValid = computed(() => draft.value.name.trim() && draft.value.path.trim() && rulesValid.value && (scheduleMode.value !== 'daily' || timeValid.value));

function buildDraft(): Draft {
  const schedule: BackupSchedule =
    scheduleMode.value === 'daily' ? { mode: 'daily', time: time.value, weekdays: weekdays.value } : scheduleMode.value === 'interval' ? { mode: 'interval', hours: hours.value } : { mode: 'manual' };
  const retention: RetentionPolicy =
    retentionMode.value === 'count' ? { mode: 'count', keep: keep.value }
    : retentionMode.value === 'age' ? { mode: 'age', days: days.value }
    : retentionMode.value === 'custom' ? { mode: 'custom', rules: rules.value.trim() }
    : { mode: retentionMode.value };
  return { ...draft.value, name: draft.value.name.trim(), path: draft.value.path.trim(), schedule, retention };
}

async function testFolder(): Promise<void> {
  try {
    const check = await api.adminTestFolder(draft.value.path.trim());
    folderCheck.value = { ...check, message: translateServerMessage(check.message) };
  } catch (error) {
    notifyError(error);
  }
}

async function saveDestination(): Promise<void> {
  const next = buildDraft();
  const destinations: Draft[] = next.id ? config.value.destinations.map((entry) => (entry.id === next.id ? next : entry)) : [...config.value.destinations, next];
  if (await persist({ enabled: config.value.enabled || !next.id, destinations }, t('Destination enregistrée'))) {
    dialogOpen.value = false;
  }
}

function askRemove(destination: BackupDestinationDTO): void {
  confirm.require({
    header: t('Retirer « {name} » ?', { name: destination.name }),
    message: t('Les sauvegardes ne seront plus faites vers ce dossier. Les archives déjà créées restent sur le disque.'),
    icon: 'pi pi-trash',
    acceptLabel: t('Retirer'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: () => void persist({ enabled: config.value.enabled, destinations: config.value.destinations.filter((entry) => entry.id !== destination.id) }, t('Destination retirée')),
  });
}

async function runNow(destination: BackupDestinationDTO): Promise<void> {
  running.value = destination.id;
  try {
    const { run, overview: fresh } = await api.adminRunBackup(destination.id);
    overview.value = fresh;
    if (run.status === 'success') notify('success', t('Sauvegarde terminée'), `${run.file} — ${formatBytes(run.size ?? 0)}`);
    else notify('error', t('Échec de la sauvegarde'), translateServerMessage(run.message ?? ''));
  } catch (error) {
    notifyError(error, t('Sauvegarde impossible'));
  } finally {
    running.value = null;
  }
}

function scheduleLabel(schedule: BackupSchedule): string {
  if (schedule.mode === 'manual') return t('Manuelle');
  if (schedule.mode === 'interval') return t('Toutes les {n} heure|Toutes les {n} heures', { n: schedule.hours });
  const dayNames = schedule.weekdays.length && schedule.weekdays.length < 7 ? ` (${WEEKDAYS.value.filter((day) => schedule.weekdays.includes(day.value)).map((day) => day.label).join(', ')})` : '';
  return t('Chaque jour à {time}', { time: schedule.time }) + dayNames;
}

function retentionLabel(policy: RetentionPolicy): string {
  switch (policy.mode) {
    case 'all':
      return t('Tout garder');
    case 'count':
      return t('{n} dernière|{n} dernières', { n: policy.keep });
    case 'age':
      return t('{n} jour|{n} jours', { n: policy.days });
    case 'smart':
      return t('Intelligente');
    default:
      return policy.rules;
  }
}

const statusSeverity: Record<BackupRunDTO['status'], 'success' | 'danger' | 'info'> = { success: 'success', failed: 'danger', running: 'info' };
const statusLabel = computed<Record<BackupRunDTO['status'], string>>(() => ({ success: t('Réussie'), failed: t('Échec'), running: t('En cours') }));
</script>

<template>
  <div class="backups">
    <header class="head">
      <div>
        <h1 class="page-title">{{ $t('Sauvegardes') }}</h1>
        <p class="muted">{{ $t('Archives ZIP de la base et des pièces jointes, planifiées, incrémentales, avec règles de conservation.') }}</p>
      </div>
      <label class="row master">
        <ToggleSwitch :model-value="config.enabled" :disabled="saving || loading" @update:model-value="toggleEnabled" />
        <strong>{{ config.enabled ? $t('Activées') : $t('Désactivées') }}</strong>
      </label>
    </header>

    <Message v-if="!loading && !config.enabled" severity="warn" :closable="false">{{ $t('Les sauvegardes planifiées sont désactivées : aucune archive n\'est créée automatiquement.') }}</Message>

    <section class="destinations">
      <article v-for="destination in config.destinations" :key="destination.id" class="destination card" :class="{ off: !destination.enabled }">
        <div class="dest-head">
          <i class="pi pi-folder dest-icon"></i>
          <div class="grow">
            <h3 class="dest-name">{{ destination.name }} <Tag v-if="!destination.enabled" :value="$t('En pause')" severity="secondary" /></h3>
            <code class="path">{{ destination.path }}</code>
          </div>
          <Button :label="$t('Sauvegarder maintenant')" icon="pi pi-play" size="small" :loading="running === destination.id" :disabled="running !== null" @click="runNow(destination)" />
          <Button icon="pi pi-pencil" text rounded severity="secondary" :aria-label="$t('Modifier')" @click="openDialog(destination)" />
          <Button icon="pi pi-trash" text rounded severity="danger" :aria-label="$t('Retirer')" @click="askRemove(destination)" />
        </div>
        <dl class="facts">
          <div><dt>{{ $t('Planification') }}</dt><dd>{{ scheduleLabel(destination.schedule) }}</dd></div>
          <div><dt>{{ $t('Mode') }}</dt><dd>{{ destination.incremental ? $t('Incrémental (complète toutes les {n} archives)', { n: destination.fullEvery }) : $t('Toujours complète') }}</dd></div>
          <div><dt>{{ $t('Conservation') }}</dt><dd>{{ retentionLabel(destination.retention) }}</dd></div>
          <div>
            <dt>{{ $t('Dernière') }}</dt>
            <dd>
              <template v-if="statusOf(destination.id)?.lastRun">
                <Tag :value="statusLabel[statusOf(destination.id)!.lastRun!.status]" :severity="statusSeverity[statusOf(destination.id)!.lastRun!.status]" />
                <span :title="formatDateTime(statusOf(destination.id)!.lastRun!.startedAt)"> {{ formatRelative(statusOf(destination.id)!.lastRun!.startedAt) }}</span>
              </template>
              <span v-else class="muted">{{ $t('Jamais') }}</span>
            </dd>
          </div>
          <div><dt>{{ $t('Prochaine') }}</dt><dd>{{ statusOf(destination.id)?.nextRunAt ? formatDateTime(statusOf(destination.id)!.nextRunAt!) : '—' }}</dd></div>
          <div><dt>{{ $t('Archives') }}</dt><dd>{{ statusOf(destination.id)?.archives ?? 0 }} · {{ formatBytes(statusOf(destination.id)?.totalSize ?? 0) }}</dd></div>
        </dl>
        <Message v-if="statusOf(destination.id)?.lastRun?.status === 'failed'" severity="error" size="small" :closable="false">{{ translateServerMessage(statusOf(destination.id)!.lastRun!.message ?? '') }}</Message>
      </article>

      <button type="button" class="add card" @click="openDialog()">
        <i class="pi pi-plus"></i>
        <strong>{{ $t('Ajouter une méthode de sauvegarde') }}</strong>
        <span class="muted small">{{ $t('Vers un dossier (disque local, disque externe, partage réseau monté)') }}</span>
      </button>
    </section>

    <section class="history">
      <h2 class="section-title">{{ $t('Historique') }}</h2>
      <DataTable :value="overview?.runs ?? []" :loading="loading" size="small" data-key="id" paginator :rows="15" class="table">
        <template #empty><p class="muted">{{ $t('Aucune sauvegarde pour l\'instant.') }}</p></template>
        <Column :header="$t('Date')" style="min-width: 10rem">
          <template #body="{ data }"><span :title="formatDateTime(data.startedAt)">{{ formatDateTime(data.startedAt) }}</span></template>
        </Column>
        <Column :header="$t('Destination')"><template #body="{ data }">{{ nameOf(data.destinationId) }}</template></Column>
        <Column :header="$t('Statut')"><template #body="{ data }"><Tag :value="statusLabel[data.status as BackupRunDTO['status']]" :severity="statusSeverity[data.status as BackupRunDTO['status']]" /></template></Column>
        <Column :header="$t('Type')">
          <template #body="{ data }">{{ data.kind === 'full' ? $t('Complète') : $t('Incrémentale') }} <span class="muted small">· {{ data.trigger === 'manual' ? $t('manuelle') : $t('planifiée') }}</span></template>
        </Column>
        <Column :header="$t('Archive')">
          <template #body="{ data }"><code v-if="data.file" class="small">{{ data.file }}</code><span v-else class="muted small">{{ data.message }}</span></template>
        </Column>
        <Column :header="$t('Taille')"><template #body="{ data }">{{ data.size ? formatBytes(data.size) : '' }}</template></Column>
        <Column :header="$t('Fichiers')"><template #body="{ data }">{{ data.files ?? '' }}</template></Column>
      </DataTable>
      <p class="muted small restore"><i class="pi pi-info-circle"></i> {{ $t('Restaurer : arrêtez FastBoard, extrayez la sauvegarde complète puis les incrémentales suivantes (dans l\'ordre de manifest.json) dans le dossier des données, puis redémarrez. Le détail est dans le README.txt de chaque archive.') }}</p>
    </section>

    <Dialog v-model:visible="dialogOpen" modal :header="draft.id ? $t('Modifier la destination') : $t('Nouvelle destination : dossier')" :style="{ width: 'min(40rem, 95vw)' }">
      <form class="form" @submit.prevent="saveDestination">
        <div class="field">
          <label for="bk-name">{{ $t('Nom') }}</label>
          <InputText id="bk-name" v-model="draft.name" maxlength="80" fluid />
        </div>
        <div class="field">
          <label for="bk-path">{{ $t('Dossier de destination (chemin absolu sur le serveur)') }}</label>
          <div class="row">
            <InputText id="bk-path" v-model="draft.path" maxlength="500" fluid :placeholder="$t('ex. D:\\Sauvegardes\\FastBoard ou /mnt/backup/fastboard')" @input="folderCheck = null" />
            <Button type="button" :label="$t('Tester')" icon="pi pi-check-circle" severity="secondary" outlined :disabled="!draft.path.trim()" @click="testFolder" />
          </div>
          <small v-if="folderCheck" :class="folderCheck.ok ? 'ok' : 'error'"><i :class="folderCheck.ok ? 'pi pi-check' : 'pi pi-times'"></i> {{ folderCheck.message }}</small>
        </div>

        <fieldset class="group">
          <legend>{{ $t('Planification') }}</legend>
          <SelectButton v-model="scheduleMode" :options="scheduleModes" option-label="label" option-value="value" :allow-empty="false" />
          <div v-if="scheduleMode === 'daily'" class="row wrap">
            <label class="row"><span class="small">{{ $t('Heure') }}</span><InputText v-model="time" maxlength="5" class="time" :invalid="!timeValid" placeholder="02:00" /></label>
            <SelectButton v-model="weekdays" :options="WEEKDAYS" option-label="label" option-value="value" multiple :aria-label="$t('Jours')" />
            <small class="muted">{{ $t('Aucun jour sélectionné = tous les jours.') }}</small>
          </div>
          <label v-else-if="scheduleMode === 'interval'" class="row">
            <span class="small">{{ $t('Toutes les') }}</span>
            <InputNumber v-model="hours" :min="1" :max="744" show-buttons button-layout="horizontal" :input-style="{ width: '4.5rem', textAlign: 'center' }" increment-button-icon="pi pi-plus" decrement-button-icon="pi pi-minus" />
            <span class="small">{{ $t('heures') }}</span>
          </label>
        </fieldset>

        <fieldset class="group">
          <legend>{{ $t('Incrémental') }}</legend>
          <label class="row"><ToggleSwitch v-model="draft.incremental" /><span>{{ $t('N\'ajouter que les pièces jointes nouvelles depuis la sauvegarde précédente') }}</span></label>
          <label v-if="draft.incremental" class="row">
            <span class="small">{{ $t('Nouvelle sauvegarde complète toutes les') }}</span>
            <InputNumber v-model="draft.fullEvery" :min="1" :max="1000" show-buttons button-layout="horizontal" :input-style="{ width: '4.5rem', textAlign: 'center' }" increment-button-icon="pi pi-plus" decrement-button-icon="pi pi-minus" />
            <span class="small">{{ $t('archives') }}</span>
          </label>
          <small class="muted">{{ $t('La base de données est toujours incluse en entier ; une incrémentale dépend des archives précédentes de sa chaîne, qui sont gardées tant qu\'elle l\'est.') }}</small>
        </fieldset>

        <fieldset class="group">
          <legend>{{ $t('Conservation') }}</legend>
          <Select v-model="retentionMode" :options="retentionModes" option-label="label" option-value="value" fluid />
          <small class="muted">{{ retentionModes.find((mode) => mode.value === retentionMode)?.help }}</small>
          <label v-if="retentionMode === 'count'" class="row"><span class="small">{{ $t('Garder les') }}</span><InputNumber v-model="keep" :min="1" :max="10000" show-buttons button-layout="horizontal" :input-style="{ width: '4.5rem', textAlign: 'center' }" increment-button-icon="pi pi-plus" decrement-button-icon="pi pi-minus" /><span class="small">{{ $t('dernières') }}</span></label>
          <label v-else-if="retentionMode === 'age'" class="row"><span class="small">{{ $t('Supprimer après') }}</span><InputNumber v-model="days" :min="1" :max="36500" show-buttons button-layout="horizontal" :input-style="{ width: '4.5rem', textAlign: 'center' }" increment-button-icon="pi pi-plus" decrement-button-icon="pi pi-minus" /><span class="small">{{ $t('jours') }}</span></label>
          <div v-else-if="retentionMode === 'custom'" class="field">
            <InputText v-model="rules" :invalid="!rulesValid" fluid :aria-label="$t('Règles de conservation')" />
            <small v-if="!rulesValid" class="error">{{ $t('Syntaxe invalide.') }}</small>
          </div>
        </fieldset>

        <label class="row"><ToggleSwitch v-model="draft.enabled" /><span>{{ $t('Destination active') }}</span></label>

        <div class="actions">
          <Button type="button" :label="$t('Annuler')" severity="secondary" text @click="dialogOpen = false" />
          <Button type="submit" :label="$t('Enregistrer')" icon="pi pi-check" :loading="saving" :disabled="!formValid" />
        </div>
      </form>
    </Dialog>
  </div>
</template>

<style scoped>
.backups {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  max-width: 64rem;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}
.head p {
  margin: 0.25rem 0 0;
}
.master {
  gap: 0.6rem;
  padding: 0.5rem 0.9rem;
  border: 1px solid var(--fb-border);
  border-radius: 999px;
  background: var(--fb-panel);
  cursor: pointer;
}
.destinations {
  display: grid;
  gap: 0.75rem;
}
.destination {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 1.2rem;
}
.destination.off {
  opacity: 0.7;
}
.dest-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.dest-icon {
  display: grid;
  place-items: center;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 10px;
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
}
.dest-name {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-size: 1rem;
}
.path {
  font-size: 0.8rem;
  color: var(--fb-muted);
  overflow-wrap: anywhere;
}
.facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
  gap: 0.5rem 1.25rem;
  margin: 0;
}
.facts dt {
  color: var(--fb-muted);
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.facts dd {
  margin: 0.1rem 0 0;
}
.add {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
  padding: 1.25rem;
  border-style: dashed;
  background: transparent;
  color: var(--fb-text);
  font: inherit;
  cursor: pointer;
}
.add:hover {
  border-color: var(--fb-accent);
  color: var(--fb-accent);
}
.add i {
  font-size: 1.3rem;
}
.section-title {
  margin: 0 0 0.6rem;
  font-size: 1.05rem;
}
.restore {
  margin-top: 0.6rem;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.group {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin: 0;
  padding: 0.75rem 1rem 1rem;
  border: 1px solid var(--fb-border);
  border-radius: 10px;
}
.group legend {
  padding: 0 0.4rem;
  font-weight: 700;
}
.wrap {
  flex-wrap: wrap;
}
.time {
  width: 5rem;
}
.ok {
  color: #16a34a;
}
.error {
  color: var(--fb-danger);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
