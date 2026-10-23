<script setup lang="ts">
import { computed } from 'vue';
import DatePicker from 'primevue/datepicker';
import MultiSelect from 'primevue/multiselect';
import Select from 'primevue/select';
import type { TicketStatus } from '@shared/constants';
import ColorChip from '@/components/common/ColorChip.vue';
import StatusTag from '@/components/common/StatusTag.vue';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/project';
import { dateToIso, isoToDate } from '@/utils/dates';

export interface TicketFieldValues {
  status: TicketStatus;
  categoryId: number | null;
  priorityId: number | null;
  componentIds: number[];
  deliveryId: number | null;
  startDate: string | null;
  endDate: string | null;
  assigneeIds: number[];
}

const props = defineProps<{
  values: TicketFieldValues;
  disabled?: boolean;
  /** Livraison initiale du ticket (mode détail) pour signaler un report. */
  initialDeliveryId?: number | null;
}>();
const emit = defineEmits<{ change: [patch: Partial<TicketFieldValues>] }>();

const project = useProjectStore();
const auth = useAuthStore();

/** « M'assigner » : visible pour un membre du projet qui n'est pas encore assigné. */
const canAssignMe = computed(() => {
  const me = auth.user?.id;
  return !props.disabled && me !== undefined && project.users.some((user) => user.id === me) && !props.values.assigneeIds.includes(me);
});

function assignMe(): void {
  if (auth.user) emit('change', { assigneeIds: [...props.values.assigneeIds, auth.user.id] });
}

const statusOptions = computed(() => project.visibleColumns.map((column) => ({ value: column.status, label: column.label })));
const delivery = computed(() => (props.values.deliveryId ? project.deliveriesById.get(props.values.deliveryId) : undefined));
const initialDelivery = computed(() =>
  props.initialDeliveryId && props.initialDeliveryId !== props.values.deliveryId ? project.deliveriesById.get(props.initialDeliveryId) : undefined,
);

const startDate = computed({
  get: () => isoToDate(props.values.startDate),
  set: (value: Date | null) => emit('change', { startDate: dateToIso(value) }),
});
const endDate = computed({
  get: () => isoToDate(props.values.endDate),
  set: (value: Date | null) => emit('change', { endDate: dateToIso(value) }),
});

/** La date de fin ne peut pas précéder la date de début (et inversement). */
const minEnd = computed(() => isoToDate(props.values.startDate) ?? undefined);
const maxStart = computed(() => isoToDate(props.values.endDate) ?? undefined);
</script>

<template>
  <div class="grid">
    <div class="field">
      <label>{{ $t('Statut') }}</label>
      <Select
        :model-value="values.status"
        :options="statusOptions"
        option-label="label"
        option-value="value"
        :disabled="disabled"
        @update:model-value="(value: TicketStatus) => emit('change', { status: value })"
      >
        <template #value="{ value }"><StatusTag v-if="value" :status="value" /></template>
        <template #option="{ option }"><StatusTag :status="option.value" /></template>
      </Select>
    </div>

    <div v-if="project.fieldOn('priority')" class="field">
      <label>{{ $t('Priorité') }}</label>
      <Select
        :model-value="values.priorityId"
        :options="project.priorities"
        option-label="name"
        option-value="id"
        :placeholder="$t('Aucune')"
        show-clear
        :disabled="disabled"
        @update:model-value="(value: number | null) => emit('change', { priorityId: value ?? null })"
      >
        <template #value="{ value }">
          <ColorChip v-if="value && project.prioritiesById.get(value)" :label="project.prioritiesById.get(value)!.name" :color="project.prioritiesById.get(value)!.color" :icon="project.prioritiesById.get(value)!.icon" />
          <span v-else class="muted">{{ $t('Aucune') }}</span>
        </template>
        <template #option="{ option }"><ColorChip :label="option.name" :color="option.color" :icon="option.icon" /></template>
      </Select>
    </div>

    <div v-if="project.fieldOn('category')" class="field">
      <label>{{ $t('Catégorie') }}</label>
      <Select
        :model-value="values.categoryId"
        :options="project.categories"
        option-label="name"
        option-value="id"
        :placeholder="$t('Aucune')"
        show-clear
        :disabled="disabled"
        @update:model-value="(value: number | null) => emit('change', { categoryId: value ?? null })"
      >
        <template #value="{ value }">
          <ColorChip v-if="value && project.categoriesById.get(value)" :label="project.categoriesById.get(value)!.name" :color="project.categoriesById.get(value)!.color" />
          <span v-else class="muted">{{ $t('Aucune') }}</span>
        </template>
        <template #option="{ option }"><ColorChip :label="option.name" :color="option.color" /></template>
      </Select>
    </div>

    <div v-if="project.components.length && project.fieldOn('components')" class="field">
      <label>{{ $t('Composants') }}</label>
      <MultiSelect
        :model-value="values.componentIds"
        :options="project.components"
        option-label="name"
        option-value="id"
        :placeholder="$t('Aucun')"
        filter
        :disabled="disabled"
        @update:model-value="(value: number[]) => emit('change', { componentIds: value })"
      >
        <template #value="{ value }">
          <span v-if="value?.length" class="chips">
            <template v-for="id in value" :key="id">
              <ColorChip v-if="project.componentsById.get(id)" :label="project.componentsById.get(id)!.name" :color="project.componentsById.get(id)!.color" :icon="project.componentsById.get(id)!.icon" />
            </template>
          </span>
          <span v-else class="muted">{{ $t('Aucun') }}</span>
        </template>
        <template #option="{ option }"><ColorChip :label="option.name" :color="option.color" :icon="option.icon" /></template>
      </MultiSelect>
    </div>

    <div v-if="project.fieldOn('delivery')" class="field">
      <label>{{ $t('Livraison ciblée') }}</label>
      <Select
        :model-value="values.deliveryId"
        :options="project.deliveries"
        option-label="name"
        option-value="id"
        :placeholder="$t('Aucune')"
        show-clear
        :disabled="disabled"
        @update:model-value="(value: number | null) => emit('change', { deliveryId: value ?? null })"
      />
      <small v-if="initialDelivery" class="slip"><i class="pi pi-history"></i> {{ $t('Livraison initiale : {name} (reporté)', { name: initialDelivery.name }) }}</small>
    </div>

    <div v-if="project.fieldOn('dates')" class="dates">
      <div class="field">
        <label>{{ $t('Début') }}</label>
        <DatePicker v-model="startDate" date-format="dd/mm/yy" show-week show-icon show-button-bar :max-date="maxStart" :disabled="disabled" :placeholder="$t('jj/mm/aaaa')" icon-display="input" />
      </div>
      <div class="field">
        <label>{{ $t('Fin') }}</label>
        <DatePicker v-model="endDate" date-format="dd/mm/yy" show-week show-icon show-button-bar :min-date="minEnd" :disabled="disabled" :placeholder="$t('jj/mm/aaaa')" icon-display="input" />
      </div>
    </div>
    <small v-if="delivery && !values.startDate && !values.endDate && project.fieldOn('dates')" class="hint muted"> {{ $t('Sans dates propres, le ticket suit la livraison « {name} ».', { name: delivery.name }) }} </small>

    <div v-if="project.fieldOn('assignees')" class="field">
      <div class="label-row">
        <label>{{ $t('Assignés') }}</label>
        <button v-if="canAssignMe" type="button" class="assign-me" @click="assignMe"><i class="pi pi-user-plus"></i> {{ $t('M’assigner') }}</button>
      </div>
      <MultiSelect
        :model-value="values.assigneeIds"
        :options="project.users"
        option-label="name"
        option-value="id"
        :placeholder="$t('Personne')"
        display="chip"
        filter
        :disabled="disabled"
        @update:model-value="(value: number[]) => emit('change', { assigneeIds: value })"
      >
        <template #option="{ option }">
          <span class="row"><UserAvatar :user="option" size="small" /> {{ option.name }}</span>
        </template>
      </MultiSelect>
    </div>
  </div>
</template>

<style scoped>
.grid {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
.dates {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.slip {
  color: #d97706;
  font-weight: 600;
}
.hint {
  margin-top: -0.4rem;
}
.label-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}
.assign-me {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0;
  border: 0;
  background: none;
  color: var(--fb-accent);
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}
.assign-me:hover {
  text-decoration: underline;
}
.assign-me i {
  font-size: 0.75rem;
}
</style>
