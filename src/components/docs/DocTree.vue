<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import ContextMenu from 'primevue/contextmenu';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import type { MenuItem } from 'primevue/menuitem';
import { docBaseName, docParent, docTitle, type DocNodeDTO } from '@shared/docs';
import { matchesQuery } from '@/utils/search';

import { t } from '@/i18n';
/** Arbre d'un espace : dossiers, notes et images. Clic droit pour agir, glisser pour déplacer. */
const props = defineProps<{ nodes: DocNodeDTO[]; selectedId: number | null; editable: boolean; spaceId: number }>();
const emit = defineEmits<{
  open: [node: DocNodeDTO];
  create: [kind: 'folder' | 'markdown', folder: string];
  rename: [node: DocNodeDTO];
  remove: [node: DocNodeDTO];
  move: [node: DocNodeDTO, folder: string];
  /** `null` : tout l'espace. */
  export: [node: DocNodeDTO | null];
  import: [node: DocNodeDTO | null];
}>();

interface Row {
  node: DocNodeDTO;
  depth: number;
  open: boolean;
}

const search = ref('');
const storageKey = computed(() => `fb.docs.closed.${props.spaceId}`);
const closed = ref(new Set<number>());

function loadClosed(): void {
  try {
    closed.value = new Set(JSON.parse(localStorage.getItem(storageKey.value) ?? '[]') as number[]);
  } catch {
    closed.value = new Set();
  }
}
watch(storageKey, loadClosed, { immediate: true });

function toggle(node: DocNodeDTO): void {
  if (closed.value.has(node.id)) closed.value.delete(node.id);
  else closed.value.add(node.id);
  try {
    localStorage.setItem(storageKey.value, JSON.stringify([...closed.value]));
  } catch {
    // Stockage indisponible : l'état vaut pour cette page seulement.
  }
}

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

function select(row: Row): void {
  if (row.node.kind === 'folder') toggle(row.node);
  else emit('open', row.node);
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
  const write: MenuItem[] = props.editable
    ? [
        { label: t('Nouvelle note'), icon: 'pi pi-file-plus', command: () => emit('create', 'markdown', folder) },
        { label: t('Nouveau dossier'), icon: 'pi pi-folder-plus', command: () => emit('create', 'folder', folder) },
        ...(node ? [{ label: t('Renommer'), icon: 'pi pi-pencil', command: () => emit('rename', node) }] : []),
        { separator: true },
      ]
    : [];
  return [
    ...write,
    { label: labels.out, icon: 'pi pi-download', command: () => emit('export', node) },
    ...(props.editable ? [{ label: labels.in, icon: 'pi pi-upload', command: () => emit('import', node) }] : []),
    ...(props.editable && node ? [{ separator: true }, { label: t('Supprimer'), icon: 'pi pi-trash', command: () => emit('remove', node) }] : []),
  ];
});

function openMenu(event: MouseEvent, node: DocNodeDTO | null): void {
  event.preventDefault();
  event.stopPropagation();
  target.value = node;
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
      <IconField class="filter">
        <InputIcon class="pi pi-search" />
        <InputText v-model="search" size="small" :placeholder="$t('Filtrer…')" :aria-label="$t('Filtrer les fichiers')" fluid />
      </IconField>
      <template v-if="editable">
        <Button v-tooltip.bottom="$t('Nouvelle note')" icon="pi pi-file-plus" text rounded size="small" severity="secondary" :aria-label="$t('Nouvelle note')" @click="emit('create', 'markdown', '')" />
        <Button v-tooltip.bottom="$t('Nouveau dossier')" icon="pi pi-folder-plus" text rounded size="small" severity="secondary" :aria-label="$t('Nouveau dossier')" @click="emit('create', 'folder', '')" />
      </template>
    </div>

    <ul class="list" role="tree" :aria-label="$t('Fichiers de l’espace')">
      <li
        v-for="row in rows"
        :key="row.node.id"
        class="row"
        role="treeitem"
        :aria-expanded="row.node.kind === 'folder' ? row.open : undefined"
        :aria-selected="row.node.id === selectedId"
        :class="{ selected: row.node.id === selectedId, dropping: over === row.node.path }"
        :style="{ paddingLeft: `${0.4 + row.depth * 0.95}rem` }"
        :draggable="editable"
        :title="row.node.path"
        tabindex="0"
        @click="select(row)"
        @keydown.enter="select(row)"
        @contextmenu="openMenu($event, row.node)"
        @dragstart="dragged = row.node"
        @dragend="(dragged = null), (over = null)"
        @dragover.prevent.stop="row.node.kind === 'folder' && canDrop(row.node.path) && (over = row.node.path)"
        @drop.prevent.stop="row.node.kind === 'folder' ? canDrop(row.node.path) && dropOn(row.node.path) : undefined"
      >
        <i v-if="row.node.kind === 'folder'" class="pi chevron" :class="row.open ? 'pi-chevron-down' : 'pi-chevron-right'"></i>
        <i :class="[ICONS[row.node.kind], row.node.kind]" class="kind"></i>
        <span class="name truncate">{{ row.node.kind === 'markdown' ? docTitle(row.node.path) : docBaseName(row.node.path) }}</span>
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
  gap: 0.4rem;
  height: 100%;
  min-height: 0;
  padding: 0.6rem 0.4rem;
}
.doc-tree.dropping {
  background: var(--fb-accent-soft);
}
.tools {
  display: flex;
  align-items: center;
  gap: 0.1rem;
}
.filter {
  flex: 1;
  min-width: 0;
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
  gap: 0.35rem;
  padding: 0.25rem 0.4rem;
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
.row.dropping {
  outline: 2px dashed var(--fb-accent);
  outline-offset: -2px;
}
.chevron {
  width: 0.8rem;
  color: var(--fb-muted);
  font-size: 0.6rem;
}
.kind {
  color: var(--fb-muted);
  font-size: 0.8rem;
}
.kind.folder {
  color: #f59e0b;
}
.name {
  min-width: 0;
}
.empty {
  padding: 0 0.5rem;
}
</style>
