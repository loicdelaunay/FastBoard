import { ref } from 'vue';
import { defineStore } from 'pinia';
import type { ProjectSummaryDTO } from '@shared/types';
import { api } from '@/api';
import { realtime } from '@/realtime/socket';

export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<ProjectSummaryDTO[]>([]);
  const loading = ref(false);
  const loaded = ref(false);

  async function fetch(): Promise<void> {
    loading.value = true;
    try {
      projects.value = (await api.projects()).projects;
      loaded.value = true;
    } finally {
      loading.value = false;
    }
  }

  async function create(input: { name: string; key?: string; description?: string }) {
    const { project } = await api.createProject(input);
    await fetch();
    return project;
  }

  realtime.on('projectsRefresh', () => {
    if (loaded.value) {
      void fetch().catch(() => undefined);
    }
  });

  return { projects, loading, loaded, fetch, create };
});
