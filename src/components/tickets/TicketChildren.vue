<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import { LIMITS } from '@shared/constants';
import type { TicketDTO } from '@shared/types';
import ProgressMeter from '@/components/common/ProgressMeter.vue';
import StatusTag from '@/components/common/StatusTag.vue';
import UserAvatarGroup from '@/components/common/UserAvatarGroup.vue';
import { useTicketRoute } from '@/composables/useTicketRoute';
import { useProjectStore } from '@/stores/project';
import { notifyError } from '@/utils/notify';
import { progressOf } from '@/utils/progress';
import { ticketKey } from '@/utils/tickets';

import { t } from '@/i18n';
/**
 * Sous-tickets (comme les sous-tâches de Jira) : de vrais tickets, avec toutes leurs propriétés, rattachés à ce ticket.
 * Un seul niveau : un sous-ticket n'a pas lui-même de sous-tickets.
 */
const props = defineProps<{ ticket: TicketDTO }>();

const project = useProjectStore();
const { openTicket } = useTicketRoute();

const editable = computed(() => project.can('ticket.edit') && !project.archived);
const canCreate = computed(() => project.can('ticket.create') && !project.archived);
const children = computed(() => project.childrenOf(props.ticket.id));
const doneCount = computed(() => children.value.filter((child) => project.settings.completeStatuses.includes(child.status)).length);
const percent = computed(() => (children.value.length ? Math.round(children.value.reduce((sum, child) => sum + progressOf(child), 0) / children.value.length) : 0));

/** Tickets qu'on peut rattacher : ni sous-ticket, ni parent, ni ce ticket. */
const candidates = computed(() =>
  project.tickets
    .filter((other) => other.id !== props.ticket.id && other.parentId === null && project.childrenOf(other.id).length === 0)
    .sort((a, b) => b.number - a.number)
    .map((other) => ({ value: other.id, label: `${ticketKey(project.project, other)} — ${other.title}` })),
);

const newTitle = ref('');
const adding = ref(false);
const linking = ref(false);
const input = ref<{ $el: HTMLInputElement } | null>(null);

function assigneesOf(child: TicketDTO) {
  return child.assignees.flatMap((assignee) => project.usersById.get(assignee.userId) ?? []);
}

async function add(): Promise<void> {
  const title = newTitle.value.trim();
  if (!title || adding.value) return;
  adding.value = true;
  try {
    // Le sous-ticket suit la livraison et la catégorie du parent ; le reste se règle dans le sous-ticket.
    await project.createTicket({ title, parentId: props.ticket.id, deliveryId: props.ticket.deliveryId, categoryId: props.ticket.categoryId });
    newTitle.value = '';
    void nextTick(() => input.value?.$el.focus());
  } catch (error) {
    notifyError(error, t('Sous-ticket non créé'));
  } finally {
    adding.value = false;
  }
}

async function attach(childId: number | null): Promise<void> {
  if (!childId) return;
  try {
    await project.updateTicket(childId, { parentId: props.ticket.id }, { label: t('Rattachement d’un sous-ticket') });
    linking.value = false;
  } catch (error) {
    notifyError(error, t('Rattachement impossible'));
  }
}

async function detach(child: TicketDTO): Promise<void> {
  try {
    await project.updateTicket(child.id, { parentId: null }, { label: t('Détachement d’un sous-ticket') });
  } catch (error) {
    notifyError(error, t('Détachement impossible'));
  }
}
</script>

<template>
  <section class="children">
    <div class="head">
      <h3 class="section-title"><i class="pi pi-sitemap"></i> {{ $t('Sous-tickets') }}</h3>
      <span v-if="children.length" class="muted small">{{ $t('{done} / {total} terminé|{done} / {total} terminés', { n: children.length, done: doneCount, total: children.length }) }}</span>
      <ProgressMeter v-if="children.length" :value="percent" :height="5" class="meter" />
      <span class="grow"></span>
      <Button v-if="editable && candidates.length" :label="$t('Rattacher un ticket')" icon="pi pi-link" size="small" text severity="secondary" @click="linking = !linking" />
    </div>

    <Select
      v-if="linking"
      :options="candidates"
      option-label="label"
      option-value="value"
      filter
      size="small"
      fluid
      :placeholder="$t('Choisissez le ticket à rattacher')"
      :aria-label="$t('Ticket à rattacher comme sous-ticket')"
      @update:model-value="attach"
    />

    <ul v-if="children.length" class="list">
      <li v-for="child in children" :key="child.id" class="item">
        <button type="button" class="open" @click="openTicket(child.id)">
          <span class="key">{{ ticketKey(project.project, child) }}</span>
          <span class="title truncate" :class="{ done: project.settings.completeStatuses.includes(child.status) }">{{ child.title }}</span>
        </button>
        <StatusTag :status="child.status" compact />
        <UserAvatarGroup v-if="child.assignees.length" :users="assigneesOf(child)" :max="2" />
        <Button v-if="editable" v-tooltip.top="$t('Détacher (le ticket est conservé)')" icon="pi pi-times" text rounded size="small" severity="secondary" :aria-label="$t('Détacher')" @click="detach(child)" />
      </li>
    </ul>

    <form v-if="canCreate" class="add" @submit.prevent="add">
      <InputText ref="input" v-model="newTitle" size="small" :placeholder="$t('Ajouter un sous-ticket…')" :maxlength="LIMITS.titleMax" fluid :aria-label="$t('Nouveau sous-ticket')" />
      <Button type="submit" icon="pi pi-plus" size="small" :disabled="!newTitle.trim()" :loading="adding" :aria-label="$t('Ajouter')" />
    </form>
    <p v-else-if="!children.length" class="muted small">{{ $t('Aucun sous-ticket.') }}</p>
  </section>
</template>

<style scoped>
.children {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.section-title {
  margin: 0;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.meter {
  flex: 1;
  max-width: 10rem;
}
.grow {
  flex: 1;
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
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.2rem 0.35rem;
  border-radius: 8px;
}
.item:hover {
  background: var(--fb-hover, color-mix(in srgb, var(--fb-text) 5%, transparent));
}
.open {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  padding: 0;
  border: 0;
  background: none;
  color: var(--fb-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.open:hover .title {
  text-decoration: underline;
}
.key {
  color: var(--fb-muted);
  font-size: 0.78rem;
  font-weight: 700;
  white-space: nowrap;
}
.title.done {
  color: var(--fb-muted);
  text-decoration: line-through;
}
.add {
  display: flex;
  gap: 0.4rem;
}
</style>
