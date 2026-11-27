<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue';
import Button from 'primevue/button';
import { useConfirm } from 'primevue/useconfirm';
import type { HomeDTO } from '@shared/home';
import { defaultHomeLayout, HOME_LAYOUT_LIMITS, newHomeBlock, type HomeBlock, type HomeBlockType, type HomeLayout } from '@shared/homeLayout';
import { api } from '@/api';
import ActivityBlock from '@/components/home/blocks/ActivityBlock.vue';
import AssignedBlock from '@/components/home/blocks/AssignedBlock.vue';
import BookmarksBlock from '@/components/home/blocks/BookmarksBlock.vue';
import DeliveriesBlock from '@/components/home/blocks/DeliveriesBlock.vue';
import DueBlock from '@/components/home/blocks/DueBlock.vue';
import FavoritesBlock from '@/components/home/blocks/FavoritesBlock.vue';
import NotificationsBlock from '@/components/home/blocks/NotificationsBlock.vue';
import ProjectBlock from '@/components/home/blocks/ProjectBlock.vue';
import RecentBlock from '@/components/home/blocks/RecentBlock.vue';
import SavedFilterBlock from '@/components/home/blocks/SavedFilterBlock.vue';
import StatusBlock from '@/components/home/blocks/StatusBlock.vue';
import HomeBlockGallery from '@/components/home/HomeBlockGallery.vue';
import HomeBlockSettings from '@/components/home/HomeBlockSettings.vue';
import { createHomeSources, provideHome, type HomeEditor } from '@/components/home/homeContext';
import { t } from '@/i18n';
import { connection } from '@/offline/connection';
import { realtime } from '@/realtime/socket';
import { useAuthStore } from '@/stores/auth';
import { notify, notifyError } from '@/utils/notify';

/**
 * Accueil : des blocs que chacun choisit, range et règle (mode « Personnaliser ») — ses espaces favoris, ce qui lui
 * est assigné, ses notifications importantes, ce qu'il a modifié, ses documents favoris, et des blocs de suivi
 * (statuts, retards, échéances, un projet, les livraisons, un filtre enregistré, l'activité).
 */
const auth = useAuthStore();
const confirm = useConfirm();
const home = ref<HomeDTO | null>(null);
const failed = ref(false);
const sources = createHomeSources(home);

const BLOCKS: Record<HomeBlockType, Component> = {
  favorites: FavoritesBlock,
  assigned: AssignedBlock,
  notifications: NotificationsBlock,
  recent: RecentBlock,
  bookmarks: BookmarksBlock,
  status: StatusBlock,
  overdue: DueBlock,
  upcoming: DueBlock,
  project: ProjectBlock,
  deliveries: DeliveriesBlock,
  savedFilter: SavedFilterBlock,
  activity: ActivityBlock,
};

// --- Disposition : celle du serveur, sauf pendant qu'une modification d'ici attend d'être enregistrée ---
const layout = ref<HomeLayout>(defaultHomeLayout());
const editing = ref(false);
const canEdit = computed(() => !connection.offline);
let saveTimer = 0;
let saving = 0;
const dirty = (): boolean => saveTimer !== 0 || saving > 0;

function adopt(next: HomeLayout): void {
  if (!dirty()) layout.value = next;
}

async function save(): Promise<void> {
  window.clearTimeout(saveTimer);
  saveTimer = 0;
  saving += 1;
  try {
    await api.saveHomeLayout(JSON.parse(JSON.stringify(layout.value)) as HomeLayout);
  } catch (error) {
    notifyError(error);
  } finally {
    saving -= 1;
  }
}
function commit(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void save(), 500);
}
function flush(): void {
  if (saveTimer) void save();
}

const find = (id: string): HomeBlock | undefined => layout.value.blocks.find((block) => block.id === id);
const settingsId = ref<string | null>(null);
const settingsOpen = ref(false);
const galleryOpen = ref(false);

const editor: HomeEditor = {
  editing,
  canEdit,
  dragging: ref<string | null>(null),
  update(id, patch) {
    const block = find(id);
    if (!block) return;
    Object.assign(block, patch);
    commit();
  },
  remove(id) {
    layout.value.blocks = layout.value.blocks.filter((block) => block.id !== id);
    commit();
  },
  move(id, delta) {
    const blocks = layout.value.blocks;
    const index = blocks.findIndex((block) => block.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= blocks.length) return;
    [blocks[index], blocks[target]] = [blocks[target]!, blocks[index]!];
    commit();
  },
  moveTo(id, targetId) {
    const blocks = layout.value.blocks;
    const from = blocks.findIndex((block) => block.id === id);
    const to = blocks.findIndex((block) => block.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const [moved] = blocks.splice(from, 1);
    blocks.splice(to, 0, moved!);
    commit();
  },
  configure(id) {
    settingsId.value = id;
    settingsOpen.value = true;
  },
  position(id) {
    return { index: layout.value.blocks.findIndex((block) => block.id === id), total: layout.value.blocks.length };
  },
};
provideHome(sources, editor);

const settingsBlock = computed(() => (settingsId.value ? (find(settingsId.value) ?? null) : null));
const present = computed(() => layout.value.blocks.map((block) => block.type));
const full = computed(() => layout.value.blocks.length >= HOME_LAYOUT_LIMITS.blocks);

function addBlock(type: HomeBlockType): void {
  if (full.value) return;
  const block = newHomeBlock(type);
  layout.value.blocks.push(block);
  commit();
  // Un bloc qui suit un projet ou un filtre se règle tout de suite.
  if (type === 'project' || type === 'savedFilter') editor.configure(block.id);
}

function startEditing(): void {
  editing.value = true;
}
function stopEditing(): void {
  editing.value = false;
  editor.dragging.value = null;
  flush();
}
function openGallery(): void {
  if (full.value) {
    notify('info', t('Accueil complet'), t('Un accueil compte au plus {n} blocs : retirez-en un pour en ajouter un autre.', { n: HOME_LAYOUT_LIMITS.blocks }));
    return;
  }
  galleryOpen.value = true;
}
function reset(): void {
  confirm.require({
    header: t('Revenir à l’accueil d’origine ?'),
    message: t('Vos blocs, leur ordre, leurs tailles et leurs réglages laissent place aux cinq blocs de départ.'),
    icon: 'pi pi-replay',
    acceptLabel: t('Revenir à l’origine'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      window.clearTimeout(saveTimer);
      saveTimer = 0;
      try {
        layout.value = (await api.saveHomeLayout(null)).layout;
      } catch (error) {
        notifyError(error);
      }
    },
  });
}
// Hors ligne : lecture seule, on quitte la personnalisation.
watch(canEdit, (allowed) => {
  if (!allowed && editing.value) stopEditing();
});

// --- Chargement et mises à jour ---
async function load(): Promise<void> {
  try {
    home.value = (await api.home()).home;
    adopt(home.value.layout ?? defaultHomeLayout());
    failed.value = false;
  } catch (error) {
    if (!home.value) failed.value = true;
    notifyError(error);
  }
}

// Notifications et favoris changés (ici ou ailleurs) : l'accueil se relit, une fois les changements passés.
let timer = 0;
const refresh = (): void => {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void load(), 400);
};
let lastFull = Date.now();
const refreshAll = (): void => {
  lastFull = Date.now();
  refresh();
  sources.refresh();
};
// Retour sur l'onglet après un moment : les blocs de suivi se relisent.
const onVisible = (): void => {
  if (document.visibilityState === 'visible' && Date.now() - lastFull > 60_000) refreshAll();
};
const stops = [
  realtime.on('notification', refresh),
  realtime.on('notificationsRead', refresh),
  realtime.on('notificationsRemoved', refresh),
  realtime.on('favorites', refresh),
  realtime.on('resync', refreshAll),
  realtime.on('homeLayout', adopt),
];
onMounted(() => {
  void load();
  document.addEventListener('visibilitychange', onVisible);
});
onBeforeUnmount(() => {
  flush();
  window.clearTimeout(timer);
  document.removeEventListener('visibilitychange', onVisible);
  stops.forEach((stop) => stop());
});

const firstName = computed(() => auth.user?.name.split(/\s+/)[0] ?? '');
const greeting = computed(() => {
  const hour = new Date().getHours();
  return hour < 5 || hour >= 18 ? t('Bonsoir {name}', { name: firstName.value }) : t('Bonjour {name}', { name: firstName.value });
});
const todayLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
</script>

<template>
  <div class="home-scroll">
    <!-- Dans la barre de l'Accueil, à droite de ses onglets. -->
    <Teleport defer to="#home-shell-actions">
      <div class="home-actions">
        <template v-if="editing">
          <span class="muted small editing-hint">{{ $t('Glissez les blocs pour les ranger ; tout est enregistré au fur et à mesure.') }}</span>
          <Button :label="$t('Ajouter un bloc')" icon="pi pi-plus" size="small" outlined @click="openGallery" />
          <Button v-tooltip.bottom="$t('Revenir à l’accueil d’origine')" :label="$t('Réinitialiser')" icon="pi pi-replay" size="small" text severity="secondary" @click="reset" />
          <Button :label="$t('Terminé')" icon="pi pi-check" size="small" @click="stopEditing" />
        </template>
        <Button
          v-else
          v-tooltip.bottom="canEdit ? $t('Choisir les blocs de l’accueil, leur taille et ce qu’ils montrent') : $t('Serveur injoignable : lecture seule')"
          :label="$t('Personnaliser')"
          icon="pi pi-sliders-h"
          size="small"
          text
          severity="secondary"
          :disabled="!canEdit || !home"
          @click="startEditing"
        />
      </div>
    </Teleport>

    <div class="page home">
      <header class="head">
        <h1 class="page-title">{{ greeting }}</h1>
        <p class="muted date">{{ todayLabel }}</p>
      </header>

      <div v-if="!home && !failed" class="empty muted"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</div>
      <div v-else-if="!home" class="empty muted">
        <i class="pi pi-exclamation-circle"></i> {{ $t('L’accueil n’a pas pu être chargé.') }}
        <Button :label="$t('Réessayer')" icon="pi pi-refresh" text size="small" @click="load" />
      </div>

      <template v-else>
        <div class="grid" :class="{ editing }">
          <component :is="BLOCKS[block.type]" v-for="block in layout.blocks" :key="block.id" :block="block" />
          <button v-if="editing && !full" type="button" class="add-tile" @click="openGallery">
            <i class="pi pi-plus"></i>
            <span>{{ $t('Ajouter un bloc') }}</span>
            <span class="muted small">{{ $t('Statuts, retards, échéances, suivi d’un projet, livraisons, filtre enregistré, activité…') }}</span>
          </button>
        </div>
        <div v-if="!layout.blocks.length && !editing" class="card blank">
          <i class="pi pi-th-large"></i>
          <p>{{ $t('Votre accueil est vide.') }}</p>
          <Button :label="$t('Ajouter un bloc')" icon="pi pi-plus" :disabled="!canEdit" @click="startEditing(), openGallery()" />
        </div>
      </template>
    </div>

    <HomeBlockGallery v-model:visible="galleryOpen" :present="present" @add="addBlock" />
    <HomeBlockSettings v-model:visible="settingsOpen" :block="settingsBlock" @save="(patch) => settingsBlock && editor.update(settingsBlock.id, patch)" />
  </div>
</template>

<style scoped>
.home-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.home {
  max-width: 82rem;
}
.home-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.4rem;
  margin-left: auto;
}
.editing-hint {
  margin-right: 0.4rem;
}
.head {
  margin-bottom: 1rem;
}
.date {
  margin: 0.2rem 0 0;
}
/* Seule la première lettre : « Jeudi 26 novembre ». */
.date::first-letter {
  text-transform: uppercase;
}
.grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 1rem;
  align-items: start;
}
.add-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  grid-column: span 4;
  min-height: 9rem;
  padding: 1rem;
  border: 2px dashed var(--fb-border);
  border-radius: 14px;
  background: transparent;
  color: var(--fb-text);
  font: inherit;
  text-align: center;
  cursor: pointer;
}
.add-tile:hover {
  border-color: var(--fb-accent);
  color: var(--fb-accent);
}
.add-tile .pi {
  font-size: 1.4rem;
}
.blank {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  padding: 2.5rem 1rem;
  text-align: center;
}
.blank .pi {
  font-size: 1.8rem;
  color: var(--fb-accent);
}
.blank p {
  margin: 0;
}
.empty {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 2rem 0;
}
@media (max-width: 1100px) {
  .add-tile {
    grid-column: span 6;
  }
  .editing-hint {
    display: none;
  }
}
@media (max-width: 760px) {
  .add-tile {
    grid-column: span 12;
  }
}
</style>
