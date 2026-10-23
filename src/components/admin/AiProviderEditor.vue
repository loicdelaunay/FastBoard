<script setup lang="ts">
import { computed, ref } from 'vue';
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
import { AI_LIMITS, guessCapabilities, type DetectedModelDTO } from '@shared/ai';
import { api } from '@/api';
import { translateServerMessage } from '@/i18n/server';
import { notifyError } from '@/utils/notify';
import { matchesQuery } from '@/utils/search';
import type { DefaultModel, ProviderDraft } from './aiProviderDraft';

import { t } from '@/i18n';
/** Un fournisseur compatible OpenAI v1 : URL, clé, délai, modèles proposés et leurs capacités. */
const props = defineProps<{ provider: ProviderDraft; defaultModel: DefaultModel | null; removable: boolean }>();
const emit = defineEmits<{ setDefault: [model: string]; remove: [] }>();

const testing = ref(false);
const detecting = ref(false);
const result = ref<{ ok: boolean; message: string } | null>(null);
const filter = ref('');
const manualId = ref('');

const PRESETS = [
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' },
  { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { label: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
  { label: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
];

function choosePreset(preset: (typeof PRESETS)[number]): void {
  const previous = PRESETS.find((entry) => entry.baseUrl === props.provider.baseUrl);
  props.provider.baseUrl = preset.baseUrl;
  // Le nom suit le préréglage tant qu'il n'a pas été personnalisé.
  if (!props.provider.name || props.provider.name === previous?.label) props.provider.name = preset.label;
}

/** Clé à envoyer pour un essai ou une détection : celle saisie, sinon le serveur utilise la clé enregistrée. */
const probeKey = computed(() => (props.provider.replacingKey && props.provider.apiKey.trim() ? props.provider.apiKey.trim() : undefined));
const selected = computed(() => props.provider.catalog.filter((model) => model.selected));
const visible = computed(() => props.provider.catalog.filter((model) => model.selected || matchesQuery(filter.value, [model.id, model.label, model.ownedBy])));
const hiddenCount = computed(() => props.provider.catalog.length - visible.value.length);
const isDefault = (id: string) => props.defaultModel?.key === props.provider.key && props.defaultModel.model === id;

async function detect(): Promise<void> {
  detecting.value = true;
  result.value = null;
  try {
    const { models } = await api.adminDetectAiModels({ providerId: props.provider.id, baseUrl: props.provider.baseUrl.trim(), apiKey: probeKey.value });
    const known = new Set(props.provider.catalog.map((model) => model.id));
    for (const model of models as DetectedModelDTO[]) {
      if (!known.has(model.id)) props.provider.catalog.push({ ...model, selected: false });
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
  if (!id || props.provider.catalog.some((model) => model.id === id)) return;
  props.provider.catalog.unshift({ id, label: '', ...guessCapabilities(id), selected: true });
  manualId.value = '';
  if (!props.defaultModel) emit('setDefault', id);
}

function toggleSelected(model: ProviderDraft['catalog'][number], value: boolean): void {
  model.selected = value;
  if (value && !props.defaultModel) emit('setDefault', model.id);
}

async function test(): Promise<void> {
  testing.value = true;
  result.value = null;
  const model = selected.value.find((entry) => isDefault(entry.id)) ?? selected.value[0];
  try {
    const answer = await api.adminTestAi({ providerId: props.provider.id, baseUrl: props.provider.baseUrl.trim(), timeoutSeconds: props.provider.timeoutSeconds, model: model?.id, apiKey: probeKey.value });
    result.value = { ok: answer.ok, message: translateServerMessage(answer.message) };
  } catch (error) {
    notifyError(error);
  } finally {
    testing.value = false;
  }
}
</script>

<template>
  <section class="provider" :class="{ open: provider.open }">
    <button type="button" class="summary" :aria-expanded="provider.open" @click="provider.open = !provider.open">
      <i :class="provider.open ? 'pi pi-chevron-down' : 'pi pi-chevron-right'"></i>
      <strong class="truncate">{{ provider.name || $t('Nouveau fournisseur') }}</strong>
      <span class="muted small truncate url">{{ provider.baseUrl }}</span>
      <span class="badge">{{ $t('{n} modèle|{n} modèles', { n: selected.length }) }}</span>
      <i v-if="selected.some((model) => isDefault(model.id))" v-tooltip.top="$t('Contient le modèle par défaut')" class="pi pi-star-fill star"></i>
    </button>

    <div v-if="provider.open" class="body">
      <div class="grid">
        <div class="field">
          <label :for="`ai-name-${provider.key}`" class="label">{{ $t('Nom affiché') }}</label>
          <InputText :id="`ai-name-${provider.key}`" v-model="provider.name" maxlength="60" fluid :placeholder="$t('ex. OpenAI, Ollama du serveur…')" @keydown.enter.prevent />
        </div>
        <div class="field">
          <label :for="`ai-timeout-${provider.key}`" class="label">{{ $t('Délai maximal de réponse') }}</label>
          <InputNumber :input-id="`ai-timeout-${provider.key}`" v-model="provider.timeoutSeconds" :min="5" :max="AI_LIMITS.timeoutMax" :step="5" :suffix="$t(' s')" show-buttons fluid />
          <small class="muted">{{ $t('Au-delà, la question est abandonnée (modèles locaux lents : augmentez-le).') }}</small>
        </div>
      </div>

      <div class="field">
        <span class="label">{{ $t('Préréglages') }}</span>
        <div class="presets">
          <Button v-for="preset in PRESETS" :key="preset.label" type="button" :label="preset.label" size="small" severity="secondary" :outlined="provider.baseUrl !== preset.baseUrl" @click="choosePreset(preset)" />
        </div>
      </div>
      <div class="field">
        <label :for="`ai-url-${provider.key}`" class="label">{{ $t('URL de l’API (compatible OpenAI v1)') }}</label>
        <InputText :id="`ai-url-${provider.key}`" v-model="provider.baseUrl" maxlength="500" fluid placeholder="https://api.openai.com/v1" @keydown.enter.prevent />
        <small class="muted">{{ $t('FastBoard appelle {url}/chat/completions avec l’appel d’outils (« function calling »).', { url: provider.baseUrl.replace(/\/+$/, '') || '…' }) }}</small>
      </div>
      <div class="field">
        <label :for="`ai-key-${provider.key}`" class="label">{{ $t('Clé d’API') }}</label>
        <div v-if="provider.hasKey && !provider.replacingKey" class="row key-row">
          <span class="key"><i class="pi pi-lock"></i> {{ $t('Clé enregistrée (…{hint})', { hint: provider.keyHint ?? '' }) }}</span>
          <Button type="button" :label="$t('Remplacer')" size="small" text @click="provider.replacingKey = true" />
          <Button type="button" :label="$t('Effacer')" size="small" text severity="danger" @click="(provider.replacingKey = true), (provider.apiKey = '')" />
        </div>
        <Password v-else v-model="provider.apiKey" :input-id="`ai-key-${provider.key}`" :feedback="false" toggle-mask fluid :placeholder="$t('sk-… (facultatif pour un modèle local)')" :input-props="{ autocomplete: 'off' }" />
        <small class="muted">{{ $t('Stockée chiffrée sur le serveur et jamais réaffichée. La clé saisie sert aussi à tester et à détecter les modèles avant l’enregistrement.') }}</small>
      </div>

      <div class="field">
        <div class="models-head">
          <span class="label">{{ $t('Modèles mis à disposition') }}</span>
          <Button type="button" :label="$t('Détecter les modèles')" icon="pi pi-search" size="small" severity="secondary" outlined :loading="detecting" :disabled="!provider.baseUrl.trim()" @click="detect" />
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
                <td><RadioButton :model-value="isDefault(model.id) ? model.id : null" :value="model.id" :disabled="!model.selected" :aria-label="$t('Par défaut')" @update:model-value="emit('setDefault', model.id)" /></td>
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
        <Button v-if="removable" type="button" :label="$t('Retirer ce fournisseur')" icon="pi pi-trash" severity="danger" text size="small" @click="emit('remove')" />
        <span class="grow"></span>
        <Button type="button" :label="$t('Tester la connexion')" icon="pi pi-bolt" severity="secondary" outlined size="small" :loading="testing" :disabled="!provider.baseUrl.trim() || !selected.length" @click="test" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.provider {
  border: 1px solid var(--fb-border);
  border-radius: 12px;
  background: var(--fb-panel);
}
.provider.open {
  border-color: color-mix(in srgb, var(--fb-accent) 45%, var(--fb-border));
}
.summary {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  padding: 0.7rem 0.9rem;
  border: 0;
  background: transparent;
  color: var(--fb-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.summary .url {
  flex: 1;
  min-width: 0;
}
.badge {
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: var(--fb-panel-alt);
  font-size: 0.75rem;
  font-weight: 700;
  white-space: nowrap;
}
.star {
  color: #f59e0b;
}
.body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 0.2rem 1rem 1rem;
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
  font-family: var(--fb-font-mono, ui-monospace, 'Cascadia Mono', Consolas, monospace);
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
  align-items: center;
  gap: 0.5rem;
}
.grow {
  flex: 1;
}
</style>
