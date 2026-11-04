import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { DocCommentDTO } from '@shared/docComments';
import { docRoleAtLeast, type DocMemberDTO, type DocNodeDTO, type DocRole, type DocSpaceDTO } from '@shared/docs';
import { api } from '@/api';
import { realtime } from '@/realtime/socket';

/** Documentation : liste des espaces, et espace ouvert avec son arbre, tenu à jour en direct. */
export const useDocsStore = defineStore('docs', () => {
  const spaces = ref<DocSpaceDTO[]>([]);
  const loading = ref(false);
  const loaded = ref(false);

  const space = ref<DocSpaceDTO | null>(null);
  const nodes = ref<DocNodeDTO[]>([]);
  const members = ref<DocMemberDTO[]>([]);
  /** L'accès à l'espace ouvert vient d'être retiré. */
  const revoked = ref(false);
  /** Commentaires de la note ouverte. */
  const comments = ref<DocCommentDTO[]>([]);
  const commentsNode = ref<number | null>(null);

  const canEdit = computed(() => (space.value ? docRoleAtLeast(space.value.role, 'editor') : false));
  const isOwner = computed(() => space.value?.role === 'owner');
  const role = computed<DocRole>(() => space.value?.role ?? 'reader');

  async function fetchSpaces(): Promise<void> {
    loading.value = true;
    try {
      spaces.value = (await api.docSpaces()).spaces;
      loaded.value = true;
    } finally {
      loading.value = false;
    }
  }

  async function reload(spaceId: number): Promise<void> {
    const result = await api.docSpace(spaceId);
    space.value = result.space;
    nodes.value = result.nodes;
    members.value = result.members;
  }

  async function openSpace(spaceId: number): Promise<void> {
    revoked.value = false;
    await reload(spaceId);
    realtime.sendDoc({ t: 'docs.watch', spaceId });
  }

  async function loadComments(nodeId: number | null): Promise<void> {
    if (commentsNode.value !== nodeId) comments.value = [];
    commentsNode.value = nodeId;
    if (nodeId === null) return;
    const result = await api.docComments(nodeId);
    if (commentsNode.value === nodeId) comments.value = result.comments;
  }

  function closeSpace(): void {
    space.value = null;
    nodes.value = [];
    members.value = [];
    realtime.sendDoc({ t: 'docs.watch', spaceId: null });
  }

  realtime.on('doc', (message) => {
    if (!('spaceId' in message) || message.spaceId !== space.value?.id) return;
    if (message.t === 'docs.tree') nodes.value = message.nodes;
    else if (message.t === 'docs.access') void reload(message.spaceId).catch(() => undefined);
    else if (message.t === 'docs.revoked') revoked.value = true;
    else if (message.t === 'docs.comments' && message.nodeId === commentsNode.value) comments.value = message.comments;
  });
  // Connexion ouverte après l'espace, ou coupure : l'arbre a pu changer, et le serveur ne sait pas encore qui regarde quoi.
  realtime.on('open', () => {
    if (!space.value) return;
    const spaceId = space.value.id;
    void openSpace(spaceId).catch(() => undefined);
    void loadComments(commentsNode.value).catch(() => undefined);
  });

  return { spaces, loading, loaded, space, nodes, members, revoked, comments, canEdit, isOwner, role, fetchSpaces, openSpace, closeSpace, reload, loadComments };
});
