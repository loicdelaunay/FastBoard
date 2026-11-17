<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Button from 'primevue/button';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import { AI_LIMITS } from '@shared/ai';
import { api } from '@/api';
import { t } from '@/i18n';
import { useAppStore } from '@/stores/app';
import { useDocsStore } from '@/stores/docs';
import { useProjectStore } from '@/stores/project';
import { useProjectsStore } from '@/stores/projects';
import type { AiContextEntry } from '@/stores/ai';
import { ticketKey } from '@/utils/tickets';

/**
 * Choix du contexte de l'assistant : ce qui y est, des suggestions (page ouverte, éléments parents, éléments en
 * lien) et une recherche dans les projets, les tickets et la documentation.
 */
const props = defineProps<{
  entries: AiContextEntry[];
  /** Contexte de la page ouverte. */
  pageEntries: AiContextEntry[];
  /** Le contexte a été choisi à la main. */
  manual: boolean;
}>();
const emit = defineEmits<{ change: [entries: AiContextEntry[]]; reset: [] }>();

const app = useAppStore();
const docs = useDocsStore();
const project = useProjectStore();
const projects = useProjectsStore();

// Noms des projets parents, même hors d'un projet.
onMounted(() => {
  if (!projects.loaded) void projects.fetch().catch(() => undefined);
});

const ICONS: Record<AiContextEntry['kind'], string> = { project: 'pi pi-folder', ticket: 'pi pi-ticket', space: 'pi pi-book', note: 'pi pi-file', board: 'pi pi-objects-column' };
const keyOf = (entry: Pick<AiContextEntry, 'kind' | 'id'>): string => `${entry.kind}:${entry.id}`;
const present = computed(() => new Set(props.entries.map(keyOf)));
const full = computed(() => props.entries.length >= AI_LIMITS.contextItems);

function add(entry: AiContextEntry): void {
  if (present.value.has(keyOf(entry)) || full.value) return;
  emit('change', [...props.entries, entry]);
}

function remove(entry: AiContextEntry): void {
  emit('change', props.entries.filter((other) => keyOf(other) !== keyOf(entry)));
}

// --- Suggestions ---
const linked = ref<AiContextEntry[]>([]);
const loadingLinks = ref(false);

function spaceName(spaceId: number): string {
  return (docs.space?.id === spaceId ? docs.space.name : docs.spaces.find((space) => space.id === spaceId)?.name) ?? t('Espace de documentation');
}

function projectName(projectId: number): string {
  return (project.project?.id === projectId ? project.project.name : projects.projects.find((entry) => entry.id === projectId)?.name) ?? t('Projet');
}

/** Ticket connu du projet ouvert, prêt à entrer dans le contexte. */
function ticketEntry(ticketId: number, detail: string): AiContextEntry | null {
  const ticket = project.ticketsById.get(ticketId);
  return ticket ? { kind: 'ticket', id: ticket.id, label: `${ticketKey(project.project, ticket)} — ${ticket.title}`, parentId: ticket.projectId, detail } : null;
}

/** Parents des éléments du contexte (et de la page ouverte) : espace d'une note, projet et ticket parent d'un ticket. */
const parents = computed<AiContextEntry[]>(() => {
  const result: AiContextEntry[] = [];
  for (const entry of [...props.entries, ...props.pageEntries]) {
    if (entry.kind === 'note' && entry.parentId) result.push({ kind: 'space', id: entry.parentId, label: spaceName(entry.parentId), detail: t('Espace de la note') });
    if (entry.kind === 'ticket') {
      if (entry.parentId) result.push({ kind: 'project', id: entry.parentId, label: projectName(entry.parentId), detail: t('Projet du ticket') });
      const parentId = project.ticketsById.get(entry.id)?.parentId;
      const parent = parentId ? ticketEntry(parentId, t('Ticket parent')) : null;
      if (parent) result.push(parent);
    }
  }
  return result;
});

/** Notes et tickets liés : liens et rétroliens d'une note, sous-tickets et dépendances d'un ticket. */
async function loadLinked(): Promise<void> {
  const seeds = [...props.entries, ...props.pageEntries];
  const result: AiContextEntry[] = [];
  for (const entry of seeds) {
    if (entry.kind !== 'ticket') continue;
    for (const child of project.childrenOf(entry.id)) {
      const item = ticketEntry(child.id, t('Sous-ticket'));
      if (item) result.push(item);
    }
    for (const link of project.linksOf(entry.id)) {
      const item = ticketEntry(link.other.id, t('Dépendance'));
      if (item) result.push(item);
    }
  }
  const notes = seeds.filter((entry) => entry.kind === 'note');
  if (notes.length && app.info.docs) {
    loadingLinks.value = true;
    try {
      for (const note of notes.slice(0, 3)) {
        const links = await api.docLinks(note.id).catch(() => null);
        if (!links) continue;
        const toNote = (detail: string) => (item: { id: number; spaceId: number; title: string; spaceName: string }): AiContextEntry => ({ kind: 'note', id: item.id, label: item.title, parentId: item.spaceId, detail });
        const toTicket = (detail: string) => (item: { id: number; projectId: number; key: string; title: string }): AiContextEntry => ({ kind: 'ticket', id: item.id, label: `${item.key} — ${item.title}`, parentId: item.projectId, detail });
        result.push(
          ...links.outgoing.notes.map(toNote(t('Citée par la note'))),
          ...links.backlinks.notes.map(toNote(t('Cite la note'))),
          ...links.outgoing.tickets.map(toTicket(t('Cité par la note'))),
          ...links.backlinks.tickets.map(toTicket(t('Cite la note'))),
        );
      }
    } finally {
      loadingLinks.value = false;
    }
  }
  linked.value = result;
}

const seedKey = computed(() => [...props.entries, ...props.pageEntries].map(keyOf).join());
watch(seedKey, () => void loadLinked(), { immediate: true });

/** Groupes de suggestions, sans doublon ni élément déjà présent. */
const groups = computed(() => {
  const seen = new Set(present.value);
  const pick = (entries: AiContextEntry[]): AiContextEntry[] =>
    entries.filter((entry) => {
      const key = keyOf(entry);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return [
    { title: t('Page ouverte'), entries: pick(props.pageEntries) },
    { title: t('Éléments parents'), entries: pick(parents.value) },
    { title: t('En lien'), entries: pick(linked.value).slice(0, 12) },
  ].filter((group) => group.entries.length);
});

// --- Recherche ---
const query = ref('');
const results = ref<AiContextEntry[]>([]);
const searching = ref(false);
let timer = 0;
let request = 0;

watch(query, (value) => {
  window.clearTimeout(timer);
  const text = value.trim();
  if (!text) {
    results.value = [];
    searching.value = false;
    return;
  }
  searching.value = true;
  timer = window.setTimeout(() => void search(text), 250);
});

async function search(text: string): Promise<void> {
  const id = ++request;
  const [found, files] = await Promise.all([
    api.search(text, { type: ['projects', 'tickets'], limit: 6 }).catch(() => null),
    app.info.docs ? api.docSearch(text).catch(() => null) : Promise.resolve(null),
  ]);
  if (id !== request) return;
  const lower = text.toLocaleLowerCase();
  results.value = [
    ...(found?.projects.items ?? []).map((item): AiContextEntry => ({ kind: 'project', id: item.id, label: item.name, detail: item.key })),
    ...(found?.tickets.items ?? []).map((item): AiContextEntry => ({ kind: 'ticket', id: item.id, label: `${item.key} — ${item.title}`, parentId: item.projectId, detail: item.projectName })),
    ...docs.spaces.filter((space) => space.name.toLocaleLowerCase().includes(lower)).slice(0, 4).map((space): AiContextEntry => ({ kind: 'space', id: space.id, label: space.name, detail: t('Espace de documentation') })),
    ...(files?.files ?? []).slice(0, 6).map((item): AiContextEntry => ({ kind: 'note', id: item.id, label: item.title, parentId: item.spaceId, detail: `${item.spaceName} · ${item.path}` })),
  ];
  searching.value = false;
}

onBeforeUnmount(() => window.clearTimeout(timer));

const root = ref<HTMLElement | null>(null);
defineExpose({ focus: () => root.value?.querySelector('input')?.focus() });
</script>

<template>
  <div ref="root" class="picker">
    <IconField>
      <InputIcon :class="searching ? 'pi pi-spin pi-spinner' : 'pi pi-search'" />
      <InputText v-model="query" size="small" fluid :placeholder="$t('Chercher un projet, un ticket ou une note…')" :aria-label="$t('Chercher un élément à ajouter au contexte')" />
    </IconField>

    <template v-if="query.trim()">
      <p v-if="!searching && !results.length" class="muted small empty">{{ $t('Aucun résultat') }}</p>
      <ul v-else class="list">
        <li v-for="entry in results" :key="`r${entry.kind}${entry.id}`">
          <button type="button" class="row" :disabled="present.has(keyOf(entry)) || full" @click="add(entry)">
            <i :class="ICONS[entry.kind]" class="row-icon"></i>
            <span class="row-text">
              <span class="truncate">{{ entry.label }}</span>
              <small v-if="entry.detail" class="muted truncate">{{ entry.detail }}</small>
            </span>
            <i :class="present.has(keyOf(entry)) ? 'pi pi-check' : 'pi pi-plus'" class="row-action"></i>
          </button>
        </li>
      </ul>
    </template>

    <template v-else>
      <h4 class="title">{{ $t('Dans le contexte') }}</h4>
      <p v-if="!entries.length" class="muted small empty">{{ $t('Rien : l’assistant cherche dans tous vos projets et toute la documentation.') }}</p>
      <ul v-else class="list">
        <li v-for="entry in entries" :key="`c${entry.kind}${entry.id}`">
          <div class="row current">
            <i :class="ICONS[entry.kind]" class="row-icon"></i>
            <span class="row-text">
              <span class="truncate">{{ entry.label }}</span>
              <small v-if="entry.detail" class="muted truncate">{{ entry.detail }}</small>
            </span>
            <button v-tooltip.left="$t('Retirer du contexte')" type="button" class="row-remove" :aria-label="$t('Retirer du contexte')" @click="remove(entry)"><i class="pi pi-times"></i></button>
          </div>
        </li>
      </ul>

      <template v-for="group in groups" :key="group.title">
        <h4 class="title">{{ group.title }}</h4>
        <ul class="list">
          <li v-for="entry in group.entries" :key="`s${entry.kind}${entry.id}`">
            <button type="button" class="row" :disabled="full" @click="add(entry)">
              <i :class="ICONS[entry.kind]" class="row-icon"></i>
              <span class="row-text">
                <span class="truncate">{{ entry.label }}</span>
                <small v-if="entry.detail" class="muted truncate">{{ entry.detail }}</small>
              </span>
              <i class="pi pi-plus row-action"></i>
            </button>
          </li>
        </ul>
      </template>
      <p v-if="loadingLinks" class="muted small empty"><i class="pi pi-spin pi-spinner"></i> {{ $t('Recherche des éléments en lien…') }}</p>
    </template>

    <footer class="foot">
      <Button v-if="manual" :label="$t('Suivre la page')" icon="pi pi-replay" size="small" text @click="emit('reset')" />
      <Button v-if="entries.length" :label="$t('Tout retirer')" icon="pi pi-times" size="small" severity="secondary" text @click="emit('change', [])" />
    </footer>
  </div>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  width: min(24rem, calc(100vw - 2rem));
  max-height: min(30rem, 70vh);
  overflow-y: auto;
}
.title {
  margin: 0.45rem 0 0.1rem;
  color: var(--fb-muted);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
  padding: 0.35rem 0.5rem;
  border: 0;
  border-radius: 7px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
}
button.row {
  cursor: pointer;
}
button.row:hover:not(:disabled),
button.row:focus-visible {
  background: var(--fb-panel-alt);
}
button.row:disabled {
  opacity: 0.55;
  cursor: default;
}
.row.current {
  background: color-mix(in srgb, #a95cff 9%, transparent);
}
.row-icon {
  flex: none;
  color: var(--fb-muted);
  font-size: 0.85rem;
}
.row-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  font-size: 0.85rem;
}
.row-text small {
  font-size: 0.72rem;
}
.row-action {
  flex: none;
  color: var(--fb-muted);
  font-size: 0.75rem;
}
.row-remove {
  display: grid;
  place-items: center;
  flex: none;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: none;
  color: var(--fb-muted);
  font-size: 0.7rem;
  cursor: pointer;
}
.row-remove:hover {
  background: color-mix(in srgb, var(--fb-text) 10%, transparent);
  color: var(--fb-text);
}
.empty {
  margin: 0.2rem 0.5rem;
}
.foot {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.25rem;
  margin-top: 0.25rem;
  padding-top: 0.35rem;
  border-top: 1px solid var(--fb-border);
}
.foot:empty {
  display: none;
}
</style>
