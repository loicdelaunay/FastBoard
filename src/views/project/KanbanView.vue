<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { TicketStatus } from '@shared/constants';
import { todayISO } from '@shared/dates';
import { defaultDoneVisibility, doneTicketHidden, isDoneVisibility, type DoneVisibility } from '@shared/doneVisibility';
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
const { filtered, filters } = useTicketFilters();
const { openTicket } = useTicketRoute();
const dnd = useKanbanDnd();

const board = ref<HTMLElement | null>(null);

const canMove = computed(() => project.can('ticket.edit') && !project.archived);
const canCreate = computed(() => project.can('ticket.create') && !project.archived);

// --- Tickets terminés montrés : le choix de chacun (menu ⋯ de « Terminé »), sinon l'automatisation du projet ---
const doneKey = computed(() => `fb.kanban.done.${project.project?.id ?? 0}`);
const doneChoice = ref<DoneVisibility | null>(null);
watch(
  doneKey,
  (key) => {
    try {
      const stored = localStorage.getItem(key);
      doneChoice.value = isDoneVisibility(stored) ? stored : null;
    } catch {
      doneChoice.value = null;
    }
  },
  { immediate: true },
);
const doneDefault = computed(() => defaultDoneVisibility(project.settings));
const doneMode = computed(() => doneChoice.value ?? doneDefault.value);
function setDoneMode(mode: DoneVisibility): void {
  // Revenir au mode du projet efface le choix : un changement de l'automatisation s'applique de nouveau.
  doneChoice.value = mode === doneDefault.value ? null : mode;
  try {
    if (doneChoice.value) localStorage.setItem(doneKey.value, doneChoice.value);
    else localStorage.removeItem(doneKey.value);
  } catch {
    // Stockage indisponible : le choix vaut pour cette page.
  }
}
/** Une recherche trouve aussi les tickets masqués. */
const searching = computed(() => Boolean(filters.search.trim()));

const layout = computed(() => {
  const statuses = project.visibleColumns.map((column) => column.status);
  const byStatus = new Map<TicketStatus, TicketDTO[]>(statuses.map((status) => [status, []]));
  const today = todayISO();
  let hidden = 0;
  let revealed = 0;
  for (const ticket of filtered.value) {
    if (doneTicketHidden(ticket, doneMode.value, project.deliveriesById, today)) {
      if (!searching.value) {
        hidden += 1;
        continue;
      }
      revealed += 1;
    }
    byStatus.get(ticket.status)?.push(ticket);
  }
  for (const [status, list] of byStatus) {
    const sort = project.settings.columnSort[status];
    list.sort(sort ? ticketComparator(sort) : (a, b) => a.position - b.position || a.id - b.id);
  }
  return { hidden, revealed, columns: statuses.map((status) => ({ status, tickets: byStatus.get(status) ?? [], sorted: Boolean(project.settings.columnSort[status]) })) };
});
const columns = computed(() => layout.value.columns);
/** Tickets terminés masqués, et ceux qu'une recherche montre malgré tout. */
const doneCounts = computed(() => ({ hidden: layout.value.hidden, revealed: layout.value.revealed }));

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
        :done="column.status === 'done' ? { mode: doneMode, defaultMode: doneDefault, hidden: doneCounts.hidden, revealed: doneCounts.revealed } : undefined"
        @open="openTicket"
        @done-mode="setDoneMode"
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
