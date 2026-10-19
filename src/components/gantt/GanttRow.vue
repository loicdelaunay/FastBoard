<script setup lang="ts">
import { computed } from 'vue';
import { addDays, formatDateShort, toDayNumber } from '@shared/dates';
import UserAvatarGroup from '@/components/common/UserAvatarGroup.vue';
import { useProjectStore } from '@/stores/project';
import { useUiStore } from '@/stores/ui';
import { isOverdue, ticketKey } from '@/utils/tickets';
import type { GanttGroupRow, GanttTicketRow } from '@/composables/useGanttRows';
import GanttBar from './GanttBar.vue';

const props = defineProps<{
  row: GanttGroupRow | GanttTicketRow;
  leftWidth: number;
  totalWidth: number;
  pxPerDay: number;
  rangeStart: number;
  today: string;
  editable: boolean;
}>();
const emit = defineEmits<{
  toggle: [groupId: string];
  open: [ticketId: number];
  reschedule: [ticketId: number, start: string, end: string];
  plan: [ticketId: number, dayOffset: number];
}>();

const project = useProjectStore();
const ui = useUiStore();

const x = (iso: string): number => (toDayNumber(iso) - props.rangeStart) * props.pxPerDay;
const spanWidth = (start: string, end: string): number => (toDayNumber(end) - toDayNumber(start) + 1) * props.pxPerDay;

const ticketRow = computed(() => (props.row.kind === 'ticket' ? props.row : null));
const groupRow = computed(() => (props.row.kind === 'group' ? props.row : null));

const assignees = computed(() =>
  (ticketRow.value?.ticket.assignees ?? []).flatMap((assignee) => {
    const user = project.usersById.get(assignee.userId);
    return user ? [user] : [];
  }),
);
const doneIds = computed(() => (ticketRow.value?.ticket.assignees ?? []).filter((a) => a.done).map((a) => a.userId));
const overdue = computed(() => {
  const ticket = ticketRow.value?.ticket;
  if (!ticket) {
    return false;
  }
  return isOverdue(ticket, ticket.deliveryId ? project.deliveriesById.get(ticket.deliveryId) : undefined, props.today);
});

function commit(deltaStart: number, deltaEnd: number): void {
  const current = ticketRow.value;
  if (!current?.range) {
    return;
  }
  emit('reschedule', current.ticket.id, addDays(current.range.start, deltaStart), addDays(current.range.end, deltaEnd));
}

/** Double-clic sur une ligne sans planning : place le ticket à cet endroit (3 jours). */
function onPlan(event: MouseEvent): void {
  const current = ticketRow.value;
  if (!current || current.range || !props.editable) {
    return;
  }
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  emit('plan', current.ticket.id, Math.floor((event.clientX - bounds.left) / props.pxPerDay));
}
</script>

<template>
  <div
    class="g-row"
    :class="{ group: groupRow, ticket: ticketRow }"
    :style="{ width: `${leftWidth + totalWidth}px` }"
    @contextmenu="ticketRow && ui.openTicketMenu($event, ticketRow.ticket.id)"
  >
    <!-- Colonne de gauche (fixe au défilement horizontal) -->
    <div class="left" :style="{ width: `${leftWidth}px` }">
      <template v-if="groupRow">
        <button type="button" class="toggle" :aria-expanded="!groupRow.collapsed" :aria-label="groupRow.collapsed ? $t('Déplier') : $t('Replier')" @click="emit('toggle', groupRow.id)">
          <i :class="groupRow.collapsed ? 'pi pi-chevron-right' : 'pi pi-chevron-down'"></i>
        </button>
        <i class="swatch" :style="{ background: groupRow.color }"></i>
        <span class="group-title truncate">{{ groupRow.title }}</span>
        <span class="count">{{ groupRow.count }}</span>
        <span v-if="groupRow.badge" class="badge" :class="groupRow.badge.level">{{ groupRow.badge.label }}</span>
        <span v-else-if="groupRow.range" class="dates muted">{{ formatDateShort(groupRow.range.start) }} → {{ formatDateShort(groupRow.range.end) }}</span>
        <span v-else-if="groupRow.subtitle" class="dates muted">{{ groupRow.subtitle }}</span>
      </template>
      <template v-else-if="ticketRow">
        <button type="button" class="ticket-link" @click="emit('open', ticketRow.ticket.id)">
          <span class="key">{{ ticketKey(project.project, ticketRow.ticket) }}</span>
          <span class="title truncate">{{ ticketRow.ticket.title }}</span>
        </button>
        <UserAvatarGroup v-if="assignees.length" :users="assignees" :highlight-ids="doneIds" :max="2" />
        <span class="percent">{{ ticketRow.progress }}%</span>
      </template>
    </div>

    <!-- Frise -->
    <div class="time" :style="{ width: `${totalWidth}px` }" @dblclick="onPlan">
      <template v-if="groupRow">
        <div
          v-if="groupRow.range"
          class="summary"
          :style="{ left: `${x(groupRow.range.start)}px`, width: `${spanWidth(groupRow.range.start, groupRow.range.end)}px`, '--bar': groupRow.color }"
          :title="`${groupRow.title} · ${groupRow.progress}%`"
        >
          <span class="summary-fill" :style="{ width: `${groupRow.progress}%` }"></span>
          <span class="summary-label truncate">{{ groupRow.progress }}%</span>
          <i class="flag pi pi-flag-fill"></i>
        </div>
      </template>
      <template v-else-if="ticketRow">
        <GanttBar
          v-if="ticketRow.range"
          :start-iso="ticketRow.range.start"
          :end-iso="ticketRow.range.end"
          :left="x(ticketRow.range.start)"
          :width="spanWidth(ticketRow.range.start, ticketRow.range.end)"
          :px-per-day="pxPerDay"
          :color="ticketRow.color"
          :progress="ticketRow.progress"
          :label="ticketRow.ticket.title"
          :inherited="ticketRow.range.inherited"
          :overdue="overdue"
          :editable="editable"
          @commit="commit"
          @open="emit('open', ticketRow.ticket.id)"
        />
        <span v-else-if="editable" class="unplanned muted small">{{ $t('Non planifié — double-cliquez pour placer le ticket') }}</span>
        <span v-else class="unplanned muted small">{{ $t('Non planifié') }}</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.g-row {
  display: flex;
  height: 36px;
  border-bottom: 1px solid color-mix(in srgb, var(--fb-border) 70%, transparent);
}
.g-row:hover .left {
  background: var(--fb-panel-alt);
}
.g-row.group {
  background: color-mix(in srgb, var(--fb-panel-alt) 80%, transparent);
}
.left {
  position: sticky;
  left: 0;
  z-index: 4;
  flex: none;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0 0.6rem;
  border-right: 1px solid var(--fb-border);
  background: var(--fb-panel);
  overflow: hidden;
}
.group .left {
  background: var(--fb-panel-alt);
}
.toggle {
  display: grid;
  place-items: center;
  width: 1.4rem;
  height: 1.4rem;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--fb-muted);
  font-size: 0.7rem;
  cursor: pointer;
}
.toggle:hover {
  background: var(--fb-border);
}
.swatch {
  flex: none;
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 3px;
}
.group-title {
  font-weight: 700;
  font-size: 0.85rem;
}
.count {
  padding: 0 0.4rem;
  border-radius: 999px;
  background: var(--fb-panel);
  color: var(--fb-muted);
  font-size: 0.7rem;
  font-weight: 700;
}
.dates {
  margin-left: auto;
  font-size: 0.7rem;
  white-space: nowrap;
}
.badge {
  margin-left: auto;
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 700;
}
.badge.high {
  background: color-mix(in srgb, #ef4444 18%, transparent);
  color: #dc2626;
}
.badge.medium {
  background: color-mix(in srgb, #f59e0b 20%, transparent);
  color: #b45309;
}
:root.app-dark .badge.high {
  color: #f87171;
}
:root.app-dark .badge.medium {
  color: #fbbf24;
}
.ticket-link {
  display: flex;
  align-items: baseline;
  gap: 0.45rem;
  flex: 1;
  min-width: 0;
  padding: 0 0 0 1.4rem;
  border: 0;
  background: none;
  color: var(--fb-text);
  text-align: left;
  cursor: pointer;
}
.ticket-link:hover .title {
  color: var(--fb-accent);
  text-decoration: underline;
}
.key {
  flex: none;
  font-size: 0.7rem;
  font-weight: 800;
  color: var(--fb-muted);
}
.title {
  font-size: 0.82rem;
}
.percent {
  flex: none;
  min-width: 2.4em;
  text-align: right;
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--fb-muted);
}
.time {
  position: relative;
  flex: none;
}
.summary {
  position: absolute;
  top: 9px;
  height: 18px;
  display: flex;
  align-items: center;
  border: 1px solid var(--bar);
  border-radius: 4px;
  background: color-mix(in srgb, var(--bar) 14%, transparent);
  z-index: 1;
}
.summary-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: color-mix(in srgb, var(--bar) 40%, transparent);
  border-radius: 3px 0 0 3px;
}
.summary-label {
  position: relative;
  padding: 0 0.4rem;
  font-size: 0.68rem;
  font-weight: 700;
}
.flag {
  position: absolute;
  right: -0.35rem;
  top: -0.2rem;
  font-size: 0.7rem;
  color: var(--bar);
}
.unplanned {
  position: absolute;
  left: 0.6rem;
  top: 9px;
  white-space: nowrap;
  font-style: italic;
  pointer-events: none;
}
</style>
