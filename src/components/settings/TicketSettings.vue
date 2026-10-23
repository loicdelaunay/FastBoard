<script setup lang="ts">
import { computed, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import ToggleSwitch from 'primevue/toggleswitch';
import type { ProjectSettingsDTO } from '@shared/settings';
import {
  CUSTOM_FIELD_LIMITS,
  CUSTOM_FIELD_TYPES,
  CUSTOM_FIELD_TYPE_META,
  TICKET_FIELDS,
  TICKET_FIELD_META,
  newCustomFieldId,
  type CustomFieldDef,
  type CustomFieldType,
  type TicketFieldKey,
} from '@shared/ticketFields';
import { useProjectStore } from '@/stores/project';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Onglet « Ticket » des réglages du projet : affichage, champs standard affichés et champs personnalisés. */
const project = useProjectStore();
const confirm = useConfirm();
const canEdit = computed(() => project.can('project.edit') && !project.archived);

async function saveSettings(patch: Partial<ProjectSettingsDTO>): Promise<void> {
  try {
    await project.updateProjectInfo({ settings: patch });
  } catch (error) {
    notifyError(error, t('Réglage non enregistré'));
  }
}

// --- Champs standard ---
const allOn = computed(() => TICKET_FIELDS.every((key) => project.settings.ticketFields[key]));
function setField(key: TicketFieldKey, value: boolean): void {
  void saveSettings({ ticketFields: { ...project.settings.ticketFields, [key]: value } });
}
function setAll(value: boolean): void {
  void saveSettings({ ticketFields: Object.fromEntries(TICKET_FIELDS.map((key) => [key, value])) as ProjectSettingsDTO['ticketFields'] });
}

// --- Champs personnalisés ---
const fields = computed(() => project.settings.customFields);
const typeOptions = computed(() => CUSTOM_FIELD_TYPES.map((type) => ({ value: type, label: t(CUSTOM_FIELD_TYPE_META[type].label), icon: CUSTOM_FIELD_TYPE_META[type].icon })));
const newLabel = ref('');
const newType = ref<CustomFieldType>('text');
const optionDrafts = ref<Record<string, string>>({});
const hasOptions = (type: CustomFieldType) => type === 'select' || type === 'multiselect';

function saveFields(next: CustomFieldDef[]): Promise<void> {
  return saveSettings({ customFields: next });
}

async function addField(): Promise<void> {
  const label = newLabel.value.trim();
  if (!label || fields.value.length >= CUSTOM_FIELD_LIMITS.fields) return;
  await saveFields([...fields.value, { id: newCustomFieldId(), label, type: newType.value, options: [], showOnCard: false }]);
  newLabel.value = '';
}

function patchField(id: string, patch: Partial<CustomFieldDef>): void {
  void saveFields(fields.value.map((field) => (field.id === id ? { ...field, ...patch } : field)));
}

function rename(field: CustomFieldDef, event: Event): void {
  const label = (event.target as HTMLInputElement).value.trim();
  if (label && label !== field.label) patchField(field.id, { label });
  else (event.target as HTMLInputElement).value = field.label;
}

function move(index: number, delta: number): void {
  const next = [...fields.value];
  const [field] = next.splice(index, 1);
  next.splice(index + delta, 0, field!);
  void saveFields(next);
}

function addOption(field: CustomFieldDef): void {
  const option = (optionDrafts.value[field.id] ?? '').trim();
  if (!option || field.options.includes(option) || field.options.length >= CUSTOM_FIELD_LIMITS.options) return;
  patchField(field.id, { options: [...field.options, option] });
  optionDrafts.value[field.id] = '';
}

function removeOption(field: CustomFieldDef, option: string): void {
  patchField(field.id, { options: field.options.filter((entry) => entry !== option) });
}

function remove(field: CustomFieldDef): void {
  const used = project.tickets.filter((ticket) => ticket.customFields[field.id] !== undefined).length;
  confirm.require({
    header: t('Supprimer le champ'),
    message: used ? t('Supprimer « {label} » ? Sa valeur est renseignée sur {n} ticket.|Supprimer « {label} » ? Sa valeur est renseignée sur {n} tickets.', { label: field.label, n: used }) : t('Supprimer « {label} » ?', { label: field.label }),
    icon: 'pi pi-trash',
    acceptProps: { label: t('Supprimer'), severity: 'danger' },
    rejectProps: { label: t('Annuler'), severity: 'secondary', text: true },
    accept: () => void saveFields(fields.value.filter((entry) => entry.id !== field.id)),
  });
}
</script>

<template>
  <div class="ticket-settings">
    <p v-if="!canEdit" class="muted small">{{ $t('Seules les personnes pouvant configurer le projet modifient ces réglages.') }}</p>

    <section class="row card">
      <i class="pi pi-percentage icon" aria-hidden="true"></i>
      <div class="text">
        <label for="ticket-hideZeroProgress" class="title">{{ $t('Masquer l’avancement à 0 %') }}</label>
        <p class="muted small">{{ $t('Les cartes des tickets dont l’avancement est à 0 % n’affichent pas de barre de progression : elle apparaît dès que le travail commence.') }}</p>
      </div>
      <ToggleSwitch input-id="ticket-hideZeroProgress" :model-value="project.settings.hideZeroProgress" :disabled="!canEdit" @update:model-value="(value: boolean) => saveSettings({ hideZeroProgress: value })" />
    </section>

    <section class="card block">
      <div class="block-head">
        <div>
          <h3 class="block-title">{{ $t('Champs du ticket') }}</h3>
          <p class="muted small">{{ $t('Masquez les champs inutiles dans ce projet : ils disparaissent des tickets, des cartes et de la liste. Les valeurs déjà saisies sont conservées.') }}</p>
        </div>
        <Button :label="allOn ? $t('Tout masquer') : $t('Tout afficher')" size="small" text :disabled="!canEdit" @click="setAll(!allOn)" />
      </div>
      <div class="fields-grid">
        <label v-for="key in TICKET_FIELDS" :key="key" class="field-toggle" :class="{ off: !project.settings.ticketFields[key] }">
          <i :class="TICKET_FIELD_META[key].icon"></i>
          <span class="grow">{{ $t(TICKET_FIELD_META[key].label) }}</span>
          <ToggleSwitch :model-value="project.settings.ticketFields[key]" :disabled="!canEdit" :aria-label="$t(TICKET_FIELD_META[key].label)" @update:model-value="(value: boolean) => setField(key, value)" />
        </label>
      </div>
      <p class="muted small">{{ $t('Le titre et la colonne restent toujours affichés.') }}</p>
    </section>

    <section class="card block">
      <div>
        <h3 class="block-title">{{ $t('Champs personnalisés') }}</h3>
        <p class="muted small">{{ $t('Ajoutez vos propres champs (texte, nombre, date, liste, case à cocher, lien, personne) : ils apparaissent dans chaque ticket du projet et, si vous le souhaitez, sur les cartes du Kanban.') }}</p>
      </div>

      <ul v-if="fields.length" class="custom-list">
        <li v-for="(field, index) in fields" :key="field.id" class="custom-item">
          <div class="custom-row">
            <i :class="CUSTOM_FIELD_TYPE_META[field.type].icon" class="type-icon" :title="$t(CUSTOM_FIELD_TYPE_META[field.type].label)"></i>
            <InputText :model-value="field.label" size="small" class="label-input" :maxlength="CUSTOM_FIELD_LIMITS.labelMax" :disabled="!canEdit" :aria-label="$t('Libellé du champ')" @blur="rename(field, $event)" @keydown.enter.prevent="($event.target as HTMLInputElement).blur()" />
            <span class="muted small type-name">{{ $t(CUSTOM_FIELD_TYPE_META[field.type].label) }}</span>
            <label class="card-toggle small">
              <ToggleSwitch :model-value="field.showOnCard" :disabled="!canEdit" :aria-label="$t('Afficher sur la carte')" @update:model-value="(value: boolean) => patchField(field.id, { showOnCard: value })" />
              {{ $t('Sur la carte') }}
            </label>
            <Button v-tooltip.top="$t('Monter')" icon="pi pi-arrow-up" text rounded size="small" severity="secondary" :disabled="!canEdit || index === 0" :aria-label="$t('Monter')" @click="move(index, -1)" />
            <Button v-tooltip.top="$t('Descendre')" icon="pi pi-arrow-down" text rounded size="small" severity="secondary" :disabled="!canEdit || index === fields.length - 1" :aria-label="$t('Descendre')" @click="move(index, 1)" />
            <Button v-tooltip.top="$t('Supprimer')" icon="pi pi-trash" text rounded size="small" severity="danger" :disabled="!canEdit" :aria-label="$t('Supprimer')" @click="remove(field)" />
          </div>
          <div v-if="hasOptions(field.type)" class="options">
            <span v-for="option in field.options" :key="option" class="option">
              {{ option }}
              <button v-if="canEdit" type="button" :aria-label="$t('Retirer {name}', { name: option })" @click="removeOption(field, option)"><i class="pi pi-times"></i></button>
            </span>
            <span v-if="!field.options.length" class="muted small">{{ $t('Aucun choix : ajoutez-en au moins un.') }}</span>
            <form v-if="canEdit" class="option-add" @submit.prevent="addOption(field)">
              <InputText v-model="optionDrafts[field.id]" size="small" :maxlength="CUSTOM_FIELD_LIMITS.optionMax" :placeholder="$t('Nouveau choix')" :aria-label="$t('Nouveau choix')" />
              <Button type="submit" icon="pi pi-plus" size="small" severity="secondary" :aria-label="$t('Ajouter')" />
            </form>
          </div>
        </li>
      </ul>
      <p v-else class="muted small">{{ $t('Aucun champ personnalisé pour l’instant.') }}</p>

      <form v-if="canEdit && fields.length < CUSTOM_FIELD_LIMITS.fields" class="add" @submit.prevent="addField">
        <InputText v-model="newLabel" size="small" class="grow" :maxlength="CUSTOM_FIELD_LIMITS.labelMax" :placeholder="$t('Libellé du nouveau champ (ex. Budget, Client, Version)')" :aria-label="$t('Libellé du champ')" />
        <Select v-model="newType" :options="typeOptions" option-label="label" option-value="value" size="small" class="type-select" :aria-label="$t('Type du champ')">
          <template #option="{ option }"><span class="type-option"><i :class="option.icon"></i> {{ option.label }}</span></template>
        </Select>
        <Button type="submit" :label="$t('Ajouter le champ')" icon="pi pi-plus" size="small" :disabled="!newLabel.trim()" />
      </form>
    </section>
  </div>
</template>

<style scoped>
.ticket-settings {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-width: 48rem;
}
.row {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.2rem;
}
.icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 10px;
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
}
.text {
  flex: 1;
  min-width: 0;
}
.text p,
.block p {
  margin: 0;
}
.title {
  display: block;
  margin-bottom: 0.15rem;
  font-weight: 700;
}
.block {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  padding: 1rem 1.2rem;
}
.block-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}
.block-head :deep(.p-button) {
  flex: none;
  white-space: nowrap;
}
.block-title {
  margin: 0 0 0.2rem;
  font-size: 1rem;
}
.fields-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: 0.4rem 1rem;
}
.field-toggle {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.35rem 0.5rem;
  border-radius: 8px;
  cursor: pointer;
}
.field-toggle:hover {
  background: var(--fb-panel-alt);
}
.field-toggle i {
  width: 1rem;
  color: var(--fb-muted);
}
.field-toggle.off span {
  color: var(--fb-muted);
  text-decoration: line-through;
}
.grow {
  flex: 1;
  min-width: 0;
}
.custom-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.custom-item {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--fb-border);
  border-radius: 10px;
}
.custom-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.type-icon {
  color: var(--fb-accent);
}
.label-input {
  flex: 1;
  min-width: 10rem;
}
.type-name {
  min-width: 7rem;
}
.card-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
}
.options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  padding-left: 1.6rem;
}
.option {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.1rem 0.25rem 0.1rem 0.55rem;
  border-radius: 999px;
  background: var(--fb-panel-alt);
  font-size: 0.8rem;
}
.option button {
  display: grid;
  place-items: center;
  width: 1.1rem;
  height: 1.1rem;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--fb-muted);
  font-size: 0.6rem;
  cursor: pointer;
}
.option-add {
  display: flex;
  gap: 0.25rem;
}
.add {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.type-select {
  min-width: 12rem;
}
.type-option {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}
</style>
