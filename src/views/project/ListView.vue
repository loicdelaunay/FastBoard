<script setup lang="ts">
import { computed, ref } from 'vue';
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Menu from 'primevue/menu';
import type { MenuItem } from 'primevue/menuitem';
import Select from 'primevue/select';
import type { TicketStatus } from '@shared/constants';
import { formatDateShort, todayISO } from '@shared/dates';
import { partsSummary } from '@shared/progress';
import { progressOf } from '@/utils/progress';
import type { TicketDTO } from '@shared/types';
import ColorChip from '@/components/common/ColorChip.vue';
import ColumnValueFilter from '@/components/common/ColumnValueFilter.vue';
import ProgressMeter from '@/components/common/ProgressMeter.vue';
import StatusTag from '@/components/common/StatusTag.vue';
import UserAvatarGroup from '@/components/common/UserAvatarGroup.vue';
import TicketFilterBar from '@/components/project/TicketFilterBar.vue';
import { useColumnFilters } from '@/composables/useColumnFilters';
import { useTicketFilters } from '@/composables/useTicketFilters';
import { useTicketRoute } from '@/composables/useTicketRoute';
import { useProjectStore } from '@/stores/project';
import { useUiStore } from '@/stores/ui';
import { downloadFile, toCsv } from '@/utils/csv';
import { notifyError } from '@/utils/notify';
import { plainText } from '@/utils/mentions';
import { dueDate, isOverdue, ticketKey } from '@/utils/tickets';

import { t } from '@/i18n';
type GroupBy = 'none' | 'delivery' | 'category' | 'status' | 'priority';

interface Row {
  id: number;
  ticket: TicketDTO;
  key: string;
  number: number;
  title: string;
  categoryName: string;
  categoryColor: string | null;
  priorityName: string;
  /** Rang de priorité pour le tri (sans priorité = en dernier). */
  priorityRank: number;
  componentNames: string[];
  assigneeNames: string[];
  statusLabel: string;
  statusOrder: number;
  deliveryName: string;
  deliveryColor: string | null;
  progress: number;
  start: string;
  end: string;
  overdue: boolean;
  assignees: Array<{ id: number; name: string; avatarVersion: number }>;
  doneIds: number[];
  group: string;
  groupOrder: string;
}

const project = useProjectStore();
const ui = useUiStore();
const { filtered } = useTicketFilters();
const { openTicket } = useTicketRoute();

const groupBy = ref<GroupBy>('none');
const groupOptions = [
  { label: t('Pas de regroupement'), value: 'none' },
  { label: t('Par livraison'), value: 'delivery' },
  { label: t('Par catégorie'), value: 'category' },
  { label: t('Par statut'), value: 'status' },
  { label: t('Par priorité'), value: 'priority' },
];

const canEdit = computed(() => project.can('ticket.edit') && !project.archived);

const rows = computed<Row[]>(() => {
  const today = todayISO();
  const mapped = filtered.value.map((ticket): Row => {
    const category = ticket.categoryId ? project.categoriesById.get(ticket.categoryId) : undefined;
    const delivery = ticket.deliveryId ? project.deliveriesById.get(ticket.deliveryId) : undefined;
    const priority = ticket.priorityId ? project.prioritiesById.get(ticket.priorityId) : undefined;
    const priorityRank = ticket.priorityId !== null ? (project.priorityRank.get(ticket.priorityId) ?? 999) : 999;
    const group =
      groupBy.value === 'delivery' ? (delivery?.name ?? t('Sans livraison'))
      : groupBy.value === 'category' ? (category?.name ?? t('Sans catégorie'))
      : groupBy.value === 'status' ? project.statusMeta(ticket.status).label
      : groupBy.value === 'priority' ? (priority?.name ?? t('Sans priorité'))
      : '';
    const groupOrder =
      groupBy.value === 'delivery' ? (delivery ? `0${delivery.startDate}${delivery.name}` : '1')
      : groupBy.value === 'category' ? (category ? `0${String(category.position).padStart(4, '0')}` : '1')
      : groupBy.value === 'status' ? String(project.statusOrder.get(ticket.status) ?? 0).padStart(2, '0')
      : groupBy.value === 'priority' ? String(priorityRank).padStart(4, '0')
      : '';
    return {
      id: ticket.id,
      ticket,
      key: ticketKey(project.project, ticket),
      number: ticket.number,
      title: ticket.title,
      categoryName: category?.name ?? '',
      categoryColor: category?.color ?? null,
      priorityName: priority?.name ?? '',
      priorityRank,
      componentNames: ticket.componentIds.flatMap((id) => project.componentsById.get(id)?.name ?? []),
      assigneeNames: ticket.assignees.flatMap((assignee) => project.usersById.get(assignee.userId)?.name ?? []),
      statusLabel: project.statusMeta(ticket.status).label,
      statusOrder: project.statusOrder.get(ticket.status) ?? 0,
      deliveryName: delivery?.name ?? '',
      deliveryColor: delivery?.color ?? null,
      progress: progressOf(ticket),
      start: ticket.startDate ?? '',
      end: dueDate(ticket, delivery) ?? '',
      overdue: isOverdue(ticket, delivery, today),
      assignees: ticket.assignees.flatMap((assignee) => {
        const user = project.usersById.get(assignee.userId);
        return user ? [{ id: user.id, name: user.name, avatarVersion: user.avatarVersion }] : [];
      }),
      doneIds: ticket.assignees.filter((assignee) => assignee.done).map((assignee) => assignee.userId),
      group,
      groupOrder,
    };
  });
  if (groupBy.value === 'none') {
    return mapped.sort((a, b) => a.number - b.number);
  }
  return mapped.sort((a, b) => a.groupOrder.localeCompare(b.groupOrder) || a.number - b.number);
});

// --- Filtres par valeur dans les en-têtes ---
const columnFilters = useColumnFilters(rows, ['categoryName', 'priorityName', 'componentNames', 'statusLabel', 'assigneeNames', 'deliveryName']);
const filterProps = { showFilterMatchModes: false, showFilterOperator: false, showAddButton: false, showApplyButton: false, showClearButton: true } as const;

// --- Changement de statut rapide ---
const statusMenu = ref<InstanceType<typeof Menu> | null>(null);
const statusTicket = ref<TicketDTO | null>(null);
const statusItems = computed<MenuItem[]>(() =>
  project.visibleColumns.map(({ status }) => ({
    label: project.statusMeta(status).label,
    icon: project.statusMeta(status).icon,
    disabled: status === statusTicket.value?.status,
    command: () => void changeStatus(status),
  })),
);

function openStatusMenu(event: MouseEvent, ticket: TicketDTO): void {
  if (!canEdit.value) {
    return;
  }
  statusTicket.value = ticket;
  statusMenu.value?.toggle(event);
}

async function changeStatus(status: TicketStatus): Promise<void> {
  if (!statusTicket.value) {
    return;
  }
  try {
    await project.moveTicket(statusTicket.value.id, status, null);
  } catch (error) {
    notifyError(error, t('Changement de statut impossible'));
  }
}

function exportCsv(): void {
  const header = [t('Clé'), t('Titre'), t('Description'), t('Statut'), t('Priorité'), t('Composants'), t('Catégorie'), t('Livraison'), t('Début'), t('Fin'), t('Progression (%)'), t('Assignés'), t('Parts terminées'), t('Commentaires')];
  const lines = rows.value.map((row) => {
    const summary = partsSummary(row.ticket);
    return [
      row.key,
      row.title,
      plainText(row.ticket.description),
      row.statusLabel,
      row.priorityName,
      row.componentNames.join(', '),
      row.categoryName,
      row.deliveryName,
      row.ticket.startDate ?? '',
      row.end,
      row.progress,
      row.assignees.map((user) => user.name).join(', '),
      summary.total ? `${summary.done}/${summary.total}` : '',
      row.ticket.commentCount,
    ];
  });
  const name = (project.project?.key ?? 'tickets').toLowerCase();
  downloadFile(`${name}-tickets-${todayISO()}.csv`, toCsv([header, ...lines]));
}
</script>

<template>
  <div class="list-view">
    <div class="bar">
      <TicketFilterBar :total="project.tickets.length" :shown="filtered.length" />
      <div class="tools">
        <Button v-if="columnFilters.activeCount.value" :label="$t('Filtres de colonnes ({n})', { n: columnFilters.activeCount.value })" icon="pi pi-filter-slash" text size="small" @click="columnFilters.clear" />
        <Select v-model="groupBy" :options="groupOptions" option-label="label" option-value="value" class="group-select" :aria-label="$t('Regrouper')" />
        <Button :label="$t('Exporter CSV')" icon="pi pi-download" severity="secondary" outlined size="small" :disabled="!rows.length" @click="exportCsv" />
      </div>
    </div>

    <div class="table-wrap">
      <DataTable
        :value="rows"
        data-key="id"
        size="small"
        row-hover
        paginator
        :rows="25"
        :rows-per-page-options="[25, 50, 100]"
        :row-group-mode="groupBy === 'none' ? undefined : 'subheader'"
        :group-rows-by="groupBy === 'none' ? undefined : 'group'"
        removable-sort
        v-model:filters="columnFilters.filters.value"
        filter-display="menu"
        scrollable
        scroll-height="flex"
        class="table"
        :row-class="(row: Row) => (project.flashes[row.id] ? 'flash' : '')"
        @row-click="(event) => openTicket(event.data.id)"
        @row-contextmenu="(event: { originalEvent: Event; data: Row }) => ui.openTicketMenu(event.originalEvent as MouseEvent, event.data.id)"
      >
        <template #empty><p class="empty muted">{{ $t('Aucun ticket ne correspond aux filtres.') }}</p></template>
        <template #groupheader="{ data }">
          <span class="group-title">{{ data.group }}</span>
        </template>

        <Column field="number" :header="$t('Clé')" :sortable="groupBy === 'none'" style="width: 6rem">
          <template #body="{ data }"><span class="key">{{ data.key }}</span></template>
        </Column>
        <Column field="title" :header="$t('Titre')" :sortable="groupBy === 'none'" style="min-width: 18rem">
          <template #body="{ data }"><span class="title">{{ data.title }}</span></template>
        </Column>
        <Column v-if="project.fieldOn('priority')" field="priorityRank" filter-field="priorityName" :header="$t('Priorité')" :sortable="groupBy === 'none'" v-bind="filterProps" style="width: 8.5rem">
          <template #body="{ data }">
            <ColorChip v-if="data.ticket.priorityId && project.prioritiesById.get(data.ticket.priorityId)" :label="data.priorityName" :color="project.prioritiesById.get(data.ticket.priorityId)!.color" :icon="project.prioritiesById.get(data.ticket.priorityId)!.icon" />
          </template>
          <template #filter="{ filterModel, filterCallback }"><ColumnValueFilter :filter-model="filterModel" :options="columnFilters.optionsFor('priorityName')" @apply="filterCallback()" /></template>
        </Column>
        <Column v-if="project.fieldOn('category')" field="categoryName" :header="$t('Catégorie')" :sortable="groupBy === 'none'" v-bind="filterProps" style="width: 10rem">
          <template #body="{ data }"><ColorChip v-if="data.categoryColor" :label="data.categoryName" :color="data.categoryColor" /></template>
          <template #filter="{ filterModel, filterCallback }"><ColumnValueFilter :filter-model="filterModel" :options="columnFilters.optionsFor('categoryName')" @apply="filterCallback()" /></template>
        </Column>
        <Column v-if="project.components.length && project.fieldOn('components')" field="componentNames" :header="$t('Composants')" v-bind="filterProps" style="width: 11rem">
          <template #body="{ data }">
            <span class="chips">
              <template v-for="id in data.ticket.componentIds" :key="id">
                <ColorChip v-if="project.componentsById.get(id)" :label="project.componentsById.get(id)!.name" :color="project.componentsById.get(id)!.color" :icon="project.componentsById.get(id)!.icon" />
              </template>
            </span>
          </template>
          <template #filter="{ filterModel, filterCallback }"><ColumnValueFilter :filter-model="filterModel" :options="columnFilters.optionsFor('componentNames')" @apply="filterCallback()" /></template>
        </Column>
        <Column field="statusOrder" filter-field="statusLabel" :header="$t('Statut')" :sortable="groupBy === 'none'" v-bind="filterProps" style="width: 9rem">
          <template #filter="{ filterModel, filterCallback }"><ColumnValueFilter :filter-model="filterModel" :options="columnFilters.optionsFor('statusLabel')" @apply="filterCallback()" /></template>
          <template #body="{ data }">
            <button type="button" class="status-btn" :disabled="!canEdit" :aria-label="$t('Statut : {statusLabel}', { statusLabel: data.statusLabel })" @click.stop="openStatusMenu($event, data.ticket)">
              <StatusTag :status="data.ticket.status" />
            </button>
          </template>
        </Column>
        <Column v-if="project.fieldOn('assignees')" filter-field="assigneeNames" :header="$t('Assignés')" v-bind="filterProps" style="width: 9rem">
          <template #filter="{ filterModel, filterCallback }"><ColumnValueFilter :filter-model="filterModel" :options="columnFilters.optionsFor('assigneeNames')" @apply="filterCallback()" /></template>
          <template #body="{ data }">
            <UserAvatarGroup v-if="data.assignees.length" :users="data.assignees" :highlight-ids="data.doneIds" :max="4" />
            <span v-else class="muted small">—</span>
          </template>
        </Column>
        <Column v-if="project.fieldOn('progress')" field="progress" :header="$t('Progression')" :sortable="groupBy === 'none'" style="width: 10rem">
          <template #body="{ data }"><ProgressMeter :value="data.progress" /></template>
        </Column>
        <Column v-if="project.fieldOn('delivery')" field="deliveryName" :header="$t('Livraison')" :sortable="groupBy === 'none'" v-bind="filterProps" style="width: 10rem">
          <template #filter="{ filterModel, filterCallback }"><ColumnValueFilter :filter-model="filterModel" :options="columnFilters.optionsFor('deliveryName')" @apply="filterCallback()" /></template>
          <template #body="{ data }"><ColorChip v-if="data.deliveryColor" :label="data.deliveryName" :color="data.deliveryColor" icon="pi pi-truck" /></template>
        </Column>
        <Column v-if="project.fieldOn('dates')" field="start" :header="$t('Début')" :sortable="groupBy === 'none'" style="width: 7rem">
          <template #body="{ data }">{{ data.ticket.startDate ? formatDateShort(data.ticket.startDate) : '' }}</template>
        </Column>
        <Column v-if="project.fieldOn('dates')" field="end" :header="$t('Échéance')" :sortable="groupBy === 'none'" style="width: 7.5rem">
          <template #body="{ data }">
            <span :class="{ late: data.overdue }">{{ data.end ? formatDateShort(data.end) : '' }}</span>
          </template>
        </Column>
        <Column header="" style="width: 6rem">
          <template #body="{ data }">
            <span v-if="data.ticket.subtasks.length" class="comments muted small" :title="$t('Sous-tâches')"><i class="pi pi-list-check"></i> {{ data.ticket.subtasks.filter((s: { done: boolean }) => s.done).length }}/{{ data.ticket.subtasks.length }}</span>
            <span v-if="data.ticket.attachmentCount" class="comments muted small" :title="$t('Pièces jointes')"><i class="pi pi-paperclip"></i> {{ data.ticket.attachmentCount }}</span>
            <span v-if="data.ticket.commentCount" class="comments muted small"><i class="pi pi-comment"></i> {{ data.ticket.commentCount }}</span>
          </template>
        </Column>
      </DataTable>
    </div>
    <Menu ref="statusMenu" :model="statusItems" popup />
  </div>
</template>

<style scoped>
.list-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
}
.bar > :first-child {
  flex: 1;
  min-width: 0;
}
.tools {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.group-select {
  width: 12rem;
}
.table-wrap {
  flex: 1;
  min-height: 0;
  padding: 0 1rem 1rem;
}
.table {
  height: 100%;
  border: 1px solid var(--fb-border);
  border-radius: var(--fb-radius);
  overflow: hidden;
}
.table :deep(tr.p-datatable-row-selected),
.table :deep(tbody tr) {
  cursor: pointer;
}
.key {
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.03em;
  color: var(--fb-muted);
  white-space: nowrap;
}
.title {
  font-weight: 600;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem;
}
.comments {
  margin-right: 0.4rem;
  white-space: nowrap;
}
.status-btn {
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}
.status-btn:disabled {
  cursor: default;
}
.late {
  color: var(--fb-danger);
  font-weight: 700;
}
.group-title {
  font-weight: 800;
}
.empty {
  padding: 2rem;
  text-align: center;
}
</style>
