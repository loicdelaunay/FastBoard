<script setup lang="ts">
import { computed, ref } from 'vue';
import type { TicketStatus } from '@shared/constants';
import type { TicketDTO } from '@shared/types';
import DependencyLines from '@/components/kanban/DependencyLines.vue';
import KanbanColumn from '@/components/kanban/KanbanColumn.vue';
import TicketFilterBar from '@/components/project/TicketFilterBar.vue';
import { useKanbanDnd } from '@/composables/useKanbanDnd';
import { useTicketFilters } from '@/composables/useTicketFilters';
import { useTicketRoute } from '@/composables/useTicketRoute';
import { useProjectStore } from '@/stores/project';
import { ticketComparator } from '@/utils/ticketSort';

const project = useProjectStore();
const { filtered } = useTicketFilters();
const { openTicket } = useTicketRoute();
const dnd = useKanbanDnd();

const board = ref<HTMLElement | null>(null);

const canMove = computed(() => project.can('ticket.edit') && !project.archived);
const canCreate = computed(() => project.can('ticket.create') && !project.archived);

const columns = computed(() => {
  const statuses = project.visibleColumns.map((column) => column.status);
  const byStatus = new Map<TicketStatus, TicketDTO[]>(statuses.map((status) => [status, []]));
  for (const ticket of filtered.value) {
    byStatus.get(ticket.status)?.push(ticket);
  }
  for (const [status, list] of byStatus) {
    const sort = project.settings.columnSort[status];
    list.sort(sort ? ticketComparator(sort) : (a, b) => a.position - b.position || a.id - b.id);
  }
  return statuses.map((status) => ({ status, tickets: byStatus.get(status) ?? [], sorted: Boolean(project.settings.columnSort[status]) }));
});

</script>

<template>
  <div class="kanban">
    <div class="bar"><TicketFilterBar :show-status="false" :total="project.tickets.length" :shown="filtered.length" /></div>
    <div class="board-wrap">
    <div ref="board" class="board" @dragover="board && dnd.autoScroll($event, board)">
      <KanbanColumn
        v-for="column in columns"
        :key="column.status"
        :status="column.status"
        :tickets="column.tickets"
        :sorted="column.sorted"
        :can-create="canCreate"
        :can-move="canMove"
        @open="openTicket"
      />
    </div>
    <DependencyLines :container="board" />
    </div>
  </div>
</template>

<style scoped>
.kanban {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.bar {
  padding: 0.75rem 1rem;
}
.board-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}
.board {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  align-items: flex-start;
  gap: 0.85rem;
  padding: 0 1rem 1rem;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type: x proximity;
}
.board > :deep(.column) {
  scroll-snap-align: start;
  max-height: 100%;
}
</style>
