<script setup lang="ts">
import { computed } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import { STATUS_META, TICKET_STATUSES, type TicketStatus } from '@shared/constants';
import type { HomeBlock } from '@shared/homeLayout';
import { emptyTicketFilters, filtersToQuery } from '@shared/ticketFilters';
import HomeBlockFrame from '../HomeBlockFrame.vue';
import { useHomeSources } from '../homeContext';

/** Combien de mes tickets dans chaque statut, dans tous mes projets ou un seul ; un clic ouvre « Mon tableau » filtré. */
const props = defineProps<{ block: HomeBlock }>();
const { board } = useHomeSources();
board.ensure();

const projectId = computed(() => props.block.options.projectId ?? null);
const projectName = computed(() => board.data.value?.projects.find((entry) => entry.project.id === projectId.value)?.project.name ?? '');
const tickets = computed(() => (board.data.value?.tickets ?? []).filter((ticket) => projectId.value === null || ticket.projectId === projectId.value));
const counts = computed(() =>
  TICKET_STATUSES.filter((status) => !(props.block.options.hideDone && status === 'done')).map((status) => ({ status, count: tickets.value.filter((ticket) => ticket.status === status).length })),
);
const total = computed(() => counts.value.reduce((sum, entry) => sum + entry.count, 0));
const max = computed(() => Math.max(1, ...counts.value.map((entry) => entry.count)));
const statusRoute = (status: TicketStatus): RouteLocationRaw => ({
  name: 'my-list',
  query: filtersToQuery({ ...emptyTicketFilters(), statuses: [status], projectIds: projectId.value === null ? [] : [projectId.value] }),
});
</script>

<template>
  <HomeBlockFrame :block="block" :badge="board.data.value ? total : null">
    <template #extra>
      <span v-if="projectName" class="muted small truncate">{{ projectName }}</span>
    </template>
    <div v-if="!board.data.value" class="state muted small">
      <template v-if="board.failed.value"><i class="pi pi-exclamation-circle"></i> {{ $t('Ce bloc n’a pas pu être chargé.') }}</template>
      <template v-else><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</template>
    </div>
    <ul v-else class="rows">
      <li v-for="entry in counts" :key="entry.status">
        <router-link :to="statusRoute(entry.status)" class="row status-row" draggable="false">
          <i :class="STATUS_META[entry.status].icon" class="row-icon" :style="{ color: STATUS_META[entry.status].color }"></i>
          <span class="label truncate">{{ $t(STATUS_META[entry.status].label) }}</span>
          <span class="bar"><span :style="{ width: `${(entry.count / max) * 100}%`, '--c': STATUS_META[entry.status].color }"></span></span>
          <strong class="number">{{ entry.count }}</strong>
        </router-link>
      </li>
    </ul>
  </HomeBlockFrame>
</template>

<style scoped src="../home.css"></style>
<style scoped>
.status-row {
  padding-block: 0.35rem;
}
.label {
  flex: none;
  width: 6.5rem;
  font-size: 0.9rem;
}
.status-row .bar {
  flex: 1;
}
.number {
  flex: none;
  min-width: 1.6rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
