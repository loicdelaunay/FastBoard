<script setup lang="ts">
import { computed } from 'vue';
import Button from 'primevue/button';
import InputNumber from 'primevue/inputnumber';
import MultiSelect from 'primevue/multiselect';
import Select from 'primevue/select';
import ToggleSwitch from 'primevue/toggleswitch';
import type { TicketStatus } from '@shared/constants';
import { SORT_FIELDS, type ColumnSort, type ProjectSettingsDTO, type SortField } from '@shared/settings';
import { useProjectStore } from '@/stores/project';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Automatisations par colonne : avancement à 100 %, tri automatique, alerte d'échéance des livraisons. */
const project = useProjectStore();
const canEdit = computed(() => project.can('project.edit') && !project.archived);

const SORT_LABELS = computed<Record<SortField, string>>(() => ({
  priority: t('Priorité'),
  dueDate: t('Échéance'),
  title: t('Titre'),
  number: t('Numéro'),
  createdAt: t('Date de création'),
  updatedAt: t('Dernière modification'),
  progress: t('Avancement'),
}));
const sortOptions = computed(() => [{ value: null, label: t('Ordre manuel (glisser-déposer)') }, ...SORT_FIELDS.map((field) => ({ value: field, label: SORT_LABELS.value[field] }))]);
const columnOptions = computed(() => project.columns.map((column) => ({ value: column.status, label: column.label, disabled: column.status === 'done' })));

async function save(patch: Partial<ProjectSettingsDTO>): Promise<void> {
  try {
    await project.updateProjectInfo({ settings: patch });
  } catch (error) {
    notifyError(error, t('Réglage non enregistré'));
  }
}

function setComplete(statuses: TicketStatus[]): void {
  void save({ completeStatuses: [...new Set<TicketStatus>(['done', ...statuses])] });
}

function setSort(status: TicketStatus, field: SortField | null, direction?: ColumnSort['direction']): void {
  const next = { ...project.settings.columnSort };
  if (field === null) delete next[status];
  else next[status] = { field, direction: direction ?? next[status]?.direction ?? (field === 'priority' || field === 'dueDate' || field === 'title' || field === 'number' ? 'asc' : 'desc') };
  void save({ columnSort: next });
}

function setDays(key: 'deliveryWarnDays' | 'deliveryDangerDays', value: number | null): void {
  if (value === null || value === project.settings[key]) return;
  void save({ [key]: value });
}

const numberProps = { showButtons: true, buttonLayout: 'horizontal', size: 'small', inputStyle: { width: '3.5rem', textAlign: 'center' }, incrementButtonIcon: 'pi pi-plus', decrementButtonIcon: 'pi pi-minus', min: 0, max: 365 } as const;
</script>

<template>
  <div class="rules">
    <section class="card block">
      <div class="head">
        <i class="pi pi-percentage icon" aria-hidden="true"></i>
        <div class="text">
          <label for="complete-columns" class="title">{{ $t('Colonnes où un ticket compte pour 100 %') }}</label>
          <p class="muted small">{{ $t('Un ticket arrivé dans l’une de ces colonnes est considéré comme fini dans l’avancement (cartes, analyseur, livraisons). « Terminé » en fait toujours partie ; ajoutez par exemple « À tester ».') }}</p>
        </div>
      </div>
      <MultiSelect
        input-id="complete-columns"
        :model-value="project.settings.completeStatuses"
        :options="columnOptions"
        option-label="label"
        option-value="value"
        option-disabled="disabled"
        display="chip"
        :disabled="!canEdit"
        class="wide"
        @update:model-value="setComplete"
      />
    </section>

    <section class="card block">
      <div class="head">
        <i class="pi pi-sort-amount-down icon" aria-hidden="true"></i>
        <div class="text">
          <span class="title">{{ $t('Tri automatique des colonnes') }}</span>
          <p class="muted small">{{ $t('Les cartes d’une colonne triée sont rangées automatiquement selon le champ choisi ; on peut toujours y déposer un ticket, mais plus le placer à la main.') }}</p>
        </div>
      </div>
      <ul class="sorts">
        <li v-for="column in project.visibleColumns" :key="column.status" class="sort-row">
          <span class="column-name"><i class="swatch" :style="{ background: column.color }"></i>{{ column.label }}</span>
          <Select
            :model-value="project.settings.columnSort[column.status]?.field ?? null"
            :options="sortOptions"
            option-label="label"
            option-value="value"
            size="small"
            :disabled="!canEdit"
            class="field-select"
            :aria-label="$t('Tri de la colonne {name}', { name: column.label })"
            @update:model-value="(field: SortField | null) => setSort(column.status, field)"
          />
          <Button
            v-if="project.settings.columnSort[column.status]"
            v-tooltip.top="project.settings.columnSort[column.status]!.direction === 'asc' ? $t('Croissant') : $t('Décroissant')"
            :icon="project.settings.columnSort[column.status]!.direction === 'asc' ? 'pi pi-sort-amount-up-alt' : 'pi pi-sort-amount-down'"
            text
            rounded
            size="small"
            severity="secondary"
            :disabled="!canEdit"
            :aria-label="$t('Inverser le sens du tri')"
            @click="setSort(column.status, project.settings.columnSort[column.status]!.field, project.settings.columnSort[column.status]!.direction === 'asc' ? 'desc' : 'asc')"
          />
        </li>
      </ul>
    </section>

    <section class="card block">
      <div class="head">
        <i class="pi pi-truck icon" aria-hidden="true"></i>
        <div class="text">
          <label for="delivery-alert" class="title">{{ $t('Signaler les livraisons qui approchent') }}</label>
          <p class="muted small">{{ $t('Sur les tickets pas encore terminés, la livraison devient une pastille colorée selon le temps restant avant sa fin.') }}</p>
        </div>
        <ToggleSwitch input-id="delivery-alert" :model-value="project.settings.deliveryAlert" :disabled="!canEdit" @update:model-value="(value: boolean) => save({ deliveryAlert: value })" />
      </div>
      <div v-if="project.settings.deliveryAlert" class="thresholds">
        <label class="row">
          <i class="dot warn"></i>
          <span class="small">{{ $t('Orange à') }}</span>
          <InputNumber v-bind="numberProps" :model-value="project.settings.deliveryWarnDays" :disabled="!canEdit" :aria-label="$t('Jours restants (orange)')" @update:model-value="(value: number | null) => setDays('deliveryWarnDays', value)" />
          <span class="small">{{ $t('jours de la fin') }}</span>
        </label>
        <label class="row">
          <i class="dot danger"></i>
          <span class="small">{{ $t('Rouge à') }}</span>
          <InputNumber v-bind="numberProps" :max="project.settings.deliveryWarnDays" :model-value="project.settings.deliveryDangerDays" :disabled="!canEdit" :aria-label="$t('Jours restants (rouge)')" @update:model-value="(value: number | null) => setDays('deliveryDangerDays', value)" />
          <span class="small">{{ $t('jours de la fin ; au-delà de la date, la pastille indique le retard.') }}</span>
        </label>
      </div>
    </section>
  </div>
</template>

<style scoped>
.rules {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-width: 42rem;
  margin-top: 0.75rem;
}
.block {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 1.2rem;
}
.head {
  display: flex;
  align-items: center;
  gap: 1rem;
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
.text p {
  margin: 0.15rem 0 0;
}
.title {
  display: block;
  font-weight: 700;
}
.wide {
  width: 100%;
}
.sorts {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.sort-row {
  display: grid;
  grid-template-columns: 10rem minmax(0, 1fr) 2.5rem;
  align-items: center;
  gap: 0.6rem;
}
.column-name {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-weight: 600;
  font-size: 0.88rem;
}
.swatch {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 50%;
}
.thresholds {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.thresholds .row {
  flex-wrap: wrap;
  gap: 0.5rem;
}
.dot {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 50%;
}
.dot.warn {
  background: #f59e0b;
}
.dot.danger {
  background: #ef4444;
}
</style>
