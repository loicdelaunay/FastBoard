import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { GroupDTO } from '@shared/groups';
import { api } from '@/api';
import { realtime } from '@/realtime/socket';

/** Groupes de personnes : tout le monde les voit (pour les ajouter à ce qu'il partage), tenus à jour en direct. */
export const useGroupsStore = defineStore('groups', () => {
  const groups = ref<GroupDTO[]>([]);
  const loading = ref(false);
  const loaded = ref(false);
  const byId = computed(() => new Map(groups.value.map((group) => [group.id, group])));

  async function fetch(): Promise<void> {
    loading.value = true;
    try {
      groups.value = (await api.groups()).groups;
      loaded.value = true;
    } finally {
      loading.value = false;
    }
  }

  /** Charge la liste une première fois (fenêtres de partage). */
  async function ensure(): Promise<void> {
    if (!loaded.value && !loading.value) await fetch();
  }

  /** Remplace un groupe dans la liste (réponse d'une modification), triée par nom. */
  function upsert(group: GroupDTO): void {
    groups.value = [...groups.value.filter((entry) => entry.id !== group.id), group].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  function forget(groupId: number): void {
    groups.value = groups.value.filter((entry) => entry.id !== groupId);
  }

  realtime.on('groupsChanged', () => {
    if (loaded.value) void fetch().catch(() => undefined);
  });
  realtime.on('open', () => {
    if (loaded.value) void fetch().catch(() => undefined);
  });

  return { groups, loading, loaded, byId, fetch, ensure, upsert, forget };
});
