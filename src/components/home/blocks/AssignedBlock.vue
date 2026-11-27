<script setup lang="ts">
import { computed } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import { STATUS_META } from '@shared/constants';
import { formatDateShort, todayISO } from '@shared/dates';
import type { HomeTicketDTO } from '@shared/home';
import type { HomeBlock } from '@shared/homeLayout';
import HomeBlockFrame from '../HomeBlockFrame.vue';
import { useHomeSources } from '../homeContext';

/** Tickets ouverts dont ma part n'est pas finie, les plus proches de leur échéance d'abord. */
const props = defineProps<{ block: HomeBlock }>();
const { home } = useHomeSources();
const today = todayISO();
const all = computed(() => home.value?.assigned ?? []);
const shown = computed(() => all.value.slice(0, props.block.options.limit ?? 20));
const overdue = (ticket: HomeTicketDTO): boolean => Boolean(ticket.endDate && ticket.endDate < today);
const lateCount = computed(() => all.value.filter(overdue).length);
const ticketRoute = (ticket: HomeTicketDTO): RouteLocationRaw => ({ name: 'project', params: { projectId: ticket.projectId }, query: { ticket: String(ticket.id) } });
</script>

<template>
  <HomeBlockFrame :block="block" :badge="all.length">
    <template #extra>
      <span v-if="lateCount" class="late small">{{ $t('{n} en retard', { n: lateCount }) }}</span>
    </template>
    <ul v-if="shown.length" class="rows">
      <li v-for="ticket in shown" :key="ticket.id">
        <router-link :to="ticketRoute(ticket)" class="row" draggable="false">
          <span class="status" :style="{ '--s': STATUS_META[ticket.status].color }" :title="$t(STATUS_META[ticket.status].label)"></span>
          <span class="row-text">
            <span class="truncate"><span class="key">{{ ticket.key }}</span> {{ ticket.title }}</span>
            <span class="muted small truncate">{{ ticket.projectName }} · {{ $t(STATUS_META[ticket.status].label) }}<template v-if="ticket.progress"> · {{ ticket.progress }} %</template></span>
          </span>
          <span v-if="ticket.endDate" class="due small" :class="{ overdue: overdue(ticket) }">{{ formatDateShort(ticket.endDate) }}</span>
        </router-link>
      </li>
    </ul>
    <p v-else class="hint muted small">{{ $t('Rien ne vous est assigné pour l’instant.') }}</p>
    <router-link v-if="all.length > shown.length" :to="{ name: 'my-board' }" class="more small see-all" draggable="false">{{ $t('Voir les {n} dans Mon tableau', { n: all.length }) }}</router-link>
  </HomeBlockFrame>
</template>

<style scoped src="../home.css"></style>
<style scoped>
.see-all {
  display: block;
  margin-top: 0.4rem;
  text-align: right;
}
</style>
