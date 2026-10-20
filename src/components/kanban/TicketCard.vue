<script setup lang="ts">
import { computed } from 'vue';
import { todayISO, formatDateShort } from '@shared/dates';
import { ticketProgress } from '@shared/progress';
import type { TicketDTO } from '@shared/types';
import ColorChip from '@/components/common/ColorChip.vue';
import ProgressMeter from '@/components/common/ProgressMeter.vue';
import UserAvatarGroup from '@/components/common/UserAvatarGroup.vue';
import StaleBar from '@/components/tickets/StaleBar.vue';
import { useProjectStore } from '@/stores/project';
import { useUiStore } from '@/stores/ui';
import { dueDate, isOverdue, ticketKey } from '@/utils/tickets';

const props = defineProps<{ ticket: TicketDTO; draggable?: boolean; dragging?: boolean }>();
const emit = defineEmits<{ open: [] }>();

const project = useProjectStore();
const ui = useUiStore();

const category = computed(() => (props.ticket.categoryId ? project.categoriesById.get(props.ticket.categoryId) : undefined));
const delivery = computed(() => (props.ticket.deliveryId ? project.deliveriesById.get(props.ticket.deliveryId) : undefined));
const progress = computed(() => ticketProgress(props.ticket));
const priority = computed(() => (props.ticket.priorityId ? project.prioritiesById.get(props.ticket.priorityId) : undefined));
const components = computed(() => props.ticket.componentIds.flatMap((id) => project.componentsById.get(id) ?? []));
const subtasksDone = computed(() => props.ticket.subtasks.filter((subtask) => subtask.done).length);
/** Ce ticket est bloqué par un autre ticket non terminé. */
const blocked = computed(() =>
  project.linksOf(props.ticket.id).some((link) => (link.incoming ? link.reason === 'Bloque' : link.reason === 'Bloqué par') && link.other.status !== 'done'),
);
const assignees = computed(() =>
  props.ticket.assignees.flatMap((assignee) => {
    const user = project.usersById.get(assignee.userId);
    return user ? [user] : [];
  }),
);
const doneIds = computed(() => props.ticket.assignees.filter((assignee) => assignee.done).map((assignee) => assignee.userId));
const due = computed(() => dueDate(props.ticket, delivery.value));
const overdue = computed(() => isOverdue(props.ticket, delivery.value, todayISO()));
const flashing = computed(() => project.flashes[props.ticket.id] !== undefined);
const linkCount = computed(() => project.linksOf(props.ticket.id).length);
/** Ce ticket est lié au ticket survolé : il clignote légèrement. */
const linked = computed(() => {
  const hovered = ui.hoveredTicketId;
  return hovered !== null && hovered !== props.ticket.id && project.linksOf(hovered).some((link) => link.other.id === props.ticket.id);
});

function onEnter(): void {
  if (linkCount.value) ui.hoveredTicketId = props.ticket.id;
}

function onLeave(): void {
  if (ui.hoveredTicketId === props.ticket.id) ui.hoveredTicketId = null;
}
</script>

<template>
  <article
    class="ticket-card"
    :class="{ dragging, flash: flashing, overdue, linked, 'link-source': ui.hoveredTicketId === ticket.id }"
    :data-ticket-id="ticket.id"
    :draggable="draggable"
    tabindex="0"
    role="button"
    :aria-label="`${ticketKey(project.project, ticket)} — ${ticket.title}`"
    @click="emit('open')"
    @keydown.enter.self="emit('open')"
    @contextmenu="ui.openTicketMenu($event, ticket.id)"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    @dragstart="onLeave"
  >
    <header class="top">
      <i v-if="priority" v-tooltip.top="$t('Priorité : {name}', { name: priority.name })" :class="priority.icon" class="priority" :style="{ color: priority.color }" :aria-label="$t('Priorité : {name}', { name: priority.name })"></i>
      <span class="key">{{ ticketKey(project.project, ticket) }}</span>
      <i v-if="blocked" v-tooltip.top="$t('Bloqué par un ticket non terminé')" class="pi pi-lock blocked" :aria-label="$t('Bloqué')"></i>
      <ColorChip v-if="category" :label="category.name" :color="category.color" />
      <button type="button" class="menu-btn" :aria-label="$t('Actions du ticket')" aria-haspopup="menu" @click.stop="ui.openTicketMenu($event, ticket.id)"><i class="pi pi-ellipsis-h"></i></button>
    </header>

    <h4 class="title">{{ ticket.title }}</h4>

    <div v-if="components.length" class="components">
      <ColorChip v-for="component in components" :key="component.id" :label="component.name" :color="component.color" :icon="component.icon" />
    </div>

    <ProgressMeter v-if="ticket.assignees.length || progress > 0" :value="progress" :height="5" />

    <footer class="bottom">
      <div class="info">
        <span v-if="due" class="due" :class="{ late: overdue }" :title="overdue ? $t('En retard') : $t('Échéance')">
          <i class="pi pi-calendar"></i>{{ formatDateShort(due) }}
        </span>
        <span v-if="delivery" class="delivery" :style="{ '--d': delivery.color }" :title="$t('Livraison : {name}', { name: delivery.name })">
          <i class="pi pi-truck"></i><span class="truncate">{{ delivery.name }}</span>
        </span>
        <StaleBar :ticket="ticket" compact />
        <span v-if="ticket.subtasks.length" class="comments" :class="{ complete: subtasksDone === ticket.subtasks.length }" :title="$t('Sous-tâches')"><i class="pi pi-list-check"></i>{{ subtasksDone }}/{{ ticket.subtasks.length }}</span>
        <span v-if="linkCount" class="comments" :title="$t('Dépendances')"><i class="pi pi-link"></i>{{ linkCount }}</span>
        <span v-if="ticket.attachmentCount" class="comments" :title="$t('Pièces jointes')"><i class="pi pi-paperclip"></i>{{ ticket.attachmentCount }}</span>
        <span v-if="ticket.commentCount" class="comments" :title="$t('Commentaires')"><i class="pi pi-comment"></i>{{ ticket.commentCount }}</span>
      </div>
      <UserAvatarGroup v-if="assignees.length" :users="assignees" :highlight-ids="doneIds" :max="3" />
    </footer>
  </article>
</template>

<style scoped>
.ticket-card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.7rem 0.75rem;
  border: 1px solid var(--fb-border);
  border-radius: 10px;
  background: var(--fb-panel);
  box-shadow: var(--fb-shadow);
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, opacity 0.15s;
}
.ticket-card[draggable='true'] {
  cursor: grab;
}
.ticket-card:hover,
.ticket-card:focus-visible {
  border-color: var(--fb-accent);
  outline: none;
}
.ticket-card:focus-visible {
  box-shadow: 0 0 0 3px var(--fb-accent-soft);
}
.ticket-card.dragging {
  opacity: 0.35;
}
.top {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}
.priority {
  font-size: 0.8rem;
  font-weight: 700;
}
.blocked {
  color: var(--fb-danger);
  font-size: 0.72rem;
}
.components {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.complete {
  color: #16a34a;
  font-weight: 700;
}
.ticket-card.linked {
  animation: fb-link-blink 1.6s ease-in-out infinite;
}
.ticket-card.link-source {
  border-color: var(--fb-accent);
}
@keyframes fb-link-blink {
  0%,
  100% {
    border-color: var(--fb-border);
    box-shadow: var(--fb-shadow);
  }
  50% {
    border-color: var(--fb-accent);
    box-shadow: 0 0 0 3px var(--fb-accent-soft);
  }
}
@media (prefers-reduced-motion: reduce) {
  .ticket-card.linked {
    animation: none;
    border-color: var(--fb-accent);
  }
}
.key {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.03em;
  color: var(--fb-muted);
}
.menu-btn {
  margin-left: auto;
  display: grid;
  place-items: center;
  width: 1.6rem;
  height: 1.6rem;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--fb-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
}
.ticket-card:hover .menu-btn,
.ticket-card:focus-within .menu-btn {
  opacity: 1;
}
.menu-btn:hover {
  background: var(--fb-panel-alt);
  color: var(--fb-text);
}
@media (hover: none) {
  .menu-btn {
    opacity: 1;
  }
}
.title {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 0;
  font-size: 0.92rem;
  font-weight: 600;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.info {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.2rem 0.6rem;
  min-width: 0;
  color: var(--fb-muted);
  font-size: 0.75rem;
}
.info i {
  margin-right: 0.25rem;
  font-size: 0.7rem;
}
.due.late {
  color: var(--fb-danger);
  font-weight: 700;
}
.delivery {
  display: inline-flex;
  align-items: center;
  max-width: 7rem;
  color: color-mix(in srgb, var(--d) 70%, var(--fb-text));
}
</style>
