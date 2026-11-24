<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import Button from 'primevue/button';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import ProgressBar from 'primevue/progressbar';
import Select from 'primevue/select';
import ToggleSwitch from 'primevue/toggleswitch';
import { detectRagPreset, RAG_LIMITS, RAG_PRESETS, ragTemplates, type RagFormat, type RagSettingsDTO, type RagStatusDTO, type RagTestResultDTO } from '@shared/rag';
import { api, type RagProbeInput } from '@/api';
import { t } from '@/i18n';
import { translateServerMessage } from '@/i18n/server';
import { formatDateTime, formatRelative } from '@/utils/format';
import { notify, notifyError } from '@/utils/notify';

/**
 * Recherche sémantique (RAG) de l'assistant : un modèle d'embeddings compatible OpenAI (Ollama, LM Studio, vLLM…)
 * indexe les tickets, notes et tableaux des projets et espaces qui l'activent, et l'assistant y cherche par le sens.
 */
const settings = ref<RagSettingsDTO | null>(null);
const status = ref<RagStatusDTO | null>(null);
const form = reactive({
  enabled: false,
  baseUrl: '',
  model: '',
  format: 'auto' as RagFormat,
  queryTemplate: '',
  documentTemplate: '',
  dimensions: null as number | null,
  timeoutSeconds: RAG_LIMITS.timeoutSeconds as number,
  verifyCertificate: true,
  chunkChars: RAG_LIMITS.chunkChars as number,
  every: 1,
  unit: 'days' as 'hours' | 'days',
});
/** Clé : `undefined` garde celle enregistrée ; une chaîne la remplace ; `''` l'efface. */
const apiKey = ref<string | undefined>(undefined);
const models = ref<string[]>([]);
const saving = ref(false);
const testing = ref(false);
const detecting = ref(false);
const test = ref<RagTestResultDTO | null>(null);
let poll = 0;

function apply(next: { settings: RagSettingsDTO; status: RagStatusDTO }): void {
  settings.value = next.settings;
  status.value = next.status;
  const days = next.settings.intervalHours % 24 === 0;
  Object.assign(form, {
    enabled: next.settings.enabled,
    baseUrl: next.settings.baseUrl,
    model: next.settings.model,
    format: next.settings.format,
    queryTemplate: next.settings.queryTemplate,
    documentTemplate: next.settings.documentTemplate,
    dimensions: next.settings.dimensions,
    timeoutSeconds: next.settings.timeoutSeconds,
    verifyCertificate: next.settings.verifyCertificate,
    chunkChars: next.settings.chunkChars,
    every: days ? next.settings.intervalHours / 24 : next.settings.intervalHours,
    unit: days ? 'days' : 'hours',
  });
  apiKey.value = undefined;
  watchStatus();
}

onMounted(async () => {
  try {
    apply(await api.adminRag());
  } catch (error) {
    notifyError(error, t('Réglages de la recherche sémantique indisponibles'));
  }
});
onBeforeUnmount(() => window.clearTimeout(poll));

/** Pendant une indexation, l'état se rafraîchit toutes les deux secondes. */
function watchStatus(): void {
  window.clearTimeout(poll);
  if (!status.value?.running) return;
  poll = window.setTimeout(async () => {
    try {
      status.value = (await api.adminRag()).status;
    } finally {
      watchStatus();
    }
  }, 2000);
}

const FORMAT_LABELS = computed<Record<RagFormat, string>>(() => ({
  auto: t('Automatique (d’après le modèle : {preset})', { preset: t(RAG_PRESETS[detectRagPreset(form.model)].label) }),
  none: t('Aucune mise en forme'),
  embeddinggemma: 'EmbeddingGemma',
  nomic: 'Nomic Embed',
  qwen3: 'Qwen3 Embedding',
  custom: t('Personnalisée'),
}));
const formats = computed(() => (Object.keys(FORMAT_LABELS.value) as RagFormat[]).map((value) => ({ value, label: FORMAT_LABELS.value[value] })));
const templates = computed(() => ragTemplates(form));
const units = computed(() => [
  { value: 'hours', label: t('heures') },
  { value: 'days', label: t('jours') },
]);
const intervalHours = computed(() => Math.min(RAG_LIMITS.intervalHoursMax, Math.max(1, Math.round((form.every || 1) * (form.unit === 'days' ? 24 : 1)))));
const https = computed(() => /^https:/i.test(form.baseUrl.trim()));
const valid = computed(() => /^https?:\/\/\S+$/i.test(form.baseUrl.trim()) && (!form.enabled || form.model.trim() !== ''));

function probe(): RagProbeInput {
  return {
    baseUrl: form.baseUrl.trim(),
    model: form.model.trim(),
    format: form.format,
    queryTemplate: form.queryTemplate,
    documentTemplate: form.documentTemplate,
    dimensions: form.dimensions || null,
    timeoutSeconds: form.timeoutSeconds,
    verifyCertificate: form.verifyCertificate,
    ...(apiKey.value !== undefined ? { apiKey: apiKey.value } : {}),
  };
}

async function save(): Promise<void> {
  saving.value = true;
  try {
    apply(await api.adminSaveRag({ ...probe(), enabled: form.enabled, intervalHours: intervalHours.value, chunkChars: form.chunkChars }));
    notify('success', form.enabled ? t('Recherche sémantique activée') : t('Réglages enregistrés'));
  } catch (error) {
    notifyError(error, t('Réglages non enregistrés'));
  } finally {
    saving.value = false;
  }
}

async function runTest(): Promise<void> {
  testing.value = true;
  test.value = null;
  try {
    test.value = (await api.adminTestRag(probe())).result;
  } catch (error) {
    notifyError(error, t('Essai impossible'));
  } finally {
    testing.value = false;
  }
}

async function detect(): Promise<void> {
  detecting.value = true;
  try {
    models.value = (await api.adminRagModels(probe())).models;
    if (!models.value.length) notify('info', t('Aucun modèle proposé par ce serveur'));
  } catch (error) {
    notifyError(error, t('Modèles introuvables'));
  } finally {
    detecting.value = false;
  }
}

async function reindex(rebuild: boolean): Promise<void> {
  try {
    status.value = (await api.adminReindexRag(rebuild)).status;
    watchStatus();
  } catch (error) {
    notifyError(error, t('Indexation impossible'));
  }
}

const SCOPE_LABELS = computed(() => ({
  project: { icon: 'pi pi-ticket', enabled: (n: number) => t('{n} projet|{n} projets', { n }), sources: (n: number) => t('{n} ticket|{n} tickets', { n }) },
  docs: { icon: 'pi pi-book', enabled: (n: number) => t('{n} espace de documentation|{n} espaces de documentation', { n }), sources: (n: number) => t('{n} note|{n} notes', { n }) },
  boards: { icon: 'pi pi-objects-column', enabled: (n: number) => t('{n} espace de tableaux|{n} espaces de tableaux', { n }), sources: (n: number) => t('{n} tableau|{n} tableaux', { n }) },
}));
const enabledScopes = computed(() => status.value?.scopes.reduce((sum, scope) => sum + scope.enabled, 0) ?? 0);
const progress = computed(() => (status.value?.progress?.total ? Math.round((status.value.progress.done / status.value.progress.total) * 100) : 0));
const score = (value: number | null) => (value === null ? '—' : value.toFixed(2));
</script>

<template>
  <form v-if="settings" class="card block rag" @submit.prevent="save">
    <div class="head">
      <h2 class="block-title"><i class="pi pi-sparkles"></i> {{ $t('Recherche sémantique (RAG)') }}</h2>
      <span v-if="settings.updatedAt" class="muted small">{{ $t('modifié le {date}', { date: formatDateTime(settings.updatedAt) }) }}</span>
    </div>
    <p class="muted small intro">
      {{ $t('Un modèle d’embeddings compatible OpenAI (Ollama, LM Studio, vLLM, OpenAI…) indexe les tickets, notes et tableaux des projets et espaces qui l’activent dans leurs réglages (désactivé par défaut). L’assistant IA y cherche alors par le sens, toujours dans les seuls projets et espaces de la personne qui pose la question.') }}
    </p>
    <label class="row master">
      <ToggleSwitch v-model="form.enabled" />
      <strong>{{ form.enabled ? $t('Recherche sémantique activée') : $t('Recherche sémantique désactivée') }}</strong>
    </label>

    <div class="grid">
      <div class="field wide">
        <label for="rag-url" class="label">{{ $t('Adresse du serveur d’embeddings') }}</label>
        <InputText id="rag-url" v-model="form.baseUrl" placeholder="http://localhost:11434/v1" fluid />
        <small class="muted">{{ $t('Compatible OpenAI v1 : le serveur reçoit POST …/embeddings. Pour Ollama : http://localhost:11434/v1.') }}</small>
      </div>
      <div class="field">
        <label for="rag-model" class="label">{{ $t('Modèle') }}</label>
        <div class="inline">
          <Select v-model="form.model" input-id="rag-model" :options="models" editable fluid placeholder="embeddinggemma" class="grow" />
          <Button type="button" icon="pi pi-search" severity="secondary" outlined :loading="detecting" :disabled="!form.baseUrl.trim()" :aria-label="$t('Détecter les modèles')" v-tooltip.top="$t('Détecter les modèles')" @click="detect" />
        </div>
        <small class="muted">{{ $t('Par exemple embeddinggemma, nomic-embed-text ou qwen3-embedding:0.6b.') }}</small>
      </div>
      <div class="field">
        <label for="rag-key" class="label">{{ $t('Clé d’API') }}</label>
        <div v-if="settings?.hasKey && apiKey === undefined" class="inline">
          <span class="saved-key muted"><i class="pi pi-lock"></i> {{ $t('Clé enregistrée (…{hint})', { hint: settings?.keyHint ?? '' }) }}</span>
          <Button type="button" :label="$t('Remplacer')" size="small" severity="secondary" text @click="apiKey = ''" />
        </div>
        <template v-else>
          <Password v-model="apiKey" input-id="rag-key" :feedback="false" toggle-mask fluid :placeholder="settings?.hasKey ? $t('Vide : la clé sera effacée') : $t('Facultative (serveur local)')" />
          <Button v-if="settings?.hasKey" type="button" :label="$t('Garder la clé enregistrée')" size="small" severity="secondary" text class="keep" @click="apiKey = undefined" />
        </template>
      </div>
      <div class="field">
        <label for="rag-format" class="label">{{ $t('Format des requêtes') }}</label>
        <Select v-model="form.format" input-id="rag-format" :options="formats" option-label="label" option-value="value" fluid />
        <small class="muted">{{ $t('Les modèles récents attendent une consigne pour la question et une autre pour les passages ; sans elle, la recherche perd en qualité sans erreur.') }}</small>
      </div>
      <div class="field wide templates">
        <template v-if="form.format === 'custom'">
          <label for="rag-query" class="label">{{ $t('Gabarit d’une question') }}</label>
          <InputText id="rag-query" v-model="form.queryTemplate" :maxlength="RAG_LIMITS.templateMax" placeholder="search_query: {text}" fluid />
          <label for="rag-document" class="label">{{ $t('Gabarit d’un passage') }}</label>
          <InputText id="rag-document" v-model="form.documentTemplate" :maxlength="RAG_LIMITS.templateMax" placeholder="title: {title} | text: {text}" fluid />
          <small class="muted">{{ $t('{text} : le texte ; {title} : le titre du passage (note, ticket, tableau).') }}</small>
        </template>
        <div v-else class="preview">
          <span class="muted small">{{ $t('Question') }}</span><code>{{ templates.query }}</code>
          <span class="muted small">{{ $t('Passage') }}</span><code>{{ templates.document }}</code>
        </div>
      </div>
      <div class="field">
        <label for="rag-every" class="label">{{ $t('Réindexer automatiquement toutes les') }}</label>
        <div class="inline">
          <InputNumber v-model="form.every" input-id="rag-every" :min="1" :max="form.unit === 'days' ? 60 : RAG_LIMITS.intervalHoursMax" show-buttons class="grow" fluid />
          <Select v-model="form.unit" :options="units" option-label="label" option-value="value" class="unit" :aria-label="$t('Unité')" />
        </div>
        <small class="muted">{{ $t('Seul ce qui a changé est recalculé ; un projet ou un espace activé est indexé aussitôt.') }}</small>
      </div>
      <div class="field">
        <label for="rag-dims" class="label">{{ $t('Taille des vecteurs (facultatif)') }}</label>
        <InputNumber v-model="form.dimensions" input-id="rag-dims" :min="8" :max="RAG_LIMITS.dimensionsMax" :placeholder="$t('Celle du modèle')" fluid />
        <small class="muted">{{ $t('Tronque les vecteurs pour un index plus léger (EmbeddingGemma : 768, 512, 256 ou 128).') }}</small>
      </div>
      <div class="field">
        <label for="rag-chunk" class="label">{{ $t('Taille des passages (caractères)') }}</label>
        <InputNumber v-model="form.chunkChars" input-id="rag-chunk" :min="RAG_LIMITS.chunkCharsMin" :max="RAG_LIMITS.chunkCharsMax" :step="100" show-buttons fluid />
      </div>
      <div class="field">
        <label for="rag-timeout" class="label">{{ $t('Délai de réponse (secondes)') }}</label>
        <InputNumber v-model="form.timeoutSeconds" input-id="rag-timeout" :min="5" :max="RAG_LIMITS.timeoutMax" show-buttons fluid />
      </div>
      <label v-if="https" class="row cert" for="rag-cert">
        <ToggleSwitch v-model="form.verifyCertificate" input-id="rag-cert" />
        <span>{{ $t('Vérifier le certificat HTTPS') }}</span>
      </label>
    </div>

    <div v-if="test" class="test" :class="test.ok ? 'ok' : test.dimensions ? 'warn' : 'failed'" role="status">
      <i :class="test.ok ? 'pi pi-check-circle' : 'pi pi-exclamation-triangle'"></i>
      <span v-if="test.dimensions">
        {{ $t('Embeddings reçus : {dims} dimensions en {ms} ms ({format}).', { dims: test.dimensions, ms: test.ms ?? 0, format: FORMAT_LABELS[test.format] ?? test.format }) }}
        {{
          test.ok
            ? $t('La question d’essai est plus proche du passage qui y répond ({related}) que d’un passage sans rapport ({unrelated}).', { related: score(test.related), unrelated: score(test.unrelated) })
            : $t('Mais la question d’essai n’est pas plus proche du passage qui y répond ({related} contre {unrelated}) : vérifiez le modèle et le format des requêtes.', { related: score(test.related), unrelated: score(test.unrelated) })
        }}
      </span>
      <span v-else>{{ translateServerMessage(test.message) }}</span>
    </div>

    <div class="actions">
      <Button type="button" :label="$t('Tester')" icon="pi pi-bolt" severity="secondary" outlined :loading="testing" :disabled="!form.baseUrl.trim() || !form.model.trim()" @click="runTest" />
      <Button type="submit" :label="$t('Enregistrer')" icon="pi pi-check" :loading="saving" :disabled="!valid" />
    </div>

    <section v-if="status" class="status">
      <div class="status-head">
        <h3><i class="pi pi-database"></i> {{ $t('Index') }}</h3>
        <div class="status-actions">
          <Button type="button" :label="$t('Indexer maintenant')" icon="pi pi-refresh" size="small" severity="secondary" outlined :disabled="!settings?.enabled || status.running" @click="reindex(false)" />
          <Button type="button" :label="$t('Tout reconstruire')" icon="pi pi-replay" size="small" severity="secondary" text :disabled="!settings?.enabled || status.running" @click="reindex(true)" />
        </div>
      </div>
      <div v-if="status.running" class="running">
        <span class="small"><i class="pi pi-spin pi-spinner"></i> {{ status.progress ? $t('Indexation : {done} sur {total}', { done: status.progress.done, total: status.progress.total }) : $t('Indexation…') }}</span>
        <ProgressBar :value="progress" :show-value="false" class="bar" />
      </div>
      <p v-if="status.stale" class="small warn-text"><i class="pi pi-info-circle"></i> {{ $t('Le modèle ou son format a changé : l’index sera reconstruit à la prochaine indexation.') }}</p>
      <ul class="scopes">
        <li v-for="scope in status.scopes" :key="scope.scope">
          <i :class="SCOPE_LABELS[scope.scope].icon"></i>
          <span>{{ SCOPE_LABELS[scope.scope].enabled(scope.enabled) }}</span>
          <span class="muted">· {{ SCOPE_LABELS[scope.scope].sources(scope.sources) }} · {{ $t('{n} passage|{n} passages', { n: scope.chunks }) }}</span>
        </li>
      </ul>
      <p v-if="!enabledScopes" class="muted small">{{ $t('Aucun projet ni espace ne l’a encore activé : chacun l’active dans ses réglages (projet : Réglages → Général ; espace : Modifier l’espace).') }}</p>
      <p class="muted small">
        <template v-if="status.lastSuccessAt">{{ $t('Dernière indexation réussie {when}', { when: formatRelative(status.lastSuccessAt) }) }}<template v-if="status.lastDurationMs !== null"> ({{ $t('{s} s', { s: Math.round(status.lastDurationMs / 100) / 10 }) }})</template></template>
        <template v-else>{{ $t('Jamais indexé') }}</template>
        <template v-if="status.dimensions"> · {{ $t('{n} dimensions', { n: status.dimensions }) }}</template>
        <template v-if="settings?.enabled && status.nextRunAt && !status.running"> · {{ $t('prochaine : {when}', { when: formatDateTime(status.nextRunAt) }) }}</template>
      </p>
      <p v-if="status.lastError" class="small error-text"><i class="pi pi-times-circle"></i> {{ translateServerMessage(status.lastError) }}</p>
    </section>
  </form>
</template>

<style scoped>
.block {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.1rem 1.25rem;
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}
.block-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-size: 1rem;
}
.intro {
  margin: -0.5rem 0 0;
}
.master,
.cert {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  cursor: pointer;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: 1rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}
.field.wide {
  grid-column: 1 / -1;
}
.label {
  font-weight: 600;
  font-size: 0.88rem;
}
.inline {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.grow {
  flex: 1;
  min-width: 0;
}
.unit {
  width: 7.5rem;
}
.saved-key {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.88rem;
}
.keep {
  align-self: flex-start;
}
.preview {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: baseline;
  gap: 0.3rem 0.75rem;
}
.preview code {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  font-size: 0.82rem;
}
.test {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.6rem 0.8rem;
  border-radius: 8px;
  font-size: 0.88rem;
}
.test.ok {
  background: color-mix(in srgb, #16a34a 12%, transparent);
}
.test.warn {
  background: color-mix(in srgb, #f59e0b 16%, transparent);
}
.test.failed {
  background: color-mix(in srgb, var(--fb-danger) 12%, transparent);
}
.test .pi {
  margin-top: 0.15rem;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
.status {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-top: 0.9rem;
  border-top: 1px solid var(--fb-border);
}
.status-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.status h3 {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0;
  font-size: 0.95rem;
}
.status-actions {
  display: flex;
  gap: 0.3rem;
}
.status p {
  margin: 0;
}
.running {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.bar {
  height: 0.4rem;
}
.scopes {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 0.9rem;
}
.scopes li {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}
.scopes .pi {
  color: var(--fb-accent);
}
.warn-text {
  color: #b45309;
}
.error-text {
  color: var(--fb-danger);
}
</style>
