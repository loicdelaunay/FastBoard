<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import Button from 'primevue/button';
import ContextMenu from 'primevue/contextmenu';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import type { MenuItem } from 'primevue/menuitem';
import Tag from 'primevue/tag';
import { DOC_ROLE_LABELS, docParent, docRoleAtLeast, docTitle, type DocBookmarkDTO, type DocSpaceDTO } from '@shared/docs';
import DocImportDialog from '@/components/docs/DocImportDialog.vue';
import DocSiteDialog from '@/components/docs/DocSiteDialog.vue';
import DocSpaceDialog from '@/components/docs/DocSpaceDialog.vue';
import { useAuthStore } from '@/stores/auth';
import { useDocsStore } from '@/stores/docs';
import { downloadFrom } from '@/utils/files';
import { formatRelative } from '@/utils/format';
import { notifyError } from '@/utils/notify';
import { matchesQuery } from '@/utils/search';

import { t } from '@/i18n';
/** Espaces de documentation accessibles, et en tête les notes mises en favori. */
const auth = useAuthStore();
const store = useDocsStore();
const router = useRouter();

const search = ref('');
const createOpen = ref(false);
const visible = computed(() => store.spaces.filter((space) => matchesQuery(search.value, [space.name, space.description])));
const favorites = computed(() => store.bookmarks.filter((entry) => matchesQuery(search.value, [entry.path, entry.spaceName])));

onMounted(() => {
  store.fetchSpaces().catch((error) => notifyError(error, t('Chargement de la documentation impossible')));
  store.loadBookmarks().catch(() => undefined);
});

function open(space: DocSpaceDTO): void {
  void router.push({ name: 'doc-space', params: { spaceId: space.id } });
}

function openBookmark(entry: DocBookmarkDTO): void {
  void router.push({ name: 'doc-space', params: { spaceId: entry.spaceId }, query: { file: String(entry.nodeId) } });
}

const SITE_LABELS = computed(() => ({ members: t('Site web : membres'), people: t('Site web : personnes choisies'), public: t('Site web public') }));

// --- Clic droit sur un espace ---
const menu = ref<InstanceType<typeof ContextMenu> | null>(null);
const target = ref<DocSpaceDTO | null>(null);
const importOpen = ref(false);
const settingsOpen = ref(false);
const siteOpen = ref(false);
const menuItems = computed<MenuItem[]>(() => {
  const space = target.value;
  if (!space) return [];
  const owner = space.role === 'owner';
  return [
    { label: t('Ouvrir'), icon: 'pi pi-folder-open', command: () => open(space) },
    ...(owner
      ? [
          { separator: true },
          { label: t('Modifier l’espace'), icon: 'pi pi-cog', command: () => (settingsOpen.value = true) },
          { label: space.site ? t('Site web…') : t('Activer le site web'), icon: 'pi pi-globe', command: () => (siteOpen.value = true) },
        ]
      : space.site
        ? [{ separator: true }, { label: t('Ouvrir le site web'), icon: 'pi pi-globe', command: () => window.open(`/wiki/${space.site!.slug}`, '_blank', 'noopener') }]
        : []),
    { separator: true },
    { label: t('Exporter l’espace en ZIP'), icon: 'pi pi-download', command: () => downloadFrom(`/api/documentation/spaces/${space.id}/export`) },
    ...(docRoleAtLeast(space.role, 'editor') ? [{ label: t('Importer un .md ou un ZIP'), icon: 'pi pi-upload', command: () => (importOpen.value = true) }] : []),
  ];
});

function openMenu(event: MouseEvent, space: DocSpaceDTO): void {
  target.value = space;
  menu.value?.show(event);
}

const refresh = () => store.fetchSpaces().catch(() => undefined);
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <h1 class="page-title">{{ $t('Documentations') }}</h1>
        <p class="muted">{{ $t('Vos espaces de documentation et ceux partagés avec vous.') }}</p>
      </div>
      <Button v-if="auth.can('docs.create')" :label="$t('Nouvel espace')" icon="pi pi-plus" @click="createOpen = true" />
    </header>

    <IconField v-if="store.spaces.length" class="search">
      <InputIcon class="pi pi-search" />
      <InputText v-model="search" :placeholder="$t('Rechercher un espace ou un favori…')" fluid />
    </IconField>

    <section v-if="favorites.length" class="favorites">
      <h2 class="section-title"><i class="pi pi-star-fill star"></i> {{ $t('Favoris') }}</h2>
      <div class="favorite-list">
        <button v-for="entry in favorites" :key="entry.nodeId" type="button" class="favorite" :title="`${entry.spaceName} / ${entry.path}`" @click="openBookmark(entry)">
          <i :class="entry.kind === 'image' ? 'pi pi-image' : 'pi pi-file'" class="muted"></i>
          <span class="favorite-text">
            <strong class="truncate">{{ docTitle(entry.path) }}</strong>
            <span class="muted small truncate">{{ entry.spaceName }}<template v-if="docParent(entry.path)"> · {{ docParent(entry.path) }}</template></span>
          </span>
          <span v-tooltip.top="$t('Retirer des favoris')" class="unstar" role="button" tabindex="0" :aria-label="$t('Retirer des favoris')" @click.stop="store.toggleBookmark(entry.nodeId)" @keydown.enter.stop="store.toggleBookmark(entry.nodeId)"><i class="pi pi-times"></i></span>
        </button>
      </div>
    </section>

    <div v-if="store.loading && !store.loaded" class="empty muted"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</div>

    <template v-else-if="visible.length">
      <h2 v-if="favorites.length" class="section-title"><i class="pi pi-book"></i> {{ $t('Espaces') }}</h2>
      <div class="grid">
        <button v-for="space in visible" :key="space.id" type="button" class="card space" @click="open(space)" @contextmenu.prevent="openMenu($event, space)">
          <div class="top">
            <i class="pi pi-book icon"></i>
            <strong class="truncate">{{ space.name }}</strong>
            <i v-if="space.site" v-tooltip.top="SITE_LABELS[space.site.visibility]" class="pi pi-globe site" :class="space.site.visibility" :aria-label="SITE_LABELS[space.site.visibility]"></i>
            <Tag :value="$t(DOC_ROLE_LABELS[space.role])" severity="secondary" />
          </div>
          <p class="muted small description">{{ space.description || $t('Aucune description.') }}</p>
          <p class="muted small meta">
            <span><i class="pi pi-file"></i> {{ $t('{n} note|{n} notes', { n: space.fileCount }) }}</span>
            <span><i class="pi pi-users"></i> {{ space.memberCount }}</span>
            <span>{{ $t('modifié {when}', { when: formatRelative(space.updatedAt) }) }}</span>
          </p>
        </button>
      </div>
    </template>

    <div v-else class="empty card">
      <i class="pi pi-book icon"></i>
      <template v-if="store.spaces.length">
        <h3>{{ $t('Aucun espace ne correspond') }}</h3>
      </template>
      <template v-else>
        <h3>{{ $t('Aucun espace de documentation') }}</h3>
        <p class="muted">{{ auth.can('docs.create') ? $t('Créez un espace pour rédiger à plusieurs, comme dans un coffre Obsidian partagé.') : $t('Demandez à un collègue de vous inviter dans un espace.') }}</p>
        <Button v-if="auth.can('docs.create')" :label="$t('Créer un espace')" icon="pi pi-plus" @click="createOpen = true" />
      </template>
    </div>

    <DocSpaceDialog v-model:visible="createOpen" @saved="open" />
    <DocSpaceDialog v-model:visible="settingsOpen" :space="target" @saved="refresh" />
    <DocSiteDialog v-model:visible="siteOpen" :space="target" @saved="refresh" />
    <DocImportDialog v-if="target" v-model:visible="importOpen" :space-id="target.id" @done="refresh" />
    <ContextMenu ref="menu" :model="menuItems" />
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}
.search {
  max-width: 26rem;
  margin-bottom: 1rem;
}
.section-title {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0 0 0.6rem;
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--fb-muted);
}
.star {
  color: #eab308;
}
.favorites {
  margin-bottom: 1.5rem;
}
.favorite-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
  gap: 0.5rem;
}
.favorite {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
  padding: 0.55rem 0.5rem 0.55rem 0.75rem;
  border: 1px solid var(--fb-border);
  border-radius: 10px;
  background: var(--fb-panel);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.favorite:hover {
  border-color: var(--fb-accent);
}
.favorite-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.unstar {
  display: grid;
  place-items: center;
  width: 1.5rem;
  height: 1.5rem;
  flex: none;
  border-radius: 6px;
  color: var(--fb-muted);
  font-size: 0.7rem;
  opacity: 0;
}
.favorite:hover .unstar,
.unstar:focus-visible {
  opacity: 1;
}
.unstar:hover {
  background: var(--fb-panel-alt);
  color: var(--fb-text);
}
@media (hover: none) {
  .unstar {
    opacity: 1;
  }
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
  gap: 1rem;
}
.space {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem;
  border: 1px solid var(--fb-border);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.space:hover {
  border-color: var(--fb-accent);
  box-shadow: var(--fb-shadow-lg);
}
.top {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.top strong {
  flex: 1;
  min-width: 0;
}
.site {
  color: var(--fb-muted);
}
.site.public {
  color: #f59e0b;
}
.description {
  flex: 1;
  margin: 0;
  overflow-wrap: anywhere;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.8rem;
  margin: 0;
}
.icon {
  color: var(--fb-accent);
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 3rem 1rem;
  text-align: center;
}
.empty .icon {
  font-size: 2rem;
}
.empty h3 {
  margin: 0;
}
</style>
