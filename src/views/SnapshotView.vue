<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from 'primevue/button';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import type { BoardElement } from '@shared/boards';
import { STATUS_META, TICKET_STATUSES } from '@shared/constants';
import { docBaseName, docTitle, type DocNodeDTO } from '@shared/docs';
import { snapshotFileUrl, type BoardSnapshotContent, type DocSnapshotContent, type ProjectSnapshotContent, type SnapshotContent, type SpaceSnapshotDTO } from '@shared/snapshots';
import type { AttachmentDTO, CategoryDTO, CommentDTO, DeliveryDTO, PriorityDTO, ProjectDTO, TicketDTO, UserSummaryDTO } from '@shared/types';
import { api } from '@/api';
import { ApiError } from '@/api/http';
import BoardCanvas from '@/components/boards/BoardCanvas.vue';
import MarkdownView from '@/components/common/MarkdownView.vue';
import { t } from '@/i18n';
import { connection } from '@/offline/connection';
import { BoardSnapshotSession } from '@/realtime/boardSession';
import { useAuthStore } from '@/stores/auth';
import { darkMode } from '@/theme/themeManager';
import { highlightCodeBlocks } from '@/utils/codeHighlight';
import { docResolver, finishDocHtml, prepareDocText, type DocRenderContext } from '@/utils/docRender';
import { downloadFrom, formatBytes } from '@/utils/files';
import { formatDateTime, formatRelative } from '@/utils/format';
import { zoomImageOnClick } from '@/utils/lightbox';
import { renderMarkdown, renderMermaid } from '@/utils/markdown';
import { notify, notifyError } from '@/utils/notify';
import { matchesQuery } from '@/utils/search';

/**
 * Consultation d'une étiquette d'espace : l'état figé d'un espace de documentation (arbre et notes), d'un espace de
 * tableaux blancs (tableaux affichés par l'éditeur, sans écriture) ou d'un projet (tickets par colonne, avec leur
 * description, leurs commentaires et leurs pièces jointes). Tout se lit depuis les copies de l'étiquette.
 */
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const snapshotId = computed(() => Number(route.params.snapshotId));
const snapshot = ref<SpaceSnapshotDTO | null>(null);
const content = shallowRef<SnapshotContent | null>(null);
const failure = ref<string | null>(null);
const users = ref<UserSummaryDTO[]>([]);

async function load(): Promise<void> {
  failure.value = null;
  snapshot.value = null;
  content.value = null;
  try {
    const read = await api.spaceSnapshot(snapshotId.value);
    snapshot.value = read.snapshot;
    content.value = read.content;
    users.value = (await api.directory().catch(() => ({ users: [] as UserSummaryDTO[] }))).users;
    if (read.content.kind === 'docs') openFirstNote(read.content);
    else if (read.content.kind === 'boards') void openBoard(read.content.nodes.find((node) => node.kind === 'board') ?? null);
    else void loadProject(read.content);
  } catch (error) {
    failure.value = error instanceof ApiError && error.code === 'network' && connection.offline ? t('Hors ligne : cette étiquette n’a pas été ouverte sur cet appareil avant la coupure.') : error instanceof Error ? error.message : t('Étiquette introuvable.');
  }
}
watch(snapshotId, () => void load(), { immediate: true });

const KIND_ICONS = { docs: 'pi pi-book', boards: 'pi pi-objects-column', project: 'pi pi-briefcase' } as const;
const back = (): void => {
  const current = snapshot.value;
  if (!current) return void router.push('/');
  void router.push(current.kind === 'docs' ? { name: 'doc-space', params: { spaceId: current.spaceId } } : current.kind === 'boards' ? { name: 'board-space', params: { spaceId: current.spaceId } } : `/p/${current.spaceId}`);
};
const restorable = computed(() => snapshot.value && snapshot.value.kind !== 'project' && !connection.offline && auth.can(snapshot.value.kind === 'docs' ? 'docs.create' : 'boards.create'));

async function restore(): Promise<void> {
  const current = snapshot.value;
  if (!current) return;
  try {
    const created = await api.restoreSpaceSnapshot(current.id);
    notify('success', t('Nouvel espace créé'), t('Le contenu de « {name} » est dans un nouvel espace.', { name: current.name }));
    void router.push(created.kind === 'docs' ? { name: 'doc-space', params: { spaceId: created.spaceId } } : { name: 'board-space', params: { spaceId: created.spaceId } });
  } catch (error) {
    notifyError(error);
  }
}

// --- Documentation ----------------------------------------------------------------------------------------------------

const docs = computed(() => (content.value?.kind === 'docs' ? content.value : null));
type DocEntry = DocSnapshotContent['nodes'][number];
/** Les fichiers de l'étiquette, au format de la documentation (liens et images entre notes). */
const docNodes = computed<DocNodeDTO[]>(() =>
  (docs.value?.nodes ?? []).filter((node) => node.kind !== 'template').map((node) => ({ id: node.id, spaceId: 0, path: node.path, kind: node.kind, size: 0, updatedAt: node.updatedAt, updatedBy: null, deletedAt: null, memo: node.memo, icon: node.icon, color: node.color })),
);
const collapsed = ref(new Set<string>());
const docFilter = ref('');
const byName = (a: DocEntry, b: DocEntry): number => docBaseName(a.path).localeCompare(docBaseName(b.path), undefined, { numeric: true, sensitivity: 'base' });
/** L'arbre à plat, dossiers d'abord, dans l'ordre de lecture ; sans le contenu des dossiers repliés. */
const tree = computed(() => {
  const nodes = (docs.value?.nodes ?? []).filter((node) => node.kind !== 'template');
  const children = new Map<string, DocEntry[]>();
  for (const node of nodes) {
    const parent = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '';
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  const rows: Array<{ node: DocEntry; depth: number }> = [];
  const walk = (parent: string, depth: number): void => {
    const list = [...(children.get(parent) ?? [])].sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder') || byName(a, b));
    for (const node of list) {
      rows.push({ node, depth });
      if (node.kind === 'folder' && !collapsed.value.has(node.path)) walk(node.path, depth + 1);
    }
  };
  if (docFilter.value.trim()) return nodes.filter((node) => node.kind !== 'folder' && matchesQuery(docFilter.value, [node.path])).map((node) => ({ node, depth: 0 }));
  walk('', 0);
  return rows;
});
const templates = computed(() => (docs.value?.nodes ?? []).filter((node) => node.kind === 'template'));
function toggleFolder(path: string): void {
  const next = new Set(collapsed.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  collapsed.value = next;
}

const selectedDoc = ref<DocEntry | null>(null);
const docText = ref<string | null>(null);
const docLoading = ref(false);
const article = ref<HTMLElement | null>(null);

function openFirstNote(read: DocSnapshotContent): void {
  const notes = read.nodes.filter((node) => node.kind === 'markdown');
  const home = notes.find((node) => !node.path.includes('/') && /^(accueil|index|readme|home)\.md$/i.test(node.path));
  void openDoc(home ?? notes.sort(byName)[0] ?? null);
}

async function openDoc(node: DocEntry | null): Promise<void> {
  selectedDoc.value = node;
  docText.value = null;
  if (!node || node.kind === 'folder' || node.kind === 'image' || !node.file) return;
  docLoading.value = true;
  try {
    docText.value = (await api.spaceSnapshotText(snapshotId.value, node.file)).text;
  } catch (error) {
    notifyError(error);
  } finally {
    docLoading.value = false;
  }
}

const docContext = computed<DocRenderContext>(() => {
  const hashes = new Map((docs.value?.nodes ?? []).map((node) => [node.id, node.file]));
  return { nodes: docNodes.value, notePath: selectedDoc.value?.path ?? '', users: users.value, obsidian: docs.value?.space.obsidian, fileUrl: (id) => snapshotFileUrl(snapshotId.value, hashes.get(id) ?? '') };
});
const docHtml = computed(() => {
  if (docText.value === null) return '';
  const context = docContext.value;
  return finishDocHtml(renderMarkdown(prepareDocText(docText.value, context.obsidian), docResolver(users.value), { obsidian: context.obsidian, boardPreviews: false }), context);
});
watch(docHtml, async () => {
  await nextTick();
  const root = article.value;
  if (!root) return;
  void renderMermaid(root, darkMode.value);
  void highlightCodeBlocks(root);
});

function onArticleClick(event: MouseEvent): void {
  if (zoomImageOnClick(event)) return;
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-node]');
  if (!link) return;
  event.preventDefault();
  const target = docs.value?.nodes.find((node) => node.id === Number(link.dataset.node));
  if (target) void openDoc(target);
}

// --- Tableaux blancs --------------------------------------------------------------------------------------------------

const boards = computed(() => (content.value?.kind === 'boards' ? content.value : null));
type BoardEntry = BoardSnapshotContent['nodes'][number];
const boardList = computed(() => (boards.value?.nodes ?? []).filter((node) => node.kind !== 'folder').sort((a, b) => Number(a.kind === 'template') - Number(b.kind === 'template') || a.path.localeCompare(b.path, undefined, { numeric: true })));
const selectedBoard = ref<BoardEntry | null>(null);
const boardSession = shallowRef<BoardSnapshotSession | null>(null);

async function openBoard(node: BoardEntry | null): Promise<void> {
  selectedBoard.value = node;
  boardSession.value = null;
  if (!node?.file) return;
  try {
    const elements = await api.spaceSnapshotJson<BoardElement[]>(snapshotId.value, node.file);
    // Un autre tableau a pu être choisi entre-temps.
    if (selectedBoard.value?.id === node.id) boardSession.value = new BoardSnapshotSession(node.id, elements ?? []);
  } catch (error) {
    notifyError(error);
  }
}

// --- Projet -----------------------------------------------------------------------------------------------------------

interface ProjectExport {
  project: ProjectDTO;
  categories: CategoryDTO[];
  priorities: PriorityDTO[];
  deliveries: DeliveryDTO[];
  tickets: Array<TicketDTO & { key: string; comments: CommentDTO[]; attachments: AttachmentDTO[] }>;
  users?: UserSummaryDTO[];
}
const projectData = shallowRef<ProjectExport | null>(null);
const projectContent = computed(() => (content.value?.kind === 'project' ? content.value : null));
const ticketFilter = ref('');
const selectedTicketId = ref<number | null>(null);

async function loadProject(read: ProjectSnapshotContent): Promise<void> {
  try {
    projectData.value = await api.spaceSnapshotJson<ProjectExport>(snapshotId.value, read.file);
  } catch (error) {
    notifyError(error);
  }
}

const people = computed(() => new Map([...users.value, ...(projectData.value?.users ?? [])].map((user) => [user.id, user.name])));
const personName = (id: number | null): string => (id === null ? t('Compte supprimé') : (people.value.get(id) ?? t('Compte supprimé')));
const projectResolver = computed(() => docResolver([...(projectData.value?.users ?? []), ...users.value]));
const columns = computed(() => {
  const data = projectData.value;
  if (!data) return [];
  const configured = new Map(data.project.settings.columns.map((column) => [column.status, column]));
  const visible = data.tickets.filter((ticket) => matchesQuery(ticketFilter.value, [ticket.key, ticket.title]));
  return TICKET_STATUSES.map((status) => ({
    status,
    label: configured.get(status)?.label ?? t(STATUS_META[status].label),
    color: configured.get(status)?.color ?? STATUS_META[status].color,
    tickets: visible.filter((ticket) => ticket.status === status).sort((a, b) => a.position - b.position),
  })).filter((column) => column.tickets.length || !configured.get(column.status)?.hidden);
});
const selectedTicket = computed(() => projectData.value?.tickets.find((ticket) => ticket.id === selectedTicketId.value) ?? null);
const nameOf = <T extends { id: number; name: string }>(list: T[] | undefined, id: number | null): string | null => (id === null ? null : (list?.find((entry) => entry.id === id)?.name ?? null));
const frozenAttachment = (id: number) => projectContent.value?.attachments.find((entry) => entry.id === id) ?? null;
const attachmentUrl = (attachment: AttachmentDTO, download = false): string | null => {
  const frozen = frozenAttachment(attachment.id);
  return frozen ? snapshotFileUrl(snapshotId.value, frozen.file, download ? attachment.name : undefined) : null;
};
</script>

<template>
  <div class="snapshot-page">
    <header v-if="snapshot" class="bar">
      <Button v-tooltip.bottom="$t('Retour à l’espace')" icon="pi pi-arrow-left" text rounded :aria-label="$t('Retour à l’espace')" @click="back" />
      <i :class="KIND_ICONS[snapshot.kind]" class="kind"></i>
      <div class="titles">
        <h1 class="truncate">
          {{ snapshot.spaceName }} <span class="tag"><i class="pi pi-tag"></i> {{ snapshot.name }}</span>
        </h1>
        <p class="muted small truncate">
          <i class="pi pi-lock"></i> {{ $t('Lecture seule · figée le {date}', { date: formatDateTime(snapshot.createdAt) }) }}<template v-if="snapshot.createdByName"> · {{ snapshot.createdByName }}</template> ·
          {{ formatBytes(snapshot.bytes) }}<template v-if="snapshot.description"> · {{ snapshot.description }}</template>
        </p>
      </div>
      <div class="bar-actions">
        <Button :label="$t('Télécharger')" icon="pi pi-download" severity="secondary" outlined size="small" @click="downloadFrom(`/api/snapshots/${snapshot.id}/download`)" />
        <Button v-if="restorable" :label="$t('Nouvel espace depuis l’étiquette')" icon="pi pi-clone" size="small" @click="restore" />
      </div>
    </header>

    <div v-if="failure" class="state">
      <i class="pi pi-tag icon"></i>
      <h2>{{ $t('Étiquette indisponible') }}</h2>
      <p class="muted">{{ failure }}</p>
      <Button :label="$t('Retour')" severity="secondary" outlined @click="router.back()" />
    </div>
    <div v-else-if="!content" class="state muted"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</div>

    <!-- Documentation : l'arbre d'alors, et la note choisie. -->
    <div v-else-if="docs" class="split">
      <aside class="side">
        <IconField class="filter">
          <InputIcon class="pi pi-search" />
          <InputText v-model="docFilter" :placeholder="$t('Filtrer…')" size="small" fluid />
        </IconField>
        <nav class="tree">
          <button
            v-for="row in tree"
            :key="row.node.id"
            type="button"
            class="row"
            :class="{ active: selectedDoc?.id === row.node.id }"
            :style="{ paddingLeft: `${0.5 + row.depth * 0.9}rem` }"
            :title="row.node.memo || row.node.path"
            @click="row.node.kind === 'folder' ? toggleFolder(row.node.path) : openDoc(row.node)"
          >
            <i v-if="row.node.kind === 'folder'" :class="collapsed.has(row.node.path) ? 'pi pi-chevron-right' : 'pi pi-chevron-down'" class="chevron"></i>
            <i :class="row.node.kind === 'folder' ? (row.node.icon ?? 'pi pi-folder') : row.node.kind === 'image' ? 'pi pi-image' : 'pi pi-file'" :style="row.node.color ? { color: row.node.color } : undefined"></i>
            <span class="truncate">{{ row.node.kind === 'markdown' ? docTitle(row.node.path) : docBaseName(row.node.path) }}</span>
          </button>
        </nav>
        <template v-if="templates.length">
          <h3 class="side-title muted small">{{ $t('Modèles') }}</h3>
          <button v-for="node in templates" :key="node.id" type="button" class="row" :class="{ active: selectedDoc?.id === node.id }" @click="openDoc(node)">
            <i class="pi pi-clone"></i><span class="truncate">{{ docTitle(node.path) }}</span>
          </button>
        </template>
      </aside>
      <main class="reader">
        <template v-if="selectedDoc?.kind === 'image' && selectedDoc.file">
          <h2 class="doc-title">{{ docBaseName(selectedDoc.path) }}</h2>
          <img :src="snapshotFileUrl(snapshot!.id, selectedDoc.file)" :alt="docBaseName(selectedDoc.path)" class="image" />
        </template>
        <div v-else-if="docLoading" class="state muted"><i class="pi pi-spin pi-spinner"></i></div>
        <template v-else-if="selectedDoc && docText !== null">
          <p class="muted small path">{{ selectedDoc.path }}</p>
          <!-- eslint-disable-next-line vue/no-v-html -- HTML assaini par DOMPurify dans renderMarkdown. -->
          <div ref="article" class="markdown content" @click="onArticleClick" v-html="docHtml"></div>
          <p v-if="!docText.trim()" class="muted">{{ $t('Cette note est vide.') }}</p>
        </template>
        <p v-else class="state muted">{{ $t('Choisissez une note à gauche.') }}</p>
      </main>
    </div>

    <!-- Tableaux blancs : chacun dans l'éditeur, sans écriture. -->
    <div v-else-if="boards" class="split">
      <aside class="side">
        <button v-for="node in boardList" :key="node.id" type="button" class="row" :class="{ active: selectedBoard?.id === node.id }" :title="node.path" @click="openBoard(node)">
          <i :class="node.kind === 'template' ? 'pi pi-clone' : 'pi pi-objects-column'"></i><span class="truncate">{{ node.path }}</span>
        </button>
        <p v-if="!boardList.length" class="muted small">{{ $t('Aucun tableau.') }}</p>
      </aside>
      <main class="board-view">
        <BoardCanvas v-if="boardSession && selectedBoard" :key="selectedBoard.id" :session="boardSession" :can-edit="false" :users="users" :board-title="selectedBoard.path" />
        <p v-else class="state muted">{{ selectedBoard ? $t('Chargement…') : $t('Choisissez un tableau à gauche.') }}</p>
      </main>
    </div>

    <!-- Projet : les tickets par colonne, et le détail de celui choisi. -->
    <div v-else-if="projectContent" class="project">
      <div v-if="!projectData" class="state muted"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</div>
      <template v-else>
        <IconField class="filter project-filter">
          <InputIcon class="pi pi-search" />
          <InputText v-model="ticketFilter" :placeholder="$t('Rechercher un ticket…')" size="small" fluid />
        </IconField>
        <div class="board">
          <section v-for="column in columns" :key="column.status" class="column" :style="{ '--c': column.color }">
            <h3 class="column-title">
              <span class="dot"></span>{{ column.label }} <span class="muted">{{ column.tickets.length }}</span>
            </h3>
            <button v-for="ticket in column.tickets" :key="ticket.id" type="button" class="ticket" :class="{ active: selectedTicketId === ticket.id }" @click="selectedTicketId = ticket.id">
              <span class="key">{{ ticket.key }}</span>
              <span class="ticket-title">{{ ticket.title }}</span>
              <span v-if="ticket.assignees.length" class="muted small">{{ ticket.assignees.map((entry) => personName(entry.userId)).join(', ') }}</span>
            </button>
          </section>
        </div>
        <aside v-if="selectedTicket" class="detail">
          <div class="detail-head">
            <span class="key">{{ selectedTicket.key }}</span>
            <Button icon="pi pi-times" text rounded size="small" :aria-label="$t('Fermer')" @click="selectedTicketId = null" />
          </div>
          <h2>{{ selectedTicket.title }}</h2>
          <dl class="facts small">
            <dt>{{ $t('Statut') }}</dt>
            <dd>{{ columns.find((column) => column.status === selectedTicket!.status)?.label ?? selectedTicket.status }}</dd>
            <template v-if="nameOf(projectData.priorities, selectedTicket.priorityId)">
              <dt>{{ $t('Priorité') }}</dt>
              <dd>{{ nameOf(projectData.priorities, selectedTicket.priorityId) }}</dd>
            </template>
            <template v-if="nameOf(projectData.categories, selectedTicket.categoryId)">
              <dt>{{ $t('Catégorie') }}</dt>
              <dd>{{ nameOf(projectData.categories, selectedTicket.categoryId) }}</dd>
            </template>
            <template v-if="nameOf(projectData.deliveries, selectedTicket.deliveryId)">
              <dt>{{ $t('Livraison') }}</dt>
              <dd>{{ nameOf(projectData.deliveries, selectedTicket.deliveryId) }}</dd>
            </template>
            <template v-if="selectedTicket.assignees.length">
              <dt>{{ $t('Assignés') }}</dt>
              <dd>{{ selectedTicket.assignees.map((entry) => personName(entry.userId)).join(', ') }}</dd>
            </template>
            <template v-if="selectedTicket.startDate || selectedTicket.endDate">
              <dt>{{ $t('Dates') }}</dt>
              <dd>{{ selectedTicket.startDate ?? '…' }} → {{ selectedTicket.endDate ?? '…' }}</dd>
            </template>
          </dl>
          <MarkdownView v-if="selectedTicket.description" :text="selectedTicket.description" :resolver="projectResolver" class="description" />
          <p v-else class="muted small">{{ $t('Aucune description.') }}</p>

          <template v-if="selectedTicket.attachments.length">
            <h3>{{ $t('Pièces jointes') }}</h3>
            <ul class="files">
              <li v-for="attachment in selectedTicket.attachments" :key="attachment.id">
                <template v-if="attachment.kind === 'file'">
                  <img v-if="attachment.mime.startsWith('image/') && attachmentUrl(attachment)" :src="attachmentUrl(attachment)!" :alt="attachment.name" class="thumb" @click="zoomImageOnClick($event)" />
                  <a v-if="attachmentUrl(attachment, true)" :href="attachmentUrl(attachment, true)!" class="truncate"><i class="pi pi-download"></i> {{ attachment.name }}</a>
                  <span v-else class="muted truncate">{{ attachment.name }}</span>
                  <span class="muted small">{{ formatBytes(attachment.size) }}</span>
                </template>
                <a v-else-if="attachment.kind === 'url' && attachment.url" :href="attachment.url" target="_blank" rel="noopener" class="truncate"><i class="pi pi-link"></i> {{ attachment.name }}</a>
                <span v-else class="truncate"><i class="pi pi-folder"></i> {{ attachment.url ?? attachment.name }}</span>
              </li>
            </ul>
          </template>

          <h3>{{ $t('Commentaires') }} <span class="muted">{{ selectedTicket.comments.filter((comment) => !comment.deleted).length }}</span></h3>
          <div v-for="comment in selectedTicket.comments.filter((entry) => !entry.deleted)" :key="comment.id" class="comment">
            <p class="muted small">
              <strong>{{ personName(comment.userId) }}</strong> · <span v-tooltip.top="formatDateTime(comment.createdAt)">{{ formatRelative(comment.createdAt) }}</span>
            </p>
            <MarkdownView :text="comment.body" :resolver="projectResolver" />
          </div>
        </aside>
      </template>
    </div>
  </div>
</template>

<style scoped>
.snapshot-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.bar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.6rem 1rem;
  border-bottom: 1px solid var(--fb-border);
  background: var(--fb-panel);
}
.kind {
  font-size: 1.2rem;
  color: var(--p-primary-color);
}
.titles {
  flex: 1;
  min-width: 0;
}
.titles h1 {
  margin: 0;
  font-size: 1.1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.titles p {
  margin: 0.1rem 0 0;
}
.tag {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.8rem;
  font-weight: 600;
  padding: 0.1rem 0.55rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
  color: var(--p-primary-color);
}
.bar-actions {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.state {
  margin: auto;
  padding: 2rem;
  text-align: center;
  display: grid;
  justify-items: center;
  gap: 0.5rem;
}
.state .icon {
  font-size: 2rem;
  color: var(--p-primary-color);
}
.split {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(14rem, 18rem) 1fr;
}
.side {
  border-right: 1px solid var(--fb-border);
  overflow: auto;
  padding: 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.filter {
  margin-bottom: 0.4rem;
}
.side-title {
  margin: 0.8rem 0.4rem 0.3rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  padding: 0.3rem 0.5rem;
  border-radius: 6px;
  cursor: pointer;
  min-width: 0;
}
.row:hover {
  background: var(--fb-hover, color-mix(in srgb, var(--p-primary-color) 6%, transparent));
}
.row.active {
  background: color-mix(in srgb, var(--p-primary-color) 14%, transparent);
  color: var(--p-primary-color);
}
.chevron {
  font-size: 0.7rem;
  width: 0.7rem;
}
.reader {
  overflow: auto;
  padding: 1.2rem 2rem 3rem;
  min-width: 0;
}
.path {
  margin: 0 0 0.6rem;
}
.doc-title {
  margin-top: 0;
}
.image {
  max-width: 100%;
  border-radius: 8px;
  border: 1px solid var(--fb-border);
}
.board-view {
  position: relative;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.project {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto 1fr;
}
.project-filter {
  grid-column: 1 / -1;
  max-width: 24rem;
  margin: 0.6rem 1rem 0;
}
.board {
  display: flex;
  gap: 0.8rem;
  overflow: auto;
  padding: 0.8rem 1rem;
  min-height: 0;
  align-items: flex-start;
}
.column {
  flex: 0 0 16rem;
  display: grid;
  gap: 0.4rem;
  background: color-mix(in srgb, var(--c) 6%, var(--fb-panel));
  border-radius: 10px;
  padding: 0.6rem;
}
.column-title {
  margin: 0 0 0.2rem;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.dot {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 999px;
  background: var(--c);
}
.ticket {
  display: grid;
  gap: 0.15rem;
  text-align: left;
  border: 1px solid var(--fb-border);
  background: var(--fb-panel);
  color: inherit;
  font: inherit;
  border-radius: 8px;
  padding: 0.5rem 0.6rem;
  cursor: pointer;
}
.ticket.active {
  border-color: var(--p-primary-color);
}
.key {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--p-primary-color);
}
.detail {
  width: min(28rem, 92vw);
  border-left: 1px solid var(--fb-border);
  overflow: auto;
  padding: 0.8rem 1.2rem 2rem;
  background: var(--fb-panel);
}
.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.detail h2 {
  margin: 0.2rem 0 0.8rem;
  font-size: 1.15rem;
}
.detail h3 {
  margin: 1.2rem 0 0.5rem;
  font-size: 0.95rem;
}
.facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.25rem 0.8rem;
  margin: 0 0 1rem;
}
.facts dt {
  color: var(--fb-muted, var(--p-text-muted-color));
}
.facts dd {
  margin: 0;
}
.files {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 0.4rem;
}
.files li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}
.thumb {
  width: 3rem;
  height: 3rem;
  object-fit: cover;
  border-radius: 6px;
  cursor: zoom-in;
}
.comment {
  border-top: 1px solid var(--fb-border);
  padding: 0.5rem 0;
}
.comment p {
  margin: 0 0 0.2rem;
}
@media (max-width: 760px) {
  .split {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(8rem, 30vh) 1fr;
  }
  .side {
    border-right: 0;
    border-bottom: 1px solid var(--fb-border);
  }
  .reader {
    padding: 1rem;
  }
  .project {
    grid-template-columns: 1fr;
  }
  .detail {
    position: fixed;
    inset: auto 0 0 0;
    width: auto;
    max-height: 70vh;
    border-left: 0;
    border-top: 1px solid var(--fb-border);
    z-index: 5;
  }
  .bar {
    flex-wrap: wrap;
  }
}
</style>
