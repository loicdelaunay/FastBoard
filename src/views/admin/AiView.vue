<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Password from 'primevue/password';
import RadioButton from 'primevue/radiobutton';
import ToggleSwitch from 'primevue/toggleswitch';
import { DEFAULT_AI_BASE_URL, guessCapabilities, type AiModelDTO, type AiSettingsDTO, type DetectedModelDTO } from '@shared/ai';
import { api } from '@/api';
import { translateServerMessage } from '@/i18n/server';
import { useAppStore } from '@/stores/app';
import { formatDateTime } from '@/utils/format';
import { notify, notifyError } from '@/utils/notify';
import { matchesQuery } from '@/utils/search';

import { t } from '@/i18n';
/** Réglages de l'assistant IA : fournisseur compatible OpenAI v1, clé, modèles mis à disposition et leurs capacités. */
const app = useAppStore();
const settings = ref<AiSettingsDTO | null>(null);
const form = reactive({ enabled: false, baseUrl: DEFAULT_AI_BASE_URL, defaultModel: '' });
/** Catalogue affiché : modèles retenus + modèles détectés ; `selected` = mis à disposition des utilisateurs. */
const catalog = ref<Array<AiModelDTO & { selected: boolean; ownedBy?: string | null }>>([]);
const apiKey = ref('');
const replacingKey = ref(false);
const saving = ref(false);
const testing = ref(false);
const detecting = ref(false);
const result = ref<{ ok: boolean; message: string } | null>(null);
const filter = ref('');
const manualId = ref('');

function apply(next: AiSettingsDTO): void {
  settings.value = next;
  Object.assign(form, { enabled: next.enabled, baseUrl: next.baseUrl, defaultModel: next.defaultModel });
  catalog.value = next.models.map((model) => ({ ...model, selected: true }));
  apiKey.value = '';
  replacingKey.value = !next.hasKey;
}

onMounted(async () => {
  try {
    apply((await api.adminAi()).settings);
  } catch (error) {
    notifyError(error, t('Réglages IA indisponibles'));
  }
});

const PRESETS = [
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' },
  { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { label: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
  { label: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
];

/** Clé à envoyer pour un essai ou une détection : celle saisie, sinon le serveur utilise la clé enregistrée. */
const probeKey = computed(() => (replacingKey.value && apiKey.value.trim() ? apiKey.value.trim() : undefined));
const selected = computed(() => catalog.value.filter((model) => model.selected));
const visible = computed(() => catalog.value.filter((model) => model.selected || matchesQuery(filter.value, [model.id, model.label, model.ownedBy])));
const hiddenCount = computed(() => catalog.value.length - visible.value.length);

async function detect(): Promise<void> {
  detecting.value = true;
  result.value = null;
  try {
    const { models } = await api.adminDetectAiModels({ baseUrl: form.baseUrl.trim(), apiKey: probeKey.value });
    const known = new Map(catalog.value.map((model) => [model.id, model]));
    for (const model of models as DetectedModelDTO[]) {
      if (!known.has(model.id)) catalog.value.push({ ...model, selected: false });
    }
    result.value = { ok: true, message: t('{n} modèle trouvé chez le fournisseur.|{n} modèles trouvés chez le fournisseur.', { n: models.length }) };
  } catch (error) {
    result.value = { ok: false, message: error instanceof Error ? error.message : String(error) };
  } finally {
    detecting.value = false;
  }
}

function addManual(): void {
  const id = manualId.value.trim();
  if (!id || catalog.value.some((model) => model.id === id)) return;
  catalog.value.unshift({ id, label: '', ...guessCapabilities(id), selected: true });
  manualId.value = '';
  if (!form.defaultModel) form.defaultModel = id;
}

function toggleSelected(model: (typeof catalog.value)[number], value: boolean): void {
  model.selected = value;
  if (value && !selected.value.some((entry) => entry.id === form.defaultModel)) form.defaultModel = model.id;
  if (!value && form.defaultModel === model.id) form.defaultModel = selected.value[0]?.id ?? '';
}

async function save(): Promise<void> {
  saving.value = true;
  try {
    const saved = await api.adminSaveAi({
      enabled: form.enabled,
      baseUrl: form.baseUrl.trim(),
      models: selected.value.map(({ id, label, vision, contextWindow, reasoning }) => ({ id, label: label.trim(), vision, contextWindow, reasoning })),
      defaultModel: form.defaultModel,
      ...(replacingKey.value ? { apiKey: apiKey.value } : {}),
    });
    const extra = catalog.value.filter((model) => !model.selected);
    apply(saved.settings);
    catalog.value.push(...extra);
    app.set(saved.app);
    notify('success', saved.settings.enabled ? t('Assistant IA activé') : t('Réglages enregistrés'));
  } catch (error) {
    notifyError(error, t('Réglages non enregistrés'));
  } finally {
    saving.value = false;
  }
}

async function test(): Promise<void> {
  testing.value = true;
  result.value = null;
  try {
    const answer = await api.adminTestAi({ baseUrl: form.baseUrl.trim(), model: form.defaultModel || undefined, apiKey: probeKey.value });
    result.value = { ok: answer.ok, message: translateServerMessage(answer.message) };
  } catch (error) {
    notifyError(error);
  } finally {
    testing.value = false;
  }
}

const valid = computed(() => form.baseUrl.trim() && selected.value.length > 0 && selected.value.some((model) => model.id === form.defaultModel));
</script>

<template>
  <div class="page ai-settings">
    <header>
      <h1 class="page-title">{{ $t('Intelligence artificielle') }}</h1>
      <p class="muted">{{ $t('Branchez un fournisseur compatible OpenAI v1 pour proposer un assistant dans tout le site : il lit le projet ou le ticket ouvert, cherche partout et, si on l’y autorise, modifie les tickets avec les droits de la personne.') }}</p>
    </header>

    <form v-if="settings" class="card block" @submit.prevent="save">
      <label class="row master">
        <ToggleSwitch v-model="form.enabled" />
        <strong>{{ form.enabled ? $t('Fonctionnalités IA activées') : $t('Fonctionnalités IA désactivées') }}</strong>
        <span v-if="settings.updatedAt" class="muted small">· {{ $t('modifié le {date}', { date: formatDateTime(settings.updatedAt) }) }}</span>
      </label>

      <div class="field">
        <span class="label">{{ $t('Fournisseur') }}</span>
        <div class="presets">
          <Button v-for="preset in PRESETS" :key="preset.label" type="button" :label="preset.label" size="small" severity="secondary" :outlined="form.baseUrl !== preset.baseUrl" @click="form.baseUrl = preset.baseUrl" />
        </div>
      </div>
      <div class="field">
        <label for="ai-url" class="label">{{ $t('URL de l’API (compatible OpenAI v1)') }}</label>
        <InputText id="ai-url" v-model="form.baseUrl" maxlength="500" fluid placeholder="https://api.openai.com/v1" />
        <small class="muted">{{ $t('FastBoard appelle {url}/chat/completions avec l’appel d’outils (« function calling »).', { url: form.baseUrl.replace(/\/+$/, '') || '…' }) }}</small>
      </div>
      <div class="field">
        <label for="ai-key" class="label">{{ $t('Clé d’API') }}</label>
        <div v-if="settings?.hasKey && !replacingKey" class="row key-row">
          <span class="key"><i class="pi pi-lock"></i> {{ $t('Clé enregistrée (…{hint})', { hint: settings?.keyHint ?? '' }) }}</span>
          <Button type="button" :label="$t('Remplacer')" size="small" text @click="replacingKey = true" />
          <Button type="button" :label="$t('Effacer')" size="small" text severity="danger" @click="(replacingKey = true), (apiKey = '')" />
        </div>
        <Password v-else v-model="apiKey" input-id="ai-key" :feedback="false" toggle-mask fluid :placeholder="$t('sk-… (facultatif pour un modèle local)')" :input-props="{ autocomplete: 'off' }" />
        <small class="muted">{{ $t('Stockée chiffrée sur le serveur et jamais réaffichée. La clé saisie sert aussi à tester et à détecter les modèles avant l’enregistrement.') }}</small>
      </div>

      <div class="field">
        <div class="models-head">
          <span class="label">{{ $t('Modèles mis à disposition') }}</span>
          <Button type="button" :label="$t('Détecter les modèles')" icon="pi pi-search" size="small" severity="secondary" outlined :loading="detecting" :disabled="!form.baseUrl.trim()" @click="detect" />
        </div>
        <small class="muted">{{ $t('Cochez les modèles que les utilisateurs pourront choisir dans le panneau de l’assistant, et le modèle par défaut. Vérifiez les capacités devinées d’après le nom.') }}</small>

        <div class="tools-row">
          <IconField class="grow">
            <InputIcon class="pi pi-filter" />
            <InputText v-model="filter" size="small" fluid :placeholder="$t('Filtrer les modèles détectés')" @keydown.enter.prevent />
          </IconField>
          <div class="manual">
            <InputText v-model="manualId" size="small" :placeholder="$t('Ajouter un modèle (identifiant)')" maxlength="200" @keydown.enter.prevent="addManual" />
            <Button type="button" icon="pi pi-plus" size="small" :disabled="!manualId.trim()" :aria-label="$t('Ajouter')" @click="addManual" />
          </div>
        </div>

        <div class="table-wrap">
          <table class="models">
            <thead>
              <tr>
                <th>{{ $t('Proposé') }}</th>
                <th>{{ $t('Modèle') }}</th>
                <th>{{ $t('Nom affiché') }}</th>
                <th v-tooltip.top="$t('Le modèle comprend les images')">{{ $t('Vision') }}</th>
                <th v-tooltip.top="$t('Taille du contexte, en jetons')">{{ $t('Contexte') }}</th>
                <th v-tooltip.top="$t('Accepte un niveau de réflexion (reasoning_effort)')">{{ $t('Réflexion') }}</th>
                <th>{{ $t('Par défaut') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="model in visible" :key="model.id" :class="{ off: !model.selected }">
                <td><Checkbox :model-value="model.selected" binary :aria-label="model.id" @update:model-value="(value: boolean) => toggleSelected(model, value)" /></td>
                <td class="id"><code>{{ model.id }}</code><span v-if="model.ownedBy" class="muted small"> · {{ model.ownedBy }}</span></td>
                <td><InputText v-model="model.label" size="small" maxlength="80" :placeholder="model.id" :disabled="!model.selected" class="label-input" @keydown.enter.prevent /></td>
                <td><ToggleSwitch v-model="model.vision" :disabled="!model.selected" :aria-label="$t('Vision')" /></td>
                <td><InputNumber v-model="model.contextWindow" :min="1000" :max="10000000" :step="1000" size="small" :disabled="!model.selected" :input-style="{ width: '6.5rem' }" suffix=" tk" /></td>
                <td><ToggleSwitch v-model="model.reasoning" :disabled="!model.selected" :aria-label="$t('Réflexion')" /></td>
                <td><RadioButton v-model="form.defaultModel" :value="model.id" :disabled="!model.selected" :aria-label="$t('Par défaut')" /></td>
              </tr>
              <tr v-if="!visible.length">
                <td colspan="7" class="muted empty">{{ $t('Aucun modèle : cliquez sur « Détecter les modèles » ou ajoutez-en un.') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <small v-if="hiddenCount" class="muted">{{ $t('{n} modèle détecté masqué par le filtre.|{n} modèles détectés masqués par le filtre.', { n: hiddenCount }) }}</small>
      </div>

      <Message v-if="result" :severity="result.ok ? 'success' : 'error'" :closable="false" size="small">{{ result.message }}</Message>

      <div class="actions">
        <Button type="button" :label="$t('Tester la connexion')" icon="pi pi-bolt" severity="secondary" outlined :loading="testing" :disabled="!form.baseUrl.trim() || !form.defaultModel" @click="test" />
        <Button type="submit" :label="$t('Enregistrer')" icon="pi pi-check" :loading="saving" :disabled="!valid" />
      </div>
    </form>

    <section class="card block help">
      <h2 class="block-title"><i class="pi pi-shield"></i> {{ $t('Droits') }}</h2>
      <p class="muted small">{{ $t('« Utiliser l’assistant IA » (rôle global) affiche le bouton ; dans chaque projet, « Interroger l’IA sur le projet » permet la lecture et « Laisser l’IA modifier le projet » les modifications. Ces droits se règlent dans Rôles et permissions. L’assistant n’a jamais plus de droits que la personne, et ne modifie rien tant qu’elle n’a pas coché « Autoriser les modifications ».') }}</p>
    </section>
  </div>
</template>

<style scoped>
.ai-settings {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
header p {
  margin: 0.25rem 0 0;
}
.block {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.1rem 1.25rem;
}
.master {
  gap: 0.6rem;
  cursor: pointer;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.label {
  font-weight: 600;
  font-size: 0.88rem;
}
.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.key-row {
  gap: 0.4rem;
}
.key {
  padding: 0.4rem 0.7rem;
  border-radius: 8px;
  background: var(--fb-panel-alt);
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 0.85rem;
}
.models-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.tools-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.manual {
  display: flex;
  gap: 0.3rem;
}
.table-wrap {
  max-height: 26rem;
  overflow: auto;
  border: 1px solid var(--fb-border);
  border-radius: 10px;
}
.models {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}
.models th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 0.45rem 0.6rem;
  background: var(--fb-panel-alt);
  color: var(--fb-muted);
  font-size: 0.72rem;
  font-weight: 800;
  text-align: left;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  white-space: nowrap;
}
.models td {
  padding: 0.35rem 0.6rem;
  border-top: 1px solid var(--fb-border);
  vertical-align: middle;
}
.models tr.off .id {
  opacity: 0.65;
}
.id code {
  font-size: 0.8rem;
}
.label-input {
  width: 10rem;
}
.empty {
  padding: 1rem;
  text-align: center;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
.block-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-size: 1rem;
}
.help p {
  margin: 0;
}
</style>
