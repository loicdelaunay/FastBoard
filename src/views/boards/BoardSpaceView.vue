<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from 'primevue/button';
import ContextMenu from 'primevue/contextmenu';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Menu from 'primevue/menu';
import Tag from 'primevue/tag';
import type { MenuItem } from 'primevue/menuitem';
import { useConfirm } from 'primevue/useconfirm';
import { boardTitle, type BoardLinksDTO, type BoardNodeDTO } from '@shared/boards';
import { citedElementsFromQuery } from '@shared/citations';
import type { UserSummaryDTO } from '@shared/types';
import { api } from '@/api';
import { darkMode } from '@/theme/themeManager';
import BoardCanvas from '@/components/boards/BoardCanvas.vue';
import BoardLinksPanel from '@/components/boards/BoardLinksPanel.vue';
import BoardTimeline from '@/components/boards/BoardTimeline.vue';
import BoardMembersDialog from '@/components/boards/BoardMembersDialog.vue';
import BoardShareDialog from '@/components/boards/BoardShareDialog.vue';
import BoardSpaceDialog from '@/components/boards/BoardSpaceDialog.vue';
import BoardTrashDialog from '@/components/boards/BoardTrashDialog.vue';
import BoardTree from '@/components/boards/BoardTree.vue';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { t } from '@/i18n';
import { BoardSession } from '@/realtime/boardSession';
import { useFollow } from '@/composables/useFollow';
import { useAuthStore } from '@/stores/auth';
import { useBoardsStore } from '@/stores/boards';
import { copyText } from '@/utils/docRender';
import { formatDateTime, formatRelative } from '@/utils/format';
import { notify, notifyError } from '@/utils/notify';

/** Un espace de tableaux blancs : l'arbre à gauche, le tableau ouvert (ou la vue d'ensemble) à droite. */
const route = useRoute();
const router = useRouter();
const store = useBoardsStore();
const auth = useAuthStore();
const confirm = useConfirm();

const spaceId = computed(() => Number(route.params.spaceId));
const boardId = computed(() => {
  const raw = Array.isArray(route.query.board) ? route.query.board[0] : route.query.board;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
});
const board = computed(() => store.nodes.find((node) => node.id === boardId.value && (node.kind === 'board' || node.kind === 'template')) ?? null);
/** Éléments cités (`?elements=a,b`) : le tableau s'ouvre sur eux. */
const focus = computed(() => citedElementsFromQuery(route.query.elements));
/** Modèles de l'espace, à part de l'arbre des tableaux. */
const templates = computed(() => store.nodes.filter((node) => node.kind === 'template').sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' })));
const treeNodes = computed(() => store.nodes.filter((node) => node.kind !== 'template'));
const isTemplate = computed(() => board.value?.kind === 'template');
/** Tableau d'où l'on est venu modifier un modèle : on y revient. */
const returnTo = ref<number | null>(null);

function openTemplate(id: number): void {
  if (board.value?.kind === 'board') returnTo.value = board.value.id;
  void router.push({ query: { ...route.query, board: String(id) } });
}

function leaveTemplate(): void {
  const back = returnTo.value;
  returnTo.value = null;
  if (back && store.nodes.some((node) => node.id === back)) void router.push({ query: { ...route.query, board: String(back) } });
  else closeBoard();
}
const boards = computed(() => store.nodes.filter((node) => node.kind === 'board').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
const failed = ref(false);
const users = ref<UserSummaryDTO[]>([]);
void api.directory().then((result) => (users.value = result.users), () => undefined);

watch(
  spaceId,
  async (id) => {
    failed.value = false;
    try {
      await store.openSpace(id);
    } catch {
      failed.value = true;
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  session.value?.close();
  store.closeSpace();
});

// --- Tableau ouvert et sa salle ---
const session = shallowRef<BoardSession | null>(null);
/** Personnes sur ce tableau ; un clic sur l'une d'elles la suit (sa vue, puis les tableaux où elle va). */
const follow = useFollow({
  self: () => auth.user?.id,
  goTo: (target) => {
    if (!store.nodes.some((node) => node.id === target && (node.kind === 'board' || node.kind === 'template'))) return false;
    if (target !== boardId.value) void router.push({ query: { ...route.query, board: String(target) } });
    return true;
  },
});
const presence = follow.people;
watch(
  boardId,
  (id) => {
    // Ceux qui nous suivent apprennent où l'on va avant que notre présence ne quitte ce tableau.
    follow.detach(id);
    session.value?.close();
    session.value = null;
    if (id === null || !auth.user) return;
    const next = new BoardSession(id, { id: auth.user.id, name: auth.user.name });
    follow.attach(next.awareness, next.doc.clientID);
    session.value = next;
  },
  { immediate: true },
);

// --- Liens et rétroliens ---
const LINKS_KEY = 'fb.boards.links';
const linksOpen = ref((() => {
  try {
    return localStorage.getItem(LINKS_KEY) === '1';
  } catch {
    return false;
  }
})());
const links = ref<BoardLinksDTO | null>(null);
const linksLoading = ref(false);
const backlinkCount = computed(() => (links.value ? links.value.backlinks.notes.length + links.value.backlinks.tickets.length + links.value.backlinks.boards.length : 0));

async function loadLinks(): Promise<void> {
  const id = boardId.value;
  if (id === null) return;
  linksLoading.value = true;
  try {
    const result = await api.boardLinks(id);
    if (boardId.value === id) links.value = result;
  } catch {
    // Le compte reste vide : le panneau le redemandera.
  } finally {
    linksLoading.value = false;
  }
}

watch(
  boardId,
  () => {
    links.value = null;
    void loadLinks();
  },
  { immediate: true },
);
watch(linksOpen, (open) => {
  try {
    localStorage.setItem(LINKS_KEY, open ? '1' : '0');
  } catch {
    // Sans stockage, le panneau se referme à la prochaine visite.
  }
  if (open) void loadLinks();
});
// Un Fast Element ajouté ou retiré : la liste suit, à chaque enregistrement du tableau.
watch(
  () => session.value?.savedAt.value,
  () => {
    if (linksOpen.value) void loadLinks();
  },
);

function open(node: BoardNodeDTO): void {
  void router.push({ query: { ...route.query, board: String(node.id) } });
}

function closeBoard(): void {
  const { board: _board, ...rest } = route.query;
  void router.push({ query: rest });
}

// Le tableau ouvert a disparu (supprimé par quelqu'un d'autre) : retour à la vue d'ensemble.
watch(
  () => session.value?.closed.value,
  (reason) => {
    if (reason === 'deleted') {
      notify('warn', t('Ce tableau vient d’être supprimé.'));
      closeBoard();
    }
  },
);

// --- Arbre ---
const TREE_KEY = 'fb.boards.treeHidden';
const treeHidden = ref((() => {
  try {
    return localStorage.getItem(TREE_KEY) === '1';
  } catch {
    return false;
  }
})());
watch(treeHidden, (hidden) => {
  try {
    localStorage.setItem(TREE_KEY, hidden ? '1' : '0');
  } catch {
    // Choix valable pour cette page seulement.
  }
});

const nameDialog = ref<{ kind: 'board' | 'folder' | 'template' | 'rename'; folder: string; node: BoardNodeDTO | null } | null>(null);
const nameValue = ref('');
const nameBusy = ref(false);
const nameTitle = computed(() =>
  nameDialog.value?.kind === 'rename' ? t('Renommer') : nameDialog.value?.kind === 'folder' ? t('Nouveau dossier') : nameDialog.value?.kind === 'template' ? t('Nouveau modèle') : t('Nouveau tableau'),
);
const inFolder = (folder: string, name: string) => [folder, name].filter(Boolean).join('/');
const parentOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function askCreate(kind: 'folder' | 'board' | 'template', folder: string): void {
  nameDialog.value = { kind, folder: kind === 'template' ? '' : folder, node: null };
  nameValue.value = '';
}

function askRename(node: BoardNodeDTO): void {
  nameDialog.value = { kind: 'rename', folder: parentOf(node.path), node };
  nameValue.value = boardTitle(node.path);
}

async function submitName(): Promise<void> {
  const dialog = nameDialog.value;
  const name = nameValue.value.trim();
  if (!dialog || !name) return;
  nameBusy.value = true;
  try {
    if (dialog.node) await api.boardMoveNode(dialog.node.id, inFolder(dialog.folder, name));
    else {
      const { node } = await api.boardCreateNode(spaceId.value, inFolder(dialog.folder, name), dialog.kind === 'rename' ? 'board' : dialog.kind);
      store.nodes = [...store.nodes.filter((entry) => entry.id !== node.id), node];
      if (node.kind === 'board') open(node);
      if (node.kind === 'template') openTemplate(node.id);
    }
    nameDialog.value = null;
  } catch (error) {
    notifyError(error, t('Action impossible'));
  } finally {
    nameBusy.value = false;
  }
}

async function move(node: BoardNodeDTO, folder: string): Promise<void> {
  try {
    await api.boardMoveNode(node.id, inFolder(folder, boardTitle(node.path)));
  } catch (error) {
    notifyError(error, t('Déplacement impossible'));
  }
}

async function duplicate(node: BoardNodeDTO): Promise<void> {
  try {
    const { node: copy } = await api.boardDuplicate(node.id);
    store.nodes = [...store.nodes.filter((entry) => entry.id !== copy.id), copy];
    open(copy);
  } catch (error) {
    notifyError(error);
  }
}

function remove(node: BoardNodeDTO): void {
  confirm.require({
    header: t('Supprimer « {name} » ?', { name: boardTitle(node.path) }),
    message:
      node.kind === 'folder'
        ? t('Le dossier et ses tableaux vont à la corbeille pendant 15 jours.')
        : node.kind === 'template'
          ? t('Le modèle va à la corbeille pendant 15 jours ; ses copies restent sur les tableaux.')
          : t('Le tableau va à la corbeille pendant 15 jours.'),
    icon: 'pi pi-trash',
    acceptLabel: t('Supprimer'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      try {
        await api.boardDeleteNode(node.id);
        if (node.id === boardId.value) closeBoard();
      } catch (error) {
        notifyError(error);
      }
    },
  });
}

// --- Espace ---
const membersOpen = ref(false);
const shareOpen = ref(false);
const shareTarget = ref<BoardNodeDTO | null>(null);
// --- Clic droit (ou « ⋯ ») sur un tableau de la vue d'ensemble ---
const cardMenu = ref<InstanceType<typeof ContextMenu> | null>(null);
const cardMenuItems = ref<MenuItem[]>([]);

function openCardMenu(event: MouseEvent, node: BoardNodeDTO): void {
  event.preventDefault();
  event.stopPropagation();
  cardMenuItems.value = [
    ...(node.id !== boardId.value ? [{ label: t('Ouvrir'), icon: 'pi pi-objects-column', command: () => open(node) }, { separator: true }] : []),
    // Le tableau ouvert s'exporte en image (PNG, WebP, SVG, PDF) ou en Mermaid, même en lecture seule.
    ...(node.id === boardId.value ? [{ label: t('Exporter…'), icon: 'pi pi-image', command: () => canvas.value?.openExportImage() }, ...(store.canEdit ? [{ separator: true }] : [])] : []),
    ...(store.canEdit
      ? [
          { label: t('Renommer'), icon: 'pi pi-pencil', command: () => askRename(node) },
          { label: t('Dupliquer'), icon: 'pi pi-clone', command: () => void duplicate(node) },
          ...(store.isOwner ? [{ label: t('Partager…'), icon: 'pi pi-share-alt', command: () => openShare(node) }] : []),
          { separator: true },
          { label: t('Supprimer'), icon: 'pi pi-trash', class: 'menu-danger', command: () => remove(node) },
        ]
      : []),
  ];
  cardMenu.value?.show(event);
}

function openShare(node: BoardNodeDTO | null = board.value): void {
  if (!node) return;
  shareTarget.value = node;
  shareOpen.value = true;
}
const settingsOpen = ref(false);
const trashOpen = ref(false);
const spaceMenu = ref<InstanceType<typeof Menu> | null>(null);
const spaceMenuItems = computed<MenuItem[]>(() => [
  ...(store.isOwner ? [{ label: t('Modifier l’espace'), icon: 'pi pi-pencil', command: () => (settingsOpen.value = true) }] : []),
  { label: t('Corbeille'), icon: 'pi pi-trash', command: () => (trashOpen.value = true) },
  { separator: true },
  { label: t('Tous les tableaux blancs'), icon: 'pi pi-objects-column', command: () => void router.push({ name: 'boards' }) },
]);

const canvas = ref<InstanceType<typeof BoardCanvas> | null>(null);
// --- Historique : la frise des versions remplace le tableau le temps de la consulter ---
const timelineOpen = ref(false);
// L'historique montre des versions figées : on n'y suit personne.
watch(timelineOpen, (open) => open && follow.stop());
watch(boardId, () => (timelineOpen.value = false));
/** Une version copiée dans un nouveau tableau : on l'ouvre. */
function onForked(node: BoardNodeDTO): void {
  timelineOpen.value = false;
  store.nodes = [...store.nodes.filter((entry) => entry.id !== node.id), node];
  // Un modèle copié reste rangé avec les modèles ; un tableau s'ouvre.
  if (node.kind === 'board') open(node);
}
const importMenu = ref<InstanceType<typeof Menu> | null>(null);
const importItems = computed<MenuItem[]>(() => [
  { label: t('Depuis Mermaid…'), icon: 'pi pi-share-alt', command: () => canvas.value?.openImport() },
  { label: t('Depuis draw.io (XML)…'), icon: 'pi pi-sitemap', command: () => canvas.value?.openDrawio() },
]);

async function copyLink(): Promise<void> {
  if (!board.value) return;
  await copyText(`${window.location.origin}${router.resolve({ name: 'board-file', params: { boardId: board.value.id } }).href}`);
  notify('success', t('Lien copié'), t('Collez-le, ou mentionnez le tableau avec @ dans la documentation ou un ticket.'));
}

const crumbs = computed(() => (board.value ? parentOf(board.value.path).split('/').filter(Boolean) : []));
const presenceUser = (person: { id: number; name: string }) => users.value.find((user) => user.id === person.id) ?? { id: person.id, name: person.name, avatarVersion: 0 };
</script>

<template>
  <div v-if="failed || store.revoked" class="page state">
    <i class="pi pi-lock icon"></i>
    <h2>{{ store.revoked ? $t('Vous n’avez plus accès à cet espace') : $t('Espace introuvable') }}</h2>
    <p class="muted">{{ $t('Il a peut-être été supprimé, ou vous n’y avez pas accès.') }}</p>
    <Button :label="$t('Tous les tableaux blancs')" severity="secondary" outlined @click="router.push({ name: 'boards' })" />
  </div>

  <div v-else-if="store.space" class="space" :class="{ 'tree-hidden': treeHidden }">
    <aside v-show="!treeHidden" class="tree-col">
      <BoardTree class="tree" :owner="store.isOwner" :nodes="treeNodes" :templates="templates" :selected-id="boardId" :editable="store.canEdit" :space-id="spaceId" @open="open" @create="askCreate" @rename="askRename" @remove="remove" @move="move" @duplicate="duplicate" @share="openShare" @collapse="treeHidden = true" />
      <footer class="space-foot">
        <button type="button" class="space-name" @click="closeBoard">
          <i class="pi pi-objects-column"></i>
          <strong class="truncate">{{ store.space.name }}</strong>
        </button>
        <Button v-tooltip.top="$t('Membres')" icon="pi pi-users" text rounded size="small" severity="secondary" :aria-label="$t('Membres')" @click="membersOpen = true" />
        <Button v-tooltip.top="$t('Réglages de l’espace')" icon="pi pi-cog" text rounded size="small" severity="secondary" :aria-label="$t('Réglages de l’espace')" aria-haspopup="true" @click="spaceMenu?.toggle($event)" />
        <Menu ref="spaceMenu" :model="spaceMenuItems" popup />
      </footer>
    </aside>

    <main class="main">
      <header class="head">
        <Button v-if="treeHidden" v-tooltip.bottom="$t('Afficher les tableaux')" icon="pi pi-angle-double-right" text rounded size="small" severity="secondary" :aria-label="$t('Afficher les tableaux')" @click="treeHidden = false" />
        <nav class="crumbs truncate" :aria-label="$t('Fil d’Ariane')">
          <button type="button" class="crumb" @click="closeBoard">{{ store.space.name }}</button>
          <template v-for="(part, index) in crumbs" :key="index">
            <i class="pi pi-angle-right sep"></i>
            <span class="crumb muted">{{ part }}</span>
          </template>
          <template v-if="board">
            <i class="pi pi-angle-right sep"></i>
            <span v-if="isTemplate" class="template-badge"><i class="pi pi-clone"></i> {{ $t('Modèle') }}</span>
            <strong class="crumb current truncate">{{ boardTitle(board.path) }}</strong>
          </template>
        </nav>
        <Tag v-if="store.space.adminAccess" v-tooltip.bottom="$t('Vous n’êtes pas propriétaire de cet espace : vous y entrez grâce à vos droits d’administration.')" :value="$t('Accès avec droit admin')" icon="pi pi-shield" severity="warn" class="admin-chip" />
        <span v-if="isTemplate" class="muted small template-hint">{{ $t('Les copies posées sur les tableaux proposeront de se mettre à jour.') }}</span>
        <Button v-if="isTemplate" :label="returnTo ? $t('Revenir au tableau') : $t('Fermer le modèle')" icon="pi pi-arrow-left" size="small" severity="secondary" outlined @click="leaveTemplate" />
        <div v-if="presence.length" class="people">
          <button
            v-for="person in presence"
            :key="person.id"
            v-tooltip.bottom="follow.label(person, $t('{name} est sur ce tableau', { name: person.name }))"
            type="button"
            class="person"
            :class="{ followed: follow.following.value === person.id }"
            :style="{ '--ring': person.color }"
            :aria-label="follow.label(person, $t('{name} est sur ce tableau', { name: person.name }))"
            :aria-pressed="follow.following.value === person.id"
            @click="follow.toggle(person)"
          >
            <UserAvatar :user="presenceUser(person)" size="small" />
            <i v-if="follow.following.value === person.id || person.followsMe" class="pi pi-eye watch" :class="{ me: person.followsMe && follow.following.value !== person.id }" aria-hidden="true"></i>
          </button>
        </div>
        <template v-if="board && session">
          <span v-if="session.savedAt.value" v-tooltip.bottom="formatDateTime(session.savedAt.value)" class="muted small saved"><i class="pi pi-check"></i> {{ $t('Enregistré') }}</span>
          <span v-else-if="session.synced.value && !session.canWrite.value" class="muted small saved"><i class="pi pi-lock"></i> {{ $t('Lecture seule') }}</span>
          <Button
            v-if="!isTemplate"
            v-tooltip.bottom="$t('Notes, tickets et tableaux qui citent ce tableau')"
            :label="String(backlinkCount)"
            icon="pi pi-reply"
            text
            size="small"
            severity="secondary"
            class="links-button"
            :class="{ active: linksOpen }"
            :aria-label="$t('{n} rétrolien|{n} rétroliens', { n: backlinkCount })"
            :aria-pressed="linksOpen"
            @click="linksOpen = !linksOpen"
          />
          <Button v-tooltip.bottom="$t('Importer (Mermaid, draw.io)')" icon="pi pi-file-import" text rounded size="small" severity="secondary" :aria-label="$t('Importer (Mermaid, draw.io)')" aria-haspopup="true" :disabled="!session.canWrite.value" @click="importMenu?.toggle($event)" />
          <Menu ref="importMenu" :model="importItems" popup />
          <Button v-tooltip.bottom="$t('Copier le lien du tableau')" icon="pi pi-link" text rounded size="small" severity="secondary" :aria-label="$t('Copier le lien du tableau')" @click="copyLink" />
          <Button v-if="store.isOwner && !isTemplate" :label="$t('Partager')" :icon="board.share === 'public' ? 'pi pi-globe' : 'pi pi-share-alt'" size="small" :severity="board.share ? 'warn' : undefined" :outlined="!board.share" class="share-button" @click="openShare()" />
          <Button v-if="!isTemplate" v-tooltip.bottom="$t('Plus d’actions')" icon="pi pi-ellipsis-v" text rounded size="small" severity="secondary" :aria-label="$t('Plus d’actions')" aria-haspopup="true" @click="openCardMenu($event, board)" />
        </template>
      </header>

      <div v-if="board && session" class="board-area">
        <BoardTimeline v-if="timelineOpen" :key="`h${board.id}`" :board-id="board.id" :title="boardTitle(board.path)" :session="session" :can-edit="store.canEdit && session.canWrite.value" :users="users" :is-template="isTemplate" @close="timelineOpen = false" @forked="onForked" />
        <BoardCanvas v-else :key="board.id" ref="canvas" :session="session" :focus="focus" :can-edit="store.canEdit" :users="users" :board-title="boardTitle(board.path)" :space-id="spaceId" :templates="templates" :is-template="isTemplate" history v-model:follow="follow.following.value" @open-template="openTemplate" @history="timelineOpen = true" />
        <BoardLinksPanel v-if="linksOpen && !isTemplate" :links="links" :loading="linksLoading" @close="linksOpen = false" />
      </div>

      <section v-else class="overview">
        <div class="overview-head">
          <div>
            <h1 class="page-title">{{ store.space.name }}</h1>
            <p class="muted">{{ store.space.description || $t('Choisissez un tableau, ou créez-en un.') }}</p>
          </div>
          <Button v-if="store.canEdit" :label="$t('Nouveau tableau')" icon="pi pi-plus" @click="askCreate('board', '')" />
        </div>
        <div v-if="boards.length" class="cards">
          <div
            v-for="node in boards"
            :key="node.id"
            role="button"
            tabindex="0"
            class="card board-card"
            @click="open(node)"
            @keydown.enter="open(node)"
            @contextmenu="openCardMenu($event, node)"
          >
            <span class="thumb"><img :src="api.boardPreviewUrl(node.id, 360, darkMode)" :alt="boardTitle(node.path)" loading="lazy" draggable="false" /></span>
            <span class="card-foot">
              <span class="card-text">
                <strong class="truncate">{{ boardTitle(node.path) }}</strong>
                <span class="muted small truncate">{{ parentOf(node.path) || $t('Racine') }} · {{ $t('modifié {when}', { when: formatRelative(node.updatedAt) }) }}</span>
              </span>
              <Button v-tooltip.top="$t('Plus d’actions')" icon="pi pi-ellipsis-v" text rounded size="small" severity="secondary" class="card-more" :aria-label="$t('Plus d’actions')" aria-haspopup="true" @click.stop="openCardMenu($event, node)" />
            </span>
          </div>
        </div>
        <div v-else class="empty">
          <i class="pi pi-objects-column icon"></i>
          <h3>{{ $t('Aucun tableau pour l’instant') }}</h3>
          <p class="muted">{{ $t('Un tableau peut être un diagramme, un atelier en post-it, une carte mentale ou un croquis.') }}</p>
          <Button v-if="store.canEdit" :label="$t('Créer un tableau')" icon="pi pi-plus" @click="askCreate('board', '')" />
        </div>
      </section>
    </main>

    <Dialog :visible="nameDialog !== null" modal :header="nameTitle" :style="{ width: 'min(26rem, calc(100vw - 2rem))' }" @update:visible="nameDialog = null">
      <form class="name-form" @submit.prevent="submitName">
        <p v-if="nameDialog?.folder" class="muted small">{{ $t('Dans {folder}', { folder: nameDialog.folder }) }}</p>
        <InputText v-model="nameValue" autofocus fluid :aria-label="$t('Nom')" :placeholder="$t('Nom')" />
      </form>
      <template #footer>
        <Button :label="$t('Annuler')" severity="secondary" text @click="nameDialog = null" />
        <Button :label="nameDialog?.kind === 'rename' ? $t('Renommer') : $t('Créer')" icon="pi pi-check" :loading="nameBusy" :disabled="!nameValue.trim()" @click="submitName" />
      </template>
    </Dialog>
    <BoardMembersDialog v-model:visible="membersOpen" :users="users" />
    <BoardShareDialog v-model:visible="shareOpen" :board="shareTarget" :users="users" @saved="store.reload(spaceId)" />
    <BoardSpaceDialog v-model:visible="settingsOpen" :space="store.space" @saved="store.reload(spaceId)" />
    <ContextMenu ref="cardMenu" :model="cardMenuItems" />
    <BoardTrashDialog v-model:visible="trashOpen" :space-id="spaceId" />
  </div>

  <div v-else class="page muted"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</div>
</template>

<style scoped>
.space {
  display: grid;
  flex: 1;
  grid-template-columns: 16rem minmax(0, 1fr);
  min-height: 0;
}
.space.tree-hidden {
  grid-template-columns: minmax(0, 1fr);
}
.tree-col {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--fb-border);
  background: var(--fb-panel);
}
.tree {
  flex: 1;
  min-height: 0;
}
.space-foot {
  display: flex;
  align-items: center;
  gap: 0.1rem;
  padding: 0.3rem 0.35rem;
  border-top: 1px solid var(--fb-border);
}
.admin-chip {
  flex: none;
}
.space-name {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
  padding: 0.35rem 0.5rem;
  border: 0;
  border-radius: 7px;
  background: none;
  color: var(--fb-text);
  font: inherit;
  font-size: 0.88rem;
  text-align: left;
  cursor: pointer;
}
.space-name:hover {
  background: var(--fb-panel-alt);
}
.space-name .pi {
  color: #a855f7;
}
.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.board-area {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
}
.board-area > :first-child {
  flex: 1;
  min-width: 0;
}
.template-badge {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 0.25rem;
  margin-right: 0.35rem;
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  background: color-mix(in srgb, #a855f7 16%, transparent);
  color: #a855f7;
  font-size: 0.75rem;
  font-weight: 700;
}
.template-hint {
  flex: none;
  max-width: 22rem;
}
@media (max-width: 1100px) {
  .template-hint {
    display: none;
  }
}
.links-button.active {
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
}
.head {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 2.75rem;
  padding: 0.25rem 0.75rem;
  border-bottom: 1px solid var(--fb-border);
  background: var(--fb-panel);
}
.crumbs {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
  font-size: 0.9rem;
}
.crumb {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
}
button.crumb {
  color: var(--fb-muted);
  cursor: pointer;
}
button.crumb:hover {
  color: var(--fb-accent);
}
.crumb.current {
  min-width: 0;
}
.sep {
  color: var(--fb-muted);
  font-size: 0.7rem;
}
.people {
  display: flex;
  gap: 0.45rem;
}
.person {
  position: relative;
  display: inline-flex;
  padding: 1px;
  border: 0;
  border-radius: 999px;
  background: none;
  box-shadow: 0 0 0 2px var(--ring);
  cursor: pointer;
  transition: transform 0.15s;
}
.person:hover,
.person:focus-visible {
  transform: translateY(-1px);
}
.person.followed {
  box-shadow: 0 0 0 2px var(--fb-panel), 0 0 0 4px var(--ring);
}
/* Œil : on suit cette personne (à sa couleur), ou elle nous suit (discret). */
.person .watch {
  position: absolute;
  right: -5px;
  bottom: -5px;
  display: grid;
  place-items: center;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: var(--ring);
  color: #fff;
  font-size: 9px;
  box-shadow: 0 0 0 1.5px var(--fb-panel);
}
.person .watch.me {
  background: var(--fb-panel);
  color: var(--fb-muted);
  box-shadow: 0 0 0 1px var(--fb-border);
}
.share-button {
  margin-left: 0.25rem;
}
.saved {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin: 0 0.25rem;
  white-space: nowrap;
}
.overview {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 1.5rem;
}
.overview-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.25rem;
}
.overview-head p {
  margin: 0.25rem 0 0;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
  gap: 1rem;
}
.board-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
  border: 1px solid var(--fb-border);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}
.board-card:hover {
  border-color: var(--fb-accent);
  box-shadow: var(--fb-shadow-lg);
}
.thumb {
  display: grid;
  place-items: center;
  height: 9.5rem;
  overflow: hidden;
  border-bottom: 1px solid var(--fb-border);
  background: var(--board-canvas);
}
.thumb img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.card-foot {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding-right: 0.35rem;
}
.card-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  padding: 0.65rem 0 0.65rem 0.8rem;
}
.card-more {
  flex: none;
  opacity: 0;
  transition: opacity 0.15s;
}
.board-card:hover .card-more,
.board-card:focus-within .card-more,
.card-more[aria-expanded='true'] {
  opacity: 1;
}
.board-card:focus-visible {
  outline: 2px solid var(--fb-accent);
  outline-offset: 2px;
}
.empty,
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 3rem 1rem;
  text-align: center;
}
.empty .icon,
.state .icon {
  color: #a855f7;
  font-size: 2rem;
}
.empty h3,
.state h2 {
  margin: 0;
}
.name-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
@media (max-width: 760px) {
  .space {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 12rem) minmax(0, 1fr);
  }
  .space.tree-hidden {
    grid-template-rows: minmax(0, 1fr);
  }
  .tree-col {
    border-right: 0;
    border-bottom: 1px solid var(--fb-border);
  }
}
</style>
