<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import Button from 'primevue/button';
import InputNumber from 'primevue/inputnumber';
import Select from 'primevue/select';
import ToggleSwitch from 'primevue/toggleswitch';
import { AI_LIMITS, modelRef, parseModelRef, type AiSettingsDTO } from '@shared/ai';
import { api } from '@/api';
import AiProviderEditor from '@/components/admin/AiProviderEditor.vue';
import { draftFrom, newDraft, type DefaultModel, type ProviderDraft } from '@/components/admin/aiProviderDraft';
import { useAppStore } from '@/stores/app';
import { formatDateTime } from '@/utils/format';
import { notify, notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Réglages de l'assistant IA : fournisseurs compatibles OpenAI v1, modèles mis à disposition, limites des réponses. */
const app = useAppStore();
const settings = ref<AiSettingsDTO | null>(null);
const form = reactive({ enabled: false, maxSteps: AI_LIMITS.steps, maxTurns: AI_LIMITS.turns });
const providers = ref<ProviderDraft[]>([]);
const defaultModel = ref<DefaultModel | null>(null);
const saving = ref(false);

function apply(next: AiSettingsDTO, keepDetected: ProviderDraft[] = []): void {
  settings.value = next;
  Object.assign(form, { enabled: next.enabled, maxSteps: next.maxSteps, maxTurns: next.maxTurns });
  providers.value = next.providers.map((provider, index) => {
    const draft = draftFrom(provider, next.providers.length === 1 || index === 0);
    // Les modèles détectés non retenus restent proposés après l'enregistrement.
    const previous = keepDetected[index];
    if (previous) {
      draft.open = previous.open;
      draft.catalog.push(...previous.catalog.filter((model) => !model.selected && !draft.catalog.some((entry) => entry.id === model.id)));
    }
    return draft;
  });
  const parsed = parseModelRef(next.defaultModel);
  defaultModel.value = parsed ? { key: parsed.providerId, model: parsed.modelId } : null;
}

onMounted(async () => {
  try {
    apply((await api.adminAi()).settings);
  } catch (error) {
    notifyError(error, t('Réglages IA indisponibles'));
  }
});

function addProvider(): void {
  for (const provider of providers.value) provider.open = false;
  providers.value.push(newDraft());
}

function removeProvider(index: number): void {
  const [removed] = providers.value.splice(index, 1);
  if (removed && defaultModel.value?.key === removed.key) defaultModel.value = null;
  ensureDefault();
}

/** Un modèle par défaut reste choisi parmi les modèles proposés. */
function ensureDefault(): void {
  const current = defaultModel.value;
  const valid = current && providers.value.some((provider) => provider.key === current.key && provider.catalog.some((model) => model.selected && model.id === current.model));
  if (valid) return;
  const provider = providers.value.find((entry) => entry.catalog.some((model) => model.selected));
  const model = provider?.catalog.find((entry) => entry.selected);
  defaultModel.value = provider && model ? { key: provider.key, model: model.id } : null;
}

/** Choix du modèle par défaut, tous fournisseurs confondus. */
const defaultOptions = computed(() =>
  providers.value
    .filter((provider) => provider.catalog.some((model) => model.selected))
    .map((provider) => ({
      label: provider.name || provider.baseUrl,
      items: provider.catalog.filter((model) => model.selected).map((model) => ({ label: model.label || model.id, value: `${provider.key}\u0000${model.id}` })),
    })),
);
const defaultValue = computed({
  get: () => (defaultModel.value ? `${defaultModel.value.key}\u0000${defaultModel.value.model}` : null),
  set: (value: string | null) => {
    if (!value) return;
    const [key, model] = value.split('\u0000');
    defaultModel.value = { key: key!, model: model! };
  },
});

watch(providers, ensureDefault, { deep: true });

const valid = computed(() => {
  return providers.value.length > 0 && providers.value.every((provider) => provider.baseUrl.trim()) && defaultModel.value !== null;
});

async function save(): Promise<void> {
  saving.value = true;
  const before = providers.value.map((provider) => ({ ...provider, catalog: [...provider.catalog] }));
  // Référence du modèle par défaut : identifiant du fournisseur, ou `new<rang>` pour un fournisseur ajouté.
  const index = providers.value.findIndex((provider) => provider.key === defaultModel.value?.key);
  const owner = providers.value[index];
  try {
    const saved = await api.adminSaveAi({
      enabled: form.enabled,
      maxSteps: form.maxSteps,
      maxTurns: form.maxTurns,
      defaultModel: owner && defaultModel.value ? modelRef(owner.id ?? `new${index}`, defaultModel.value.model) : '',
      providers: providers.value.map((provider) => ({
        ...(provider.id ? { id: provider.id } : {}),
        name: provider.name.trim(),
        baseUrl: provider.baseUrl.trim(),
        timeoutSeconds: provider.timeoutSeconds,
        models: provider.catalog.filter((model) => model.selected).map(({ id, label, vision, contextWindow, reasoning }) => ({ id, label: label.trim(), vision, contextWindow, reasoning })),
        ...(provider.replacingKey ? { apiKey: provider.apiKey } : {}),
      })),
    });
    apply(saved.settings, before);
    app.set(saved.app);
    notify('success', saved.settings.enabled ? t('Assistant IA activé') : t('Réglages enregistrés'));
  } catch (error) {
    notifyError(error, t('Réglages non enregistrés'));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="page ai-settings">
    <header>
      <h1 class="page-title">{{ $t('Intelligence artificielle') }}</h1>
      <p class="muted">{{ $t('Branchez un ou plusieurs fournisseurs compatibles OpenAI v1 pour proposer un assistant dans tout le site : il lit le projet ou le ticket ouvert, cherche partout et, si on l’y autorise, modifie les tickets avec les droits de la personne.') }}</p>
    </header>

    <form v-if="settings" class="card block" @submit.prevent="save">
      <label class="row master">
        <ToggleSwitch v-model="form.enabled" />
        <strong>{{ form.enabled ? $t('Fonctionnalités IA activées') : $t('Fonctionnalités IA désactivées') }}</strong>
        <span v-if="settings.updatedAt" class="muted small">· {{ $t('modifié le {date}', { date: formatDateTime(settings.updatedAt) }) }}</span>
      </label>

      <div class="section-head">
        <h2 class="block-title"><i class="pi pi-server"></i> {{ $t('Fournisseurs') }}</h2>
        <Button type="button" :label="$t('Ajouter un fournisseur')" icon="pi pi-plus" size="small" severity="secondary" outlined :disabled="providers.length >= AI_LIMITS.providers" @click="addProvider" />
      </div>
      <p class="muted small hint">{{ $t('Chaque fournisseur a sa clé, son délai et ses modèles ; les utilisateurs choisissent parmi tous les modèles proposés.') }}</p>
      <div class="providers">
        <AiProviderEditor
          v-for="(provider, index) in providers"
          :key="provider.key"
          :provider="provider"
          :default-model="defaultModel"
          :removable="providers.length > 1"
          @set-default="(model) => (defaultModel = { key: provider.key, model })"
          @remove="removeProvider(index)"
        />
      </div>

      <h2 class="block-title"><i class="pi pi-sliders-h"></i> {{ $t('Réponses de l’assistant') }}</h2>
      <div class="limits">
        <div class="field">
          <label for="ai-default" class="label">{{ $t('Modèle par défaut') }}</label>
          <Select v-model="defaultValue" input-id="ai-default" :options="defaultOptions" option-label="label" option-value="value" option-group-label="label" option-group-children="items" fluid :placeholder="$t('Choisissez un modèle proposé')" />
        </div>
        <div class="field">
          <label for="ai-steps" class="label">{{ $t('Tours de réflexion maximum') }}</label>
          <InputNumber v-model="form.maxSteps" input-id="ai-steps" :min="1" :max="AI_LIMITS.stepsMax" show-buttons fluid />
          <small class="muted">{{ $t('Allers-retours entre le modèle et les outils (recherche, lecture, modification) pour une même question.') }}</small>
        </div>
        <div class="field">
          <label for="ai-turns" class="label">{{ $t('Tours de discussion maximum') }}</label>
          <InputNumber v-model="form.maxTurns" input-id="ai-turns" :min="1" :max="AI_LIMITS.turnsMax" show-buttons fluid />
          <small class="muted">{{ $t('Échanges précédents (question et réponse) que le modèle garde en mémoire ; les plus anciens sont oubliés.') }}</small>
        </div>
      </div>

      <div class="actions">
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
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.hint {
  margin: -0.6rem 0 0;
}
.providers {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.limits {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
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
