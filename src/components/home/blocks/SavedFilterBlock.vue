<script setup lang="ts">
import { computed, watchEffect } from 'vue';
import Button from 'primevue/button';
import { STATUS_META, type TicketStatus } from '@shared/constants';
import { formatDateShort, todayISO } from '@shared/dates';
import type { HomeBlock } from '@shared/homeLayout';
import { filtersToQuery } from '@shared/ticketFilters';
import type { TicketDTO } from '@shared/types';
import { t } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import { ticketMatchesFilters } from '@/utils/ticketFilterMatch';
import { dueDate, isOverdue } from '@/utils/tickets';
import HomeBlockFrame from '../HomeBlockFrame.vue';
import { useHomeEditor, useHomeSources } from '../homeContext';

/** Les tickets d'un filtre enregistré d'un projet (le mien ou un filtre partagé) : combien, et les premiers. */
const props = defineProps<{ block: HomeBlock }>();
const sources = useHomeSources();
const editor = useHomeEditor();
const { canEdit } = editor;
const auth = useAuthStore();

const projectId = computed(() => props.block.options.projectId ?? null);
const filterId = computed(() => props.block.options.filterId ?? null);
const snapshot = computed(() => (projectId.value === null ? null : sources.snapshot(projectId.value)));
const filters = computed(() => (projectId.value === null ? null : sources.filters(projectId.value)));
watchEffect(() => {
  if (filterId.value === null) return;
  snapshot.value?.ensure();
  filters.value?.ensure();
});

const filter = computed(() => filters.value?.data.value?.find((entry) => entry.id === filterId.value) ?? null);
const loading = computed(() => !snapshot.value?.data.value || !filters.value?.data.value);
const failed = computed(() => Boolean(snapshot.value?.failed.value || filters.value?.failed.value));

const matches = computed(() => {
  const data = snapshot.value?.data.value;
  const values = filter.value?.filters;
  if (!data || !values) return [];
  const today = todayISO();
  const deliveriesById = new Map(data.deliveries.map((delivery) => [delivery.id, delivery]));
  const context = {
    today,
    userId: auth.user?.id,
    deliveriesById,
    categoriesById: new Map(data.categories.map((category) => [category.id, category])),
    usersById: new Map(data.users.map((user) => [user.id, user])),
    key: (ticket: TicketDTO) => `${data.project.key}-${ticket.number}`,
    statusLabel: (status: TicketStatus) => t(STATUS_META[status].label),
  };
  return data.tickets
    .filter((ticket) => ticketMatchesFilters(ticket, values, context))
    .map((ticket) => {
      const delivery = ticket.deliveryId ? deliveriesById.get(ticket.deliveryId) : undefined;
      return { ticket, due: dueDate(ticket, delivery), late: isOverdue(ticket, delivery, today) };
    })
    .sort((a, b) => Number(a.ticket.status === 'done') - Number(b.ticket.status === 'done') || (a.due ?? '9999').localeCompare(b.due ?? '9999') || b.ticket.number - a.ticket.number);
});
const shown = computed(() => matches.value.slice(0, props.block.options.limit ?? 10));
const openRoute = computed(() => (projectId.value === null || !filter.value ? null : { name: 'project', params: { projectId: projectId.value }, query: filtersToQuery(filter.value.filters) }));
const key = (ticket: TicketDTO): string => `${snapshot.value?.data.value?.project.key ?? '#'}-${ticket.number}`;
</script>

<template>
  <HomeBlockFrame :block="block" :badge="filter && !loading ? matches.length : null" :fallback-title="filter?.name">
    <template #extra>
      <span v-if="snapshot?.data.value" class="muted small truncate">{{ snapshot.data.value.project.key }}</span>
      <router-link v-if="openRoute" :to="openRoute" class="more small" draggable="false">{{ $t('Ouvrir dans le projet') }}</router-link>
    </template>
    <div v-if="projectId === null || filterId === null" class="state choose">
      <p class="hint muted small">{{ $t('Choisissez un projet et l’un de ses filtres enregistrés dans les réglages du bloc.') }}</p>
      <Button v-if="canEdit" :label="$t('Choisir un filtre')" icon="pi pi-cog" size="small" outlined @click="editor.configure(block.id)" />
    </div>
    <div v-else-if="loading" class="state muted small">
      <template v-if="failed"><i class="pi pi-exclamation-circle"></i> {{ $t('Ce bloc n’a pas pu être chargé.') }}</template>
      <template v-else><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</template>
    </div>
    <p v-else-if="!filter" class="hint muted small"><i class="pi pi-eye-slash"></i> {{ $t('Ce filtre n’existe plus, ou il n’est plus partagé avec vous.') }}</p>
    <template v-else>
      <p v-if="filter.description" class="description muted small">{{ filter.description }}</p>
      <ul v-if="shown.length" class="rows">
        <li v-for="{ ticket, due, late } in shown" :key="ticket.id">
          <router-link :to="{ name: 'project', params: { projectId: ticket.projectId }, query: { ticket: String(ticket.id) } }" class="row" draggable="false">
            <span class="status" :style="{ '--s': STATUS_META[ticket.status].color }" :title="$t(STATUS_META[ticket.status].label)"></span>
            <span class="row-text">
              <span class="truncate"><span class="key">{{ key(ticket) }}</span> {{ ticket.title }}</span>
              <span class="muted small truncate">{{ $t(STATUS_META[ticket.status].label) }}</span>
            </span>
            <span v-if="due" class="due small" :class="{ overdue: late }">{{ formatDateShort(due) }}</span>
          </router-link>
        </li>
      </ul>
      <p v-else class="hint muted small"><i class="pi pi-check-circle"></i> {{ $t('Aucun ticket ne correspond à ce filtre.') }}</p>
    </template>
  </HomeBlockFrame>
</template>

<style scoped src="../home.css"></style>
<style scoped>
.choose {
  flex-direction: column;
  align-items: flex-start;
}
.description {
  margin: -0.2rem 0 0.4rem;
}
</style>
