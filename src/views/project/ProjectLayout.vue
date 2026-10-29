<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from 'primevue/button';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import { realtime } from '@/realtime/socket';
import PresenceStack from '@/components/project/PresenceStack.vue';
import TicketContextMenu from '@/components/tickets/TicketContextMenu.vue';
import TicketQuickEdit from '@/components/tickets/TicketQuickEdit.vue';
import TicketDialog from '@/components/tickets/TicketDialog.vue';
import { resetTicketFilters, useTicketFilters } from '@/composables/useTicketFilters';
import { useProjectStore } from '@/stores/project';
import { useUiStore } from '@/stores/ui';
import { notify } from '@/utils/notify';

import { t } from '@/i18n';
const route = useRoute();
const router = useRouter();
const project = useProjectStore();
const ticketFilters = useTicketFilters();
const ui = useUiStore();

const projectId = computed(() => Number(route.params.projectId));
const currentView = computed(() => (typeof route.meta.view === 'string' ? route.meta.view : ''));

const VIEWS = [
  { name: 'analyzer', label: t('Analyseur'), icon: 'pi pi-chart-bar' },
  { name: 'list', label: t('Liste'), icon: 'pi pi-list' },
  { name: 'kanban', label: t('Kanban'), icon: 'pi pi-objects-column' },
  { name: 'gantt', label: t('Gantt'), icon: 'pi pi-calendar' },
  { name: 'activity', label: t('Activités'), icon: 'pi pi-history' },
] as const;

const canCreate = computed(() => project.can('ticket.create') && !project.archived);
const canConfigure = computed(() => project.can('project.edit') || project.can('project.members'));

async function open(id: number): Promise<void> {
  resetTicketFilters();
  await project.load(id);
}

onMounted(() => void open(projectId.value));
watch(projectId, (id) => void open(id));

onBeforeUnmount(() => project.leave());

watch(currentView, (view) => realtime.setPresence({ view }), { immediate: true });

/** « Nouveau ticket » depuis une vue filtrée (liste, Kanban, Gantt) : le ticket reprend les filtres en cours. */
function createDefaults() {
  return ['list', 'kanban', 'gantt'].includes(currentView.value) ? ticketFilters.creationDefaults() : {};
}

watch(
  () => project.status,
  (status) => {
    if (status === 'revoked') {
      notify('warn', t('Accès retiré'), t('Vous n\'avez plus accès à ce projet.'));
      void router.replace('/');
    }
  },
);

// --- Raccourcis : Ctrl+Z / Ctrl+Maj+Z / Ctrl+Y (hors champs de saisie), N = nouveau ticket ---
function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return !!element && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName));
}

function onKeydown(event: KeyboardEvent): void {
  if (isTyping(event.target)) {
    return;
  }
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (mod && key === 'z' && !event.shiftKey) {
    event.preventDefault();
    void project.undo();
  } else if (mod && (key === 'y' || (key === 'z' && event.shiftKey))) {
    event.preventDefault();
    void project.redo();
  } else if (!mod && !event.altKey && key === 'n' && canCreate.value && !document.querySelector('.p-dialog')) {
    event.preventDefault();
    ui.openCreate(createDefaults());
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));

</script>

<template>
  <div class="project-layout">
    <div v-if="project.status === 'loading' && !project.project" class="center">
      <ProgressSpinner style="width: 2.5rem; height: 2.5rem" />
    </div>

    <div v-else-if="project.status === 'error'" class="center">
      <Message severity="error" :closable="false">{{ project.error }}</Message>
      <Button :label="$t('Retour aux projets')" icon="pi pi-arrow-left" @click="router.push('/')" />
    </div>

    <template v-else-if="project.project">
      <header class="project-head">
        <div class="title-block">
          <router-link to="/" class="back" :aria-label="$t('Retour aux projets')"><i class="pi pi-arrow-left"></i></router-link>
          <span class="key">{{ project.project.key }}</span>
          <h1 class="name truncate">{{ project.project.name }}</h1>
          <span v-if="project.archived" class="archived-badge"><i class="pi pi-lock"></i> {{ $t('Archivé') }}</span>
        </div>

        <nav class="tabs" :aria-label="$t('Vues du projet')">
          <router-link v-for="view in VIEWS" :key="view.name" :to="{ name: view.name, params: { projectId }, query: route.query.ticket ? { ticket: route.query.ticket } : {} }" class="tab" active-class="active">
            <i :class="view.icon"></i><span>{{ view.label }}</span>
            <span v-if="view.name === 'activity' && project.unseenActivity > 0 && currentView !== 'activity'" class="badge" :aria-label="$t('{unseenActivity} nouveautés', { unseenActivity: project.unseenActivity })">{{ project.unseenActivity > 99 ? '99+' : project.unseenActivity }}</span>
          </router-link>
        </nav>

        <div class="actions">
          <PresenceStack />
          <Button v-tooltip.bottom="project.undoLabel ? $t('Annuler : {undoLabel} (Ctrl+Z)', { undoLabel: project.undoLabel }) : $t('Annuler (Ctrl+Z)')" icon="pi pi-undo" text rounded severity="secondary" :aria-label="$t('Annuler')" :disabled="!project.canUndo" @click="project.undo()" />
          <Button v-tooltip.bottom="project.redoLabel ? $t('Rétablir : {redoLabel} (Ctrl+Y)', { redoLabel: project.redoLabel }) : $t('Rétablir (Ctrl+Y)')" icon="pi pi-refresh" text rounded severity="secondary" :aria-label="$t('Rétablir')" :disabled="!project.canRedo" @click="project.redo()" />
          <Button v-if="canConfigure" v-tooltip.bottom="$t('Réglages du projet')" icon="pi pi-cog" text rounded severity="secondary" :aria-label="$t('Réglages du projet')" @click="router.push({ name: 'settings', params: { projectId } })" />
          <Button v-if="canCreate" :label="$t('Nouveau ticket')" icon="pi pi-plus" @click="ui.openCreate(createDefaults())" />
        </div>
      </header>

      <div class="project-body">
        <router-view />
      </div>

      <TicketDialog />
      <TicketContextMenu />
      <TicketQuickEdit />
    </template>
  </div>
</template>

<style scoped>
.project-layout {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
}
.project-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem 1.25rem;
  padding: 0.6rem 1rem;
  background: var(--fb-panel);
  border-bottom: 1px solid var(--fb-border);
}
.title-block {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
}
.back {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  color: var(--fb-muted);
}
.back:hover {
  background: var(--fb-panel-alt);
  color: var(--fb-text);
}
.key {
  padding: 0.1rem 0.5rem;
  border-radius: 6px;
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.04em;
}
.name {
  font-size: 1.15rem;
  font-weight: 700;
  max-width: 22rem;
}
.archived-badge {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--fb-muted);
}
.tabs {
  display: flex;
  gap: 0.25rem;
  padding: 0.2rem;
  border-radius: 10px;
  background: var(--fb-panel-alt);
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
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
.badge {
  min-width: 1.2rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: var(--fb-accent);
  color: var(--p-primary-contrast-color, #fff);
  font-size: 0.68rem;
  font-weight: 800;
  line-height: 1.2rem;
  text-align: center;
}
.actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-left: auto;
}
.project-body {
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
}
</style>
