<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import Button from 'primevue/button';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import ContextMenu from 'primevue/contextmenu';
import type { MenuItem } from 'primevue/menuitem';
import ToggleSwitch from 'primevue/toggleswitch';
import type { ProjectSummaryDTO } from '@shared/types';
import ProjectCard from '@/components/projects/ProjectCard.vue';
import ProjectCreateDialog from '@/components/projects/ProjectCreateDialog.vue';
import { useAuthStore } from '@/stores/auth';
import { useProjectsStore } from '@/stores/projects';
import { notifyError } from '@/utils/notify';
import { matchesQuery } from '@/utils/search';

import { t } from '@/i18n';
const auth = useAuthStore();
const store = useProjectsStore();
const router = useRouter();

const search = ref('');
const showArchived = ref(false);
const createOpen = ref(false);

onMounted(() => {
  store.fetch().catch((error) => notifyError(error, t('Chargement des projets impossible')));
});

const visibleProjects = computed(() =>
  store.projects.filter((project) => (showArchived.value || !project.archived) && matchesQuery(search.value, [project.name, project.key, project.description])),
);
const menu = ref<InstanceType<typeof ContextMenu> | null>(null);
const menuProject = ref<ProjectSummaryDTO | null>(null);
const menuItems = computed<MenuItem[]>(() => {
  const target = menuProject.value;
  if (!target) return [];
  const download = (format: 'json' | 'csv') => {
    const link = document.createElement('a');
    link.href = `/api/projects/${target.id}/export?format=${format}`;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };
  return [
    { label: `${target.key} — ${target.name}`, disabled: true, class: 'menu-title' },
    { separator: true },
    { label: t('Ouvrir'), icon: 'pi pi-external-link', command: () => void router.push(`/p/${target.id}`) },
    { label: t('Exporter en CSV (tickets)'), icon: 'pi pi-file-excel', command: () => download('csv') },
    { label: t('Exporter en JSON (projet complet)'), icon: 'pi pi-file', command: () => download('json') },
  ];
});

function openMenu(event: MouseEvent, project: ProjectSummaryDTO): void {
  menuProject.value = project;
  menu.value?.show(event);
}

const archivedCount = computed(() => store.projects.filter((project) => project.archived).length);
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <h1 class="page-title">{{ $t('Projets') }}</h1>
        <p class="muted">{{ $t('Vos projets et ceux partagés avec vous.') }}</p>
      </div>
      <Button v-if="auth.can('projects.create')" :label="$t('Nouveau projet')" icon="pi pi-plus" @click="createOpen = true" />
    </header>

    <div class="toolbar">
      <IconField class="search">
        <InputIcon class="pi pi-search" />
        <InputText v-model="search" :placeholder="$t('Rechercher un projet…')" fluid />
      </IconField>
      <label v-if="archivedCount" class="row archived-toggle">
        <ToggleSwitch v-model="showArchived" />
        <span class="small">{{ $t('Afficher les archivés ({archivedCount})', { archivedCount }) }}</span>
      </label>
    </div>

    <div v-if="store.loading && !store.loaded" class="empty muted"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</div>

    <div v-else-if="visibleProjects.length" class="grid">
      <ProjectCard v-for="project in visibleProjects" :key="project.id" :project="project" @menu="openMenu" />
      <ContextMenu ref="menu" :model="menuItems" />
    </div>

    <div v-else class="empty card">
      <i class="pi pi-folder-open icon"></i>
      <template v-if="store.projects.length">
        <h3>{{ $t('Aucun projet ne correspond') }}</h3>
        <p class="muted">{{ $t('Modifiez votre recherche ou affichez les projets archivés.') }}</p>
      </template>
      <template v-else>
        <h3>{{ $t('Aucun projet pour l\'instant') }}</h3>
        <p v-if="auth.can('projects.create')" class="muted">{{ $t('Créez votre premier projet et invitez votre équipe.') }}</p>
        <p v-else class="muted">{{ $t('Demandez à un collègue de vous inviter sur un projet.') }}</p>
        <Button v-if="auth.can('projects.create')" :label="$t('Créer un projet')" icon="pi pi-plus" @click="createOpen = true" />
      </template>
    </div>

    <footer class="foot muted small">
      <i class="pi pi-code"></i>
      <span>{{ $t('Automatisez FastBoard avec l’API REST :') }}</span>
      <a href="/api/docs" target="_blank" rel="noopener">{{ $t('Documentation de l’API (Swagger)') }}</a>
      <span aria-hidden="true">·</span>
      <a href="/api/docs/guide.md" target="_blank" rel="noopener">{{ $t('Guide pour les IA et les scripts') }}</a>
      <span aria-hidden="true">·</span>
      <a href="/api/openapi.json" target="_blank" rel="noopener">OpenAPI</a>
    </footer>

    <ProjectCreateDialog v-model:visible="createOpen" @created="(id) => router.push(`/p/${id}`)" />
  </div>
</template>

<style scoped>
.foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  margin-top: 3rem;
  padding-top: 1rem;
  border-top: 1px solid var(--fb-border);
}
.foot a {
  color: var(--fb-accent);
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.25rem;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.25rem;
}
.search {
  flex: 1;
  min-width: 14rem;
  max-width: 28rem;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
  gap: 1rem;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  padding: 3rem 1rem;
  text-align: center;
}
.icon {
  font-size: 2.5rem;
  color: var(--fb-muted);
}
</style>
