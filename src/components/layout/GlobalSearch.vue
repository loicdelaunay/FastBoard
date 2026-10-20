<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { SearchResultDTO } from '@shared/types';
import { api } from '@/api';
import StatusTag from '@/components/common/StatusTag.vue';
import UserAvatar from '@/components/common/UserAvatar.vue';

/** Recherche globale de l'en-tête : projets, tickets et utilisateurs, avec un aperçu rapide et un lien vers tous les résultats. */
const router = useRouter();
const query = ref('');
const open = ref(false);
const loading = ref(false);
const result = ref<SearchResultDTO | null>(null);
const highlighted = ref(0);
const input = ref<HTMLInputElement | null>(null);
const root = ref<HTMLElement | null>(null);
let timer: number | null = null;
let generation = 0;

interface Hit {
  key: string;
  go: () => void;
}

const hits = computed<Hit[]>(() => {
  const data = result.value;
  if (!data) return [];
  return [
    ...data.projects.items.map((project) => ({ key: `p${project.id}`, go: () => void router.push({ name: 'project', params: { projectId: project.id } }) })),
    ...data.tickets.items.map((ticket) => ({ key: `t${ticket.id}`, go: () => void router.push({ name: 'project', params: { projectId: ticket.projectId }, query: { ticket: String(ticket.id) } }) })),
    ...data.users.items.map((user) => ({ key: `u${user.id}`, go: () => void router.push({ name: 'user', params: { id: user.id } }) })),
  ];
});
const total = computed(() => (result.value ? result.value.projects.total + result.value.tickets.total + result.value.users.total : 0));

function indexOf(key: string): number {
  return hits.value.findIndex((hit) => hit.key === key);
}

async function run(text: string): Promise<void> {
  const current = ++generation;
  loading.value = true;
  try {
    const data = await api.search(text, { limit: 5 });
    if (current === generation) {
      result.value = data;
      highlighted.value = 0;
    }
  } catch {
    if (current === generation) result.value = null;
  } finally {
    if (current === generation) loading.value = false;
  }
}

watch(query, (text) => {
  if (timer !== null) window.clearTimeout(timer);
  if (!text.trim()) {
    result.value = null;
    loading.value = false;
    return;
  }
  open.value = true;
  timer = window.setTimeout(() => void run(text.trim()), 180);
});

function close(): void {
  open.value = false;
}

function choose(hit: Hit | undefined): void {
  if (hit) {
    hit.go();
  } else if (query.value.trim()) {
    seeAll();
    return;
  }
  close();
  input.value?.blur();
}

function seeAll(): void {
  void router.push({ name: 'search', query: { q: query.value.trim() } });
  close();
  input.value?.blur();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    open.value = true;
    const count = hits.value.length;
    if (count) highlighted.value = (highlighted.value + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) seeAll();
    else choose(hits.value[highlighted.value]);
  } else if (event.key === 'Escape') {
    close();
    input.value?.blur();
  }
}

/** Ctrl + K (ou « / » hors d'un champ) place le curseur dans la recherche. */
function onGlobalKey(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  const typing = target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
  if (((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') || (event.key === '/' && !typing)) {
    event.preventDefault();
    input.value?.focus();
    input.value?.select();
    open.value = Boolean(query.value.trim());
  }
}

function onDocumentClick(event: MouseEvent): void {
  if (root.value && !root.value.contains(event.target as Node)) close();
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKey);
  document.addEventListener('mousedown', onDocumentClick);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKey);
  document.removeEventListener('mousedown', onDocumentClick);
});
</script>

<template>
  <div ref="root" class="global-search" :class="{ open: open && query.trim() }">
    <label class="box">
      <i class="pi" :class="loading ? 'pi-spin pi-spinner' : 'pi-search'" aria-hidden="true"></i>
      <input
        ref="input"
        v-model="query"
        type="search"
        :placeholder="$t('Rechercher…')"
        :aria-label="$t('Rechercher dans les projets, tickets et utilisateurs')"
        autocomplete="off"
        role="combobox"
        :aria-expanded="open && Boolean(query.trim())"
        aria-controls="global-search-results"
        @focus="open = Boolean(query.trim())"
        @keydown="onKeydown"
      />
      <kbd class="hint">Ctrl K</kbd>
    </label>

    <div v-if="open && query.trim()" id="global-search-results" class="panel" role="listbox">
      <p v-if="result && !total" class="empty muted">{{ $t('Aucun résultat pour « {q} »', { q: query.trim() }) }}</p>

      <template v-if="result?.projects.items.length">
        <h4 class="group">{{ $t('Projets') }} <span class="muted">{{ result.projects.total }}</span></h4>
        <button
          v-for="project in result.projects.items"
          :key="`p${project.id}`"
          type="button"
          class="hit"
          :class="{ active: hits[highlighted]?.key === `p${project.id}` }"
          @mouseenter="highlighted = indexOf(`p${project.id}`)"
          @click="choose(hits[indexOf(`p${project.id}`)])"
        >
          <span class="badge">{{ project.key }}</span>
          <span class="truncate"><strong>{{ project.name }}</strong></span>
          <span v-if="project.archived" class="muted small">{{ $t('Archivé') }}</span>
        </button>
      </template>

      <template v-if="result?.tickets.items.length">
        <h4 class="group">{{ $t('Tickets') }} <span class="muted">{{ result.tickets.total }}</span></h4>
        <button
          v-for="ticket in result.tickets.items"
          :key="`t${ticket.id}`"
          type="button"
          class="hit"
          :class="{ active: hits[highlighted]?.key === `t${ticket.id}` }"
          @mouseenter="highlighted = indexOf(`t${ticket.id}`)"
          @click="choose(hits[indexOf(`t${ticket.id}`)])"
        >
          <span class="key">{{ ticket.key }}</span>
          <span class="truncate">{{ ticket.title }}</span>
          <StatusTag :status="ticket.status" compact />
        </button>
      </template>

      <template v-if="result?.users.items.length">
        <h4 class="group">{{ $t('Utilisateurs') }} <span class="muted">{{ result.users.total }}</span></h4>
        <button
          v-for="user in result.users.items"
          :key="`u${user.id}`"
          type="button"
          class="hit"
          :class="{ active: hits[highlighted]?.key === `u${user.id}` }"
          @mouseenter="highlighted = indexOf(`u${user.id}`)"
          @click="choose(hits[indexOf(`u${user.id}`)])"
        >
          <UserAvatar :user="user" size="small" />
          <span class="truncate"><strong>{{ user.name }}</strong></span>
          <span class="muted small truncate">{{ user.email }}</span>
        </button>
      </template>

      <button v-if="result && total" type="button" class="see-all" @click="seeAll">
        <i class="pi pi-arrow-right"></i> {{ $t('Voir tous les résultats ({n})', { n: total }) }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.global-search {
  position: relative;
  width: min(22rem, 34vw);
}
.box {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  height: 2.2rem;
  padding: 0 0.6rem;
  border: 1px solid var(--fb-border);
  border-radius: 10px;
  background: var(--fb-panel-alt);
  color: var(--fb-muted);
  cursor: text;
}
.box:focus-within {
  border-color: var(--fb-accent);
  box-shadow: 0 0 0 3px var(--fb-accent-soft);
}
.box input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--fb-text);
  font: inherit;
  font-size: 0.9rem;
}
.hint {
  padding: 0 0.35rem;
  border: 1px solid var(--fb-border);
  border-radius: 5px;
  font-size: 0.68rem;
  font-family: inherit;
}
.box:focus-within .hint {
  display: none;
}
.panel {
  position: absolute;
  z-index: 50;
  top: calc(100% + 6px);
  right: 0;
  width: max(100%, 26rem);
  max-height: min(70vh, 32rem);
  overflow-y: auto;
  padding: 0.4rem;
  border: 1px solid var(--fb-border);
  border-radius: 12px;
  background: var(--fb-panel);
  box-shadow: 0 16px 40px rgb(0 0 0 / 20%);
}
.group {
  display: flex;
  justify-content: space-between;
  margin: 0.5rem 0.5rem 0.2rem;
  font-size: 0.7rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--fb-muted);
}
.hit {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  padding: 0.4rem 0.5rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--fb-text);
  font: inherit;
  font-size: 0.88rem;
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
.see-all {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  width: 100%;
  margin-top: 0.3rem;
  padding: 0.5rem;
  border: 0;
  border-top: 1px solid var(--fb-border);
  background: transparent;
  color: var(--fb-accent);
  font: inherit;
  font-weight: 700;
  font-size: 0.85rem;
  cursor: pointer;
}
.empty {
  padding: 0.8rem;
  margin: 0;
  text-align: center;
}
@media (max-width: 720px) {
  .global-search {
    width: 2.4rem;
  }
  .global-search:focus-within {
    position: absolute;
    left: 0.5rem;
    right: 0.5rem;
    width: auto;
  }
  .hint {
    display: none;
  }
  .panel {
    width: 100%;
  }
}
</style>
