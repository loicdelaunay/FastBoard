<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import Button from 'primevue/button';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import ToggleSwitch from 'primevue/toggleswitch';
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
      <ProjectCard v-for="project in visibleProjects" :key="project.id" :project="project" />
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

    <ProjectCreateDialog v-model:visible="createOpen" @created="(id) => router.push(`/p/${id}`)" />
  </div>
</template>

<style scoped>
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
