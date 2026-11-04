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
import { DOC_ROLE_LABELS, docRoleAtLeast, type DocSpaceDTO } from '@shared/docs';
import DocImportDialog from '@/components/docs/DocImportDialog.vue';
import DocSpaceDialog from '@/components/docs/DocSpaceDialog.vue';
import { useAuthStore } from '@/stores/auth';
import { useDocsStore } from '@/stores/docs';
import { downloadFrom } from '@/utils/files';
import { formatRelative } from '@/utils/format';
import { notifyError } from '@/utils/notify';
import { matchesQuery } from '@/utils/search';

import { t } from '@/i18n';
/** Espaces de documentation accessibles : chacun est un dossier de fichiers Markdown sur le serveur. */
const auth = useAuthStore();
const store = useDocsStore();
const router = useRouter();

const search = ref('');
const createOpen = ref(false);
const visible = computed(() => store.spaces.filter((space) => matchesQuery(search.value, [space.name, space.description])));

onMounted(() => {
  store.fetchSpaces().catch((error) => notifyError(error, t('Chargement de la documentation impossible')));
});

function open(space: DocSpaceDTO): void {
  void router.push({ name: 'doc-space', params: { spaceId: space.id } });
}

// --- Clic droit sur un espace ---
const menu = ref<InstanceType<typeof ContextMenu> | null>(null);
const target = ref<DocSpaceDTO | null>(null);
const importOpen = ref(false);
const menuItems = computed<MenuItem[]>(() => {
  const space = target.value;
  if (!space) return [];
  return [
    { label: t('Ouvrir'), icon: 'pi pi-folder-open', command: () => open(space) },
    { separator: true },
    { label: t('Exporter l’espace en ZIP'), icon: 'pi pi-download', command: () => downloadFrom(`/api/documentation/spaces/${space.id}/export`) },
    ...(docRoleAtLeast(space.role, 'editor') ? [{ label: t('Réimporter un ZIP'), icon: 'pi pi-upload', command: () => (importOpen.value = true) }] : []),
  ];
});

function openMenu(event: MouseEvent, space: DocSpaceDTO): void {
  target.value = space;
  menu.value?.show(event);
}
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
      <InputText v-model="search" :placeholder="$t('Rechercher un espace…')" fluid />
    </IconField>

    <div v-if="store.loading && !store.loaded" class="empty muted"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</div>

    <div v-else-if="visible.length" class="grid">
      <button v-for="space in visible" :key="space.id" type="button" class="card space" @click="open(space)" @contextmenu.prevent="openMenu($event, space)">
        <div class="top">
          <i class="pi pi-book icon"></i>
          <strong class="truncate">{{ space.name }}</strong>
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
    <DocImportDialog v-if="target" v-model:visible="importOpen" :space-id="target.id" @done="store.fetchSpaces()" />
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
