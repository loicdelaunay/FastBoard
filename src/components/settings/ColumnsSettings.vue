<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import ToggleSwitch from 'primevue/toggleswitch';
import { STATUS_META } from '@shared/constants';
import { COLUMN_LABEL_MAX, defaultColumns, type ColumnConfig } from '@shared/settings';
import { useProjectStore } from '@/stores/project';
import { notify, notifyError } from '@/utils/notify';

import { t } from '@/i18n';
const project = useProjectStore();
const canEdit = computed(() => project.can('project.edit') && !project.archived);

const draft = ref<ColumnConfig[]>([]);
const saving = ref(false);

const clone = (columns: ColumnConfig[]): ColumnConfig[] => columns.map((column) => ({ ...column }));
// Les colonnes du serveur (ou d'un collègue) remplacent le brouillon tant qu'il n'a pas été modifié ici.
const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(project.columns));
watch(
  () => project.columns,
  (columns) => {
    if (!dirty.value || draft.value.length === 0) {
      draft.value = clone(columns);
    }
  },
  { immediate: true, deep: true },
);

function count(status: ColumnConfig['status']): number {
  return project.tickets.filter((ticket) => ticket.status === status).length;
}

function move(index: number, delta: number): void {
  const target = index + delta;
  if (target < 0 || target >= draft.value.length) return;
  const next = [...draft.value];
  [next[index], next[target]] = [next[target]!, next[index]!];
  draft.value = next;
}

function reset(column: ColumnConfig): void {
  const base = STATUS_META[column.status];
  column.label = t(base.label);
  column.color = base.color;
}

function resetAll(): void {
  draft.value = defaultColumns();
}

/** Un nom resté « par défaut » (dans la langue courante) est enregistré en français, la langue source. */
function toStored(column: ColumnConfig): string {
  const label = column.label.trim();
  return label === t(STATUS_META[column.status].label) ? STATUS_META[column.status].label : label;
}

const invalid = computed(() => draft.value.some((column) => !column.label.trim()));

async function save(): Promise<void> {
  saving.value = true;
  try {
    await project.updateProjectInfo({ settings: { columns: draft.value.map((column) => ({ ...column, label: toStored(column) })) } });
    notify('success', t('Colonnes enregistrées'));
  } catch (error) {
    notifyError(error, t('Colonnes non enregistrées'));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="columns">
    <p class="muted small intro"> {{ $t('Renommez, recolorez et réordonnez les colonnes du Kanban. Chaque colonne garde son rôle (le statut) : « Terminé » reste la colonne des tickets finis et ne peut pas être masquée. Une colonne n\'est masquable que si elle ne contient aucun ticket.') }} </p>

    <ol class="list">
      <li v-for="(column, index) in draft" :key="column.status" class="item card" :class="{ hidden: column.hidden }">
        <div class="order">
          <Button icon="pi pi-chevron-up" text rounded size="small" severity="secondary" :disabled="!canEdit || index === 0" :aria-label="$t('Monter {label}', { label: column.label })" @click="move(index, -1)" />
          <Button icon="pi pi-chevron-down" text rounded size="small" severity="secondary" :disabled="!canEdit || index === draft.length - 1" :aria-label="$t('Descendre {label}', { label: column.label })" @click="move(index, 1)" />
        </div>

        <label class="color" :title="$t('Couleur de {label}', { label: column.label })">
          <input v-model="column.color" type="color" :disabled="!canEdit" :aria-label="$t('Couleur de {label}', { label: column.label })" />
          <span class="swatch" :style="{ background: column.color }"></span>
        </label>

        <div class="name">
          <InputText v-model="column.label" :maxlength="COLUMN_LABEL_MAX" :disabled="!canEdit" :invalid="!column.label.trim()" :placeholder="t(STATUS_META[column.status].label)" :aria-label="$t('Nom de la colonne {label}', { label: t(STATUS_META[column.status].label) })" fluid />
          <small class="muted">
            <i :class="STATUS_META[column.status].icon"></i> {{ $t('statut « {label} » · {n} ticket|statut « {label} » · {n} tickets', { n: count(column.status), label: t(STATUS_META[column.status].label) }) }}
          </small>
        </div>

        <Button v-if="column.label !== t(STATUS_META[column.status].label) || column.color.toLowerCase() !== STATUS_META[column.status].color" icon="pi pi-undo" text rounded size="small" severity="secondary" :disabled="!canEdit" :aria-label="$t('Rétablir le nom et la couleur d\'origine')" @click="reset(column)" />

        <label class="visible" :title="column.status === $t('done') ? $t('La colonne Terminé est toujours affichée') : count(column.status) > 0 ? $t('Vide la colonne pour pouvoir la masquer') : ''">
          <ToggleSwitch :model-value="!column.hidden" :disabled="!canEdit || column.status === 'done' || (count(column.status) > 0 && !column.hidden)" :aria-label="$t('Afficher {label}', { label: column.label })" @update:model-value="(value: boolean) => (column.hidden = !value)" />
          <span class="small">{{ $t('Afficher') }}</span>
        </label>
      </li>
    </ol>

    <div v-if="canEdit" class="actions">
      <Button :label="$t('Enregistrer')" icon="pi pi-check" :disabled="!dirty || invalid" :loading="saving" @click="save" />
      <Button :label="$t('Annuler')" severity="secondary" text :disabled="!dirty" @click="draft = project.columns.map((entry) => ({ ...entry }))" />
      <Button :label="$t('Valeurs par défaut')" icon="pi pi-refresh" severity="secondary" text class="defaults" @click="resetAll" />
    </div>
    <p v-else class="muted small">{{ $t('Seules les personnes pouvant configurer le projet modifient les colonnes.') }}</p>
  </div>
</template>

<style scoped>
.columns {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 46rem;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0.8rem;
}
.item.hidden {
  opacity: 0.65;
}
.order {
  display: flex;
  flex-direction: column;
  flex: none;
}
.color {
  position: relative;
  flex: none;
  width: 2rem;
  height: 2rem;
  cursor: pointer;
}
.color input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
.swatch {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 8px;
  border: 2px solid var(--fb-panel);
  box-shadow: 0 0 0 1px var(--fb-border);
}
.name {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}
.visible {
  display: flex;
  align-items: center;
  flex: none;
  gap: 0.5rem;
}
.actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.defaults {
  margin-left: auto;
}
@media (max-width: 640px) {
  .item {
    flex-wrap: wrap;
  }
  .name {
    flex-basis: 100%;
    order: 5;
  }
}
</style>
