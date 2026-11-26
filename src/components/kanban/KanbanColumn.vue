<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Menu from 'primevue/menu';
import type { MenuItem } from 'primevue/menuitem';
import { useRouter } from 'vue-router';
import type { TicketStatus } from '@shared/constants';
import type { DoneVisibility } from '@shared/doneVisibility';
import type { TicketDTO } from '@shared/types';
import { useKanbanDnd } from '@/composables/useKanbanDnd';
import { useTicketFilters } from '@/composables/useTicketFilters';
import { useProjectStore } from '@/stores/project';
import { notifyError } from '@/utils/notify';
import TicketCard from './TicketCard.vue';

import { t } from '@/i18n';
const props = defineProps<{
  status: TicketStatus;
  tickets: TicketDTO[];
  canCreate: boolean;
  canMove: boolean;
  sorted?: boolean;
  /** Colonne « Terminé » : tickets montrés (`mode`, celui du projet `defaultMode`), masqués, et montrés par une recherche. */
  done?: { mode: DoneVisibility; defaultMode: DoneVisibility; hidden: number; revealed: number };
}>();
const emit = defineEmits<{ open: [ticketId: number]; 'done-mode': [mode: DoneVisibility] }>();
const router = useRouter();

// --- Colonne « Terminé » : menu ⋯ pour choisir vite les tickets montrés ---
const doneMenu = ref<InstanceType<typeof Menu> | null>(null);
const DONE_LABELS: Record<DoneVisibility, string> = {
  all: 'Afficher tous les tickets terminés',
  current: 'Masquer ceux des livraisons passées',
  none: 'Masquer tous les tickets terminés',
};
const doneItems = computed<MenuItem[]>(() => {
  const done = props.done;
  if (!done) return [];
  const choices: MenuItem[] = (['all', 'current', 'none'] as const).map((mode) => ({
    label: mode === done.defaultMode ? `${t(DONE_LABELS[mode])} · ${t('réglage du projet')}` : t(DONE_LABELS[mode]),
    icon: mode === done.mode ? 'pi pi-check' : 'pi pi-fw',
    class: mode === done.mode ? 'menu-active' : undefined,
    command: () => emit('done-mode', mode),
  }));
  return [
    { label: t('Tickets terminés affichés'), disabled: true, class: 'menu-heading' },
    ...choices,
    ...(project.can('project.edit')
      ? [{ separator: true }, { label: t('Automatisation du projet…'), icon: 'pi pi-bolt', command: () => void router.push({ name: 'settings', params: { projectId: project.project?.id }, query: { tab: 'automation' } }) }]
      : []),
  ];
});

const project = useProjectStore();
const dnd = useKanbanDnd();
const { creationDefaults } = useTicketFilters();

const column = ref<HTMLElement | null>(null);
const list = ref<HTMLElement | null>(null);
const meta = computed(() => project.statusMeta(props.status));
const isTarget = computed(() => dnd.state.draggingId !== null && dnd.state.overStatus === props.status);
/** Colonne triée automatiquement : un dépôt place la carte selon le tri, pas à l'endroit visé. */
const sortLabel = computed(() => {
  const sort = project.settings.columnSort[props.status];
  if (!sort) return '';
  const labels: Record<string, string> = { priority: t('priorité'), dueDate: t('échéance'), title: t('titre'), number: t('numéro'), createdAt: t('date de création'), updatedAt: t('dernière modification'), progress: t('avancement') };
  return t('Triée automatiquement par {field} ({direction})', { field: labels[sort.field] ?? sort.field, direction: sort.direction === 'asc' ? t('croissant') : t('décroissant') });
});

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
    // Les filtres en cours (catégorie, livraison, personnes) s'appliquent au nouveau ticket.
    await project.createTicket({ title, status: props.status, ...creationDefaults() });
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
    :data-status="status"
    :aria-label="`${meta.label} — ${$t('{n} ticket|{n} tickets', { n: tickets.length })}`"
    @dragover="canMove && list && dnd.over($event, status, list, sorted)"
    @dragleave="column && dnd.leave($event, column)"
    @drop="canMove && onDrop($event)"
  >
    <header class="head" :style="{ '--c': meta.color }">
      <i class="swatch"></i>
      <h3 class="label">{{ meta.label }}</h3>
      <span class="count">{{ tickets.length }}</span>
      <i v-if="sorted" v-tooltip.bottom="sortLabel" class="pi pi-sort-amount-down sorted-icon" :aria-label="sortLabel"></i>
      <button
        v-if="done?.hidden"
        v-tooltip.bottom="$t('Afficher les tickets masqués')"
        type="button"
        class="hidden-chip"
        :aria-label="$t('{n} ticket masqué : l’afficher|{n} tickets masqués : les afficher', { n: done.hidden })"
        @click="emit('done-mode', 'all')"
      >
        <i class="pi pi-eye-slash"></i> {{ done.hidden }}
      </button>
      <span v-else-if="done?.revealed" v-tooltip.bottom="$t('La recherche montre aussi les tickets terminés masqués')" class="hidden-chip searching" tabindex="0">
        <i class="pi pi-search"></i> {{ done.revealed }}
      </span>
      <Button v-if="done" v-tooltip.bottom="$t('Tickets terminés affichés')" icon="pi pi-ellipsis-h" text rounded size="small" severity="secondary" :aria-label="$t('Tickets terminés affichés')" aria-haspopup="true" @click="doneMenu?.toggle($event)" />
      <Menu v-if="done" ref="doneMenu" :model="doneItems" popup />
      <Button v-if="canCreate" v-tooltip.bottom="$t('Ajouter un ticket')" icon="pi pi-plus" text rounded size="small" severity="secondary" class="add-btn" :aria-label="$t('Ajouter un ticket dans {label}', { label: meta.label })" @click="startAdding" />
    </header>

    <div ref="list" class="cards">
      <template v-for="ticket in tickets" :key="ticket.id">
        <div v-if="isTarget && !sorted && dnd.state.beforeId === ticket.id" class="drop-indicator"></div>
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

      <p v-if="!tickets.length && !isTarget && !adding && done?.hidden" class="empty muted small">
        {{ $t('{n} ticket terminé masqué|{n} tickets terminés masqués', { n: done.hidden }) }}
        <button type="button" class="show-hidden" @click="emit('done-mode', 'all')">{{ $t('Afficher') }}</button>
      </p>
      <p v-else-if="!tickets.length && !isTarget && !adding" class="empty muted small">{{ $t('Aucun ticket') }}</p>
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
.hidden-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.1rem 0.45rem;
  border: 1px solid var(--fb-border);
  border-radius: 999px;
  background: var(--fb-panel);
  color: var(--fb-muted);
  font: inherit;
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
}
.hidden-chip:hover {
  border-color: var(--fb-accent);
  color: var(--fb-accent);
}
.hidden-chip.searching {
  border-color: color-mix(in srgb, var(--fb-accent) 40%, var(--fb-border));
  color: var(--fb-accent);
  cursor: help;
}
.hidden-chip .pi {
  font-size: 0.7rem;
}
.show-hidden {
  margin-left: 0.25rem;
  padding: 0;
  border: 0;
  background: none;
  color: var(--fb-accent);
  font: inherit;
  cursor: pointer;
}
.show-hidden:hover {
  text-decoration: underline;
}
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
.sorted-icon {
  color: var(--fb-muted);
  font-size: 0.75rem;
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
