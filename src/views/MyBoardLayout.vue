<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import Button from 'primevue/button';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import TicketContextMenu from '@/components/tickets/TicketContextMenu.vue';
import TicketDialog from '@/components/tickets/TicketDialog.vue';
import TicketQuickEdit from '@/components/tickets/TicketQuickEdit.vue';
import { filterQueryOf, useFilterQuery } from '@/composables/useFilterQuery';
import { applyTicketFilters } from '@/composables/useTicketFilters';
import { filtersFromQuery } from '@shared/ticketFilters';
import { t } from '@/i18n';
import { useProjectStore } from '@/stores/project';

/**
 * « Mon tableau » (Accueil) : les tickets qui me sont assignés dans tous mes projets, avec les vues d'un projet —
 * Analyseur, Liste, Kanban, Gantt et Activités (ce qui me concerne). Un ticket s'ouvre et se modifie selon son projet.
 */
const route = useRoute();
const project = useProjectStore();
useFilterQuery();

const VIEWS = [
  { name: 'my-analyzer', label: t('Analyseur'), icon: 'pi pi-chart-bar' },
  { name: 'my-list', label: t('Liste'), icon: 'pi pi-list' },
  { name: 'my-kanban', label: t('Kanban'), icon: 'pi pi-objects-column' },
  { name: 'my-gantt', label: t('Gantt'), icon: 'pi pi-calendar' },
  { name: 'my-activity', label: t('Activités'), icon: 'pi pi-history' },
] as const;

/** Lien d'une vue : il garde les filtres et le ticket ouvert. */
const viewQuery = computed(() => ({ ...filterQueryOf(route.query), ...(route.query.ticket ? { ticket: String(route.query.ticket) } : {}) }));
const empty = computed(() => project.status === 'ready' && project.tickets.length === 0);

onMounted(() => {
  applyTicketFilters(filtersFromQuery(route.query));
  void project.loadPersonal();
});
onBeforeUnmount(() => project.leave());

// --- Raccourcis : Ctrl+Z / Ctrl+Maj+Z / Ctrl+Y (hors champs de saisie) ---
function onKeydown(event: KeyboardEvent): void {
  const element = event.target as HTMLElement | null;
  if (element && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName))) return;
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (mod && key === 'z' && !event.shiftKey) {
    event.preventDefault();
    void project.undo();
  } else if (mod && (key === 'y' || (key === 'z' && event.shiftKey))) {
    event.preventDefault();
    void project.redo();
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="my-board">
    <!-- Dans la barre de l'Accueil, à droite de ses onglets (qui ne bougent pas d'un onglet à l'autre). -->
    <Teleport defer to="#home-shell-actions">
      <nav v-if="project.personal && project.project" class="tabs" :aria-label="$t('Vues de mon tableau')">
        <router-link v-for="view in VIEWS" :key="view.name" :to="{ name: view.name, query: viewQuery }" class="tab" active-class="active">
          <i :class="view.icon"></i><span>{{ view.label }}</span>
        </router-link>
      </nav>
      <div class="actions">
        <span v-if="project.personal && project.status === 'ready'" class="muted small summary">
          {{ $t('{n} ticket dans {p} projet|{n} tickets dans {p} projets', { n: project.tickets.length, p: project.personalProjects.length }) }}
        </span>
        <Button v-tooltip.bottom="project.undoLabel ? $t('Annuler : {undoLabel} (Ctrl+Z)', { undoLabel: project.undoLabel }) : $t('Annuler (Ctrl+Z)')" icon="pi pi-undo" text rounded severity="secondary" :aria-label="$t('Annuler')" :disabled="!project.canUndo" @click="project.undo()" />
        <Button v-tooltip.bottom="project.redoLabel ? $t('Rétablir : {redoLabel} (Ctrl+Y)', { redoLabel: project.redoLabel }) : $t('Rétablir (Ctrl+Y)')" icon="pi pi-refresh" text rounded severity="secondary" :aria-label="$t('Rétablir')" :disabled="!project.canRedo" @click="project.redo()" />
      </div>
    </Teleport>

    <div v-if="project.status === 'loading' && !project.project" class="center">
      <ProgressSpinner style="width: 2.5rem; height: 2.5rem" />
    </div>
    <div v-else-if="project.status === 'error'" class="center">
      <Message severity="error" :closable="false">{{ project.error }}</Message>
      <Button :label="$t('Réessayer')" icon="pi pi-refresh" @click="project.loadPersonal()" />
    </div>
    <div v-else-if="empty" class="center empty">
      <i class="pi pi-check-circle"></i>
      <h3>{{ $t('Aucun ticket ne vous est assigné') }}</h3>
      <p class="muted">{{ $t('Les tickets où vous avez une ligne d’avancement, dans tous vos projets, apparaissent ici.') }}</p>
    </div>
    <template v-else-if="project.personal && project.project">
      <div class="board-body">
        <router-view />
      </div>
      <TicketDialog />
      <TicketContextMenu />
      <TicketQuickEdit />
    </template>
  </div>
</template>

<style scoped>
.my-board {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.tabs {
  display: flex;
  gap: 0.25rem;
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
  padding: 0.2rem;
  border-radius: 10px;
  background: var(--fb-panel-alt);
}
.tab {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 0.45rem;
  white-space: nowrap;
  padding: 0.35rem 0.85rem;
  border-radius: 8px;
  color: var(--fb-muted);
  font-size: 0.9rem;
  font-weight: 600;
}
.tab:hover {
  color: var(--fb-text);
}
.tab.active {
  background: var(--fb-panel);
  color: var(--fb-accent);
  box-shadow: var(--fb-shadow);
}
.actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-left: auto;
}
.summary {
  margin-right: 0.4rem;
  white-space: nowrap;
}
.center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 2rem 1rem;
  text-align: center;
}
.empty .pi {
  font-size: 2.2rem;
  color: var(--fb-accent);
}
.empty h3 {
  margin: 0;
}
.empty p {
  margin: 0;
  max-width: 32rem;
}
.board-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
@media (max-width: 720px) {
  .tab span {
    display: none;
  }
  .tab {
    padding: 0.45rem 0.8rem;
  }
  .summary {
    display: none;
  }
}
</style>
