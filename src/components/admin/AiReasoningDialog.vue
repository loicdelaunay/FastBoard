<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import { AI_LIMITS, REASONING_PRESETS, RESERVED_REASONING_PARAMS, reasoningPresetOf, type AiReasoningOption } from '@shared/ai';
import { t } from '@/i18n';
import { reasoningLabel } from '@/utils/aiReasoning';

/**
 * Réglages de réflexion d'un modèle : ce que le panneau de l'assistant propose (« Faible », « Sans réflexion »…) et,
 * pour chacun, les paramètres ajoutés à la requête. Un préréglage par fournisseur (OpenAI, Qwen, DeepSeek), ou une
 * liste personnalisée.
 */
const props = defineProps<{ model: string; options: AiReasoningOption[] | undefined }>();
const emit = defineEmits<{ save: [options: AiReasoningOption[] | undefined] }>();
const visible = defineModel<boolean>('visible', { required: true });

interface Row {
  id: string;
  label: string;
  /** Paramètres, en JSON (texte saisi). */
  json: string;
}

const preset = ref('openai');
const rows = ref<Row[]>([]);
const toRows = (options: readonly AiReasoningOption[]): Row[] => options.map((option) => ({ id: option.id, label: option.label, json: JSON.stringify(option.params, null, 2) }));

watch(visible, (open) => {
  if (!open) return;
  preset.value = reasoningPresetOf(props.options);
  rows.value = toRows(props.options?.length ? props.options : REASONING_PRESETS[0]!.options);
});

const choices = computed(() => [...REASONING_PRESETS.map((entry) => ({ key: entry.key, label: entry.label })), { key: 'custom', label: t('Personnalisé') }]);
const custom = computed(() => preset.value === 'custom');

function choose(key: string): void {
  const found = REASONING_PRESETS.find((entry) => entry.key === key);
  // « Personnalisé » part de la liste affichée, qui devient modifiable.
  if (found) rows.value = toRows(found.options);
  preset.value = key;
}

function addRow(): void {
  let index = rows.value.length + 1;
  while (rows.value.some((row) => row.id === `reglage-${index}`)) index += 1;
  rows.value.push({ id: `reglage-${index}`, label: '', json: '{\n  \n}' });
}

/** Paramètres d'une ligne, ou le message d'erreur à montrer. */
function parse(row: Row): { params: Record<string, unknown> } | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(row.json.trim() || '{}');
  } catch {
    return { error: t('JSON invalide.') };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { error: t('Écrivez un objet JSON, par exemple { "reasoning_effort": "high" }.') };
  const reserved = Object.keys(value).find((key) => RESERVED_REASONING_PARAMS.includes(key));
  if (reserved) return { error: t('« {key} » est fixé par FastBoard et ne peut pas être remplacé.', { key: reserved }) };
  if (JSON.stringify(value).length > AI_LIMITS.reasoningParamsChars) return { error: t('Paramètres trop longs.') };
  return { params: value as Record<string, unknown> };
}

const errors = computed(() =>
  rows.value.map((row, index) => {
    if (!/^[\w-]{1,40}$/.test(row.id)) return t('Identifiant : lettres, chiffres et tirets seulement.');
    if (rows.value.findIndex((other) => other.id === row.id) !== index) return t('Cet identifiant est déjà utilisé.');
    const parsed = parse(row);
    return 'error' in parsed ? parsed.error : '';
  }),
);
const valid = computed(() => rows.value.length > 0 && errors.value.every((error) => !error));

function save(): void {
  if (!valid.value) return;
  const options = rows.value.map((row): AiReasoningOption => ({ id: row.id, label: row.label.trim(), params: (parse(row) as { params: Record<string, unknown> }).params }));
  // Les réglages d'OpenAI sont ceux par défaut : rien à enregistrer.
  emit('save', reasoningPresetOf(options) === 'openai' ? undefined : options);
  visible.value = false;
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="$t('Réglages de réflexion de {model}', { model })" :style="{ width: 'min(46rem, calc(100vw - 2rem))' }">
    <p class="muted small intro">
      {{ $t('Ce sont les choix proposés dans le panneau de l’assistant pour ce modèle, en plus d’« Auto » (réglage du fournisseur). Chaque choix ajoute ses paramètres à la requête envoyée au fournisseur.') }}
    </p>
    <div class="presets" role="radiogroup" :aria-label="$t('Préréglages')">
      <Button v-for="choice in choices" :key="choice.key" type="button" :label="choice.label" size="small" severity="secondary" :outlined="preset !== choice.key" role="radio" :aria-checked="preset === choice.key" @click="choose(choice.key)" />
    </div>
    <p v-if="!custom" class="muted small">{{ $t('Préréglage : les choix ci-dessous sont ceux de la documentation du fournisseur. Passez en « Personnalisé » pour les modifier.') }}</p>

    <div class="options">
      <div v-for="(row, index) in rows" :key="index" class="option" :class="{ invalid: errors[index] }">
        <template v-if="custom">
          <div class="option-fields">
            <label class="option-field">
              <span class="label">{{ $t('Nom affiché') }}</span>
              <InputText v-model="row.label" size="small" maxlength="40" :placeholder="reasoningLabel({ id: row.id, label: '' })" fluid />
            </label>
            <label class="option-field">
              <span class="label">{{ $t('Identifiant') }}</span>
              <InputText v-model="row.id" size="small" maxlength="40" fluid />
            </label>
            <Button v-tooltip.top="$t('Retirer ce réglage')" type="button" icon="pi pi-trash" size="small" severity="danger" text :aria-label="$t('Retirer ce réglage')" :disabled="rows.length === 1" @click="rows.splice(index, 1)" />
          </div>
          <label class="option-field">
            <span class="label">{{ $t('Paramètres envoyés (JSON)') }}</span>
            <Textarea v-model="row.json" rows="3" class="json" spellcheck="false" fluid />
          </label>
          <small v-if="errors[index]" class="error">{{ errors[index] }}</small>
        </template>
        <template v-else>
          <strong class="name">{{ reasoningLabel(row) }}</strong>
          <code class="params">{{ row.json.replace(/\s+/g, ' ') }}</code>
        </template>
      </div>
    </div>
    <Button v-if="custom" type="button" :label="$t('Ajouter un réglage')" icon="pi pi-plus" size="small" severity="secondary" outlined :disabled="rows.length >= AI_LIMITS.reasoningOptions" @click="addRow" />

    <template #footer>
      <Button type="button" :label="$t('Annuler')" severity="secondary" text @click="visible = false" />
      <Button type="button" :label="$t('Valider')" icon="pi pi-check" :disabled="!valid" @click="save" />
    </template>
  </Dialog>
</template>

<style scoped>
.intro {
  margin-top: 0;
}
.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 0.6rem;
}
.options {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0.6rem 0;
}
.option {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--fb-border);
  border-radius: 10px;
}
.option.invalid {
  border-color: var(--fb-danger);
}
.option-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 0.6rem;
  align-items: end;
}
.option-field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
.label {
  color: var(--fb-muted);
  font-size: 0.75rem;
  font-weight: 600;
}
.json,
.params {
  font-family: var(--fb-font-mono, ui-monospace, monospace);
  font-size: 0.8rem;
}
.params {
  color: var(--fb-muted);
  overflow-wrap: anywhere;
}
.error {
  color: var(--fb-danger);
}
</style>
