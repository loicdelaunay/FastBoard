import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { BoardMemberDTO, BoardNodeDTO, BoardRole, BoardSpaceDTO } from '@shared/boards';
import type { SpaceGroupDTO } from '@shared/groups';
import { docRoleAtLeast } from '@shared/docs';
import { api } from '@/api';
import { realtime } from '@/realtime/socket';

/** Tableaux blancs : liste des espaces, et espace ouvert avec son arbre, tenu à jour en direct. */
export const useBoardsStore = defineStore('boards', () => {
  const spaces = ref<BoardSpaceDTO[]>([]);
  const loading = ref(false);
  const loaded = ref(false);

  const space = ref<BoardSpaceDTO | null>(null);
  const nodes = ref<BoardNodeDTO[]>([]);
  const members = ref<BoardMemberDTO[]>([]);
  /** Groupes ajoutés à l'espace ouvert. */
  const groups = ref<SpaceGroupDTO[]>([]);
  const revoked = ref(false);

  const role = computed<BoardRole>(() => space.value?.role ?? 'reader');
  const canEdit = computed(() => docRoleAtLeast(role.value, 'editor'));
  const isOwner = computed(() => role.value === 'owner');

  async function fetchSpaces(): Promise<void> {
    loading.value = true;
    try {
      spaces.value = (await api.boardSpaces()).spaces;
      loaded.value = true;
    } finally {
      loading.value = false;
    }
  }

  async function reload(spaceId: number): Promise<void> {
    const result = await api.boardSpace(spaceId);
    space.value = result.space;
    nodes.value = result.nodes;
    members.value = result.members;
    groups.value = result.groups;
  }

  async function openSpace(spaceId: number): Promise<void> {
    revoked.value = false;
    await reload(spaceId);
    realtime.sendBoard({ t: 'boards.watch', spaceId });
  }

  function closeSpace(): void {
    space.value = null;
    nodes.value = [];
    members.value = [];
    groups.value = [];
    realtime.sendBoard({ t: 'boards.watch', spaceId: null });
  }

  realtime.on('board', (message) => {
    if (!('spaceId' in message) || message.spaceId !== space.value?.id) return;
    if (message.t === 'boards.tree') nodes.value = message.nodes;
    else if (message.t === 'boards.access') void reload(message.spaceId).catch(() => undefined);
    else if (message.t === 'boards.revoked') revoked.value = true;
  });
  realtime.on('open', () => {
    if (space.value) void openSpace(space.value.id).catch(() => undefined);
  });
  // Un groupe a été ajouté ou retiré : la liste des espaces accessibles a changé.
  realtime.on('spacesRefresh', () => {
    if (loaded.value) void fetchSpaces().catch(() => undefined);
  });

  return { spaces, loading, loaded, space, nodes, members, groups, revoked, role, canEdit, isOwner, fetchSpaces, openSpace, closeSpace, reload };
});
