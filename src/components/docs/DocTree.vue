<script setup lang="ts">
import { computed, ref, watch } from 'vue';
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
 */
const props = defineProps<{ nodes: DocNodeDTO[]; selectedId: number | null; editable: boolean; spaceId: number }>();
const emit = defineEmits<{
  open: [node: DocNodeDTO, newTab: boolean];
  create: [kind: 'folder' | 'markdown', folder: string];
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

const ICONS: Record<DocNodeDTO['kind'], string> = { folder: 'pi pi-folder', markdown: 'pi pi-file', image: 'pi pi-image' };

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
  const folder = node ? (node.kind === 'folder' ? node.path : docParent(node.path)) : '';
  const transfer: Record<'space' | DocNodeDTO['kind'], { out: string; in: string }> = {
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

    <ul class="list" role="tree" :aria-label="$t('Fichiers de l’espace')">
      <li
        v-for="row in rows"
        :key="row.node.id"
        class="row"
        role="treeitem"
        :aria-expanded="row.node.kind === 'folder' ? row.open : undefined"
        :aria-selected="row.node.id === selectedId || row.node.id === folderId"
        :class="{ selected: row.node.id === selectedId, chosen: row.node.id === folderId, dropping: over === row.node.path }"
        :style="{ paddingLeft: `${0.2 + row.depth * 0.95}rem` }"
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
        <span v-else class="chevron-gap"></span>
        <i :class="[row.node.kind === 'folder' && row.open ? 'pi pi-folder-open' : ICONS[row.node.kind], row.node.kind]" class="kind"></i>
        <span class="name truncate">{{ row.node.kind === 'markdown' ? docTitle(row.node.path) : docBaseName(row.node.path) }}</span>
        <i v-if="row.node.memo" class="pi pi-comment mark" aria-hidden="true"></i>
        <i v-if="store.bookmarked.has(row.node.id)" class="pi pi-star-fill mark star" :aria-label="$t('Favori')"></i>
      </li>
    </ul>
    <p v-if="!rows.length" class="muted small empty">{{ search ? $t('Aucun fichier ne correspond.') : editable ? $t('Espace vide : créez une première note.') : $t('Espace vide.') }}</p>
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
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
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
  width: 1.05rem;
  height: 1.05rem;
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
.chevron-gap {
  width: 1.05rem;
  flex: none;
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
</style>
