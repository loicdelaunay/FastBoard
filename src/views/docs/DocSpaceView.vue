<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useConfirm } from 'primevue/useconfirm';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import SelectButton from 'primevue/selectbutton';
import ToggleSwitch from 'primevue/toggleswitch';
import type { DocCommentDTO, DocQuote } from '@shared/docComments';
import { docBaseName, docParent, docTitle, type DocLinksDTO, type DocNodeDTO } from '@shared/docs';
import type { UserSummaryDTO } from '@shared/types';
import { api } from '@/api';
import UserAvatar from '@/components/common/UserAvatar.vue';
import DocEditor from '@/components/docs/DocEditor.vue';
import DocHistoryDialog from '@/components/docs/DocHistoryDialog.vue';
import DocImportDialog from '@/components/docs/DocImportDialog.vue';
import DocMembersDialog from '@/components/docs/DocMembersDialog.vue';
import DocPreview from '@/components/docs/DocPreview.vue';
import DocSidePanel from '@/components/docs/DocSidePanel.vue';
import DocSpaceDialog from '@/components/docs/DocSpaceDialog.vue';
import DocTrashDialog from '@/components/docs/DocTrashDialog.vue';
import DocTree from '@/components/docs/DocTree.vue';
import { DocSession, type DocPresence } from '@/realtime/docSession';
import { useAuthStore } from '@/stores/auth';
import { useDocsStore } from '@/stores/docs';
import { downloadFrom } from '@/utils/files';
import { formatDateTime } from '@/utils/format';
import { notify, notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Espace de documentation : arbre à gauche, note au centre, en lecture ou en écriture à plusieurs. */
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const store = useDocsStore();
const confirm = useConfirm();

const spaceId = computed(() => Number(route.params.spaceId));
const fileId = computed(() => {
  const value = Number(route.query.file);
  return Number.isInteger(value) && value > 0 ? value : null;
});
const selected = computed(() => store.nodes.find((node) => node.id === fileId.value) ?? null);
const users = ref<UserSummaryDTO[]>([]);
const failed = ref(false);

onMounted(() => {
  void api.directory().then((result) => (users.value = result.users), () => undefined);
});

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

// --- Session d'édition du fichier ouvert ---
const session = shallowRef<DocSession | null>(null);
const content = ref('');
const presence = ref<DocPresence[]>([]);
const synced = computed(() => session.value?.synced.value ?? false);
const canWrite = computed(() => store.canEdit && (session.value?.canWrite.value ?? false));
const savedAt = computed(() => session.value?.savedAt.value ?? null);
const closed = computed(() => session.value?.closed.value ?? null);

type DocMode = 'read' | 'live' | 'write';
const MODE_KEY = 'fb.docs.mode';
function storedMode(): DocMode {
  try {
    const value = localStorage.getItem(MODE_KEY);
    return value === 'write' || value === 'live' ? value : 'read';
  } catch {
    return 'read';
  }
}
const mode = ref<DocMode>(storedMode());
const showPreview = ref(true);
const modeOptions = computed(() => [
  { value: 'read', label: t('Lecture'), icon: 'pi pi-eye' },
  { value: 'live', label: t('Lecture et écriture'), icon: 'pi pi-file-edit' },
  { value: 'write', label: t('Écriture'), icon: 'pi pi-pencil' },
]);
/** Le texte se modifie, soit en source, soit directement dans le rendu. */
const writing = computed(() => mode.value !== 'read' && canWrite.value);
const live = computed(() => mode.value === 'live' && canWrite.value);

function chooseMode(value: DocMode): void {
  mode.value = value;
  try {
    localStorage.setItem(MODE_KEY, value);
  } catch {
    // Stockage indisponible : le choix vaut pour cette page seulement.
  }
}

function closeSession(): void {
  session.value?.close();
  session.value = null;
  content.value = '';
  presence.value = [];
}

function openSession(nodeId: number): void {
  closeSession();
  if (!auth.user) return;
  const next = new DocSession(nodeId, { id: auth.user.id, name: auth.user.name });
  next.text.observe(() => (content.value = next.text.toString()));
  next.awareness.on('change', () => {
    const people = new Map<number, DocPresence>();
    for (const state of next.awareness.getStates().values()) {
      const user = state.user as DocPresence | undefined;
      if (user && user.id !== auth.user?.id) people.set(user.id, user);
    }
    presence.value = [...people.values()];
  });
  session.value = next;
}

watch(
  () => (selected.value?.kind === 'markdown' ? selected.value.id : null),
  (nodeId) => (nodeId === null ? closeSession() : openSession(nodeId)),
);

// Espace quitté ou droits retirés : plus rien à afficher.
watch(
  () => store.revoked,
  (revoked) => {
    if (!revoked) return;
    closeSession();
    notify('warn', t('Accès retiré'), t('Vous n’avez plus accès à cet espace.'));
    void router.replace({ name: 'docs' });
  },
);
// --- Panneau de la note : liens et commentaires ---
const SIDE_KEY = 'fb.docs.side';
function storedSide(): 'links' | 'comments' | null {
  try {
    const value = localStorage.getItem(SIDE_KEY);
    return value === 'links' || value === 'comments' ? value : null;
  } catch {
    return null;
  }
}
const stored = storedSide();
const sideOpen = ref(stored !== null);
const sideTab = ref<'links' | 'comments'>(stored ?? 'links');
const links = ref<DocLinksDTO | null>(null);
const draft = ref<DocQuote | null>(null);
const focusedComment = ref<number | null>(null);
const editor = ref<InstanceType<typeof DocEditor> | null>(null);

watch([sideOpen, sideTab], ([open, tab]) => {
  try {
    localStorage.setItem(SIDE_KEY, open ? tab : '');
  } catch {
    // Stockage indisponible : le choix vaut pour cette page seulement.
  }
});

const noteId = computed(() => (selected.value?.kind === 'markdown' ? selected.value.id : null));
const openComments = computed(() => store.comments.filter((comment) => comment.parentId === null && !comment.resolvedAt).length);
const linkCount = computed(() => (links.value ? links.value.outgoing.notes.length + links.value.outgoing.tickets.length : 0));
const backlinkCount = computed(() => (links.value ? links.value.backlinks.notes.length + links.value.backlinks.tickets.length : 0));
const members = computed(() => users.value.filter((user) => store.members.some((member) => member.userId === user.id)));

function showSide(tab: 'links' | 'comments'): void {
  sideOpen.value = !(sideOpen.value && sideTab.value === tab);
  sideTab.value = tab;
}

async function loadLinks(nodeId: number): Promise<void> {
  try {
    const result = await api.docLinks(nodeId);
    if (noteId.value === nodeId) links.value = result;
  } catch {
    // Compteurs indisponibles : la note reste lisible.
  }
}

watch(
  noteId,
  (nodeId) => {
    links.value = null;
    draft.value = null;
    focusedComment.value = null;
    void store.loadComments(nodeId).catch(() => undefined);
    if (nodeId !== null) void loadLinks(nodeId);
  },
  { immediate: true },
);

// Les liens suivent la frappe, sans la gêner.
let linksTimer: number | undefined;
watch(content, () => {
  window.clearTimeout(linksTimer);
  linksTimer = window.setTimeout(() => {
    if (noteId.value !== null) void loadLinks(noteId.value);
  }, 2000);
});

function startComment(quote: DocQuote): void {
  draft.value = quote;
  sideOpen.value = true;
  sideTab.value = 'comments';
}

function focusComment(commentId: number): void {
  const comment = store.comments.find((entry) => entry.id === commentId);
  focusedComment.value = comment?.parentId ?? commentId;
  sideOpen.value = true;
  sideTab.value = 'comments';
}

/** Amène un passage commenté à l'écran, dans l'éditeur ou dans le rendu. */
function revealComment(comment: DocCommentDTO): void {
  if (writing.value) editor.value?.reveal(comment);
  if (live.value) return;
  const element = document.querySelector(`.doc-preview [data-comment="${comment.id}"]`);
  element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

watch(closed, (reason) => {
  if (reason === 'deleted') void router.replace({ query: {} });
  else if (reason === 'revoked' && !store.revoked) void store.reload(spaceId.value).catch(() => undefined);
});

onBeforeUnmount(() => {
  window.clearTimeout(linksTimer);
  closeSession();
  void store.loadComments(null);
  store.closeSpace();
});

function openNode(node: DocNodeDTO): void {
  void router.replace({ query: { file: String(node.id) } });
}

// --- Arbre : créer, renommer, déplacer, supprimer ---
const nameDialog = ref<{ kind: 'create-note' | 'create-folder' | 'rename'; folder: string; node: DocNodeDTO | null } | null>(null);
const nameValue = ref('');
const nameBusy = ref(false);
const nameTitle = computed(() => (nameDialog.value?.kind === 'rename' ? t('Renommer') : nameDialog.value?.kind === 'create-folder' ? t('Nouveau dossier') : t('Nouvelle note')));

function askCreate(kind: 'folder' | 'markdown', folder: string): void {
  nameDialog.value = { kind: kind === 'folder' ? 'create-folder' : 'create-note', folder, node: null };
  nameValue.value = '';
}

function askRename(node: DocNodeDTO): void {
  nameDialog.value = { kind: 'rename', folder: docParent(node.path), node };
  nameValue.value = node.kind === 'markdown' ? docTitle(node.path) : docBaseName(node.path);
}

const inFolder = (folder: string, name: string) => [folder, name].filter(Boolean).join('/');

async function submitName(): Promise<void> {
  const dialog = nameDialog.value;
  const name = nameValue.value.trim();
  if (!dialog || !name) return;
  nameBusy.value = true;
  try {
    if (dialog.node) {
      await api.docMoveNode(dialog.node.id, inFolder(dialog.folder, name));
    } else {
      const { node } = await api.docCreateNode(spaceId.value, inFolder(dialog.folder, name), dialog.kind === 'create-folder' ? 'folder' : 'markdown');
      if (node.kind === 'markdown') {
        store.nodes = [...store.nodes.filter((entry) => entry.id !== node.id), node];
        if (mode.value === 'read') chooseMode('write');
        openNode(node);
      }
    }
    nameDialog.value = null;
  } catch (error) {
    notifyError(error, t('Action impossible'));
  } finally {
    nameBusy.value = false;
  }
}

async function moveNode(node: DocNodeDTO, folder: string): Promise<void> {
  try {
    await api.docMoveNode(node.id, inFolder(folder, docBaseName(node.path)));
  } catch (error) {
    notifyError(error, t('Déplacement impossible'));
  }
}

function askRemove(node: DocNodeDTO): void {
  confirm.require({
    header: t('Supprimer « {name} » ?', { name: docBaseName(node.path) }),
    message: node.kind === 'folder' ? t('Le dossier et son contenu vont à la corbeille pendant 15 jours.') : t('Le fichier va à la corbeille pendant 15 jours.'),
    icon: 'pi pi-trash',
    acceptLabel: t('Supprimer'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      try {
        await api.docDeleteNode(node.id);
      } catch (error) {
        notifyError(error);
      }
    },
  });
}

// --- Export et réimport ---
const importOpen = ref(false);
const importNode = ref<DocNodeDTO | null>(null);

function exportNode(node: DocNodeDTO | null): void {
  downloadFrom(node ? `/api/documentation/nodes/${node.id}/export` : `/api/documentation/spaces/${spaceId.value}/export`);
}

function askImport(node: DocNodeDTO | null): void {
  importNode.value = node;
  importOpen.value = true;
}

// --- Réglages de l'espace ---
const membersOpen = ref(false);
const trashOpen = ref(false);
const historyOpen = ref(false);
const settingsOpen = ref(false);

function askDeleteSpace(): void {
  confirm.require({
    header: t('Supprimer l’espace « {name} » ?', { name: store.space?.name ?? '' }),
    message: t('Tous les fichiers, l’historique et la corbeille seront définitivement supprimés.'),
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: t('Supprimer'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      try {
        await api.docDeleteSpace(spaceId.value);
        await router.replace({ name: 'docs' });
      } catch (error) {
        notifyError(error);
      }
    },
  });
}
</script>

<template>
  <div v-if="failed" class="page">
    <div class="empty card">
      <i class="pi pi-lock"></i>
      <h3>{{ $t('Espace inaccessible') }}</h3>
      <p class="muted">{{ $t('Il a peut-être été supprimé, ou vous n’y avez pas accès.') }}</p>
      <Button :label="$t('Retour aux documentations')" severity="secondary" outlined @click="router.push({ name: 'docs' })" />
    </div>
  </div>

  <div v-else-if="store.space" class="doc-space">
    <header class="space-head">
      <Button v-tooltip.bottom="$t('Retour aux documentations')" icon="pi pi-arrow-left" text rounded size="small" severity="secondary" :aria-label="$t('Retour aux documentations')" @click="router.push({ name: 'docs' })" />
      <strong class="truncate space-name">{{ store.space.name }}</strong>
      <span class="spacer"></span>
      <Button v-tooltip.bottom="$t('Membres')" icon="pi pi-users" text rounded size="small" severity="secondary" :aria-label="$t('Membres')" @click="membersOpen = true" />
      <Button v-tooltip.bottom="$t('Exporter l’espace en ZIP')" icon="pi pi-download" text rounded size="small" severity="secondary" :aria-label="$t('Exporter l’espace en ZIP')" @click="exportNode(null)" />
      <Button v-if="store.canEdit" v-tooltip.bottom="$t('Réimporter un ZIP')" icon="pi pi-upload" text rounded size="small" severity="secondary" :aria-label="$t('Réimporter un ZIP')" @click="askImport(null)" />
      <Button v-tooltip.bottom="$t('Corbeille')" icon="pi pi-trash" text rounded size="small" severity="secondary" :aria-label="$t('Corbeille')" @click="trashOpen = true" />
      <template v-if="store.isOwner">
        <Button v-tooltip.bottom="$t('Modifier l’espace')" icon="pi pi-cog" text rounded size="small" severity="secondary" :aria-label="$t('Modifier l’espace')" @click="settingsOpen = true" />
        <Button v-tooltip.bottom="$t('Supprimer l’espace')" icon="pi pi-times" text rounded size="small" severity="danger" :aria-label="$t('Supprimer l’espace')" @click="askDeleteSpace" />
      </template>
    </header>

    <div class="body">
      <aside class="tree">
        <DocTree :nodes="store.nodes" :selected-id="fileId" :editable="store.canEdit" :space-id="spaceId" @open="openNode" @create="askCreate" @rename="askRename" @remove="askRemove" @move="moveNode" @export="exportNode" @import="askImport" />
      </aside>

      <main class="note">
        <template v-if="selected?.kind === 'markdown'">
          <header class="note-head">
            <div class="crumbs truncate">
              <span v-if="docParent(selected.path)" class="muted">{{ docParent(selected.path) }} / </span>
              <strong>{{ docTitle(selected.path) }}</strong>
            </div>
            <div class="people">
              <span v-for="person in presence" :key="person.id" v-tooltip.bottom="$t('{name} est sur cette note', { name: person.name })" class="person" :style="{ '--ring': person.color }">
                <UserAvatar :user="users.find((user) => user.id === person.id) ?? { id: person.id, name: person.name, avatarVersion: 0 }" size="small" />
              </span>
            </div>
            <div class="counters">
              <button v-tooltip.bottom="$t('Liens et rétroliens')" type="button" class="counter" :class="{ active: sideOpen && sideTab === 'links' }" :aria-label="$t('Liens et rétroliens')" @click="showSide('links')">
                <i class="pi pi-link"></i>{{ linkCount }}<i class="pi pi-reply back"></i>{{ backlinkCount }}
              </button>
              <button v-tooltip.bottom="$t('Commentaires')" type="button" class="counter" :class="{ active: sideOpen && sideTab === 'comments' }" :aria-label="$t('Commentaires')" @click="showSide('comments')">
                <i class="pi pi-comments"></i>{{ openComments }}
              </button>
            </div>
            <span v-if="writing && savedAt" class="muted small saved" :title="formatDateTime(savedAt)"><i class="pi pi-check"></i> {{ $t('Enregistré') }}</span>
            <label v-if="writing && !live" class="row preview-toggle small">
              <ToggleSwitch v-model="showPreview" class="mini-switch" :aria-label="$t('Aperçu')" />
              <span>{{ $t('Aperçu') }}</span>
            </label>
            <SelectButton v-if="canWrite" :model-value="mode" :options="modeOptions" option-value="value" option-label="label" size="small" :allow-empty="false" :aria-label="$t('Mode d’affichage')" @update:model-value="chooseMode">
              <template #option="{ option }"><i :class="option.icon"></i><span>{{ option.label }}</span></template>
            </SelectButton>
            <span v-else-if="synced" class="muted small"><i class="pi pi-eye"></i> {{ $t('Lecture seule') }}</span>
            <Button v-tooltip.bottom="$t('Historique')" icon="pi pi-history" text rounded size="small" severity="secondary" :aria-label="$t('Historique')" @click="historyOpen = true" />
          </header>

          <div v-if="!synced" class="waiting muted"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</div>
          <div v-else class="note-body" :class="{ 'with-side': sideOpen }">
            <div class="panes" :class="{ split: writing && !live && showPreview }">
              <div v-if="writing && session" class="pane editor">
                <DocEditor :key="`${session.nodeId}-${mode}`" ref="editor" :session="session" :space-id="spaceId" :note-path="selected.path" :users="users" :nodes="store.nodes" :comments="store.comments" :live="live" :readonly="false" @open="openNode" @comment="startComment" @focus-comment="focusComment" />
              </div>
              <div v-if="!writing || (showPreview && !live)" class="pane preview">
                <DocPreview v-if="content" :text="content" :nodes="store.nodes" :note-path="selected.path" :users="users" :comments="store.comments" @open="openNode" @comment="startComment" @focus-comment="focusComment" />
                <p v-else class="muted empty-note">{{ canWrite ? $t('Cette note est vide. Passez en écriture pour la rédiger.') : $t('Cette note est vide.') }}</p>
              </div>
            </div>
            <DocSidePanel
              v-if="sideOpen"
              v-model:tab="sideTab"
              v-model:focused="focusedComment"
              :node-id="selected.id"
              :nodes="store.nodes"
              :text="content"
              :links="links"
              :comments="store.comments"
              :members="members"
              :users="users"
              :draft="draft"
              :is-owner="store.isOwner"
              @close="sideOpen = false"
              @open="openNode"
              @reveal="revealComment"
              @cancel-draft="draft = null"
            />
          </div>
        </template>

        <div v-else-if="selected?.kind === 'image'" class="image-view">
          <p class="muted small">{{ selected.path }}</p>
          <img :src="`/api/documentation/nodes/${selected.id}/raw`" :alt="docBaseName(selected.path)" />
        </div>

        <div v-else class="welcome">
          <i class="pi pi-book"></i>
          <h3>{{ store.space.name }}</h3>
          <p v-if="store.space.description" class="muted">{{ store.space.description }}</p>
          <p class="muted">{{ store.nodes.length ? $t('Choisissez une note dans l’arbre.') : store.canEdit ? $t('Créez une première note pour commencer.') : $t('Cet espace est vide.') }}</p>
          <Button v-if="store.canEdit" :label="$t('Nouvelle note')" icon="pi pi-file-plus" @click="askCreate('markdown', '')" />
        </div>
      </main>
    </div>

    <Dialog :visible="nameDialog !== null" modal :header="nameTitle" :style="{ width: 'min(26rem, calc(100vw - 2rem))' }" @update:visible="nameDialog = null">
      <form class="name-form" @submit.prevent="submitName">
        <p v-if="nameDialog?.folder" class="muted small">{{ $t('Dans {folder}', { folder: nameDialog.folder }) }}</p>
        <InputText v-model="nameValue" autofocus fluid :aria-label="$t('Nom')" :placeholder="$t('Nom')" />
        <div class="name-actions">
          <Button type="button" :label="$t('Annuler')" severity="secondary" text @click="nameDialog = null" />
          <Button type="submit" :label="$t('Valider')" icon="pi pi-check" :disabled="!nameValue.trim()" :loading="nameBusy" />
        </div>
      </form>
    </Dialog>

    <DocMembersDialog v-model:visible="membersOpen" :users="users" />
    <DocImportDialog v-model:visible="importOpen" :space-id="spaceId" :node="importNode" @done="store.reload(spaceId)" />
    <DocTrashDialog v-model:visible="trashOpen" :space-id="spaceId" />
    <DocHistoryDialog v-if="selected?.kind === 'markdown'" v-model:visible="historyOpen" :node="selected" :nodes="store.nodes" :users="users" :can-restore="canWrite" />
    <DocSpaceDialog v-model:visible="settingsOpen" :space="store.space" @saved="store.reload(spaceId)" />
  </div>

  <div v-else class="page muted"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</div>
</template>

<style scoped>
.doc-space {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.space-head {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.3rem 0.75rem;
  border-bottom: 1px solid var(--fb-border);
  background: var(--fb-panel);
}
.space-name {
  min-width: 0;
  margin-left: 0.25rem;
}
.spacer {
  flex: 1;
}
.body {
  display: grid;
  flex: 1;
  grid-template-columns: 17rem minmax(0, 1fr);
  min-height: 0;
}
.tree {
  min-height: 0;
  border-right: 1px solid var(--fb-border);
  background: var(--fb-panel);
}
.note {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.note-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: 2.8rem;
  padding: 0.3rem 0.75rem;
  border-bottom: 1px solid var(--fb-border);
}
.crumbs {
  flex: 1;
  min-width: 0;
}
.people {
  display: flex;
  gap: 0.15rem;
}
.person {
  display: inline-flex;
  border-radius: 50%;
  box-shadow: 0 0 0 2px var(--ring);
}
.counters {
  display: flex;
  gap: 0.15rem;
}
.counter {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.45rem;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--fb-muted);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
.counter:hover {
  background: var(--fb-panel-alt);
  color: var(--fb-text);
}
.counter.active {
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
}
.counter .pi {
  font-size: 0.75rem;
}
.counter .back {
  margin-left: 0.3rem;
}
.saved {
  white-space: nowrap;
}
.preview-toggle {
  gap: 0.35rem;
  white-space: nowrap;
  cursor: pointer;
}
.mini-switch {
  --p-toggleswitch-width: 1.75rem;
  --p-toggleswitch-height: 1rem;
  --p-toggleswitch-handle-size: 0.7rem;
}
.note-head :deep(.p-togglebutton-content) {
  gap: 0.35rem;
}
.waiting {
  padding: 2rem;
  text-align: center;
}
.note-body {
  display: grid;
  flex: 1;
  grid-template-columns: minmax(0, 1fr);
  min-height: 0;
}
.note-body.with-side {
  grid-template-columns: minmax(0, 1fr) 20rem;
}
.panes {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-height: 0;
}
.panes.split {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}
.pane {
  min-width: 0;
  min-height: 0;
  overflow: auto;
}
.pane.editor {
  overflow: hidden;
  background: var(--fb-panel);
}
.panes.split .pane.editor {
  border-right: 1px solid var(--fb-border);
}
.pane.preview {
  padding: 1.25rem 1.5rem 3rem;
}
.empty-note {
  text-align: center;
}
.image-view {
  flex: 1;
  min-height: 0;
  padding: 1rem;
  overflow: auto;
}
.image-view img {
  max-width: 100%;
  border-radius: 8px;
}
.welcome,
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  margin: auto;
  padding: 2rem 1rem;
  text-align: center;
}
.welcome > .pi,
.empty > .pi {
  color: var(--fb-accent);
  font-size: 2rem;
}
.welcome h3,
.welcome p,
.empty h3,
.empty p {
  margin: 0;
}
.name-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.name-form p {
  margin: 0;
}
.name-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
@media (max-width: 760px) {
  .body {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 13rem) minmax(0, 1fr);
  }
  .tree {
    border-right: 0;
    border-bottom: 1px solid var(--fb-border);
  }
  .note-body.with-side {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  }
  .panes.split {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  }
  .panes.split .pane.editor {
    border-right: 0;
    border-bottom: 1px solid var(--fb-border);
  }
  .note-head {
    flex-wrap: wrap;
  }
}
</style>
