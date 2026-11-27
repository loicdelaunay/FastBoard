<script setup lang="ts">
import { computed } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import { STATUS_META } from '@shared/constants';
import { addDays, formatDateShort, todayISO } from '@shared/dates';
import type { HomeBlock } from '@shared/homeLayout';
import type { TicketDTO } from '@shared/types';
import { dueDate, isOverdue } from '@/utils/tickets';
import HomeBlockFrame from '../HomeBlockFrame.vue';
import { useHomeSources } from '../homeContext';

/**
 * Mes tickets en retard (« En retard ») ou qui arrivent à échéance dans les prochains jours (« Échéances à venir »),
 * l'échéance du ticket, ou à défaut celle de sa livraison.
 */
const props = defineProps<{ block: HomeBlock }>();
const { board } = useHomeSources();
board.ensure();

const late = computed(() => props.block.type === 'overdue');
const days = computed(() => props.block.options.days ?? 7);
const projectId = computed(() => props.block.options.projectId ?? null);
const projects = computed(() => new Map((board.data.value?.projects ?? []).map((entry) => [entry.project.id, entry.project])));

const entries = computed(() => {
  const data = board.data.value;
  if (!data) return [];
  const today = todayISO();
  const until = addDays(today, days.value);
  const deliveries = new Map(data.deliveries.map((delivery) => [delivery.id, delivery]));
  const result: Array<{ ticket: TicketDTO; due: string }> = [];
  for (const ticket of data.tickets) {
    if (ticket.status === 'done' || (projectId.value !== null && ticket.projectId !== projectId.value)) continue;
    const delivery = ticket.deliveryId ? deliveries.get(ticket.deliveryId) : undefined;
    const due = dueDate(ticket, delivery);
    if (!due) continue;
    if (late.value ? isOverdue(ticket, delivery, today) : due >= today && due <= until) result.push({ ticket, due });
  }
  return result.sort((a, b) => a.due.localeCompare(b.due) || b.ticket.id - a.ticket.id);
});
const shown = computed(() => entries.value.slice(0, props.block.options.limit ?? 10));
const keyOf = (ticket: TicketDTO): string => `${projects.value.get(ticket.projectId)?.key ?? '#'}-${ticket.number}`;
const ticketRoute = (ticket: TicketDTO): RouteLocationRaw => ({ name: 'project', params: { projectId: ticket.projectId }, query: { ticket: String(ticket.id) } });
</script>

<template>
  <HomeBlockFrame :block="block" :badge="board.data.value ? entries.length : null">
    <template #extra>
      <span v-if="!late" class="muted small">{{ $t('{n} prochain jour|{n} prochains jours', { n: days }) }}</span>
      <span v-if="projectId !== null && projects.get(projectId)" class="muted small truncate">· {{ projects.get(projectId)!.name }}</span>
    </template>
    <div v-if="!board.data.value" class="state muted small">
      <template v-if="board.failed.value"><i class="pi pi-exclamation-circle"></i> {{ $t('Ce bloc n’a pas pu être chargé.') }}</template>
      <template v-else><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</template>
    </div>
    <ul v-else-if="shown.length" class="rows">
      <li v-for="{ ticket, due } in shown" :key="ticket.id">
        <router-link :to="ticketRoute(ticket)" class="row" draggable="false">
          <span class="status" :style="{ '--s': STATUS_META[ticket.status].color }" :title="$t(STATUS_META[ticket.status].label)"></span>
          <span class="row-text">
            <span class="truncate"><span class="key">{{ keyOf(ticket) }}</span> {{ ticket.title }}</span>
            <span class="muted small truncate">{{ projects.get(ticket.projectId)?.name }} · {{ $t(STATUS_META[ticket.status].label) }}<template v-if="!ticket.endDate"> · {{ $t('échéance de la livraison') }}</template></span>
          </span>
          <span class="due small" :class="{ overdue: late }">{{ formatDateShort(due) }}</span>
        </router-link>
      </li>
    </ul>
    <p v-else class="hint muted small">
      <i class="pi pi-check-circle"></i>
      {{ late ? $t('Aucun de vos tickets n’est en retard.') : $t('Aucune échéance dans les {n} prochains jours.', { n: days }) }}
    </p>
  </HomeBlockFrame>
</template>

<style scoped src="../home.css"></style>
