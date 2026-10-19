<script setup lang="ts">
import { computed } from 'vue';
import Checkbox from 'primevue/checkbox';
import { assigneeProgress, partsSummary, ticketProgress } from '@shared/progress';
import type { TicketDTO } from '@shared/types';
import ProgressMeter from '@/components/common/ProgressMeter.vue';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/project';
import { notifyError } from '@/utils/notify';
import { formatRelative } from '@/utils/format';
import PartNote from './PartNote.vue';
import ProgressSlider from './ProgressSlider.vue';

import { t } from '@/i18n';
const props = defineProps<{ ticket: TicketDTO }>();

const auth = useAuthStore();
const project = useProjectStore();

const global = computed(() => ticketProgress(props.ticket));
const summary = computed(() => partsSummary(props.ticket));
const writable = computed(() => !project.archived);
const canEditTicket = computed(() => writable.value && project.can('ticket.edit'));

function canEditPart(userId: number): boolean {
  return writable.value && (project.can('ticket.edit') || (userId === auth.user?.id && project.can('ticket.update_own_part')));
}

async function setDone(userId: number, done: boolean): Promise<void> {
  try {
    await project.updatePart(props.ticket.id, userId, { done });
  } catch (error) {
    notifyError(error);
  }
}

async function setNote(userId: number, note: string): Promise<void> {
  try {
    await project.updatePart(props.ticket.id, userId, { note });
  } catch (error) {
    notifyError(error, t('Mission non enregistrée'));
  }
}

async function setProgress(userId: number, progress: number): Promise<void> {
  try {
    await project.updatePart(props.ticket.id, userId, { progress });
  } catch (error) {
    notifyError(error);
  }
}

async function setManualProgress(progress: number): Promise<void> {
  try {
    await project.updateTicket(props.ticket.id, { progress }, { label: t('Avancement du ticket') });
  } catch (error) {
    notifyError(error);
  }
}
</script>

<template>
  <section class="parts">
    <header class="head">
      <h3 class="title">{{ $t('Avancement') }}</h3>
      <span v-if="ticket.assignees.length" class="muted small">{{ $t('{done} / {total} part terminée|{done} / {total} parts terminées', { n: summary.total, done: summary.done, total: summary.total }) }}</span>
    </header>

    <div class="global">
      <ProgressMeter :value="global" :height="12" />
      <span class="muted small global-label">{{ $t('Progression globale') }}</span>
    </div>

    <ul v-if="ticket.assignees.length" class="list">
      <li v-for="assignee in ticket.assignees" :key="assignee.userId" class="part" :class="{ done: assignee.done }">
        <UserAvatar :user="project.usersById.get(assignee.userId)" :ring="assignee.done ? 'done' : 'none'" />
        <div class="who">
          <strong class="truncate">{{ project.usersById.get(assignee.userId)?.name ?? $t('Utilisateur supprimé') }}</strong>
          <span v-if="assignee.userId === auth.user?.id" class="muted small">{{ $t('(vous)') }}</span>
          <span v-if="assignee.done && assignee.doneAt" class="muted small">{{ $t('· terminé {value}', { value: formatRelative(assignee.doneAt) }) }}</span>
        </div>
        <ProgressSlider
          class="slider"
          :model-value="assigneeProgress(assignee)"
          :disabled="!canEditPart(assignee.userId) || assignee.done"
          @commit="(value) => setProgress(assignee.userId, value)"
        />
        <label class="done-toggle" :class="{ disabled: !canEditPart(assignee.userId) }">
          <Checkbox
            :model-value="assignee.done"
            binary
            :disabled="!canEditPart(assignee.userId)"
            :input-id="`part-${ticket.id}-${assignee.userId}`"
            @update:model-value="(value: boolean) => setDone(assignee.userId, value)"
          />
          <span>{{ assignee.userId === auth.user?.id ? $t('J\'ai terminé ma part') : $t('Terminé') }}</span>
        </label>
        <PartNote
          class="note"
          :note="assignee.note"
          :name="project.usersById.get(assignee.userId)?.name ?? 'cette personne'"
          :is-me="assignee.userId === auth.user?.id"
          :editable="canEditPart(assignee.userId)"
          @save="(note) => setNote(assignee.userId, note)"
        />
      </li>
    </ul>

    <div v-else class="manual">
      <p class="muted small">{{ $t('Aucune personne assignée : l\'avancement se règle à la main.') }}</p>
      <ProgressSlider :model-value="ticket.status === 'done' ? 100 : ticket.progress" :disabled="!canEditTicket" @commit="setManualProgress" />
    </div>
  </section>
</template>

<style scoped>
.parts {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid var(--fb-border);
  border-radius: var(--fb-radius);
  background: var(--fb-panel);
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.title {
  font-size: 0.95rem;
  font-weight: 700;
}
.global {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.global-label {
  align-self: flex-start;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.part {
  display: grid;
  grid-template-columns: auto minmax(7rem, 11rem) 1fr auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.55rem 0.65rem;
  border-radius: 8px;
  background: var(--fb-panel-alt);
}
.part.done {
  background: color-mix(in srgb, #22c55e 10%, transparent);
}
.note {
  grid-column: 1 / -1;
  margin-left: 2.75rem;
}
.who {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 0.35rem;
  min-width: 0;
}
.done-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.82rem;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}
.done-toggle.disabled {
  cursor: default;
  opacity: 0.7;
}
@media (max-width: 700px) {
  .part {
    grid-template-columns: auto 1fr auto;
  }
  .slider {
    grid-column: 1 / -1;
    order: 4;
  }
  .note {
    order: 5;
    margin-left: 0;
  }
}
</style>
