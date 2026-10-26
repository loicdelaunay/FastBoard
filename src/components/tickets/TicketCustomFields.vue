<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import Checkbox from 'primevue/checkbox';
import DatePicker from 'primevue/datepicker';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import MultiSelect from 'primevue/multiselect';
import Select from 'primevue/select';
import Textarea from 'primevue/textarea';
import { CUSTOM_FIELD_LIMITS, type CustomFieldDef, type CustomFieldValue } from '@shared/ticketFields';
import type { TicketDTO } from '@shared/types';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { useProjectStore } from '@/stores/project';
import { dateToIso, isoToDate } from '@/utils/dates';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Champs personnalisés du projet (onglet « Ticket » des réglages), modifiables dans le ticket. */
const props = defineProps<{ ticket: TicketDTO; disabled?: boolean }>();
const project = useProjectStore();

const fields = computed(() => project.settings.customFields);
/** Brouillons des champs texte et nombre (enregistrés en quittant le champ). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- valeur selon le type du champ (texte ou nombre)
const drafts = reactive<Record<string, any>>({});
function syncDrafts(): void {
  for (const field of fields.value) {
    if (['text', 'longtext', 'url', 'number'].includes(field.type)) {
      const value = props.ticket.customFields[field.id];
      drafts[field.id] = value === undefined ? (field.type === 'number' ? null : '') : (value as string | number);
    }
  }
}
watch(() => [props.ticket.id, props.ticket.customFields, fields.value], syncDrafts, { immediate: true, deep: true });

async function save(field: CustomFieldDef, value: CustomFieldValue | null): Promise<void> {
  const current = props.ticket.customFields[field.id] ?? null;
  const next = value === '' || (Array.isArray(value) && !value.length) || value === false ? null : value;
  if (JSON.stringify(current) === JSON.stringify(next)) return;
  try {
    await project.updateTicket(props.ticket.id, { customFields: { [field.id]: next } }, { label: t('Champ « {label} »', { label: field.label }) });
  } catch (error) {
    notifyError(error, t('Modification refusée'));
    syncDrafts();
  }
}

function commitDraft(field: CustomFieldDef): void {
  const value = drafts[field.id];
  void save(field, typeof value === 'string' ? value.trim() : value);
}

const raw = (field: CustomFieldDef) => props.ticket.customFields[field.id];
const str = (field: CustomFieldDef) => (typeof raw(field) === 'string' ? (raw(field) as string) : undefined);
const num = (field: CustomFieldDef) => (typeof raw(field) === 'number' ? (raw(field) as number) : undefined);
const bool = (field: CustomFieldDef) => raw(field) === true;
const list = (field: CustomFieldDef) => (Array.isArray(raw(field)) ? (raw(field) as string[]) : []);
/** Hors du gabarit : « // » dans un attribut y gêne la vérification des types (vue-tsc). */
const urlPlaceholder = 'https://…';
const linkLabel = t('Ouvrir le lien');
/** Listes ouvertes : texte tapé dans la recherche, proposé comme nouveau choix. */
const optionFilters = reactive<Record<string, string>>({});
function newOption(field: CustomFieldDef): string {
  const value = (optionFilters[field.id] ?? '').trim().slice(0, CUSTOM_FIELD_LIMITS.optionMax);
  return field.allowNewOptions && value && !field.options.some((option) => option.toLowerCase() === value.toLowerCase()) ? value : '';
}
function addOption(field: CustomFieldDef): void {
  const value = newOption(field);
  if (!value) return;
  optionFilters[field.id] = '';
  void save(field, field.type === 'multiselect' ? [...list(field), value] : value);
}

const activeUsers = computed(() => project.users.filter((user) => user.isActive));
</script>

<template>
  <section v-if="fields.length" class="custom-fields">
    <div v-for="field in fields" :key="field.id" class="field">
      <label :for="`cf-${field.id}`">{{ field.label }}</label>
      <InputText
        v-if="field.type === 'text'"
        :id="`cf-${field.id}`"
        v-model="drafts[field.id]"
        :maxlength="CUSTOM_FIELD_LIMITS.textMax"
        :disabled="disabled"
        @blur="commitDraft(field)"
        @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
      />
      <Textarea v-else-if="field.type === 'longtext'" :id="`cf-${field.id}`" v-model="drafts[field.id]" auto-resize rows="2" :maxlength="CUSTOM_FIELD_LIMITS.longTextMax" :disabled="disabled" @blur="commitDraft(field)" />
      <InputNumber v-else-if="field.type === 'number'" v-model="drafts[field.id]" :input-id="`cf-${field.id}`" :max-fraction-digits="4" :disabled="disabled" @blur="commitDraft(field)" @keydown.enter="commitDraft(field)" />
      <DatePicker
        v-else-if="field.type === 'date'"
        :input-id="`cf-${field.id}`"
        :model-value="isoToDate(str(field) ?? null)"
        date-format="dd/mm/yy"
        show-icon
        show-button-bar
        icon-display="input"
        :placeholder="$t('jj/mm/aaaa')"
        :disabled="disabled"
        @update:model-value="(value) => save(field, dateToIso((value as Date | null) ?? null))"
      />
      <Select
        v-else-if="field.type === 'select'"
        :input-id="`cf-${field.id}`"
        :model-value="str(field) ?? null"
        :options="field.options"
        show-clear
        :filter="field.allowNewOptions || field.options.length > 8"
        :placeholder="$t('Aucun')"
        :disabled="disabled"
        @filter="(event) => (optionFilters[field.id] = event.value)"
        @update:model-value="(value: string | null) => save(field, value)"
      >
        <template v-if="field.allowNewOptions" #footer>
          <button v-if="newOption(field)" type="button" class="create-option" @click="addOption(field)"><i class="pi pi-plus"></i> {{ $t('Ajouter « {name} »', { name: newOption(field) }) }}</button>
          <p v-else class="muted small create-hint">{{ $t('Tapez un nouveau choix pour l’ajouter.') }}</p>
        </template>
      </Select>
      <MultiSelect
        v-else-if="field.type === 'multiselect'"
        :input-id="`cf-${field.id}`"
        :model-value="list(field)"
        :options="field.options"
        display="chip"
        :filter="field.allowNewOptions || field.options.length > 8"
        :placeholder="$t('Aucun')"
        :disabled="disabled"
        @filter="(event) => (optionFilters[field.id] = event.value)"
        @update:model-value="(value: string[]) => save(field, value)"
      >
        <template v-if="field.allowNewOptions" #footer>
          <button v-if="newOption(field)" type="button" class="create-option" @click="addOption(field)"><i class="pi pi-plus"></i> {{ $t('Ajouter « {name} »', { name: newOption(field) }) }}</button>
          <p v-else class="muted small create-hint">{{ $t('Tapez un nouveau choix pour l’ajouter.') }}</p>
        </template>
      </MultiSelect>
      <div v-else-if="field.type === 'checkbox'" class="check">
        <Checkbox :input-id="`cf-${field.id}`" :model-value="bool(field)" binary :disabled="disabled" @update:model-value="(value: boolean) => save(field, value)" />
        <span class="small">{{ bool(field) ? $t('Oui') : $t('Non') }}</span>
      </div>
      <div v-else-if="field.type === 'url'" class="url">
        <InputText :id="`cf-${field.id}`" v-model="drafts[field.id]" type="url" :placeholder="urlPlaceholder" :disabled="disabled" @blur="commitDraft(field)" @keydown.enter.prevent="($event.target as HTMLInputElement).blur()" />
        <a v-if="str(field)" :href="str(field)" target="_blank" rel="noopener noreferrer" class="open" :aria-label="linkLabel"><i class="pi pi-external-link"></i></a>
      </div>
      <Select
        v-else-if="field.type === 'user'"
        :input-id="`cf-${field.id}`"
        :model-value="num(field) ?? null"
        :options="activeUsers"
        option-label="name"
        option-value="id"
        filter
        show-clear
        :placeholder="$t('Personne')"
        :disabled="disabled"
        @update:model-value="(value: number | null) => save(field, value)"
      >
        <template #option="{ option }">
          <span class="row"><UserAvatar :user="option" size="small" /> {{ option.name }}</span>
        </template>
      </Select>
    </div>
  </section>
</template>

<style scoped>
.custom-fields {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding-top: 0.9rem;
  border-top: 1px dashed var(--fb-border);
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}
.url {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.url :deep(input) {
  flex: 1;
  min-width: 0;
}
.open {
  color: var(--fb-accent);
}
.create-option {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  padding: 0.55rem 0.9rem;
  border: 0;
  border-top: 1px solid var(--fb-border);
  background: transparent;
  color: var(--fb-accent);
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.create-option:hover {
  background: var(--fb-accent-soft);
}
.create-hint {
  margin: 0;
  padding: 0.5rem 0.9rem;
  border-top: 1px solid var(--fb-border);
}
</style>
