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
import { partsSummary, ticketProgress } from '@shared/progress';
import type { TicketDTO } from '@shared/types';
import ColorChip from '@/components/common/ColorChip.vue';
import ProgressMeter from '@/components/common/ProgressMeter.vue';
import StatusTag from '@/components/common/StatusTag.vue';
import UserAvatarGroup from '@/components/common/UserAvatarGroup.vue';
import TicketFilterBar from '@/components/project/TicketFilterBar.vue';
import { useTicketFilters } from '@/composables/useTicketFilters';
import { useTicketRoute } from '@/composables/useTicketRoute';
import { useProjectStore } from '@/stores/project';
import { useUiStore } from '@/stores/ui';
import { downloadFile, toCsv } from '@/utils/csv';
import { notifyError } from '@/utils/notify';
import { dueDate, isOverdue, ticketKey } from '@/utils/tickets';

import { t } from '@/i18n';
type GroupBy = 'none' | 'delivery' | 'category' | 'status';

interface Row {
  id: number;
  ticket: TicketDTO;
  key: string;
  number: number;
  title: string;
  categoryName: string;
  categoryColor: string | null;
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
];

const canEdit = computed(() => project.can('ticket.edit') && !project.archived);

const rows = computed<Row[]>(() => {
  const today = todayISO();
  const mapped = filtered.value.map((ticket): Row => {
    const category = ticket.categoryId ? project.categoriesById.get(ticket.categoryId) : undefined;
    const delivery = ticket.deliveryId ? project.deliveriesById.get(ticket.deliveryId) : undefined;
    const group =
      groupBy.value === 'delivery' ? (delivery?.name ?? t('Sans livraison'))
      : groupBy.value === 'category' ? (category?.name ?? t('Sans catégorie'))
      : groupBy.value === 'status' ? project.statusMeta(ticket.status).label
      : '';
    const groupOrder =
      groupBy.value === 'delivery' ? (delivery ? `0${delivery.startDate}${delivery.name}` : '1')
      : groupBy.value === 'category' ? (category ? `0${String(category.position).padStart(4, '0')}` : '1')
      : groupBy.value === 'status' ? String(project.statusOrder.get(ticket.status) ?? 0).padStart(2, '0')
      : '';
    return {
      id: ticket.id,
      ticket,
      key: ticketKey(project.project, ticket),
      number: ticket.number,
      title: ticket.title,
      categoryName: category?.name ?? '',
      categoryColor: category?.color ?? null,
      statusLabel: project.statusMeta(ticket.status).label,
      statusOrder: project.statusOrder.get(ticket.status) ?? 0,
      deliveryName: delivery?.name ?? '',
      deliveryColor: delivery?.color ?? null,
      progress: ticketProgress(ticket),
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
  const header = [t('Clé'), t('Titre'), t('Description'), t('Statut'), t('Catégorie'), t('Livraison'), t('Début'), t('Fin'), t('Progression (%)'), t('Assignés'), t('Parts terminées'), t('Commentaires')];
  const lines = rows.value.map((row) => {
    const summary = partsSummary(row.ticket);
    return [
      row.key,
      row.title,
      row.ticket.description,
      row.statusLabel,
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
        <Column field="categoryName" :header="$t('Catégorie')" :sortable="groupBy === 'none'" style="width: 10rem">
          <template #body="{ data }"><ColorChip v-if="data.categoryColor" :label="data.categoryName" :color="data.categoryColor" /></template>
        </Column>
        <Column field="statusOrder" :header="$t('Statut')" :sortable="groupBy === 'none'" style="width: 9rem">
          <template #body="{ data }">
            <button type="button" class="status-btn" :disabled="!canEdit" :aria-label="$t('Statut : {statusLabel}', { statusLabel: data.statusLabel })" @click.stop="openStatusMenu($event, data.ticket)">
              <StatusTag :status="data.ticket.status" />
            </button>
          </template>
        </Column>
        <Column :header="$t('Assignés')" style="width: 9rem">
          <template #body="{ data }">
            <UserAvatarGroup v-if="data.assignees.length" :users="data.assignees" :highlight-ids="data.doneIds" :max="4" />
            <span v-else class="muted small">—</span>
          </template>
        </Column>
        <Column field="progress" :header="$t('Progression')" :sortable="groupBy === 'none'" style="width: 10rem">
          <template #body="{ data }"><ProgressMeter :value="data.progress" /></template>
        </Column>
        <Column field="deliveryName" :header="$t('Livraison')" :sortable="groupBy === 'none'" style="width: 10rem">
          <template #body="{ data }"><ColorChip v-if="data.deliveryColor" :label="data.deliveryName" :color="data.deliveryColor" icon="pi pi-truck" /></template>
        </Column>
        <Column field="start" :header="$t('Début')" :sortable="groupBy === 'none'" style="width: 7rem">
          <template #body="{ data }">{{ data.ticket.startDate ? formatDateShort(data.ticket.startDate) : '' }}</template>
        </Column>
        <Column field="end" :header="$t('Échéance')" :sortable="groupBy === 'none'" style="width: 7.5rem">
          <template #body="{ data }">
            <span :class="{ late: data.overdue }">{{ data.end ? formatDateShort(data.end) : '' }}</span>
          </template>
        </Column>
        <Column header="" style="width: 6rem">
          <template #body="{ data }">
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
