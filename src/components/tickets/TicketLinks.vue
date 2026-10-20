<script setup lang="ts">
import { computed, ref } from 'vue';
import AutoComplete from 'primevue/autocomplete';
import Button from 'primevue/button';
import Select from 'primevue/select';
import { LIMITS, LINK_INVERSE, LINK_REASONS } from '@shared/constants';
import type { TicketDTO } from '@shared/types';
import StatusTag from '@/components/common/StatusTag.vue';
import { useTicketRoute } from '@/composables/useTicketRoute';
import { useProjectStore } from '@/stores/project';
import { linkReasonLabel } from '@/utils/historyFormat';
import { notifyError } from '@/utils/notify';
import { matchesQuery } from '@/utils/search';
import { ticketKey } from '@/utils/tickets';

import { t } from '@/i18n';
const props = defineProps<{ ticket: TicketDTO }>();

const project = useProjectStore();
const { openTicket } = useTicketRoute();
const editable = computed(() => project.can('ticket.edit') && !project.archived);

/** Dépendances groupées par raison (vue depuis ce ticket : les raisons entrantes sont inversées). */
const groups = computed(() => {
  const map = new Map<string, Array<{ id: number; other: TicketDTO; incoming: boolean }>>();
  for (const link of project.linksOf(props.ticket.id)) {
    const reason = link.incoming ? (LINK_INVERSE[link.reason] ?? `← ${link.reason}`) : link.reason;
    const list = map.get(reason) ?? [];
    list.push({ id: link.id, other: link.other, incoming: link.incoming });
    map.set(reason, list);
  }
  return [...map.entries()].map(([reason, items]) => ({ reason, items }));
});
const count = computed(() => groups.value.reduce((sum, group) => sum + group.items.length, 0));

const adding = ref(false);
const reason = ref<string>(LINK_REASONS[0]);
const target = ref<TicketDTO | string | null>(null);
const suggestions = ref<TicketDTO[]>([]);
const saving = ref(false);

/** Raisons proposées, plus la saisie libre en cours (Select éditable). */
const reasonOptions = computed(() => LINK_REASONS.map((value) => ({ value, label: linkReasonLabel(value) })));

function search(event: { query: string }): void {
  const linked = new Set(project.linksOf(props.ticket.id).map((link) => link.other.id));
  suggestions.value = project.tickets
    .filter((ticket) => ticket.id !== props.ticket.id && !linked.has(ticket.id) && matchesQuery(event.query, [ticketKey(project.project, ticket), ticket.title]))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 12);
}

async function add(): Promise<void> {
  const chosen = typeof target.value === 'object' ? target.value : null;
  const text = (reason.value ?? '').trim();
  if (!chosen || !text) return;
  saving.value = true;
  try {
    // Une raison proposée est enregistrée en français (clé de traduction), une raison libre telle quelle.
    const stored = LINK_REASONS.find((value) => value === text || linkReasonLabel(value) === text) ?? text;
    await project.addLink(props.ticket.id, chosen.id, stored.slice(0, LIMITS.linkReasonMax));
    target.value = null;
    adding.value = false;
  } catch (error) {
    notifyError(error, t('Dépendance non ajoutée'));
  } finally {
    saving.value = false;
  }
}

async function remove(linkId: number): Promise<void> {
  try {
    await project.deleteLink(linkId);
  } catch (error) {
    notifyError(error);
  }
}
</script>

<template>
  <section class="links">
    <header class="head">
      <h3 class="section-title"><i class="pi pi-link"></i> {{ $t('Dépendances') }}<span v-if="count" class="count">{{ count }}</span></h3>
      <Button v-if="editable && !adding" :label="$t('Ajouter')" icon="pi pi-plus" text size="small" @click="adding = true" />
    </header>

    <div v-for="group in groups" :key="group.reason" class="group">
      <span class="reason">{{ linkReasonLabel(group.reason) }}</span>
      <ul class="list">
        <li v-for="item in group.items" :key="item.id" class="item">
          <button type="button" class="target" @click="openTicket(item.other.id)">
            <span class="key">{{ ticketKey(project.project, item.other) }}</span>
            <span class="truncate" :class="{ done: item.other.status === 'done' }">{{ item.other.title }}</span>
          </button>
          <StatusTag :status="item.other.status" compact />
          <Button
            v-if="editable"
            v-tooltip.top="item.incoming ? $t('Retirer (dépendance portée par l\'autre ticket)') : $t('Retirer')"
            icon="pi pi-times"
            text
            rounded
            size="small"
            severity="secondary"
            :aria-label="$t('Retirer')"
            @click="remove(item.id)"
          />
        </li>
      </ul>
    </div>
    <p v-if="!count && !adding" class="muted small">{{ $t('Aucune dépendance.') }}</p>

    <form v-if="adding" class="add" @submit.prevent="add">
      <Select
        v-model="reason"
        :options="reasonOptions"
        option-label="label"
        option-value="value"
        editable
        size="small"
        class="reason-input"
        :maxlength="LIMITS.linkReasonMax"
        :placeholder="$t('Raison')"
        :aria-label="$t('Raison de la dépendance (liste ou texte libre)')"
      />
      <AutoComplete
        v-model="target"
        :suggestions="suggestions"
        :option-label="(ticket: TicketDTO) => `${ticketKey(project.project, ticket)} — ${ticket.title}`"
        dropdown
        force-selection
        size="small"
        class="target-input"
        :placeholder="$t('Ticket lié (clé ou titre)')"
        :aria-label="$t('Ticket lié')"
        @complete="search"
      />
      <div class="actions">
        <Button type="submit" :label="$t('Lier')" icon="pi pi-check" size="small" :loading="saving" :disabled="!target || typeof target !== 'object' || !reason" />
        <Button type="button" :label="$t('Annuler')" size="small" severity="secondary" text @click="adding = false" />
      </div>
    </form>
  </section>
</template>

<style scoped>
.links {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.section-title {
  margin: 0;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.count {
  padding: 0 0.4rem;
  border-radius: 999px;
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
  font-size: 0.72rem;
}
.group {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.reason {
  color: var(--fb-muted);
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.target {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
  min-width: 0;
  padding: 0.25rem 0.35rem;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.target:hover {
  background: var(--fb-accent-soft);
}
.key {
  flex: none;
  color: var(--fb-accent);
  font-weight: 700;
  font-size: 0.8rem;
}
.done {
  text-decoration: line-through;
  color: var(--fb-muted);
}
.add {
  display: grid;
  grid-template-columns: 11rem minmax(0, 1fr);
  gap: 0.4rem;
}
.actions {
  grid-column: 1 / -1;
  display: flex;
  gap: 0.4rem;
}
.reason-input,
.target-input {
  width: 100%;
}
@media (max-width: 640px) {
  .add {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
