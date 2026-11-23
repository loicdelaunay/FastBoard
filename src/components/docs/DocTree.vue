<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import Button from 'primevue/button';
import ContextMenu from 'primevue/contextmenu';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import type { MenuItem } from 'primevue/menuitem';
import { docBaseName, docParent, docTitle, type DocNodeDTO } from '@shared/docs';
import { useDocsStore } from '@/stores/docs';
import { matchesQuery } from '@/utils/search';

import { t } from '@/i18n';
/**
 * Arbre d'un espace : dossiers, notes et images. Un clic sélectionne un dossier (la flèche le déplie) ou ouvre un
 * fichier, Ctrl + clic ou le clic du milieu l'ouvre dans un nouvel onglet. Clic droit pour agir, glisser pour déplacer.
 * En bas, les modèles de notes de l'espace.
 */
const props = defineProps<{ nodes: DocNodeDTO[]; templates: DocNodeDTO[]; selectedId: number | null; editable: boolean; spaceId: number }>();
const emit = defineEmits<{
  open: [node: DocNodeDTO, newTab: boolean];
  create: [kind: 'folder' | 'markdown' | 'template', folder: string];
  /** Nouvelle note d'après ce modèle. */
  useTemplate: [template: DocNodeDTO, folder: string];
  /** Nouveau modèle d'après cette note. */
  saveAsTemplate: [node: DocNodeDTO];
  rename: [node: DocNodeDTO];
  remove: [node: DocNodeDTO];
  move: [node: DocNodeDTO, folder: string];
  /** `null` : tout l'espace. */
  export: [node: DocNodeDTO | null];
  import: [node: DocNodeDTO | null];
  info: [node: DocNodeDTO];
  memo: [node: DocNodeDTO];
  /** Masque la colonne des fichiers. */
  collapse: [];
}>();

const store = useDocsStore();

interface Row {
  node: DocNodeDTO;
  depth: number;
  open: boolean;
}

const search = ref('');
const storageKey = computed(() => `fb.docs.closed.${props.spaceId}`);
const closed = ref(new Set<number>());
/** Dossier choisi d'un clic : les nouvelles notes y sont créées. */
const folderId = ref<number | null>(null);

function loadClosed(): void {
  try {
    closed.value = new Set(JSON.parse(localStorage.getItem(storageKey.value) ?? '[]') as number[]);
  } catch {
    closed.value = new Set();
  }
}
watch(storageKey, loadClosed, { immediate: true });

function saveClosed(): void {
  try {
    localStorage.setItem(storageKey.value, JSON.stringify([...closed.value]));
  } catch {
    // Stockage indisponible : l'état vaut pour cette page seulement.
  }
}

function toggle(node: DocNodeDTO, open = closed.value.has(node.id)): void {
  const next = new Set(closed.value);
  if (open) next.delete(node.id);
  else next.add(node.id);
  closed.value = next;
  saveClosed();
}

const folders = computed(() => props.nodes.filter((node) => node.kind === 'folder'));
const allClosed = computed(() => folders.value.length > 0 && folders.value.every((node) => closed.value.has(node.id)));

function toggleAll(): void {
  closed.value = allClosed.value ? new Set() : new Set(folders.value.map((node) => node.id));
  saveClosed();
}

// Le fichier ouvert reste visible : ses dossiers se déplient, et la sélection d'un dossier s'efface.
watch(
  () => props.selectedId,
  (id) => {
    const node = props.nodes.find((entry) => entry.id === id);
    if (!node) return;
    folderId.value = null;
    const next = new Set(closed.value);
    let changed = false;
    for (let parent = docParent(node.path); parent; parent = docParent(parent)) {
      const folder = props.nodes.find((entry) => entry.path === parent);
      if (folder && next.delete(folder.id)) changed = true;
    }
    if (changed) {
      closed.value = next;
      saveClosed();
    }
  },
  { immediate: true },
);

/** Dossiers d'abord, puis fichiers, chacun par ordre alphabétique, à chaque niveau. */
const rows = computed<Row[]>(() => {
  const query = search.value.trim();
  if (query) {
    return props.nodes.filter((node) => node.kind !== 'folder' && matchesQuery(query, [node.path])).map((node) => ({ node, depth: 0, open: false }));
  }
  const children = new Map<string, DocNodeDTO[]>();
  for (const node of props.nodes) {
    const parent = docParent(node.path);
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  const rank = (node: DocNodeDTO) => (node.kind === 'folder' ? 0 : 1);
  const list: Row[] = [];
  const walk = (folder: string, depth: number): void => {
    const entries = [...(children.get(folder) ?? [])].sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));
    for (const node of entries) {
      const open = !closed.value.has(node.id);
      list.push({ node, depth, open });
      if (node.kind === 'folder' && open) walk(node.path, depth + 1);
    }
  };
  walk('', 0);
  return list;
});

/** Retrait d'un niveau : la largeur du chevron et de l'espace qui le suit, pour que les enfants s'alignent sous l'icône du dossier. */
const INDENT_REM = 1.3;
const indent = (depth: number): string => `${0.2 + depth * INDENT_REM}rem`;

// --- Dossiers collants : en faisant défiler, les dossiers ouverts du fichier en haut de la liste y restent (façon VS Code) ---
const list = ref<HTMLElement | null>(null);
const stuck = ref<Row[]>([]);
let stickFrame = 0;

/** Dossiers ouverts (de la liste) qui contiennent la ligne `index`, du plus haut au plus proche. */
function ancestorsOf(index: number): Row[] {
  const row = rows.value[index];
  if (!row) return [];
  const result: Row[] = [];
  let depth = row.depth;
  for (let cursor = index - 1; cursor >= 0 && depth > 0; cursor -= 1) {
    const candidate = rows.value[cursor]!;
    if (candidate.node.kind === 'folder' && candidate.depth < depth) {
      result.unshift(candidate);
      depth = candidate.depth;
    }
  }
  return result;
}

function updateStuck(): void {
  stickFrame = 0;
  const element = list.value;
  if (!element || search.value.trim()) {
    stuck.value = [];
    return;
  }
  const items = [...element.querySelectorAll<HTMLElement>(':scope > .row')];
  const height = items[0]?.offsetHeight ?? 0;
  if (!height || element.scrollTop <= 0) {
    stuck.value = [];
    return;
  }
  // La ligne qui passe sous les dossiers collés ; deux passes, car leur nombre change la hauteur qu'ils couvrent.
  let ancestors: Row[] = [];
  for (let pass = 0; pass < 2; pass += 1) {
    const edge = element.scrollTop + ancestors.length * height;
    const index = Math.max(0, items.findIndex((item) => item.offsetTop + item.offsetHeight > edge));
    ancestors = ancestorsOf(index).filter((row) => {
      const item = items[rows.value.indexOf(row)];
      return item !== undefined && item.offsetTop < element.scrollTop + ancestors.length * height;
    });
  }
  stuck.value = ancestors;
}

function onListScroll(): void {
  if (!stickFrame) stickFrame = requestAnimationFrame(updateStuck);
}

/** Un dossier collé ramène la liste jusqu'à lui. */
function revealRow(row: Row): void {
  const element = list.value;
  const index = rows.value.indexOf(row);
  const item = element?.querySelectorAll<HTMLElement>(':scope > .row')[index];
  if (element && item) element.scrollTo({ top: Math.max(0, item.offsetTop - ancestorsOf(index).length * item.offsetHeight), behavior: 'smooth' });
}

watch(rows, () => void nextTick(updateStuck));
onBeforeUnmount(() => cancelAnimationFrame(stickFrame));

const ICONS: Record<DocNodeDTO['kind'], string> = { folder: 'pi pi-folder', markdown: 'pi pi-file', image: 'pi pi-image', template: 'pi pi-clone' };

// --- Modèles ---
const TEMPLATES_KEY = 'fb.docs.templatesClosed';
function storedTemplatesOpen(): boolean {
  try {
    return localStorage.getItem(TEMPLATES_KEY) !== '1';
  } catch {
    return true;
  }
}
const templatesOpen = ref(storedTemplatesOpen());
watch(templatesOpen, (open) => {
  try {
    localStorage.setItem(TEMPLATES_KEY, open ? '0' : '1');
  } catch {
    // Stockage indisponible : le choix vaut pour cette page seulement.
  }
});
const shownTemplates = computed(() => props.templates.filter((node) => !search.value.trim() || matchesQuery(search.value.trim(), [node.path])));

/** Où créer une note : le dossier choisi, sinon celui du fichier ouvert. */
const currentFolder = computed(() => {
  const folder = props.nodes.find((node) => node.id === folderId.value);
  if (folder) return folder.path;
  const open = props.nodes.find((node) => node.id === props.selectedId);
  return open ? docParent(open.path) : '';
});

function select(row: Row, event: MouseEvent | KeyboardEvent): void {
  if (row.node.kind === 'folder') {
    folderId.value = row.node.id;
    return;
  }
  emit('open', row.node, event.ctrlKey || event.metaKey);
}

function onKey(row: Row, event: KeyboardEvent): void {
  if (row.node.kind !== 'folder') return;
  if (event.key === 'ArrowRight') toggle(row.node, true);
  else if (event.key === 'ArrowLeft') toggle(row.node, false);
}

// --- Menu ---
const menu = ref<InstanceType<typeof ContextMenu> | null>(null);
const target = ref<DocNodeDTO | null>(null);
const menuItems = computed<MenuItem[]>(() => {
  const node = target.value;
  if (node?.kind === 'template') return templateMenu(node);
  const folder = node ? (node.kind === 'folder' ? node.path : docParent(node.path)) : '';
  const transfer: Record<'space' | Exclude<DocNodeDTO['kind'], 'template'>, { out: string; in: string }> = {
    space: { out: t('Exporter l’espace en ZIP'), in: t('Importer un .md ou un ZIP') },
    folder: { out: t('Exporter le dossier en ZIP'), in: t('Importer un .md ou un ZIP ici') },
    markdown: { out: t('Exporter en .md'), in: t('Importer un .md') },
    image: { out: t('Exporter l’image'), in: t('Remplacer l’image') },
  };
  const labels = transfer[node?.kind ?? 'space'];
  const file = node && node.kind !== 'folder' ? node : null;
  const opening: MenuItem[] = file
    ? [
        { label: t('Ouvrir'), icon: 'pi pi-file', command: () => emit('open', file, false) },
        { label: t('Ouvrir dans un nouvel onglet'), icon: 'pi pi-clone', command: () => emit('open', file, true) },
        store.bookmarked.has(file.id)
          ? { label: t('Retirer des favoris'), icon: 'pi pi-star-fill', command: () => void store.toggleBookmark(file.id) }
          : { label: t('Ajouter aux favoris'), icon: 'pi pi-star', command: () => void store.toggleBookmark(file.id) },
        { separator: true },
      ]
    : [];
  const write: MenuItem[] = props.editable
    ? [
        { label: t('Nouvelle note'), icon: 'pi pi-file-plus', command: () => emit('create', 'markdown', folder) },
        { label: t('Nouveau dossier'), icon: 'pi pi-folder-plus', command: () => emit('create', 'folder', folder) },
        ...(node ? [{ label: t('Renommer'), icon: 'pi pi-pencil', command: () => emit('rename', node) }] : []),
        ...(node?.kind === 'markdown' ? [{ label: t('Enregistrer comme modèle'), icon: 'pi pi-clone', command: () => emit('saveAsTemplate', node) }] : []),
        { separator: true },
      ]
    : [];
  const about: MenuItem[] = node
    ? [
        { label: t('Infos'), icon: 'pi pi-info-circle', command: () => emit('info', node) },
        ...(props.editable ? [{ label: node.memo ? t('Modifier la note') : t('Ajouter une note'), icon: 'pi pi-comment', command: () => emit('memo', node) }] : []),
        { separator: true },
      ]
    : [];
  return [
    ...opening,
    ...write,
    ...about,
    { label: labels.out, icon: 'pi pi-download', command: () => emit('export', node) },
    ...(props.editable ? [{ label: labels.in, icon: 'pi pi-upload', command: () => emit('import', node) }] : []),
    ...(props.editable && node ? [{ separator: true }, { label: t('Supprimer'), icon: 'pi pi-trash', command: () => emit('remove', node) }] : []),
  ];
});

function templateMenu(node: DocNodeDTO): MenuItem[] {
  return [
    { label: t('Modifier le modèle'), icon: 'pi pi-pencil', command: () => emit('open', node, false) },
    ...(props.editable
      ? [
          { label: t('Nouvelle note depuis ce modèle'), icon: 'pi pi-file-plus', command: () => emit('useTemplate', node, currentFolder.value) },
          { label: t('Renommer'), icon: 'pi pi-tag', command: () => emit('rename', node) },
        ]
      : []),
    { separator: true },
    { label: t('Infos'), icon: 'pi pi-info-circle', command: () => emit('info', node) },
    ...(props.editable ? [{ label: node.memo ? t('Modifier la note') : t('Ajouter une note'), icon: 'pi pi-comment', command: () => emit('memo', node) }] : []),
    { label: t('Exporter en .md'), icon: 'pi pi-download', command: () => emit('export', node) },
    ...(props.editable ? [{ separator: true }, { label: t('Supprimer'), icon: 'pi pi-trash', command: () => emit('remove', node) }] : []),
  ];
}

function openMenu(event: MouseEvent, node: DocNodeDTO | null): void {
  event.preventDefault();
  event.stopPropagation();
  target.value = node;
  if (node?.kind === 'folder') folderId.value = node.id;
  menu.value?.show(event);
}

// --- Glisser-déposer ---
const dragged = ref<DocNodeDTO | null>(null);
const over = ref<string | null>(null);

function canDrop(folder: string): boolean {
  const node = dragged.value;
  if (!node || docParent(node.path) === folder) return false;
  return node.kind !== 'folder' || (folder !== node.path && !folder.startsWith(`${node.path}/`));
}

function dropOn(folder: string): void {
  const node = dragged.value;
  over.value = null;
  dragged.value = null;
  if (node) emit('move', node, folder);
}
</script>

<template>
  <div class="doc-tree" :class="{ dropping: over === '' }" @contextmenu="openMenu($event, null)" @dragover.prevent="canDrop('') && (over = '')" @dragleave.self="over = null" @drop.prevent="canDrop('') && dropOn('')">
    <div class="tools">
      <Button v-if="editable" v-tooltip.bottom="$t('Nouvelle note')" icon="pi pi-file-plus" text rounded size="small" severity="secondary" :aria-label="$t('Nouvelle note')" @click="emit('create', 'markdown', currentFolder)" />
      <Button v-if="editable" v-tooltip.bottom="$t('Nouveau dossier')" icon="pi pi-folder-plus" text rounded size="small" severity="secondary" :aria-label="$t('Nouveau dossier')" @click="emit('create', 'folder', currentFolder)" />
      <Button
        v-if="folders.length"
        v-tooltip.bottom="allClosed ? $t('Tout déplier') : $t('Tout replier')"
        :icon="allClosed ? 'pi pi-angle-double-down' : 'pi pi-angle-double-up'"
        text
        rounded
        size="small"
        severity="secondary"
        :aria-label="allClosed ? $t('Tout déplier') : $t('Tout replier')"
        @click="toggleAll"
      />
      <Button v-tooltip.bottom="$t('Masquer les fichiers')" icon="pi pi-angle-double-left" text rounded size="small" severity="secondary" class="collapse" :aria-label="$t('Masquer les fichiers')" @click="emit('collapse')" />
    </div>
    <IconField class="filter">
      <InputIcon class="pi pi-search" />
      <InputText v-model="search" size="small" :placeholder="$t('Filtrer…')" :aria-label="$t('Filtrer les fichiers')" fluid />
    </IconField>

    <ul ref="list" class="list" role="tree" :aria-label="$t('Fichiers de l’espace')" @scroll.passive="onListScroll">
      <li v-if="stuck.length" class="sticky" role="presentation">
        <div class="sticky-rows">
          <div
            v-for="row in stuck"
            :key="row.node.id"
            class="sticky-row"
            :class="{ chosen: row.node.id === folderId }"
            :style="{ paddingLeft: indent(row.depth) }"
            :title="row.node.path"
            @click="revealRow(row)"
          >
            <button type="button" class="chevron" tabindex="-1" :aria-label="$t('Replier')" @click.stop="toggle(row.node)"><i class="pi pi-chevron-down"></i></button>
            <i class="pi pi-folder-open kind folder"></i>
            <span class="name truncate">{{ docBaseName(row.node.path) }}</span>
          </div>
        </div>
      </li>
      <li
        v-for="row in rows"
        :key="row.node.id"
        class="row"
        role="treeitem"
        :aria-expanded="row.node.kind === 'folder' ? row.open : undefined"
        :aria-selected="row.node.id === selectedId || row.node.id === folderId"
        :class="{ selected: row.node.id === selectedId, chosen: row.node.id === folderId, dropping: over === row.node.path }"
        :style="{ paddingLeft: indent(row.depth) }"
        :draggable="editable"
        :title="row.node.memo ? `${row.node.path}\n${row.node.memo}` : row.node.path"
        tabindex="0"
        @click="select(row, $event)"
        @dblclick="row.node.kind === 'folder' && toggle(row.node)"
        @auxclick.prevent="$event.button === 1 && row.node.kind !== 'folder' && emit('open', row.node, true)"
        @keydown.enter="select(row, $event)"
        @keydown="onKey(row, $event)"
        @contextmenu="openMenu($event, row.node)"
        @dragstart="dragged = row.node"
        @dragend="(dragged = null), (over = null)"
        @dragover.prevent.stop="row.node.kind === 'folder' && canDrop(row.node.path) && (over = row.node.path)"
        @drop.prevent.stop="row.node.kind === 'folder' ? canDrop(row.node.path) && dropOn(row.node.path) : undefined"
      >
        <button v-if="row.node.kind === 'folder'" type="button" class="chevron" tabindex="-1" :aria-label="row.open ? $t('Replier') : $t('Déplier')" @click.stop="toggle(row.node)">
          <i class="pi" :class="row.open ? 'pi-chevron-down' : 'pi-chevron-right'"></i>
        </button>
        <i :class="[row.node.kind === 'folder' && row.open ? 'pi pi-folder-open' : ICONS[row.node.kind], row.node.kind]" class="kind"></i>
        <span class="name truncate">{{ row.node.kind === 'markdown' ? docTitle(row.node.path) : docBaseName(row.node.path) }}</span>
        <i v-if="row.node.memo" class="pi pi-comment mark" aria-hidden="true"></i>
        <i v-if="store.bookmarked.has(row.node.id)" class="pi pi-star-fill mark star" :aria-label="$t('Favori')"></i>
      </li>
    </ul>
    <p v-if="!rows.length" class="muted small empty">{{ search ? $t('Aucun fichier ne correspond.') : editable ? $t('Espace vide : créez une première note.') : $t('Espace vide.') }}</p>

    <section v-if="templates.length || editable" class="templates" :aria-label="$t('Modèles')" @contextmenu.stop.prevent>
      <header class="templates-head">
        <button type="button" class="templates-toggle" :aria-expanded="templatesOpen" @click="templatesOpen = !templatesOpen">
          <i :class="templatesOpen ? 'pi pi-chevron-down' : 'pi pi-chevron-right'"></i>
          <span>{{ $t('Modèles') }}</span>
          <span class="count muted">{{ templates.length }}</span>
        </button>
        <Button v-if="editable" v-tooltip.bottom="$t('Nouveau modèle')" icon="pi pi-plus" text rounded size="small" severity="secondary" :aria-label="$t('Nouveau modèle')" @click="emit('create', 'template', '')" />
      </header>
      <ul v-if="templatesOpen" class="list template-rows" role="list">
        <li
          v-for="node in shownTemplates"
          :key="node.id"
          class="row"
          :class="{ selected: node.id === selectedId }"
          :title="node.memo ? `${docTitle(node.path)}\n${node.memo}` : $t('Modifier le modèle')"
          tabindex="0"
          @click="emit('open', node, $event.ctrlKey || $event.metaKey)"
          @auxclick.prevent="$event.button === 1 && emit('open', node, true)"
          @keydown.enter="emit('open', node, false)"
          @contextmenu.prevent.stop="openMenu($event, node)"
        >
          <i class="pi pi-clone kind template"></i>
          <span class="name truncate">{{ docTitle(node.path) }}</span>
          <i v-if="node.memo" class="pi pi-comment mark" aria-hidden="true"></i>
          <button v-if="editable" v-tooltip.top="$t('Nouvelle note depuis ce modèle')" type="button" class="use" :aria-label="$t('Nouvelle note depuis ce modèle')" @click.stop="emit('useTemplate', node, currentFolder)"><i class="pi pi-file-plus"></i></button>
        </li>
      </ul>
      <p v-if="templatesOpen && !templates.length" class="muted small empty">{{ $t('Clic droit sur une note, « Enregistrer comme modèle », ou « + » pour en écrire un.') }}</p>
    </section>
    <ContextMenu ref="menu" :model="menuItems" />
  </div>
</template>

<style scoped>
.doc-tree {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  height: 100%;
  min-height: 0;
  padding: 0.4rem 0.4rem 0.6rem;
}
.doc-tree.dropping {
  background: var(--fb-accent-soft);
}
.tools {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.1rem;
}
.tools .collapse {
  margin-left: auto;
}
.filter {
  flex: none;
}
.list {
  position: relative;
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
/* Dossiers collés en haut de la liste pendant le défilement : une bande sans hauteur, au-dessus des lignes. */
.sticky {
  position: sticky;
  z-index: 2;
  top: 0;
  height: 0;
}
.sticky-rows {
  background: var(--fb-panel);
  box-shadow: 0 6px 8px -6px rgb(0 0 0 / 30%);
}
.sticky-row {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.22rem 0.4rem;
  border-radius: 6px;
  font-size: 0.86rem;
  cursor: pointer;
  user-select: none;
}
.sticky-row:hover {
  background: var(--fb-panel-alt);
}
.sticky-row.chosen {
  background: color-mix(in srgb, var(--fb-accent) 7%, transparent);
}
.row {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.22rem 0.4rem;
  border-radius: 6px;
  font-size: 0.86rem;
  cursor: pointer;
  user-select: none;
}
.row:hover {
  background: var(--fb-panel-alt);
}
.row.selected {
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
  font-weight: 600;
}
.row.chosen {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fb-accent) 55%, transparent);
  background: color-mix(in srgb, var(--fb-accent) 7%, transparent);
}
.row:focus-visible {
  outline: 2px solid var(--fb-accent);
  outline-offset: -2px;
}
.row.dropping {
  outline: 2px dashed var(--fb-accent);
  outline-offset: -2px;
}
.chevron {
  display: grid;
  place-items: center;
  width: 1rem;
  height: 1rem;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--fb-muted);
  font-size: 0.6rem;
  cursor: pointer;
}
.chevron:hover {
  background: color-mix(in srgb, var(--fb-text) 10%, transparent);
  color: var(--fb-text);
}
.kind {
  color: var(--fb-muted);
  font-size: 0.8rem;
}
.kind.folder {
  color: #f59e0b;
}
.name {
  flex: 1;
  min-width: 0;
}
.mark {
  flex: none;
  color: var(--fb-muted);
  font-size: 0.65rem;
}
.mark.star {
  color: #eab308;
}
.empty {
  padding: 0 0.5rem;
}
.templates {
  display: flex;
  flex: none;
  flex-direction: column;
  max-height: 40%;
  min-height: 0;
  padding-top: 0.35rem;
  border-top: 1px solid var(--fb-border);
}
.templates-head {
  display: flex;
  align-items: center;
}
.templates-toggle {
  display: inline-flex;
  flex: 1;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.4rem;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
}
.templates-toggle .pi {
  color: var(--fb-muted);
  font-size: 0.6rem;
}
.template-rows {
  flex: 1;
}
.kind.template {
  color: #a855f7;
}
.use {
  display: none;
  place-items: center;
  width: 1.3rem;
  height: 1.3rem;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--fb-muted);
  font-size: 0.75rem;
  cursor: pointer;
}
.row:hover .use,
.row:focus-within .use {
  display: grid;
}
.use:hover {
  background: color-mix(in srgb, var(--fb-text) 10%, transparent);
  color: var(--fb-accent);
}
</style>
