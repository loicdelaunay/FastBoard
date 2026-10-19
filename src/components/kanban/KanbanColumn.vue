<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import type { TicketStatus } from '@shared/constants';
import type { TicketDTO } from '@shared/types';
import { useKanbanDnd } from '@/composables/useKanbanDnd';
import { useProjectStore } from '@/stores/project';
import { notifyError } from '@/utils/notify';
import TicketCard from './TicketCard.vue';

import { t } from '@/i18n';
const props = defineProps<{ status: TicketStatus; tickets: TicketDTO[]; canCreate: boolean; canMove: boolean }>();
const emit = defineEmits<{ open: [ticketId: number] }>();

const project = useProjectStore();
const dnd = useKanbanDnd();

const column = ref<HTMLElement | null>(null);
const list = ref<HTMLElement | null>(null);
const meta = computed(() => project.statusMeta(props.status));
const isTarget = computed(() => dnd.state.draggingId !== null && dnd.state.overStatus === props.status);

const adding = ref(false);
const newTitle = ref('');
const addInput = ref<{ $el: HTMLInputElement } | null>(null);
const creating = ref(false);

async function startAdding(): Promise<void> {
  adding.value = true;
  await nextTick();
  addInput.value?.$el.focus();
}

async function submitNew(): Promise<void> {
  const title = newTitle.value.trim();
  if (!title || creating.value) {
    return;
  }
  creating.value = true;
  try {
    await project.createTicket({ title, status: props.status });
    newTitle.value = '';
  } catch (error) {
    notifyError(error, t('Création impossible'));
  } finally {
    creating.value = false;
    addInput.value?.$el.focus();
  }
}

async function onDrop(event: DragEvent): Promise<void> {
  const target = dnd.drop(event, props.status);
  if (!target) {
    return;
  }
  try {
    await project.moveTicket(target.ticketId, target.status, target.beforeId);
  } catch (error) {
    notifyError(error, t('Déplacement impossible'));
  }
}
</script>

<template>
  <section
    ref="column"
    class="column"
    :class="{ target: isTarget }"
    :aria-label="`${meta.label} — ${$t('{n} ticket|{n} tickets', { n: tickets.length })}`"
    @dragover="canMove && list && dnd.over($event, status, list)"
    @dragleave="column && dnd.leave($event, column)"
    @drop="canMove && onDrop($event)"
  >
    <header class="head" :style="{ '--c': meta.color }">
      <i class="swatch"></i>
      <h3 class="label">{{ meta.label }}</h3>
      <span class="count">{{ tickets.length }}</span>
      <Button v-if="canCreate" v-tooltip.bottom="$t('Ajouter un ticket')" icon="pi pi-plus" text rounded size="small" severity="secondary" class="add-btn" :aria-label="$t('Ajouter un ticket dans {label}', { label: meta.label })" @click="startAdding" />
    </header>

    <div ref="list" class="cards">
      <template v-for="ticket in tickets" :key="ticket.id">
        <div v-if="isTarget && dnd.state.beforeId === ticket.id" class="drop-indicator"></div>
        <TicketCard
          :ticket="ticket"
          :draggable="canMove"
          :dragging="dnd.state.draggingId === ticket.id"
          @dragstart="dnd.start($event, ticket.id)"
          @dragend="dnd.end()"
          @open="emit('open', ticket.id)"
        />
      </template>
      <div v-if="isTarget && dnd.state.beforeId === null" class="drop-indicator"></div>

      <p v-if="!tickets.length && !isTarget && !adding" class="empty muted small">{{ $t('Aucun ticket') }}</p>
    </div>

    <footer v-if="canCreate" class="foot">
      <form v-if="adding" class="quick-add" @submit.prevent="submitNew">
        <InputText ref="addInput" v-model="newTitle" :placeholder="$t('Titre du ticket…')" maxlength="200" size="small" fluid @keydown.esc="adding = false; newTitle = ''" @blur="!newTitle && (adding = false)" />
        <small class="muted">{{ $t('Entrée pour ajouter · Échap pour fermer') }}</small>
      </form>
      <button v-else type="button" class="add-link" @click="startAdding"><i class="pi pi-plus"></i> {{ $t('Ajouter un ticket') }}</button>
    </footer>
  </section>
</template>

<style scoped>
.column {
  display: flex;
  flex-direction: column;
  flex: 0 0 18.5rem;
  max-height: 100%;
  min-height: 0;
  border: 1px solid var(--fb-border);
  border-radius: 12px;
  background: color-mix(in srgb, var(--fb-panel-alt) 70%, var(--fb-bg));
  transition: border-color 0.15s, background 0.15s;
}
.column.target {
  border-color: var(--fb-accent);
  background: var(--fb-accent-soft);
}
.head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.7rem 0.75rem 0.4rem 0.9rem;
}
.swatch {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 50%;
  background: var(--c);
}
.label {
  font-size: 0.85rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.count {
  padding: 0 0.5rem;
  border-radius: 999px;
  background: var(--fb-panel);
  color: var(--fb-muted);
  font-size: 0.75rem;
  font-weight: 700;
}
.add-btn {
  margin-left: auto;
}
.cards {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  flex: 1;
  min-height: 3rem;
  padding: 0.35rem 0.6rem 0.6rem;
  overflow-y: auto;
}
.drop-indicator {
  flex: none;
  height: 3.2rem;
  border: 2px dashed var(--fb-accent);
  border-radius: 10px;
  background: var(--fb-accent-soft);
}
.empty {
  padding: 1rem 0;
  text-align: center;
}
.foot {
  padding: 0 0.6rem 0.6rem;
}
.add-link {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  padding: 0.45rem 0.5rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--fb-muted);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}
.add-link:hover {
  background: var(--fb-panel);
  color: var(--fb-accent);
}
.quick-add {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
</style>
