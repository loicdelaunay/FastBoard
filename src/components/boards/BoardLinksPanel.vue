<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import Button from 'primevue/button';
import type { BoardLinksDTO } from '@shared/boards';
import { useDocLinks } from '@/composables/useDocLinks';
import { t } from '@/i18n';

/**
 * Rétroliens d'un tableau blanc (notes et tickets qui le mentionnent, tableaux qui le montrent dans un Fast Element)
 * et ce que montrent ses propres Fast Elements ; un clic ouvre l'élément.
 */
const props = defineProps<{ links: BoardLinksDTO | null; loading: boolean }>();
const emit = defineEmits<{ close: [] }>();

const router = useRouter();
const { openNode, openTicket } = useDocLinks(
  () => [],
  () => undefined,
);

const NONE: BoardLinksDTO['backlinks'] = { notes: [], tickets: [], boards: [] };
const groups = computed(() => [
  { key: 'back', label: t('Rétroliens'), ...(props.links?.backlinks ?? NONE), empty: t('Rien ne cite ce tableau.') },
  { key: 'out', label: t('Liens du tableau'), ...(props.links?.outgoing ?? NONE), empty: t('Ce tableau ne montre aucun Fast Element.') },
]);
const count = (group: BoardLinksDTO['backlinks']): number => group.notes.length + group.tickets.length + group.boards.length;

function openBoard(id: number): void {
  void router.push({ name: 'board-file', params: { boardId: id } });
}
</script>

<template>
  <aside class="links-panel" :aria-label="$t('Liens du tableau')">
    <header class="head">
      <strong><i class="pi pi-link"></i> {{ $t('Liens') }}</strong>
      <i v-if="loading" class="pi pi-spin pi-spinner muted"></i>
      <Button icon="pi pi-times" text rounded size="small" severity="secondary" class="close" :aria-label="$t('Fermer')" @click="emit('close')" />
    </header>
    <div class="content">
      <section v-for="group in groups" :key="group.key" class="group">
        <h4>{{ group.label }} <span class="muted">{{ count(group) }}</span></h4>
        <p v-if="!count(group) && links" class="muted small">{{ group.empty }}</p>
        <button v-for="note in group.notes" :key="`n${note.id}`" type="button" class="entry" :title="note.path" @click="openNode(note.id)">
          <i class="pi pi-file"></i>
          <span class="names"><strong class="truncate">{{ note.title }}</strong><small class="muted truncate">{{ note.spaceName }} · {{ note.path }}</small></span>
        </button>
        <button v-for="ticket in group.tickets" :key="`t${ticket.id}`" type="button" class="entry" :data-ticket="ticket.id" @click="openTicket(ticket.id)">
          <i class="pi pi-ticket"></i>
          <span class="names"><strong class="truncate">{{ ticket.key }}</strong><small class="muted truncate">{{ ticket.title }}</small></span>
        </button>
        <button v-for="board in group.boards" :key="`b${board.id}`" type="button" class="entry" :data-board="board.id" @click="openBoard(board.id)">
          <i class="pi pi-objects-column"></i>
          <span class="names"><strong class="truncate">{{ board.title }}</strong><small class="muted truncate">{{ board.spaceName }} · {{ board.path }}</small></span>
        </button>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.links-panel {
  display: flex;
  flex: none;
  flex-direction: column;
  width: 18rem;
  min-height: 0;
  border-left: 1px solid var(--fb-border);
  background: var(--fb-panel);
}
.head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.4rem 0.3rem 0.75rem;
  border-bottom: 1px solid var(--fb-border);
  font-size: 0.9rem;
}
.head .pi-link {
  color: var(--fb-muted);
  font-size: 0.8rem;
}
.close {
  margin-left: auto;
}
.content {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.6rem;
  min-height: 0;
  padding: 0.6rem;
  overflow-y: auto;
}
.group h4 {
  margin: 0 0 0.3rem;
  font-size: 0.82rem;
}
.group p {
  margin: 0;
}
.entry {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  width: 100%;
  padding: 0.3rem 0.4rem;
  border: 0;
  border-radius: 6px;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 0.84rem;
  text-align: left;
  cursor: pointer;
}
.entry:hover {
  background: var(--fb-panel-alt);
}
.entry > .pi {
  color: var(--fb-muted);
  font-size: 0.8rem;
}
.entry > .pi-objects-column {
  color: #a855f7;
}
.names {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
@media (max-width: 760px) {
  .links-panel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 5;
    box-shadow: -8px 0 24px rgb(0 0 0 / 0.15);
  }
}
</style>
