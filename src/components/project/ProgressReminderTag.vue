<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Popover from 'primevue/popover';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/project';
import { formatRelative } from '@/utils/format';
import { ticketKey } from '@/utils/tickets';

/**
 * Rappel d'avancement (réglage « Automatisation » du projet) : la personne connectée voit combien de ses tickets « En
 * cours » d'une livraison en cours attendent une mise à jour de son avancement, et les ouvre depuis la liste.
 */
const project = useProjectStore();
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const panel = ref<InstanceType<typeof Popover> | null>(null);

const tickets = computed(() => project.remindersFor(auth.user?.id));
const rows = computed(() =>
  tickets.value.map((ticket) => {
    const last = ticket.progressUpdates.find((update) => update.userId === auth.user?.id)?.at ?? null;
    return {
      ticket,
      key: ticketKey(project.project, ticket),
      delivery: ticket.deliveryId === null ? '' : (project.deliveriesById.get(ticket.deliveryId)?.name ?? ''),
      last,
    };
  }),
);

function open(ticketId: number): void {
  panel.value?.hide();
  void router.replace({ query: { ...route.query, ticket: String(ticketId) } });
}
</script>

<template>
  <template v-if="tickets.length">
    <button
      v-tooltip.bottom="$t('Pensez à mettre à jour votre avancement')"
      type="button"
      class="reminder-tag"
      aria-haspopup="dialog"
      @click="panel?.toggle($event)"
    >
      <i class="pi pi-info-circle" aria-hidden="true"></i>
      <span>{{ $t('{n} avancement à mettre à jour|{n} avancements à mettre à jour', { n: tickets.length }) }}</span>
    </button>
    <Popover ref="panel">
      <div class="reminder-panel">
        <p class="intro small">
          {{ $t('Ces tickets sont en cours dans une livraison en cours. Mettez à jour au moins le pourcentage de votre ligne, ou laissez un commentaire de progression.') }}
        </p>
        <ul class="list">
          <li v-for="row in rows" :key="row.ticket.id">
            <button type="button" class="item" @click="open(row.ticket.id)">
              <span class="key">{{ row.key }}</span>
              <span class="title truncate">{{ row.ticket.title }}</span>
              <span class="meta muted small truncate">
                <template v-if="row.delivery"><i class="pi pi-truck"></i> {{ row.delivery }} · </template>
                {{ row.last ? $t('dernière mise à jour {when}', { when: formatRelative(row.last) }) : $t('jamais mis à jour') }}
              </span>
            </button>
          </li>
        </ul>
      </div>
    </Popover>
  </template>
</template>

<style scoped>
.reminder-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.7rem;
  border: 1px solid color-mix(in srgb, #0ea5e9 45%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, #0ea5e9 12%, transparent);
  color: #0369a1;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}
:global(.app-dark) .reminder-tag {
  color: #7dd3fc;
}
.reminder-tag:hover {
  background: color-mix(in srgb, #0ea5e9 20%, transparent);
}
.reminder-panel {
  width: min(24rem, calc(100vw - 2rem));
}
.intro {
  margin: 0 0 0.6rem;
  color: var(--fb-muted);
}
.list {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.1rem 0.5rem;
  width: 100%;
  padding: 0.45rem 0.5rem;
  border: 0;
  border-radius: 8px;
  background: none;
  color: var(--fb-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.item:hover,
.item:focus-visible {
  background: var(--fb-panel-alt);
  outline: none;
}
.key {
  color: var(--fb-muted);
  font-size: 0.78rem;
  font-weight: 700;
}
.title {
  font-weight: 600;
}
.meta {
  grid-column: 2;
}
</style>
