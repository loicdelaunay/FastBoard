<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import Button from 'primevue/button';
import ContextMenu from 'primevue/contextmenu';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import Tag from 'primevue/tag';
import type { MenuItem } from 'primevue/menuitem';
import { useConfirm } from 'primevue/useconfirm';
import type { BoardSpaceDTO } from '@shared/boards';
import { DOC_ROLE_LABELS } from '@shared/docs';
import { api } from '@/api';
import BoardSpaceDialog from '@/components/boards/BoardSpaceDialog.vue';
import { t } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import { useBoardsStore } from '@/stores/boards';
import { formatRelative } from '@/utils/format';
import { notifyError } from '@/utils/notify';
import { matchesQuery } from '@/utils/search';

/** Page « Tableaux blancs » : les espaces accessibles, comme la page des documentations. */
const store = useBoardsStore();
const auth = useAuthStore();
const router = useRouter();
const confirm = useConfirm();

const search = ref('');
const createOpen = ref(false);
const settingsOpen = ref(false);
const target = ref<BoardSpaceDTO | null>(null);
const menu = ref<InstanceType<typeof ContextMenu> | null>(null);

const visible = computed(() => store.spaces.filter((space) => matchesQuery(search.value, [space.name, space.description])));

onMounted(() => void store.fetchSpaces().catch((error) => notifyError(error)));

function open(space: BoardSpaceDTO): void {
  void router.push({ name: 'board-space', params: { spaceId: space.id } });
}

const menuItems = computed<MenuItem[]>(() => {
  const space = target.value;
  if (!space) return [];
  return [
    { label: t('Ouvrir'), icon: 'pi pi-folder-open', command: () => open(space) },
    ...(space.role === 'owner'
      ? [
          { label: t('Modifier l’espace'), icon: 'pi pi-pencil', command: () => (settingsOpen.value = true) },
          { separator: true },
          { label: t('Supprimer l’espace'), icon: 'pi pi-trash', class: 'menu-danger', command: () => remove(space) },
        ]
      : []),
  ];
});

function openMenu(event: MouseEvent, space: BoardSpaceDTO): void {
  target.value = space;
  menu.value?.show(event);
}

function remove(space: BoardSpaceDTO): void {
  confirm.require({
    header: t('Supprimer l’espace « {name} » ?', { name: space.name }),
    message: t('Tous ses tableaux sont supprimés définitivement.'),
    icon: 'pi pi-trash',
    acceptLabel: t('Supprimer'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      try {
        await api.boardDeleteSpace(space.id);
        await store.fetchSpaces();
      } catch (error) {
        notifyError(error);
      }
    },
  });
}

const refresh = () => store.fetchSpaces().catch(() => undefined);
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <h1 class="page-title">{{ $t('Tableaux blancs') }}</h1>
        <p class="muted">{{ $t('Diagrammes, ateliers en post-it, cartes mentales et croquis, à plusieurs et en direct.') }}</p>
      </div>
      <Button v-if="auth.can('boards.create')" :label="$t('Nouvel espace')" icon="pi pi-plus" @click="createOpen = true" />
    </header>

    <IconField v-if="store.spaces.length" class="search">
      <InputIcon class="pi pi-search" />
      <InputText v-model="search" :placeholder="$t('Rechercher un espace…')" fluid />
    </IconField>

    <div v-if="store.loading && !store.loaded" class="empty muted"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</div>

    <div v-else-if="visible.length" class="grid">
      <button v-for="space in visible" :key="space.id" type="button" class="card space" @click="open(space)" @contextmenu.prevent="openMenu($event, space)">
        <div class="top">
          <i class="pi pi-objects-column icon"></i>
          <strong class="truncate">{{ space.name }}</strong>
<Tag v-if="space.adminAccess" v-tooltip.top="$t('Vous n’êtes pas propriétaire de cet espace : vous y entrez grâce à vos droits d’administration.')" :value="$t('Accès avec droit admin')" icon="pi pi-shield" severity="warn" />
          <Tag v-else :value="$t(DOC_ROLE_LABELS[space.role])" severity="secondary" />
        </div>
        <p class="muted small description">{{ space.description || $t('Aucune description.') }}</p>
        <p class="muted small meta">
          <span><i class="pi pi-objects-column"></i> {{ $t('{n} tableau|{n} tableaux', { n: space.boardCount }) }}</span>
          <span><i class="pi pi-users"></i> {{ space.memberCount }}</span>
          <span>{{ $t('modifié {when}', { when: formatRelative(space.updatedAt) }) }}</span>
        </p>
      </button>
    </div>

    <div v-else class="empty card">
      <i class="pi pi-objects-column icon"></i>
      <template v-if="store.spaces.length">
        <h3>{{ $t('Aucun espace ne correspond') }}</h3>
      </template>
      <template v-else>
        <h3>{{ $t('Aucun espace de tableaux blancs') }}</h3>
        <p class="muted">{{ auth.can('boards.create') ? $t('Créez un espace pour dessiner à plusieurs : diagrammes, ateliers, cartes mentales.') : $t('Demandez à un collègue de vous inviter dans un espace.') }}</p>
        <Button v-if="auth.can('boards.create')" :label="$t('Créer un espace')" icon="pi pi-plus" @click="createOpen = true" />
      </template>
    </div>

    <BoardSpaceDialog v-model:visible="createOpen" @saved="open" />
    <BoardSpaceDialog v-model:visible="settingsOpen" :space="target" @saved="refresh" />
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
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
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
  color: #a855f7;
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
