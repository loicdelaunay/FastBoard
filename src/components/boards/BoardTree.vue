<script setup lang="ts">
import { computed, ref } from 'vue';
import Button from 'primevue/button';
import ContextMenu from 'primevue/contextmenu';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import type { MenuItem } from 'primevue/menuitem';
import { boardTitle, type BoardNodeDTO } from '@shared/boards';
import { t } from '@/i18n';
import { matchesQuery } from '@/utils/search';

/**
 * Arbre d'un espace de tableaux blancs : dossiers et sous-dossiers, tableaux ; glisser-déposer pour ranger. Ctrl (Cmd)
 * + clic ajoute ou retire un élément de la sélection, Maj + clic sélectionne une plage ; le clic droit agit alors sur
 * toute la sélection (déplacer vers un autre espace).
 */
const props = defineProps<{ nodes: BoardNodeDTO[]; selectedId: number | null; editable: boolean; spaceId: number; owner?: boolean; templates?: BoardNodeDTO[] }>();
const emit = defineEmits<{
  open: [node: BoardNodeDTO];
  create: [kind: 'folder' | 'board' | 'template', folder: string];
  rename: [node: BoardNodeDTO];
  remove: [node: BoardNodeDTO];
  move: [node: BoardNodeDTO, folder: string];
  /** Vers un autre espace (le contenu d'un dossier choisi n'est pas répété). */
  moveTo: [nodes: BoardNodeDTO[]];
  duplicate: [node: BoardNodeDTO];
  share: [node: BoardNodeDTO];
  collapse: [];
}>();

const SHARE_LABELS = computed(() => ({ users: t('Partagé aux personnes connectées'), people: t('Partagé à des personnes choisies'), public: t('Partagé à tout le monde, sans compte') }));
const parentOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

const STORE_KEY = computed(() => `fb.boards.closed.${props.spaceId}`);
function storedClosed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORE_KEY.value) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
const closed = ref(storedClosed());
function setClosed(next: Set<string>): void {
  closed.value = next;
  try {
    localStorage.setItem(STORE_KEY.value, JSON.stringify([...next]));
  } catch {
    // Sans stockage, l'état des dossiers vaut pour cette page.
  }
}

const search = ref('');
const templatesOpen = ref(true);
const shownTemplates = computed(() => (props.templates ?? []).filter((node) => !search.value.trim() || matchesQuery(search.value.trim(), [node.path])));
const folder = ref('');
const over = ref<string | null>(null);
const dragged = ref<BoardNodeDTO | null>(null);

interface Row {
  node: BoardNodeDTO;
  depth: number;
}

const rows = computed<Row[]>(() => {
  const query = search.value.trim();
  if (query) return props.nodes.filter((node) => node.kind === 'board' && matchesQuery(query, [node.path])).map((node) => ({ node, depth: 0 }));
  const children = new Map<string, BoardNodeDTO[]>();
  for (const node of props.nodes) children.set(parentOf(node.path), [...(children.get(parentOf(node.path)) ?? []), node]);
  const list: Row[] = [];
  const walk = (path: string, depth: number): void => {
    const entries = [...(children.get(path) ?? [])].sort((a, b) => (a.kind === 'folder' ? 0 : 1) - (b.kind === 'folder' ? 0 : 1) || boardTitle(a.path).localeCompare(boardTitle(b.path), undefined, { sensitivity: 'base', numeric: true }));
    for (const node of entries) {
      list.push({ node, depth });
      if (node.kind === 'folder' && !closed.value.has(node.path)) walk(node.path, depth + 1);
    }
  };
  walk('', 0);
  return list;
});

const folders = computed(() => props.nodes.filter((node) => node.kind === 'folder'));
const allClosed = computed(() => folders.value.length > 0 && folders.value.every((node) => closed.value.has(node.path)));

function toggle(path: string): void {
  const next = new Set(closed.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  setClosed(next);
}

function toggleAll(): void {
  setClosed(allClosed.value ? new Set() : new Set(folders.value.map((node) => node.path)));
}

// --- Sélection ---
const selection = ref(new Set<number>());
const anchor = ref<number | null>(null);
const selectedNodes = computed(() => props.nodes.filter((node) => selection.value.has(node.id)));
const multi = computed(() => selection.value.size > 1);

/** Sans ce que contient déjà un dossier choisi : il l'emporte avec lui. */
function outermost(nodes: readonly BoardNodeDTO[]): BoardNodeDTO[] {
  const folders = nodes.filter((node) => node.kind === 'folder').map((node) => `${node.path}/`);
  return nodes.filter((node) => !folders.some((prefix) => node.path.startsWith(prefix)));
}

function rangeIds(from: number, to: number): number[] {
  const ids = rows.value.map((row) => row.node.id);
  const start = ids.indexOf(from);
  const end = ids.indexOf(to);
  if (start < 0 || end < 0) return [to];
  return ids.slice(Math.min(start, end), Math.max(start, end) + 1);
}

/** Ctrl ou Maj : la sélection change, rien ne s'ouvre. Vrai si le clic a été pris par la sélection. */
function selectWith(node: BoardNodeDTO, event: MouseEvent | KeyboardEvent): boolean {
  if (event.shiftKey && anchor.value !== null) {
    selection.value = new Set(rangeIds(anchor.value, node.id));
    return true;
  }
  if (event.ctrlKey || event.metaKey) {
    const next = new Set(selection.value);
    if (next.has(node.id) && next.size > 1) next.delete(node.id);
    else next.add(node.id);
    selection.value = next;
    anchor.value = node.id;
    return true;
  }
  selection.value = new Set([node.id]);
  anchor.value = node.id;
  return false;
}

function click(node: BoardNodeDTO, event?: MouseEvent | KeyboardEvent): void {
  if (event && selectWith(node, event)) return;
  if (node.kind === 'folder') {
    folder.value = folder.value === node.path ? '' : node.path;
    return;
  }
  folder.value = parentOf(node.path);
  emit('open', node);
}

// --- Glisser-déposer ---
function canDrop(target: string): boolean {
  const node = dragged.value;
  if (!node || !props.editable) return false;
  if (parentOf(node.path) === target) return false;
  return !(node.kind === 'folder' && (target === node.path || target.startsWith(`${node.path}/`)));
}

function drop(target: string): void {
  const node = dragged.value;
  over.value = null;
  dragged.value = null;
  if (node && canDrop(target)) emit('move', node, target);
}

// --- Menu ---
const menu = ref<InstanceType<typeof ContextMenu> | null>(null);
const menuItems = ref<MenuItem[]>([]);

function openMenu(event: MouseEvent, node: BoardNodeDTO | null): void {
  event.preventDefault();
  event.stopPropagation();
  if (node?.kind === 'template') {
    menuItems.value = [
      { label: t('Modifier le modèle'), icon: 'pi pi-pencil', command: () => emit('open', node) },
      ...(props.editable
        ? [
            { label: t('Renommer'), icon: 'pi pi-tag', command: () => emit('rename', node) },
            { label: t('Déplacer vers…'), icon: 'pi pi-arrow-up-right', command: () => emit('moveTo', [node]) },
            { separator: true },
            { label: t('Supprimer'), icon: 'pi pi-trash', class: 'menu-danger', command: () => emit('remove', node) },
          ]
        : []),
    ];
    menu.value?.show(event);
    return;
  }
  // Clic droit sur une sélection de plusieurs éléments : ce qui vaut pour tous.
  if (node && multi.value && selection.value.has(node.id)) {
    menuItems.value = [
      { label: t('{n} élément sélectionné|{n} éléments sélectionnés', { n: selection.value.size }), disabled: true },
      { separator: true },
      ...(props.editable ? [{ label: t('Déplacer vers…'), icon: 'pi pi-arrow-up-right', command: () => emit('moveTo', outermost(selectedNodes.value)) }] : []),
      { label: t('Désélectionner'), icon: 'pi pi-times', command: () => (selection.value = new Set()) },
    ];
    menu.value?.show(event);
    return;
  }
  if (node && !selection.value.has(node.id)) {
    selection.value = new Set([node.id]);
    anchor.value = node.id;
  }
  const target = node?.kind === 'folder' ? node.path : node ? parentOf(node.path) : folder.value;
  menuItems.value = [
    ...(node?.kind === 'board' ? [{ label: t('Ouvrir'), icon: 'pi pi-objects-column', command: () => emit('open', node) }] : []),
    ...(props.editable
      ? [
          { label: t('Nouveau tableau'), icon: 'pi pi-plus', command: () => emit('create', 'board', target) },
          { label: t('Nouveau dossier'), icon: 'pi pi-folder-plus', command: () => emit('create', 'folder', target) },
          ...(node
            ? [
                { separator: true },
                { label: t('Renommer'), icon: 'pi pi-pencil', command: () => emit('rename', node) },
                { label: t('Déplacer vers…'), icon: 'pi pi-arrow-up-right', command: () => emit('moveTo', [node]) },
                ...(node.kind === 'board' ? [{ label: t('Dupliquer'), icon: 'pi pi-clone', command: () => emit('duplicate', node) }] : []),
                ...(node.kind === 'board' && props.owner ? [{ label: t('Partager…'), icon: 'pi pi-share-alt', command: () => emit('share', node) }] : []),
                { separator: true },
                { label: t('Supprimer'), icon: 'pi pi-trash', class: 'menu-danger', command: () => emit('remove', node) },
              ]
            : []),
        ]
      : []),
  ];
  if (menuItems.value.length) menu.value?.show(event);
}
</script>

<template>
  <div class="tree" :class="{ dropping: over === '' }" @contextmenu="openMenu($event, null)" @dragover.prevent="canDrop('') && (over = '')" @dragleave.self="over = null" @drop.prevent="drop('')">
    <div class="tools">
      <Button v-if="editable" v-tooltip.bottom="$t('Nouveau tableau')" icon="pi pi-plus" text rounded size="small" severity="secondary" :aria-label="$t('Nouveau tableau')" @click="emit('create', 'board', folder)" />
      <Button v-if="editable" v-tooltip.bottom="$t('Nouveau dossier')" icon="pi pi-folder-plus" text rounded size="small" severity="secondary" :aria-label="$t('Nouveau dossier')" @click="emit('create', 'folder', folder)" />
      <Button v-if="folders.length" v-tooltip.bottom="allClosed ? $t('Tout déplier') : $t('Tout replier')" :icon="allClosed ? 'pi pi-angle-double-down' : 'pi pi-angle-double-up'" text rounded size="small" severity="secondary" :aria-label="allClosed ? $t('Tout déplier') : $t('Tout replier')" @click="toggleAll" />
      <Button v-tooltip.bottom="$t('Masquer les tableaux')" icon="pi pi-angle-double-left" text rounded size="small" severity="secondary" class="collapse" :aria-label="$t('Masquer les tableaux')" @click="emit('collapse')" />
    </div>
    <IconField class="filter">
      <InputIcon class="pi pi-search" />
      <InputText v-model="search" size="small" :placeholder="$t('Filtrer…')" :aria-label="$t('Filtrer les tableaux')" fluid />
    </IconField>
    <ul class="rows" role="tree">
      <li v-for="row in rows" :key="row.node.id" role="treeitem" :aria-expanded="row.node.kind === 'folder' ? !closed.has(row.node.path) : undefined">
        <div
          class="row"
          :class="{ active: row.node.id === selectedId, chosen: row.node.kind === 'folder' && folder === row.node.path, over: over === row.node.path, selected: multi && selection.has(row.node.id) }"
          :aria-selected="selection.has(row.node.id)"
          :style="{ paddingLeft: `${0.4 + row.depth * 0.9}rem` }"
          :draggable="editable"
          tabindex="0"
          :title="row.node.path"
          @click="click(row.node, $event)"
          @dblclick="row.node.kind === 'folder' && toggle(row.node.path)"
          @keydown.enter="click(row.node)"
          @keydown.esc="selection = new Set()"
          @contextmenu="openMenu($event, row.node)"
          @dragstart="dragged = row.node"
          @dragend="dragged = null; over = null"
          @dragover.prevent.stop="row.node.kind === 'folder' && canDrop(row.node.path) && (over = row.node.path)"
          @drop.prevent.stop="row.node.kind === 'folder' ? drop(row.node.path) : drop(parentOf(row.node.path))"
        >
          <button v-if="row.node.kind === 'folder'" type="button" class="chevron" :aria-label="closed.has(row.node.path) ? $t('Déplier') : $t('Replier')" @click.stop="toggle(row.node.path)">
            <i :class="closed.has(row.node.path) ? 'pi pi-chevron-right' : 'pi pi-chevron-down'"></i>
          </button>
          <span v-else class="chevron"></span>
          <i :class="row.node.kind === 'folder' ? (closed.has(row.node.path) ? 'pi pi-folder' : 'pi pi-folder-open') : 'pi pi-objects-column'" class="kind"></i>
          <span class="name truncate">{{ boardTitle(row.node.path) }}</span>
          <i v-if="row.node.share" v-tooltip.top="SHARE_LABELS[row.node.share]" class="pi share" :class="[row.node.share === 'public' ? 'pi-globe public' : 'pi-share-alt']"></i>
          <span v-if="row.node.kind === 'board' && row.node.elementCount" class="count muted">{{ row.node.elementCount }}</span>
        </div>
      </li>
    </ul>
    <p v-if="!rows.length" class="muted small empty">{{ search ? $t('Aucun tableau ne correspond.') : $t('Aucun tableau pour l’instant.') }}</p>

    <section v-if="templates" class="templates" :aria-label="$t('Modèles')" @contextmenu.stop>
      <header class="templates-head">
        <button type="button" class="templates-toggle" :aria-expanded="templatesOpen" @click="templatesOpen = !templatesOpen">
          <i :class="templatesOpen ? 'pi pi-chevron-down' : 'pi pi-chevron-right'"></i>
          <span>{{ $t('Modèles') }}</span>
          <span class="count muted">{{ templates.length }}</span>
        </button>
        <Button v-if="editable" v-tooltip.bottom="$t('Nouveau modèle')" icon="pi pi-plus" text rounded size="small" severity="secondary" :aria-label="$t('Nouveau modèle')" @click="emit('create', 'template', '')" />
      </header>
      <ul v-if="templatesOpen" class="rows template-rows" role="list">
        <li v-for="node in shownTemplates" :key="node.id">
          <div class="row" :class="{ active: node.id === selectedId }" tabindex="0" :title="$t('Modifier le modèle')" @click="emit('open', node)" @keydown.enter="emit('open', node)" @contextmenu.prevent.stop="openMenu($event, node)">
            <span class="chevron"></span>
            <i class="pi pi-clone kind template-icon"></i>
            <span class="name truncate">{{ node.path }}</span>
          </div>
        </li>
      </ul>
      <p v-if="templatesOpen && !templates.length" class="muted small empty">{{ $t('Sélectionnez des éléments, clic droit, « Créer un modèle ».') }}</p>
    </section>
    <ContextMenu ref="menu" :model="menuItems" />
  </div>
</template>

<style scoped>
.tree {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-height: 0;
  padding: 0.5rem 0.4rem;
}
.tree.dropping {
  box-shadow: inset 0 0 0 2px var(--fb-accent);
}
.tools {
  display: flex;
  align-items: center;
  gap: 0.1rem;
}
.tools .collapse {
  margin-left: auto;
}
.filter {
  flex: none;
}
.rows {
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
  min-height: 1.9rem;
  padding-right: 0.4rem;
  border-radius: 7px;
  font-size: 0.88rem;
  cursor: pointer;
  user-select: none;
}
.row:hover {
  background: var(--fb-panel-alt);
}
.row.active {
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
  font-weight: 600;
}
.row.selected {
  background: color-mix(in srgb, var(--fb-accent) 14%, transparent);
}
.row.chosen {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fb-accent) 45%, transparent);
}
.row.over {
  background: var(--fb-accent-soft);
  box-shadow: inset 0 0 0 2px var(--fb-accent);
}
.chevron {
  display: grid;
  place-items: center;
  width: 1.1rem;
  height: 1.1rem;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--fb-muted);
  font-size: 0.6rem;
  cursor: pointer;
}
.kind {
  flex: none;
  color: var(--fb-muted);
  font-size: 0.85rem;
}
.row.active .kind {
  color: inherit;
}
.name {
  flex: 1;
  min-width: 0;
}
.count {
  font-size: 0.72rem;
}
.share {
  color: var(--fb-muted);
  font-size: 0.75rem;
}
.share.public {
  color: #f59e0b;
}
.empty {
  margin: 0.5rem;
}
.templates {
  flex: none;
  max-height: 40%;
  display: flex;
  flex-direction: column;
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
.template-icon {
  color: #a855f7;
}
</style>
