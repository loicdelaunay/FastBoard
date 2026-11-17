<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from 'primevue/button';
import { docBaseName, docParent, docTitle, type DocNodeDTO, type WikiDTO, type WikiPageDTO, type WikiSearchHitDTO } from '@shared/docs';
import { headingKey } from '@shared/docLinks';
import { docOutline } from '@shared/docOutline';
import { api } from '@/api';
import { ApiError } from '@/api/http';
import { t } from '@/i18n';
import { useAppStore } from '@/stores/app';
import { useAuthStore } from '@/stores/auth';
import { copyText, finishDocHtml, hydrateEmbeds, pendingAnchor, prepareDocText, scrollToHeading } from '@/utils/docRender';
import { formatRelative } from '@/utils/format';
import { zoomImageOnClick } from '@/utils/lightbox';
import { escapeHtml, renderMarkdown, renderMermaid, type MentionResolver } from '@/utils/markdown';

/**
 * Site web d'un espace de documentation, à la manière de Docusaurus : page d'accueil, barre latérale par sections,
 * recherche (Ctrl K), sommaire qui suit la lecture, pages précédente et suivante, thème clair ou sombre.
 */
const route = useRoute();
const router = useRouter();
const app = useAppStore();
const auth = useAuthStore();

const slug = computed(() => String(route.params.slug));
const wiki = ref<WikiDTO | null>(null);
const page = ref<WikiPageDTO | null>(null);
const failure = ref<'login' | 'forbidden' | 'missing' | null>(null);
const loading = ref(true);
const drawer = ref(false);
const article = ref<HTMLElement | null>(null);
const scroller = ref<HTMLElement | null>(null);

// --- Arbre du site ---
type WikiNode = DocNodeDTO;
interface Section {
  path: string;
  name: string;
  notes: WikiNode[];
  folders: Section[];
}

/** Les fichiers du site, au format de la documentation (pour les liens et les images). */
const nodes = computed<WikiNode[]>(() =>
  (wiki.value?.nodes ?? []).map((node) => ({ ...node, spaceId: 0, size: 0, updatedAt: '', updatedBy: null, deletedAt: null, memo: '' })),
);
const notes = computed(() => nodes.value.filter((node) => node.kind === 'markdown'));
/** Page d'entrée : une note « Accueil », « Index » ou « README » à la racine. */
const home = computed(() => notes.value.find((node) => !node.path.includes('/') && /^(accueil|index|readme|home)\.md$/i.test(node.path)) ?? null);

const byTitle = (a: WikiNode, b: WikiNode): number => docTitle(a.path).localeCompare(docTitle(b.path), undefined, { sensitivity: 'base', numeric: true });
const tree = computed<Section>(() => {
  const root: Section = { path: '', name: '', notes: [], folders: [] };
  const sections = new Map<string, Section>([['', root]]);
  const ensure = (path: string): Section => {
    const known = sections.get(path);
    if (known) return known;
    const section: Section = { path, name: docBaseName(path), notes: [], folders: [] };
    ensure(docParent(path)).folders.push(section);
    sections.set(path, section);
    return section;
  };
  for (const node of nodes.value) {
    if (node.kind === 'folder') ensure(node.path);
    else if (node.kind === 'markdown') ensure(docParent(node.path)).notes.push(node);
  }
  // Un dossier sans page (images seulement, ou vide) n'a pas sa place dans le menu.
  const hasNotes = (section: Section): boolean => section.notes.length > 0 || section.folders.some(hasNotes);
  for (const section of sections.values()) {
    section.notes.sort((a, b) => (a === home.value ? -1 : b === home.value ? 1 : byTitle(a, b)));
    section.folders = section.folders.filter(hasNotes).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  }
  return root;
});
const notesOf = (section: Section): WikiNode[] => [...section.notes, ...section.folders.flatMap(notesOf)];
/** Ordre de lecture : celui de la barre latérale. */
const ordered = computed(() => notesOf(tree.value));

const pageId = computed(() => {
  const value = Number(route.params.nodeId);
  return Number.isInteger(value) && value > 0 ? value : null;
});
const current = computed(() => nodes.value.find((node) => node.id === pageId.value) ?? null);
const position = computed(() => (current.value ? ordered.value.indexOf(current.value) : -1));
const previous = computed(() => (position.value > 0 ? ordered.value[position.value - 1] : null));
const next = computed(() => (position.value >= 0 ? (ordered.value[position.value + 1] ?? null) : null));
const firstPage = computed(() => home.value ?? ordered.value[0] ?? null);

// --- Barre latérale ---
/** Dossiers ouverts ou fermés à la main ; sinon, les sections du haut et celle de la page lue sont ouvertes. */
const toggled = ref(new Set<string>());
const openByDefault = (path: string, depth: number): boolean => depth === 0 || Boolean(current.value?.path.startsWith(`${path}/`));
const isOpen = (path: string, depth: number): boolean => toggled.value.has(path) !== openByDefault(path, depth);

interface Row {
  key: string;
  depth: number;
  note?: WikiNode;
  section?: Section;
  open?: boolean;
}
const rows = computed<Row[]>(() => {
  const list: Row[] = [];
  const walk = (section: Section, depth: number): void => {
    for (const note of section.notes) list.push({ key: `n${note.id}`, depth, note });
    for (const folder of section.folders) {
      const open = isOpen(folder.path, depth);
      list.push({ key: `f${folder.path}`, depth, section: folder, open });
      if (open) walk(folder, depth + 1);
    }
  };
  walk(tree.value, 0);
  return list;
});

function toggleFolder(path: string): void {
  const value = new Set(toggled.value);
  if (value.has(path)) value.delete(path);
  else value.add(path);
  toggled.value = value;
}

/** Sections de la page d'accueil et de la barre du haut. */
const sections = computed(() =>
  tree.value.folders.map((folder) => {
    const pages = notesOf(folder);
    return { folder, count: pages.length, first: pages[0] ?? null, samples: pages.slice(0, 3) };
  }),
);
const looseNotes = computed(() => tree.value.notes.filter((note) => note !== home.value));
const activeSection = computed(() => (current.value?.path.includes('/') ? current.value.path.split('/')[0] : null));

// --- Chargement ---
watch(
  slug,
  async (value) => {
    loading.value = true;
    failure.value = null;
    try {
      wiki.value = await api.wiki(value);
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 0;
      failure.value = status === 401 ? 'login' : status === 403 ? 'forbidden' : 'missing';
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

watch(
  [pageId, wiki],
  async ([id]) => {
    drawer.value = false;
    if (!wiki.value || id === null) {
      page.value = null;
      if (wiki.value) document.title = wiki.value.name;
      return;
    }
    try {
      page.value = await api.wikiPage(slug.value, id);
      document.title = `${docTitle(page.value.path)} · ${wiki.value.name}`;
    } catch {
      page.value = null;
    }
  },
  { immediate: true },
);

// --- Rendu ---
// Hors de l'espace, une mention de personne ou de ticket n'est qu'un nom.
const resolver: MentionResolver = { userName: () => undefined, ticketLabel: () => undefined };
const context = computed(() => ({ nodes: nodes.value, notePath: page.value?.path ?? '', users: [], obsidian: wiki.value?.obsidian ?? false, fileUrl: (nodeId: number) => `/api/wiki/${encodeURIComponent(slug.value)}/files/${nodeId}` }));
const html = computed(() => (page.value ? finishDocHtml(renderMarkdown(prepareDocText(page.value.content, context.value.obsidian), resolver, { obsidian: context.value.obsidian, boardPreviews: false }), context.value) : ''));
const headings = computed(() => (page.value ? docOutline(page.value.content) : []));
/** Une note qui commence par son propre titre ne le montre pas deux fois. */
const showTitle = computed(() => {
  const first = headings.value[0];
  return !(page.value && first && first.level === 1 && headingKey(first.title) === headingKey(docTitle(page.value.path)));
});
/** « Sur cette page » : les intertitres (niveaux 2 à 4), ou les titres si la note n'a que cela. */
const toc = computed(() => {
  const all = headings.value.map((heading, index) => ({ ...heading, index }));
  const inner = all.filter((heading) => heading.level >= 2 && heading.level <= 4);
  return inner.length ? inner : all.filter((heading) => heading.level === 1).slice(showTitle.value ? 0 : 1);
});
const activeHeading = ref(-1);
/** Entrée du sommaire à surligner : le dernier intertitre passé. */
const activeToc = computed(() => [...toc.value].reverse().find((heading) => heading.index <= activeHeading.value)?.index ?? -1);

/** Boutons « Copier » des blocs de code et liens d'ancre des intertitres. */
function decorate(root: HTMLElement): void {
  for (const pre of root.querySelectorAll<HTMLElement>('pre:not(.has-copy)')) {
    pre.classList.add('has-copy');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-copy';
    button.title = t('Copier le code');
    button.setAttribute('aria-label', t('Copier le code'));
    button.innerHTML = '<i class="pi pi-copy"></i>';
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      await copyText(pre.querySelector('code')?.textContent ?? '');
      button.innerHTML = '<i class="pi pi-check"></i>';
      button.classList.add('done');
      window.setTimeout(() => {
        button.innerHTML = '<i class="pi pi-copy"></i>';
        button.classList.remove('done');
      }, 1500);
    });
    pre.append(button);
  }
  for (const heading of root.querySelectorAll<HTMLElement>(':scope > :is(h2, h3, h4)')) {
    if (heading.querySelector('.hash-link')) continue;
    const link = document.createElement('a');
    link.className = 'hash-link';
    link.href = `#${encodeURIComponent(heading.textContent ?? '')}`;
    link.textContent = '#';
    link.title = t('Lien direct vers ce titre');
    heading.append(link);
  }
}

watch(html, async () => {
  await nextTick();
  const root = article.value;
  if (!root) {
    scroller.value?.scrollTo({ top: 0 });
    return;
  }
  decorate(root);
  void renderMermaid(root, document.documentElement.classList.contains('app-dark'));
  void hydrateEmbeds(root, context.value, async (nodeId) => (await api.wikiPage(slug.value, nodeId)).content);
  const anchor = pendingAnchor.value;
  const hash = route.hash ? decodeURIComponent(route.hash.slice(1)) : '';
  if (anchor && anchor.path === page.value?.path) {
    pendingAnchor.value = null;
    scrollToHeading(root, anchor.heading);
  } else if (hash) {
    scrollToHeading(root, hash);
  } else {
    scroller.value?.scrollTo({ top: 0 });
  }
  spy();
});

// Le sommaire suit la lecture.
let spyFrame = 0;
function spy(): void {
  cancelAnimationFrame(spyFrame);
  spyFrame = requestAnimationFrame(() => {
    const root = article.value;
    const box = scroller.value;
    if (!root || !box) return;
    const top = box.getBoundingClientRect().top + Math.min(160, box.clientHeight * 0.3);
    const elements = [...root.querySelectorAll<HTMLElement>(':scope > :is(h1, h2, h3, h4, h5, h6)')];
    let active = -1;
    elements.forEach((element, index) => {
      if (element.getBoundingClientRect().top <= top) active = index;
    });
    // En bas de page, le dernier titre est le bon même s'il n'atteint pas le haut.
    if (box.scrollTop + box.clientHeight >= box.scrollHeight - 4 && elements.length) active = elements.length - 1;
    activeHeading.value = active;
  });
}

function goToHeading(index: number): void {
  const elements = [...(article.value?.querySelectorAll<HTMLElement>(':scope > :is(h1, h2, h3, h4, h5, h6)') ?? [])];
  elements[index]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// --- Navigation ---
const pageHref = (node: WikiNode): string => router.resolve({ name: 'wiki', params: { slug: slug.value, nodeId: String(node.id) } }).href;
const homeHref = computed(() => router.resolve({ name: 'wiki', params: { slug: slug.value } }).href);
const editHref = computed(() =>
  wiki.value?.editSpaceId && current.value ? router.resolve({ name: 'doc-space', params: { spaceId: String(wiki.value.editSpaceId) }, query: { file: String(current.value.id) } }).href : null,
);

function open(node: WikiNode | null): void {
  if (node) void router.push({ name: 'wiki', params: { slug: slug.value, nodeId: String(node.id) } });
}

function goHome(): void {
  void router.push({ name: 'wiki', params: { slug: slug.value } });
}

/** Les liens entre notes restent dans le site ; les autres pages de l'application n'y ont pas cours. */
function onClick(event: MouseEvent): void {
  if (zoomImageOnClick(event)) return;
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a');
  if (!link) return;
  const href = link.getAttribute('href') ?? '';
  const root = article.value ?? document;
  if (link.classList.contains('hash-link')) {
    event.preventDefault();
    const heading = decodeURIComponent(href.slice(1));
    void router.replace({ hash: href });
    void copyText(window.location.href.split('#')[0] + href);
    scrollToHeading(root, heading);
    return;
  }
  if (link.dataset.fn || link.dataset.fnBack) {
    event.preventDefault();
    const selector = link.dataset.fn ? `[data-fn-def="${CSS.escape(link.dataset.fn)}"]` : `[data-fn-ref="${CSS.escape(link.dataset.fnBack!)}"]`;
    root.querySelector(selector)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  if (href.startsWith('#')) {
    event.preventDefault();
    scrollToHeading(root, decodeURIComponent(href.slice(1)));
    return;
  }
  const target = link.dataset.node ?? link.dataset.doc;
  if (target) {
    event.preventDefault();
    const node = nodes.value.find((entry) => entry.id === Number(target));
    if (!node) return;
    pendingAnchor.value = href.includes('#') && link.dataset.node ? { path: node.path, heading: decodeURIComponent(href.slice(href.indexOf('#') + 1)) } : null;
    open(node);
    return;
  }
  if (link.classList.contains('md-mention') || link.classList.contains('broken')) event.preventDefault();
}

function login(): void {
  void router.push({ name: 'login', query: { redirect: route.fullPath } });
}

// --- Thème clair ou sombre, propre au site ---
const THEME_KEY = 'fb.wiki.theme';
const appDark = document.documentElement.classList.contains('app-dark');
function storedTheme(): boolean | null {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'dark' ? true : value === 'light' ? false : null;
  } catch {
    return null;
  }
}
const dark = ref(storedTheme() ?? appDark);
function paint(value: boolean): void {
  document.documentElement.classList.toggle('app-dark', value);
  document.documentElement.style.colorScheme = value ? 'dark' : 'light';
}
watch(dark, (value) => {
  paint(value);
  try {
    localStorage.setItem(THEME_KEY, value ? 'dark' : 'light');
  } catch {
    // Stockage indisponible : le choix vaut pour cette visite.
  }
});

// --- Recherche ---
const searchOpen = ref(false);
const query = ref('');
const results = ref<WikiSearchHitDTO[]>([]);
const searching = ref(false);
const selectedResult = ref(0);
const searchInput = ref<HTMLInputElement | null>(null);
let searchTimer = 0;
let searchRequest = 0;

async function openSearch(): Promise<void> {
  searchOpen.value = true;
  await nextTick();
  searchInput.value?.focus();
  searchInput.value?.select();
}

watch(query, (value) => {
  window.clearTimeout(searchTimer);
  const text = value.trim();
  if (!text) {
    results.value = [];
    searching.value = false;
    return;
  }
  searching.value = true;
  searchTimer = window.setTimeout(async () => {
    const id = ++searchRequest;
    const found = await api.wikiSearch(slug.value, text).catch(() => null);
    if (id !== searchRequest) return;
    results.value = found?.results ?? [];
    selectedResult.value = 0;
    searching.value = false;
  }, 180);
});

function pick(hit: WikiSearchHitDTO): void {
  searchOpen.value = false;
  open(nodes.value.find((node) => node.id === hit.id) ?? null);
}

function onSearchKey(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const count = results.value.length;
    if (count) selectedResult.value = (selectedResult.value + (event.key === 'ArrowDown' ? 1 : count - 1)) % count;
  } else if (event.key === 'Enter') {
    const hit = results.value[selectedResult.value];
    if (hit) pick(hit);
  } else if (event.key === 'Escape') {
    searchOpen.value = false;
  }
}

/** Texte replié (casse et accents) caractère par caractère, pour surligner la recherche dans un extrait. */
const fold = (char: string): string => char.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function highlight(text: string): string {
  const needle = [...query.value.trim()].map(fold).join('');
  const chars = [...text];
  const folded = chars.map(fold);
  if (!needle || folded.some((char) => char.length !== 1)) return escapeHtml(text);
  const index = folded.join('').indexOf(needle);
  if (index < 0) return escapeHtml(text);
  const end = index + [...needle].length;
  return `${escapeHtml(chars.slice(0, index).join(''))}<mark>${escapeHtml(chars.slice(index, end).join(''))}</mark>${escapeHtml(chars.slice(end).join(''))}`;
}

function onKey(event: KeyboardEvent): void {
  const typing = (event.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"]');
  if (((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') || (event.key === '/' && !typing)) {
    event.preventDefault();
    void openSearch();
  }
}

onMounted(() => {
  paint(dark.value);
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  window.clearTimeout(searchTimer);
  cancelAnimationFrame(spyFrame);
  paint(appDark);
});
</script>

<template>
  <div class="wiki">
    <header class="bar">
      <button v-if="wiki" type="button" class="icon-button menu" :aria-label="$t('Pages')" :aria-expanded="drawer" @click="drawer = !drawer"><i class="pi pi-bars"></i></button>
      <a :href="homeHref" class="brand" @click.prevent="goHome">
        <img :src="app.logoUrl" alt="" width="28" height="28" />
        <span class="truncate">{{ wiki?.name ?? app.name }}</span>
      </a>
      <nav v-if="wiki && sections.length" class="top-links" :aria-label="$t('Sections')">
        <a v-for="entry in sections.slice(0, 4)" :key="entry.folder.path" :href="entry.first ? pageHref(entry.first) : homeHref" class="top-link" :class="{ active: activeSection === entry.folder.path }" @click.prevent="open(entry.first)">{{ entry.folder.name }}</a>
      </nav>
      <span class="spacer"></span>
      <button v-if="wiki" type="button" class="search-button" @click="openSearch">
        <i class="pi pi-search"></i>
        <span class="search-label">{{ $t('Rechercher') }}</span>
        <kbd>Ctrl K</kbd>
      </button>
      <button type="button" class="icon-button" :aria-label="dark ? $t('Thème clair') : $t('Thème sombre')" :title="dark ? $t('Thème clair') : $t('Thème sombre')" @click="dark = !dark">
        <i :class="dark ? 'pi pi-sun' : 'pi pi-moon'"></i>
      </button>
      <a v-if="auth.isAuthenticated" href="/" class="icon-button" :title="$t('Retour à {name}', { name: app.name })" :aria-label="$t('Retour à {name}', { name: app.name })"><i class="pi pi-th-large"></i></a>
    </header>

    <div ref="scroller" class="scroller" @scroll.passive="spy">
      <div v-if="loading" class="state muted"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</div>
      <div v-else-if="failure" class="state">
        <i :class="failure === 'login' ? 'pi pi-lock' : failure === 'forbidden' ? 'pi pi-ban' : 'pi pi-question-circle'" class="state-icon"></i>
        <h2>{{ failure === 'login' ? $t('Connectez-vous pour lire ce site') : failure === 'forbidden' ? $t('Ce site n’est pas partagé avec vous') : $t('Site introuvable') }}</h2>
        <p class="muted">{{ failure === 'login' ? $t('Il est réservé à des personnes de {name}.', { name: app.name }) : failure === 'forbidden' ? $t('Demandez l’accès à un propriétaire de l’espace.') : $t('L’adresse est peut-être erronée, ou le site a été désactivé.') }}</p>
        <Button v-if="failure === 'login'" :label="$t('Se connecter')" icon="pi pi-sign-in" @click="login" />
      </div>

      <!-- Page d'accueil -->
      <div v-else-if="wiki && pageId === null" class="landing">
        <section class="hero">
          <div class="hero-inner">
            <p class="eyebrow"><i class="pi pi-book"></i> {{ $t('Documentation') }}</p>
            <h1>{{ wiki.name }}</h1>
            <p class="tagline">{{ wiki.description || $t('Tout ce qu’il faut savoir, rangé et à jour.') }}</p>
            <div class="hero-actions">
              <Button v-if="firstPage" :label="$t('Commencer la lecture')" icon="pi pi-arrow-right" icon-pos="right" size="large" @click="open(firstPage)" />
              <Button :label="$t('Rechercher')" icon="pi pi-search" severity="secondary" outlined size="large" @click="openSearch" />
            </div>
            <p class="muted small stats">{{ $t('{n} page|{n} pages', { n: notes.length }) }} · {{ $t('Mis à jour {when}', { when: formatRelative(wiki.updatedAt) }) }}</p>
          </div>
        </section>
        <section v-if="sections.length || looseNotes.length" class="cards">
          <a v-for="entry in sections" :key="entry.folder.path" :href="entry.first ? pageHref(entry.first) : homeHref" class="card" @click.prevent="open(entry.first)">
            <span class="card-icon"><i class="pi pi-folder-open"></i></span>
            <strong class="card-title">{{ entry.folder.name }}</strong>
            <span class="muted small">{{ $t('{n} page|{n} pages', { n: entry.count }) }}</span>
            <ul class="card-pages">
              <li v-for="note in entry.samples" :key="note.id" class="truncate">{{ docTitle(note.path) }}</li>
            </ul>
            <span class="card-more">{{ $t('Parcourir') }} <i class="pi pi-arrow-right"></i></span>
          </a>
          <div v-if="looseNotes.length" class="card loose">
            <span class="card-icon"><i class="pi pi-file"></i></span>
            <strong class="card-title">{{ $t('Pages') }}</strong>
            <ul class="card-pages links">
              <li v-for="note in looseNotes.slice(0, 6)" :key="note.id">
                <a :href="pageHref(note)" class="truncate" @click.prevent="open(note)">{{ docTitle(note.path) }}</a>
              </li>
            </ul>
          </div>
        </section>
        <p v-if="!notes.length" class="state muted">{{ $t('Ce site n’a encore aucune page.') }}</p>
        <footer class="footer muted small">{{ $t('Propulsé par {name}', { name: app.name }) }}</footer>
      </div>

      <!-- Page de documentation -->
      <div v-else-if="wiki" class="docs">
        <div v-if="drawer" class="backdrop" @click="drawer = false"></div>
        <nav class="sidebar" :class="{ open: drawer }" :aria-label="$t('Pages')">
          <ul class="menu-list">
            <li v-for="row in rows" :key="row.key" :style="{ '--depth': row.depth }">
              <button v-if="row.section" type="button" class="menu-item folder" :class="{ category: row.depth === 0, current: activeSection === row.section.path }" :aria-expanded="row.open" @click="toggleFolder(row.section.path)">
                <span class="truncate">{{ row.section.name }}</span>
                <i class="pi chevron" :class="row.open ? 'pi-chevron-down' : 'pi-chevron-right'"></i>
              </button>
              <a v-else-if="row.note" :href="pageHref(row.note)" class="menu-item" :class="{ active: row.note.id === pageId }" :aria-current="row.note.id === pageId ? 'page' : undefined" @click.prevent="open(row.note)">
                <span class="truncate">{{ docTitle(row.note.path) }}</span>
              </a>
            </li>
          </ul>
        </nav>

        <main class="main">
          <article v-if="page && current" class="doc">
            <nav class="crumbs" :aria-label="$t('Fil d’Ariane')">
              <a :href="homeHref" class="crumb home" :aria-label="$t('Accueil')" @click.prevent="goHome"><i class="pi pi-home"></i></a>
              <template v-for="(part, index) in docParent(page.path) ? docParent(page.path).split('/') : []" :key="index">
                <i class="pi pi-angle-right sep"></i>
                <span class="crumb">{{ part }}</span>
              </template>
              <i class="pi pi-angle-right sep"></i>
              <span class="crumb last">{{ docTitle(page.path) }}</span>
            </nav>
            <h1 v-if="showTitle" class="title">{{ docTitle(page.path) }}</h1>
            <!-- eslint-disable-next-line vue/no-v-html -- HTML assaini par DOMPurify dans renderMarkdown. -->
            <div ref="article" class="markdown content" @click="onClick" v-html="html"></div>

            <div class="meta">
              <a v-if="editHref" :href="editHref" class="edit"><i class="pi pi-pencil"></i> {{ $t('Modifier cette page') }}</a>
              <span class="muted small">{{ $t('Mis à jour {when}', { when: formatRelative(page.updatedAt) }) }}</span>
            </div>

            <nav v-if="previous || next" class="pager" :aria-label="$t('Pages voisines')">
              <a v-if="previous" :href="pageHref(previous)" class="pager-card" @click.prevent="open(previous)">
                <small class="muted">{{ $t('Précédent') }}</small>
                <strong><i class="pi pi-angle-double-left"></i> {{ docTitle(previous.path) }}</strong>
              </a>
              <span v-else></span>
              <a v-if="next" :href="pageHref(next)" class="pager-card next" @click.prevent="open(next)">
                <small class="muted">{{ $t('Suivant') }}</small>
                <strong>{{ docTitle(next.path) }} <i class="pi pi-angle-double-right"></i></strong>
              </a>
            </nav>
          </article>
          <div v-else class="state muted">
            <i class="pi pi-book state-icon"></i>
            <p>{{ $t('Page introuvable') }}</p>
          </div>
          <footer class="footer muted small">{{ $t('Propulsé par {name}', { name: app.name }) }}</footer>
        </main>

        <aside v-if="toc.length > 1" class="toc">
          <p class="toc-title">{{ $t('Sur cette page') }}</p>
          <ul>
            <li v-for="heading in toc" :key="heading.index" :class="[`level-${heading.level}`, { active: heading.index === activeToc }]">
              <a :href="`#${encodeURIComponent(heading.title)}`" @click.prevent="goToHeading(heading.index)">{{ heading.title }}</a>
            </li>
          </ul>
        </aside>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="searchOpen" class="wiki-search-overlay" @mousedown.self="searchOpen = false">
        <div class="wiki-search" role="dialog" aria-modal="true" :aria-label="$t('Rechercher')">
          <div class="search-field">
            <i :class="searching ? 'pi pi-spin pi-spinner' : 'pi pi-search'"></i>
            <input ref="searchInput" v-model="query" type="search" :placeholder="$t('Rechercher dans {name}…', { name: wiki?.name ?? '' })" :aria-label="$t('Rechercher')" @keydown="onSearchKey" />
            <kbd>Échap</kbd>
          </div>
          <ul v-if="results.length" class="search-results">
            <li v-for="(hit, index) in results" :key="hit.id">
              <button type="button" class="search-hit" :class="{ selected: index === selectedResult }" @mouseenter="selectedResult = index" @click="pick(hit)">
                <i class="pi pi-file hit-icon"></i>
                <span class="hit-text">
                  <!-- eslint-disable-next-line vue/no-v-html -- texte échappé par highlight(). -->
                  <strong v-html="highlight(hit.title)"></strong>
                  <small v-if="docParent(hit.path)" class="muted">{{ docParent(hit.path).replaceAll('/', ' › ') }}</small>
                  <!-- eslint-disable-next-line vue/no-v-html -- texte échappé par highlight(). -->
                  <span v-if="hit.excerpt" class="hit-excerpt" v-html="highlight(hit.excerpt)"></span>
                </span>
                <i class="pi pi-arrow-right hit-go"></i>
              </button>
            </li>
          </ul>
          <p v-else class="search-empty muted">{{ query.trim() ? (searching ? $t('Recherche…') : $t('Aucun résultat pour « {query} »', { query: query.trim() })) : $t('Tapez pour chercher dans les titres et le texte des pages.') }}</p>
          <footer class="search-help muted">
            <span><kbd>↑</kbd><kbd>↓</kbd> {{ $t('pour choisir') }}</span>
            <span><kbd>↵</kbd> {{ $t('pour ouvrir') }}</span>
          </footer>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.wiki {
  --bar: 3.75rem;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  height: 100dvh;
  background: var(--fb-panel);
  color: var(--fb-text);
}

/* Barre du haut */
.bar {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  height: var(--bar);
  flex: none;
  padding: 0 1.25rem;
  border-bottom: 1px solid var(--fb-border);
  background: color-mix(in srgb, var(--fb-panel) 88%, transparent);
  backdrop-filter: saturate(1.6) blur(10px);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.04);
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
  color: var(--fb-text);
  font-size: 1.08rem;
  font-weight: 700;
  text-decoration: none;
}
.brand img {
  flex: none;
  border-radius: 7px;
  object-fit: contain;
}
.top-links {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  margin-left: 0.75rem;
}
.top-link {
  padding: 0.35rem 0.7rem;
  border-radius: 7px;
  color: var(--fb-text);
  font-size: 0.92rem;
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
}
.top-link:hover {
  background: var(--fb-panel-alt);
}
.top-link.active {
  color: var(--fb-accent);
  font-weight: 600;
}
.spacer {
  flex: 1;
}
.search-button {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 13rem;
  height: 2.3rem;
  padding: 0 0.5rem 0 0.8rem;
  border: 1px solid var(--fb-border);
  border-radius: 999px;
  background: var(--fb-panel-alt);
  color: var(--fb-muted);
  font: inherit;
  font-size: 0.9rem;
  cursor: pointer;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}
.search-button:hover {
  border-color: var(--fb-accent);
  box-shadow: 0 0 0 3px var(--fb-accent-soft);
}
.search-label {
  flex: 1;
  text-align: left;
}
kbd {
  padding: 0.1rem 0.4rem;
  border: 1px solid var(--fb-border);
  border-bottom-width: 2px;
  border-radius: 5px;
  background: var(--fb-panel);
  color: var(--fb-muted);
  font-family: inherit;
  font-size: 0.7rem;
  font-weight: 600;
}
.icon-button {
  display: inline-grid;
  place-items: center;
  width: 2.3rem;
  height: 2.3rem;
  flex: none;
  border: 0;
  border-radius: 999px;
  background: none;
  color: var(--fb-text);
  font-size: 1rem;
  text-decoration: none;
  cursor: pointer;
}
.icon-button:hover {
  background: var(--fb-panel-alt);
}
.icon-button.menu {
  display: none;
}

.scroller {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scroll-behavior: smooth;
}

/* États */
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  margin: auto;
  padding: 4rem 1rem;
  text-align: center;
}
.state h2,
.state p {
  margin: 0;
}
.state-icon {
  color: var(--fb-accent);
  font-size: 2.2rem;
}

/* Page d'accueil */
.hero {
  position: relative;
  overflow: hidden;
  padding: 5.5rem 1.5rem 4.5rem;
  border-bottom: 1px solid var(--fb-border);
  background:
    radial-gradient(60rem 26rem at 15% -10%, color-mix(in srgb, var(--fb-accent) 22%, transparent), transparent 70%),
    radial-gradient(40rem 22rem at 95% 10%, color-mix(in srgb, #a95cff 18%, transparent), transparent 70%),
    var(--fb-bg);
  text-align: center;
}
.hero::before {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(color-mix(in srgb, var(--fb-text) 9%, transparent) 1px, transparent 1px);
  background-size: 22px 22px;
  content: '';
  mask-image: linear-gradient(to bottom, #000, transparent 85%);
  pointer-events: none;
}
.hero-inner {
  position: relative;
  max-width: 46rem;
  margin: 0 auto;
}
.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0 1rem;
  padding: 0.25rem 0.75rem;
  border: 1px solid color-mix(in srgb, var(--fb-accent) 35%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--fb-panel) 70%, transparent);
  color: var(--fb-accent);
  font-size: 0.8rem;
  font-weight: 600;
}
.hero h1 {
  margin: 0;
  background: linear-gradient(120deg, var(--fb-text) 30%, var(--fb-accent) 75%, #a95cff);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-size: clamp(2.2rem, 5vw, 3.4rem);
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.1;
}
.tagline {
  max-width: 36rem;
  margin: 1.1rem auto 0;
  color: var(--fb-muted);
  font-size: 1.2rem;
  line-height: 1.55;
}
.hero-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.75rem;
  margin-top: 2rem;
}
.stats {
  margin: 1.5rem 0 0;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
  gap: 1.1rem;
  max-width: 72rem;
  margin: 0 auto;
  padding: 3rem 1.5rem 1rem;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 1.25rem 1.3rem;
  border: 1px solid var(--fb-border);
  border-radius: 14px;
  background: var(--fb-panel);
  color: var(--fb-text);
  text-decoration: none;
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease,
    border-color 0.15s ease;
}
a.card:hover {
  border-color: color-mix(in srgb, var(--fb-accent) 45%, var(--fb-border));
  box-shadow: 0 12px 28px -12px color-mix(in srgb, var(--fb-accent) 40%, transparent);
  transform: translateY(-2px);
}
.card-icon {
  display: grid;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  margin-bottom: 0.4rem;
  border-radius: 10px;
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
  font-size: 1.1rem;
}
.card-title {
  font-size: 1.08rem;
}
.card-pages {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin: 0.5rem 0 0;
  padding: 0;
  color: var(--fb-muted);
  font-size: 0.86rem;
  list-style: none;
}
.card-pages li::before {
  margin-right: 0.4rem;
  color: var(--fb-accent);
  content: '›';
}
.card-pages.links a {
  color: var(--fb-text);
  text-decoration: none;
}
.card-pages.links a:hover {
  color: var(--fb-accent);
}
.card-more {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-top: auto;
  padding-top: 0.75rem;
  color: var(--fb-accent);
  font-size: 0.86rem;
  font-weight: 600;
}
.card-more .pi {
  font-size: 0.75rem;
  transition: transform 0.15s;
}
a.card:hover .card-more .pi {
  transform: translateX(3px);
}

/* Pages de documentation */
.docs {
  display: grid;
  grid-template-columns: 17.5rem minmax(0, 1fr) 15rem;
  align-items: start;
  max-width: 96rem;
  min-height: 100%;
  margin: 0 auto;
}
.sidebar {
  position: sticky;
  top: 0;
  height: calc(100dvh - var(--bar));
  overflow-y: auto;
  padding: 1.25rem 0.75rem 2rem;
  border-right: 1px solid var(--fb-border);
}
.menu-list {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.menu-list li {
  padding-left: calc(var(--depth) * 0.85rem);
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  padding: 0.38rem 0.7rem;
  border: 0;
  border-radius: 7px;
  background: none;
  color: var(--fb-text);
  font: inherit;
  font-size: 0.92rem;
  line-height: 1.35;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
}
.menu-item:hover {
  background: var(--fb-panel-alt);
}
.menu-item.active {
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
  font-weight: 600;
}
.menu-item.folder {
  justify-content: space-between;
  color: var(--fb-text);
  font-weight: 500;
}
.menu-item.category {
  margin-top: 0.6rem;
  font-weight: 700;
}
.menu-item.current {
  color: var(--fb-accent);
}
.chevron {
  color: var(--fb-muted);
  font-size: 0.65rem;
}
.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: calc(100dvh - var(--bar));
  padding: 2rem 2.5rem 0;
}
.doc {
  width: 100%;
  max-width: 50rem;
  margin: 0 auto;
}
.crumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: 1.25rem;
  font-size: 0.82rem;
}
.crumb {
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  color: var(--fb-muted);
  text-decoration: none;
}
.crumb.home:hover {
  background: var(--fb-panel-alt);
  color: var(--fb-accent);
}
.crumb.last {
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
  font-weight: 600;
}
.sep {
  color: var(--fb-muted);
  font-size: 0.7rem;
}
.title {
  margin: 0 0 1.25rem;
  font-size: clamp(2rem, 4vw, 2.6rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.15;
}
.content {
  font-size: 1.02rem;
  line-height: 1.75;
}
.content :deep(> h1:first-child) {
  margin-top: 0;
  font-size: clamp(2rem, 4vw, 2.6rem);
  font-weight: 800;
  letter-spacing: -0.02em;
}
.content :deep(> :is(h2, h3, h4)) {
  position: relative;
  scroll-margin-top: 1.5rem;
}
.content :deep(> h2) {
  margin-top: 2.5rem;
  font-size: 1.65rem;
  letter-spacing: -0.01em;
}
.content :deep(> h3) {
  margin-top: 2rem;
  font-size: 1.3rem;
}
.content :deep(.hash-link) {
  margin-left: 0.4rem;
  color: var(--fb-accent);
  font-weight: 400;
  text-decoration: none;
  opacity: 0;
  transition: opacity 0.15s;
}
.content :deep(:is(h2, h3, h4):hover .hash-link),
.content :deep(.hash-link:focus-visible) {
  opacity: 1;
}
.content :deep(pre.has-copy) {
  position: relative;
}
.content :deep(.code-copy) {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--fb-border);
  border-radius: 7px;
  background: var(--fb-panel);
  color: var(--fb-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
}
.content :deep(pre:hover .code-copy),
.content :deep(.code-copy:focus-visible),
.content :deep(.code-copy.done) {
  opacity: 1;
}
.content :deep(.code-copy.done) {
  color: #16a34a;
}
.content :deep(img:not(a img)) {
  cursor: zoom-in;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-top: 3rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--fb-border);
}
.edit {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--fb-accent);
  font-size: 0.9rem;
  font-weight: 600;
  text-decoration: none;
}
.edit:hover {
  text-decoration: underline;
}
.pager {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  margin-top: 1.75rem;
}
.pager-card {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.9rem 1.1rem;
  border: 1px solid var(--fb-border);
  border-radius: 12px;
  color: var(--fb-text);
  text-decoration: none;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}
.pager-card:hover {
  border-color: var(--fb-accent);
  box-shadow: 0 0 0 3px var(--fb-accent-soft);
}
.pager-card strong {
  color: var(--fb-accent);
  font-size: 1rem;
}
.pager-card .pi {
  font-size: 0.75rem;
}
.pager-card.next {
  grid-column: 2;
  align-items: flex-end;
  text-align: right;
}
.footer {
  margin-top: auto;
  padding: 3rem 1rem 1.5rem;
  text-align: center;
}
.toc {
  position: sticky;
  top: 0;
  max-height: calc(100dvh - var(--bar));
  overflow-y: auto;
  padding: 2rem 1rem 2rem 0.5rem;
}
.toc-title {
  margin: 0 0 0.6rem;
  color: var(--fb-muted);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.toc ul {
  margin: 0;
  padding: 0 0 0 0.75rem;
  border-left: 1px solid var(--fb-border);
  list-style: none;
}
.toc li {
  margin: 0;
}
.toc a {
  display: block;
  margin-left: -0.8rem;
  padding: 0.22rem 0 0.22rem 0.75rem;
  border-left: 2px solid transparent;
  color: var(--fb-muted);
  font-size: 0.85rem;
  line-height: 1.4;
  text-decoration: none;
}
.toc a:hover {
  color: var(--fb-text);
}
.toc .level-3 a {
  padding-left: 1.5rem;
}
.toc .level-4 a {
  padding-left: 2.25rem;
}
.toc li.active a {
  border-left-color: var(--fb-accent);
  color: var(--fb-accent);
  font-weight: 600;
}
.backdrop {
  display: none;
}

@media (max-width: 1200px) {
  .docs {
    grid-template-columns: 16rem minmax(0, 1fr);
  }
  .toc {
    display: none;
  }
}
@media (max-width: 900px) {
  .top-links {
    display: none;
  }
}
@media (max-width: 760px) {
  .bar {
    gap: 0.4rem;
    padding: 0 0.6rem;
  }
  .icon-button.menu {
    display: inline-grid;
  }
  .search-button {
    min-width: 0;
    width: 2.3rem;
    padding: 0;
    justify-content: center;
    border-radius: 999px;
  }
  .search-label,
  .search-button kbd {
    display: none;
  }
  .docs {
    grid-template-columns: minmax(0, 1fr);
  }
  .sidebar {
    position: fixed;
    top: var(--bar);
    bottom: 0;
    left: 0;
    z-index: 20;
    width: min(19rem, 85vw);
    height: auto;
    background: var(--fb-panel);
    box-shadow: var(--fb-shadow-lg);
    transform: translateX(-105%);
    transition: transform 0.2s ease;
  }
  .sidebar.open {
    transform: none;
  }
  .backdrop {
    position: fixed;
    inset: var(--bar) 0 0;
    z-index: 15;
    display: block;
    background: rgb(0 0 0 / 0.35);
  }
  .main {
    padding: 1.25rem 1rem 0;
  }
  .hero {
    padding: 3.5rem 1rem 3rem;
  }
  .tagline {
    font-size: 1.05rem;
  }
  .cards {
    padding: 2rem 1rem 1rem;
  }
  .pager {
    grid-template-columns: 1fr;
  }
  .pager-card.next {
    grid-column: 1;
  }
}
</style>

<style>
/* Recherche du site (hors du composant, au-dessus de tout). */
.wiki-search-overlay {
  position: fixed;
  inset: 0;
  z-index: 1300;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 10vh 1rem 1rem;
  background: rgb(15 18 24 / 0.45);
  backdrop-filter: blur(3px);
}
.wiki-search {
  display: flex;
  flex-direction: column;
  width: min(40rem, 100%);
  max-height: min(34rem, 80vh);
  overflow: hidden;
  border: 1px solid var(--fb-border);
  border-radius: 14px;
  background: var(--fb-panel);
  box-shadow: 0 24px 60px -12px rgb(0 0 0 / 0.45);
}
.wiki-search .search-field {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.9rem 1rem;
  border-bottom: 1px solid var(--fb-border);
  color: var(--fb-muted);
}
.wiki-search .search-field input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: none;
  color: var(--fb-text);
  font: inherit;
  font-size: 1.05rem;
  outline: none;
}
.wiki-search .search-field input::-webkit-search-cancel-button {
  display: none;
}
.wiki-search kbd {
  padding: 0.1rem 0.4rem;
  border: 1px solid var(--fb-border);
  border-bottom-width: 2px;
  border-radius: 5px;
  background: var(--fb-panel-alt);
  color: var(--fb-muted);
  font-family: inherit;
  font-size: 0.7rem;
  font-weight: 600;
}
.wiki-search .search-results {
  flex: 1;
  margin: 0;
  padding: 0.4rem;
  overflow-y: auto;
  list-style: none;
}
.wiki-search .search-hit {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  width: 100%;
  padding: 0.65rem 0.75rem;
  border: 0;
  border-radius: 9px;
  background: none;
  color: var(--fb-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.wiki-search .search-hit.selected {
  background: var(--fb-accent);
  color: #fff;
}
.wiki-search .search-hit.selected .muted,
.wiki-search .search-hit.selected .hit-icon {
  color: rgb(255 255 255 / 0.8);
}
.wiki-search .hit-icon {
  margin-top: 0.2rem;
  color: var(--fb-muted);
}
.wiki-search .hit-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}
.wiki-search .hit-excerpt {
  overflow: hidden;
  font-size: 0.85rem;
  opacity: 0.85;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wiki-search mark {
  border-radius: 3px;
  background: color-mix(in srgb, #facc15 55%, transparent);
  color: inherit;
}
.wiki-search .search-hit.selected mark {
  background: rgb(255 255 255 / 0.3);
}
.wiki-search .hit-go {
  align-self: center;
  font-size: 0.75rem;
  opacity: 0;
}
.wiki-search .search-hit.selected .hit-go {
  opacity: 1;
}
.wiki-search .search-empty {
  margin: 0;
  padding: 2rem 1rem;
  text-align: center;
}
.wiki-search .search-help {
  display: flex;
  gap: 1rem;
  padding: 0.55rem 1rem;
  border-top: 1px solid var(--fb-border);
  background: var(--fb-panel-alt);
  font-size: 0.75rem;
}
.wiki-search .search-help kbd {
  margin-right: 0.2rem;
}
</style>
