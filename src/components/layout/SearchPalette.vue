<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { docTitle } from '@shared/docs';
import type { BoardSearchHitDTO } from '@shared/boards';
import type { SearchKind, SearchResultDTO } from '@shared/types';
import { api } from '@/api';
import CategoryChips from '@/components/common/CategoryChips.vue';
import StatusTag from '@/components/common/StatusTag.vue';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { useAppStore } from '@/stores/app';
import { useDocsStore } from '@/stores/docs';
import { useUiStore } from '@/stores/ui';

/**
 * Recherche générale en palette, au centre de l'écran un peu en hauteur : projets, tickets, documents, tableaux blancs et
 * personnes. Les pastilles (ou Tab) limitent la recherche à une catégorie, qui montre alors bien plus de résultats.
 * Ctrl + K (ou « / » hors d'un champ) l'ouvre de partout ; vide, elle propose les favoris de la documentation.
 */
const router = useRouter();
const ui = useUiStore();
const app = useAppStore();
const docs = useDocsStore();
const query = ref('');
const loading = ref(false);
const result = ref<SearchResultDTO | null>(null);
const highlighted = ref(0);
const input = ref<HTMLInputElement | null>(null);
const list = ref<HTMLElement | null>(null);
let timer: number | null = null;
let generation = 0;

type Category = 'all' | 'projects' | 'tickets' | 'docs' | 'boards' | 'users';
/** Catégories, avec l'icône et la couleur de leur module (les mêmes que celles des mentions « @ »). */
const CATEGORIES: ReadonlyArray<{ key: Category; label: string; icon: string; color: string }> = [
  { key: 'all', label: 'Tout', icon: 'pi pi-asterisk', color: 'var(--fb-accent)' },
  { key: 'projects', label: 'Projets', icon: 'pi pi-th-large', color: 'var(--fb-module-projects)' },
  { key: 'tickets', label: 'Tickets', icon: 'pi pi-ticket', color: '#6366f1' },
  { key: 'docs', label: 'Documents', icon: 'pi pi-file', color: 'var(--fb-module-docs)' },
  { key: 'boards', label: 'Tableaux blancs', icon: 'pi pi-objects-column', color: 'var(--fb-module-boards)' },
  { key: 'users', label: 'Personnes', icon: 'pi pi-user', color: '#14b8a6' },
];
const categories = computed(() => CATEGORIES.filter((entry) => (entry.key !== 'docs' || app.info.docs) && (entry.key !== 'boards' || app.info.boards)));
const category = ref<Category>('all');
const info = (key: Category) => CATEGORIES.find((entry) => entry.key === key)!;
const shows = (key: Category): boolean => category.value === 'all' || category.value === key;
const boards = ref<BoardSearchHitDTO[]>([]);

interface Hit {
  key: string;
  go: () => void;
}

const bookmarks = computed(() => (query.value.trim() ? [] : docs.bookmarks.slice(0, 8)));

const hits = computed<Hit[]>(() => {
  const favorites = bookmarks.value.map((entry) => ({ key: `b${entry.nodeId}`, go: () => void router.push({ name: 'doc-file', params: { nodeId: entry.nodeId } }) }));
  const data = result.value;
  if (!data || !query.value.trim()) return favorites;
  return [
    ...data.projects.items.map((project) => ({ key: `p${project.id}`, go: () => void router.push({ name: 'project', params: { projectId: project.id } }) })),
    ...data.tickets.items.map((ticket) => ({ key: `t${ticket.id}`, go: () => void router.push({ name: 'project', params: { projectId: ticket.projectId }, query: { ticket: String(ticket.id) } }) })),
    ...data.docs.items.map((doc) => ({ key: `d${doc.id}`, go: () => void router.push({ name: 'doc-file', params: { nodeId: doc.id } }) })),
    ...boards.value.map((board) => ({ key: `w${board.id}`, go: () => void router.push({ name: 'board-file', params: { boardId: board.id } }) })),
    ...data.users.items.map((user) => ({ key: `u${user.id}`, go: () => void router.push({ name: 'user', params: { id: user.id } }) })),
  ];
});
const total = computed(() => (result.value ? result.value.projects.total + result.value.tickets.total + result.value.docs.total + result.value.users.total : 0) + boards.value.length);

const indexOf = (key: string): number => hits.value.findIndex((hit) => hit.key === key);
const isActive = (key: string): boolean => hits.value[highlighted.value]?.key === key;

const EMPTY = { items: [], total: 0 };

async function run(text: string): Promise<void> {
  const current = ++generation;
  loading.value = true;
  // Une seule catégorie : bien plus de résultats.
  const limit = category.value === 'all' ? 5 : 20;
  const kinds: SearchKind[] | null = category.value === 'all' ? null : category.value === 'boards' ? [] : [category.value];
  try {
    const [data, found] = await Promise.all([
      kinds?.length === 0 ? null : api.search(text, { limit, ...(kinds ? { type: kinds } : {}) }),
      shows('boards') && app.info.boards ? api.boardSearch(text, limit).catch(() => null) : null,
    ]);
    if (current === generation) {
      result.value = data ?? { query: text, projects: EMPTY, tickets: EMPTY, docs: EMPTY, users: EMPTY };
      boards.value = found?.boards ?? [];
      highlighted.value = 0;
    }
  } catch {
    if (current === generation) {
      result.value = null;
      boards.value = [];
    }
  } finally {
    if (current === generation) loading.value = false;
  }
}

watch(query, (text) => {
  if (timer !== null) window.clearTimeout(timer);
  highlighted.value = 0;
  if (!text.trim()) {
    result.value = null;
    boards.value = [];
    loading.value = false;
    return;
  }
  timer = window.setTimeout(() => void run(text.trim()), 160);
});
watch(category, () => {
  highlighted.value = 0;
  if (query.value.trim()) void run(query.value.trim());
});

/** Tab (Maj + Tab) passe à la catégorie suivante (précédente). */
function cycleCategory(step: number): void {
  const list = categories.value;
  const index = list.findIndex((entry) => entry.key === category.value);
  category.value = list[(index + step + list.length) % list.length]!.key;
}

watch(
  () => ui.searchOpen,
  async (open) => {
    if (!open) return;
    highlighted.value = 0;
    category.value = 'all';
    if (app.info.docs) void docs.loadBookmarks().catch(() => undefined);
    await nextTick();
    input.value?.focus();
    input.value?.select();
  },
);

function close(): void {
  ui.searchOpen = false;
}

function choose(hit: Hit | undefined): void {
  if (hit) hit.go();
  else if (query.value.trim()) {
    seeAll();
    return;
  }
  close();
}

function seeAll(): void {
  const type = category.value === 'all' || category.value === 'boards' ? undefined : category.value;
  void router.push({ name: 'search', query: { q: query.value.trim(), type } });
  close();
}

async function move(delta: number): Promise<void> {
  const count = hits.value.length;
  if (!count) return;
  highlighted.value = (highlighted.value + delta + count) % count;
  await nextTick();
  list.value?.querySelector('.hit.active')?.scrollIntoView({ block: 'nearest' });
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    void move(event.key === 'ArrowDown' ? 1 : -1);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    // La page de recherche ne couvre pas les tableaux blancs : la palette en montre déjà jusqu'à 20.
    if ((event.ctrlKey || event.metaKey) && category.value !== 'boards') seeAll();
    else choose(hits.value[highlighted.value]);
  } else if (event.key === 'Tab') {
    event.preventDefault();
    cycleCategory(event.shiftKey ? -1 : 1);
  } else if (event.key === 'Escape') {
    event.stopPropagation();
    close();
  }
}

/** Ctrl + K (ou « / » hors d'un champ) ouvre la palette de partout. */
function onGlobalKey(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  const typing = target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
  // « / » déjà pris par la page (l'ajout rapide d'un tableau blanc) : elle garde la main.
  if (((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') || (event.key === '/' && !typing && !event.defaultPrevented)) {
    event.preventDefault();
    ui.searchOpen = true;
  }
}

onMounted(() => window.addEventListener('keydown', onGlobalKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKey));
</script>

<template>
  <Teleport to="body">
    <Transition name="palette">
      <div v-if="ui.searchOpen" class="palette-mask" @mousedown.self="close">
        <div class="palette" role="dialog" aria-modal="true" :aria-label="$t('Recherche')">
          <label class="box">
            <i class="pi" :class="loading ? 'pi-spin pi-spinner' : 'pi-search'" aria-hidden="true"></i>
            <input
              ref="input"
              v-model="query"
              type="search"
              :placeholder="$t('Rechercher des projets, tickets, documents, personnes…')"
              :aria-label="$t('Rechercher dans les projets, tickets, documents et utilisateurs')"
              autocomplete="off"
              role="combobox"
              aria-expanded="true"
              aria-controls="search-palette-results"
              @keydown="onKeydown"
            />
            <kbd>Esc</kbd>
          </label>
          <CategoryChips v-model="category" :filters="categories" class="chips" />

          <div id="search-palette-results" ref="list" class="results" role="listbox">
            <template v-if="!query.trim()">
              <template v-if="bookmarks.length">
                <h4 class="group">{{ $t('Favoris') }}</h4>
                <button v-for="entry in bookmarks" :key="`b${entry.nodeId}`" type="button" class="hit" :class="{ active: isActive(`b${entry.nodeId}`) }" @mouseenter="highlighted = indexOf(`b${entry.nodeId}`)" @click="choose(hits[indexOf(`b${entry.nodeId}`)])">
                  <i class="pi pi-star-fill star"></i>
                  <span class="doc truncate"><strong>{{ docTitle(entry.path) }}</strong></span>
                  <span class="muted small truncate side">{{ entry.spaceName }}</span>
                </button>
              </template>
              <p v-else class="empty muted">{{ $t('Tapez pour chercher dans les projets, les tickets, la documentation et les personnes.') }}</p>
            </template>

            <template v-else>
              <p v-if="result && !total" class="empty muted">{{ $t('Aucun résultat pour « {q} »', { q: query.trim() }) }}</p>

              <template v-if="shows('projects') && result?.projects.items.length">
                <h4 class="group" :style="{ '--chip-color': info('projects').color }"><span><i :class="info('projects').icon"></i>{{ $t('Projets') }}</span> <span class="muted">{{ result.projects.total }}</span></h4>
                <button v-for="project in result.projects.items" :key="`p${project.id}`" type="button" class="hit" :class="{ active: isActive(`p${project.id}`) }" @mouseenter="highlighted = indexOf(`p${project.id}`)" @click="choose(hits[indexOf(`p${project.id}`)])">
                  <span class="badge">{{ project.key }}</span>
                  <span class="truncate"><strong>{{ project.name }}</strong></span>
                  <span v-if="project.archived" class="muted small">{{ $t('Archivé') }}</span>
                </button>
              </template>

              <template v-if="shows('tickets') && result?.tickets.items.length">
                <h4 class="group" :style="{ '--chip-color': info('tickets').color }"><span><i :class="info('tickets').icon"></i>{{ $t('Tickets') }}</span> <span class="muted">{{ result.tickets.total }}</span></h4>
                <button v-for="ticket in result.tickets.items" :key="`t${ticket.id}`" type="button" class="hit" :class="{ active: isActive(`t${ticket.id}`) }" @mouseenter="highlighted = indexOf(`t${ticket.id}`)" @click="choose(hits[indexOf(`t${ticket.id}`)])">
                  <span class="key">{{ ticket.key }}</span>
                  <span class="truncate">{{ ticket.title }}</span>
                  <StatusTag :status="ticket.status" compact />
                </button>
              </template>

              <template v-if="shows('docs') && result?.docs.items.length">
                <h4 class="group" :style="{ '--chip-color': info('docs').color }"><span><i :class="info('docs').icon"></i>{{ $t('Documents') }}</span> <span class="muted">{{ result.docs.total }}</span></h4>
                <button v-for="doc in result.docs.items" :key="`d${doc.id}`" type="button" class="hit" :class="{ active: isActive(`d${doc.id}`) }" @mouseenter="highlighted = indexOf(`d${doc.id}`)" @click="choose(hits[indexOf(`d${doc.id}`)])">
                  <i class="pi pi-file kind-icon" :style="{ '--chip-color': info('docs').color }"></i>
                  <span class="doc truncate"><strong>{{ doc.title }}</strong><small v-if="doc.excerpt" class="muted truncate">{{ doc.excerpt }}</small></span>
                  <span class="muted small truncate side">{{ doc.spaceName }}</span>
                </button>
              </template>

              <template v-if="shows('boards') && boards.length">
                <h4 class="group" :style="{ '--chip-color': info('boards').color }"><span><i :class="info('boards').icon"></i>{{ $t('Tableaux blancs') }}</span> <span class="muted">{{ boards.length }}</span></h4>
                <button v-for="board in boards" :key="`w${board.id}`" type="button" class="hit" :class="{ active: isActive(`w${board.id}`) }" @mouseenter="highlighted = indexOf(`w${board.id}`)" @click="choose(hits[indexOf(`w${board.id}`)])">
                  <i class="pi pi-objects-column kind-icon" :style="{ '--chip-color': info('boards').color }"></i>
                  <span class="truncate"><strong>{{ board.title }}</strong></span>
                  <span class="muted small truncate side">{{ board.spaceName }}</span>
                </button>
              </template>

              <template v-if="shows('users') && result?.users.items.length">
                <h4 class="group" :style="{ '--chip-color': info('users').color }"><span><i :class="info('users').icon"></i>{{ $t('Personnes') }}</span> <span class="muted">{{ result.users.total }}</span></h4>
                <button v-for="user in result.users.items" :key="`u${user.id}`" type="button" class="hit" :class="{ active: isActive(`u${user.id}`) }" @mouseenter="highlighted = indexOf(`u${user.id}`)" @click="choose(hits[indexOf(`u${user.id}`)])">
                  <UserAvatar :user="user" size="small" />
                  <span class="truncate"><strong>{{ user.name }}</strong></span>
                  <span class="muted small truncate">{{ user.email }}</span>
                </button>
              </template>
            </template>
          </div>

          <footer class="foot muted">
            <span><kbd>↑</kbd><kbd>↓</kbd> {{ $t('pour choisir') }}</span>
            <span><kbd>↵</kbd> {{ $t('pour ouvrir') }}</span>
            <span><kbd>Tab</kbd> {{ $t('pour changer de catégorie') }}</span>
            <button v-if="query.trim() && category !== 'boards'" type="button" class="see-all" @click="seeAll"><kbd>Ctrl ↵</kbd> {{ $t('Voir tous les résultats ({n})', { n: total }) }}</button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.palette-mask {
  position: fixed;
  inset: 0;
  z-index: 1300;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 12vh 1rem 1rem;
  background: rgb(0 0 0 / 38%);
  backdrop-filter: blur(2px);
}
.palette {
  display: flex;
  flex-direction: column;
  width: min(42rem, 100%);
  max-height: min(70vh, 40rem);
  border: 1px solid var(--fb-border);
  border-radius: 14px;
  background: var(--fb-panel);
  box-shadow: 0 24px 60px rgb(0 0 0 / 35%);
  overflow: hidden;
}
.box {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--fb-border);
  color: var(--fb-muted);
}
.box .pi {
  font-size: 1.05rem;
}
.box input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--fb-text);
  font: inherit;
  font-size: 1.1rem;
}
.box input::-webkit-search-cancel-button {
  display: none;
}
kbd {
  padding: 0 0.35rem;
  border: 1px solid var(--fb-border);
  border-radius: 5px;
  background: var(--fb-panel-alt);
  font-family: inherit;
  font-size: 0.68rem;
}
.results {
  flex: 1;
  min-height: 0;
  padding: 0.4rem;
  overflow-y: auto;
}
.chips {
  padding: 0.5rem 0.8rem 0.4rem;
  border-bottom: 1px solid var(--fb-border);
}
.group {
  display: flex;
  justify-content: space-between;
  margin: 0.5rem 0.6rem 0.2rem;
  font-size: 0.7rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--fb-muted);
}
.group > span:first-child {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.group .pi {
  color: var(--chip-color);
  font-size: 0.75rem;
}
.kind-icon {
  color: var(--chip-color);
}
.hit {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  padding: 0.5rem 0.6rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--fb-text);
  font: inherit;
  font-size: 0.9rem;
  text-align: left;
  cursor: pointer;
}
.hit .truncate {
  flex: 1;
  min-width: 0;
}
.hit.active {
  background: var(--fb-accent-soft);
}
.doc {
  display: flex;
  flex-direction: column;
}
.side {
  flex: 0 1 auto !important;
  max-width: 35%;
}
.star {
  color: #eab308;
}
.badge,
.key {
  flex: none;
  font-size: 0.72rem;
  font-weight: 800;
  color: var(--fb-accent);
}
.badge {
  padding: 0.05rem 0.4rem;
  border-radius: 5px;
  background: var(--fb-accent-soft);
}
.empty {
  margin: 0;
  padding: 1.2rem 0.8rem;
  text-align: center;
}
.foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem 1rem;
  padding: 0.45rem 0.9rem;
  border-top: 1px solid var(--fb-border);
  font-size: 0.75rem;
}
.foot kbd {
  margin-right: 0.15rem;
}
.see-all {
  margin-left: auto;
  padding: 0;
  border: 0;
  background: none;
  color: var(--fb-accent);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.palette-enter-active,
.palette-leave-active {
  transition: opacity 0.12s ease;
}
.palette-enter-active .palette,
.palette-leave-active .palette {
  transition: transform 0.12s ease;
}
.palette-enter-from,
.palette-leave-to {
  opacity: 0;
}
.palette-enter-from .palette,
.palette-leave-to .palette {
  transform: translateY(-8px) scale(0.98);
}
@media (max-width: 640px) {
  .palette-mask {
    padding-top: 1rem;
  }
}
</style>
