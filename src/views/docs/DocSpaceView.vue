<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useConfirm } from 'primevue/useconfirm';
import Button from 'primevue/button';
import ContextMenu from 'primevue/contextmenu';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Menu from 'primevue/menu';
import Tag from 'primevue/tag';
import Select from 'primevue/select';
import type { MenuItem } from 'primevue/menuitem';
import { citedLinesFromQuery, linesLabel, linesParam } from '@shared/citations';
import type { DocCommentDTO, DocQuote } from '@shared/docComments';
import { docBaseName, docParent, docTitle, type DocLinksDTO, type DocNodeDTO } from '@shared/docs';
import { docOutline } from '@shared/docOutline';
import { searchHasMarkdown } from '@shared/noteSearch';
import { applyDocTemplate, DOC_TEMPLATE_VARIABLES } from '@shared/docTemplates';
import type { UserSummaryDTO } from '@shared/types';
import { api } from '@/api';
import FollowPill from '@/components/common/FollowPill.vue';
import UserAvatar from '@/components/common/UserAvatar.vue';
import DocEditor from '@/components/docs/DocEditor.vue';
import DocHistoryDialog from '@/components/docs/DocHistoryDialog.vue';
import DocImportDialog from '@/components/docs/DocImportDialog.vue';
import DocMembersDialog from '@/components/docs/DocMembersDialog.vue';
import DocNodeInfoDialog from '@/components/docs/DocNodeInfoDialog.vue';
import DocOutline from '@/components/docs/DocOutline.vue';
import DocPreview from '@/components/docs/DocPreview.vue';
import DocSidePanel from '@/components/docs/DocSidePanel.vue';
import DocSiteDialog from '@/components/docs/DocSiteDialog.vue';
import DocSpaceDialog from '@/components/docs/DocSpaceDialog.vue';
import DocTrashDialog from '@/components/docs/DocTrashDialog.vue';
import DocTree from '@/components/docs/DocTree.vue';
import DocFindBar from '@/components/docs/find/DocFindBar.vue';
import { useDocFind } from '@/composables/useDocFind';
import { useDocTabs } from '@/composables/useDocTabs';
import { useFollow } from '@/composables/useFollow';
import { useReadingShift } from '@/composables/useReadingShift';
import { DocSession } from '@/realtime/docSession';
import { useAuthStore } from '@/stores/auth';
import { useDocsStore } from '@/stores/docs';
import { downloadFrom } from '@/utils/files';
import { clearCitedBlocks, clearPreviewLines, markCitedBlocks, numberPreviewLines } from '@/utils/citedPreview';
import { markdownBlocks } from '@/utils/markdown';
import { formatDateTime, formatRelative } from '@/utils/format';
import { notify, notifyError } from '@/utils/notify';
import { openLightbox } from '@/utils/lightbox';
import { docImageUrl, replaceDocImage } from '@/utils/replaceImage';

import { currentLocale, t } from '@/i18n';
/**
 * Espace de documentation, façon Obsidian : arbre à gauche avec l'espace en bas, onglets au-dessus de la note, et les
 * liens, rétroliens, commentaires et le compte des mots en bas à droite, dans un panneau flottant.
 */
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const store = useDocsStore();
const confirm = useConfirm();

const spaceId = computed(() => Number(route.params.spaceId));
const users = ref<UserSummaryDTO[]>([]);
const failed = ref(false);

// --- Onglets, et leur reflet dans l'adresse (précédent / suivant du navigateur) ---
const tabsState = useDocTabs(spaceId);
const { tabs, active } = tabsState;
const fileId = computed(() => active.value.nodeId);
/** Notes, images et modèles : tout ce qu'un onglet peut montrer. */
const allNodes = computed(() => [...store.nodes, ...store.templates]);
const selected = computed(() => allNodes.value.find((node) => node.id === fileId.value) ?? null);
/** Note ou modèle : un texte qui s'écrit. */
const isText = (node: DocNodeDTO | null | undefined): boolean => node?.kind === 'markdown' || node?.kind === 'template';
const isTemplate = computed(() => selected.value?.kind === 'template');
/** Prêt quand l'arbre est chargé : avant, un fichier de l'adresse ne peut pas être vérifié. */
const ready = ref(false);

const queryFile = (): number | null => {
  const value = Number(route.query.file);
  return Number.isInteger(value) && value > 0 ? value : null;
};

onMounted(() => {
  void api.directory().then((result) => (users.value = result.users), () => undefined);
  void store.loadBookmarks().catch(() => undefined);
});

watch(
  spaceId,
  async (id) => {
    failed.value = false;
    ready.value = false;
    try {
      await store.openSpace(id);
      tabsState.prune(new Set(allNodes.value.map((node) => node.id)));
      const wanted = queryFile();
      if (wanted !== null && allNodes.value.some((node) => node.id === wanted)) tabsState.show(wanted);
      ready.value = true;
      // L'adresse reprend l'onglet retrouvé, sans ajouter d'étape à l'historique du navigateur.
      if (queryFile() !== fileId.value) void router.replace({ query: fileId.value ? { file: String(fileId.value) } : {} });
    } catch {
      failed.value = true;
    }
  },
  { immediate: true },
);

// Chaque fichier affiché est une étape du navigateur : précédent et suivant passent d'une note à l'autre.
watch(fileId, (id) => {
  if (!ready.value || queryFile() === id) return;
  void router.push({ query: id ? { file: String(id) } : {} });
});
watch(
  () => route.query.file,
  () => {
    if (!ready.value) return;
    const wanted = queryFile();
    if (wanted === fileId.value) return;
    if (wanted === null || allNodes.value.some((node) => node.id === wanted)) tabsState.show(wanted);
  },
);

// Fichiers supprimés ou déplacés hors de l'espace : leurs onglets se ferment.
watch(allNodes, (nodes) => ready.value && tabsState.prune(new Set(nodes.map((node) => node.id))));

function openNode(node: DocNodeDTO, newTab = false): void {
  if (newTab) tabsState.openInNewTab(node.id);
  else tabsState.navigate(node.id);
}

function tabTitle(nodeId: number | null): string {
  const node = allNodes.value.find((entry) => entry.id === nodeId);
  if (!node) return t('Nouvel onglet');
  return isText(node) ? docTitle(node.path) : docBaseName(node.path);
}

function tabIcon(nodeId: number | null): string {
  const node = allNodes.value.find((entry) => entry.id === nodeId);
  return !node ? 'pi pi-plus-circle' : node.kind === 'image' ? 'pi pi-image' : node.kind === 'template' ? 'pi pi-clone template-tab' : 'pi pi-file';
}

const tabMenu = ref<InstanceType<typeof ContextMenu> | null>(null);
const tabMenuItems = ref<MenuItem[]>([]);
function openTabMenu(event: MouseEvent, id: string): void {
  tabMenuItems.value = [
    { label: t('Fermer l’onglet'), icon: 'pi pi-times', command: () => tabsState.close(id) },
    { label: t('Fermer les autres onglets'), icon: 'pi pi-clone', disabled: tabs.value.length < 2, command: () => tabsState.closeOthers(id) },
  ];
  tabMenu.value?.show(event);
}

// --- Session d'édition du fichier ouvert ---
const session = shallowRef<DocSession | null>(null);
const content = ref('');
/** Personnes sur cette note ; un clic sur l'une d'elles la suit (là où elle lit, puis les notes où elle va). */
const follow = useFollow({
  self: () => auth.user?.id,
  goTo: (target) => {
    if (!allNodes.value.some((node) => node.id === target)) return false;
    if (selected.value?.id !== target) tabsState.navigate(target);
    return true;
  },
});
const presence = follow.people;
const synced = computed(() => session.value?.synced.value ?? false);
const canWrite = computed(() => store.canEdit && (session.value?.canWrite.value ?? false));
const savedAt = computed(() => session.value?.savedAt.value ?? null);
const closed = computed(() => session.value?.closed.value ?? null);
const obsidian = computed(() => store.space?.obsidian ?? true);

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
const modeOptions = computed<Array<{ value: DocMode; label: string; icon: string }>>(() => [
  { value: 'read', label: t('Lecture'), icon: 'pi pi-eye' },
  { value: 'live', label: t('Lecture et écriture'), icon: 'pi pi-file-edit' },
  { value: 'write', label: t('Écriture'), icon: 'pi pi-code' },
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

// --- Sommaire ---
const OUTLINE_KEY = 'fb.docs.outline';
function storedOutline(): boolean {
  try {
    return localStorage.getItem(OUTLINE_KEY) !== '0';
  } catch {
    return true;
  }
}
const outlineOpen = ref(storedOutline());

// --- Colonne des fichiers, repliable ---
const TREE_KEY = 'fb.docs.treeHidden';
function storedTreeHidden(): boolean {
  try {
    return localStorage.getItem(TREE_KEY) === '1';
  } catch {
    return false;
  }
}
const treeHidden = ref(storedTreeHidden());
watch(treeHidden, (hidden) => {
  try {
    localStorage.setItem(TREE_KEY, hidden ? '1' : '0');
  } catch {
    // Stockage indisponible : le choix vaut pour cette page seulement.
  }
});
const outlineAvailable = computed(() => !writing.value || live.value);

// --- Numéros de ligne (à côté du sommaire), dans tous les modes ---
const LINES_KEY = 'fb.docs.lineNumbers';
function storedLineNumbers(): boolean | null {
  try {
    const value = localStorage.getItem(LINES_KEY);
    return value === '1' ? true : value === '0' ? false : null;
  } catch {
    return null;
  }
}
const lineNumbersChoice = ref<boolean | null>(storedLineNumbers());
/** Sans choix enregistré : en écriture seulement, comme avant le bouton. */
const lineNumbers = computed(() => lineNumbersChoice.value ?? (writing.value && !live.value));
function toggleLineNumbers(): void {
  lineNumbersChoice.value = !lineNumbers.value;
  try {
    localStorage.setItem(LINES_KEY, lineNumbersChoice.value ? '1' : '0');
  } catch {
    // Stockage indisponible : le choix vaut pour cette page seulement.
  }
}
const showOutline = computed(() => outlineOpen.value && outlineAvailable.value);
const headings = computed(() => docOutline(content.value));
const activeHeading = ref(0);
const previewPane = ref<HTMLElement | null>(null);
/** Volets de la note : le texte y est recentré sur l'écran (Mon compte → Apparence → Lecture). */
const panes = ref<HTMLElement | null>(null);
useReadingShift(
  panes,
  () => !(writing.value && !live.value && showPreview.value),
  () => [selected.value?.id, mode.value, showOutline.value, treeHidden.value, synced.value, showPreview.value],
);
/** Après un clic sur un titre, le défilement ne doit pas en mettre un autre en avant. */
let followAfter = 0;
let spyFrame = 0;

watch(outlineOpen, (open) => {
  try {
    localStorage.setItem(OUTLINE_KEY, open ? '1' : '0');
  } catch {
    // Stockage indisponible : le choix vaut pour cette page seulement.
  }
});

const renderedHeadings = (): HTMLElement[] => [...(previewPane.value?.querySelectorAll<HTMLElement>('.markdown > :is(h1, h2, h3, h4, h5, h6)') ?? [])];
const squash = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();

/** Titre rendu : même rang dans la page, ou même texte si du HTML brut a décalé les rangs. */
function renderedHeading(index: number): HTMLElement | undefined {
  const elements = renderedHeadings();
  if (elements.length === headings.value.length) return elements[index];
  const title = squash(headings.value[index]?.title);
  return elements.find((element) => squash(element.textContent) === title) ?? elements[index];
}

function goToHeading(index: number): void {
  const heading = headings.value[index];
  if (!heading) return;
  activeHeading.value = index;
  followAfter = Date.now() + 900;
  if (live.value) editor.value?.scrollToLine(heading.line);
  else renderedHeading(index)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function onPreviewScroll(): void {
  if (spyFrame) return;
  spyFrame = requestAnimationFrame(() => {
    spyFrame = 0;
    const pane = previewPane.value;
    // En lecture, la ligne du haut est celle que l'on retrouvera en passant en écriture.
    if (pane && !writing.value && !restoringPosition) {
      topLine = previewTopLine() ?? topLine;
      shareLine();
    }
    if (!pane || !showOutline.value || Date.now() < followAfter) return;
    const elements = renderedHeadings();
    const limit = pane.getBoundingClientRect().top + 24;
    const atEnd = pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2;
    activeHeading.value = atEnd ? Math.max(0, elements.length - 1) : Math.max(0, elements.findLastIndex((element) => element.getBoundingClientRect().top <= limit));
  });
}

function onEditorLine(line: number, fraction = 0): void {
  if (!restoringPosition) {
    topLine = line + fraction;
    shareLine();
  }
  // Défilement de l'éditeur sans déplacer le curseur : l'aperçu suit le haut de l'éditeur.
  if (Date.now() > cursorSyncedAt + 400) syncPreview(line, 0);
  if (Date.now() < followAfter) return;
  activeHeading.value = Math.max(0, headings.value.findLastIndex((heading) => heading.line <= line));
}

// --- Écriture avec l'aperçu à côté : l'aperçu suit le curseur de l'éditeur ---
const splitView = computed(() => writing.value && !live.value && showPreview.value);
let lastCursor: { line: number; ratio: number } | null = null;
let cursorSyncedAt = 0;

function onCursorLine(line: number, ratio: number): void {
  // Le curseur a bougé : le compteur de la recherche suit (« 3 sur 12 »).
  find.refresh();
  lastCursor = { line, ratio };
  cursorSyncedAt = Date.now();
  syncPreview(line, ratio);
}

/**
 * Amène dans l'aperçu le passage de la ligne `line` du source, à la même hauteur (`ratio`) que dans l'éditeur. Les blocs
 * rendus (paragraphes, titres, listes…) servent de repères, dans l'ordre des blocs du source ; entre deux repères, la
 * position est interpolée. Si le rendu ne correspond pas bloc à bloc, seuls les titres servent de repères.
 */
function syncPreview(line: number, ratio: number): void {
  if (splitView.value) scrollPreviewToLine(line, ratio);
}

/** Repères entre les lignes du source et les hauteurs du rendu (voir `syncPreview`), du début à la fin de la note. */
function previewAnchors(): { pane: HTMLElement; anchors: Array<{ line: number; y: number }> } | null {
  const pane = previewPane.value;
  const root = pane?.querySelector<HTMLElement>('.doc-preview .markdown');
  if (!pane || !root) return null;
  const text = content.value;
  const origin = pane.getBoundingClientRect().top - pane.scrollTop;
  const yOf = (element: Element): number => element.getBoundingClientRect().top - origin;

  const blocks = markdownBlocks(text, obsidian.value);
  const elements = [...root.children];
  let anchors: Array<{ line: number; y: number }> = [];
  if (blocks.length && blocks.length === elements.length) {
    let offset = 0;
    let current = 1;
    anchors = blocks.map((block, index) => {
      for (; offset < block.from; offset += 1) if (text.charCodeAt(offset) === 10) current += 1;
      return { line: current, y: yOf(elements[index]!) };
    });
  } else {
    anchors = headings.value.flatMap((heading, index) => {
      const element = renderedHeading(index);
      return element ? [{ line: heading.line, y: yOf(element) }] : [];
    });
  }
  const total = text.split('\n').length;
  anchors = [{ line: 1, y: 0 }, ...anchors.filter((anchor) => anchor.line > 1), { line: total + 1, y: pane.scrollHeight }];
  return { pane, anchors };
}

/** Hauteur, dans le contenu de l'aperçu, de la ligne `line` du source (interpolée entre deux repères). */
function lineY(anchors: ReadonlyArray<{ line: number; y: number }>, line: number): number {
  const index = Math.max(0, anchors.findLastIndex((anchor) => anchor.line <= line));
  const from = anchors[index]!;
  const to = anchors[Math.min(index + 1, anchors.length - 1)]!;
  return to.line > from.line ? from.y + ((line - from.line) / (to.line - from.line)) * (to.y - from.y) : from.y;
}

/** Amène la ligne `line` du source (décimale : une partie de la ligne) à la hauteur `ratio` de l'aperçu. */
function scrollPreviewToLine(line: number, ratio: number): void {
  const found = previewAnchors();
  if (!found) return;
  found.pane.scrollTop = Math.max(0, lineY(found.anchors, line) - ratio * found.pane.clientHeight);
}

/** Ligne du source (décimale) affichée en haut de l'aperçu : l'inverse de `scrollPreviewToLine`. */
function previewTopLine(): number | null {
  const found = previewAnchors();
  if (!found) return null;
  const { pane, anchors } = found;
  const y = pane.scrollTop + 16;
  const index = Math.max(0, anchors.findLastIndex((anchor) => anchor.y <= y));
  const from = anchors[index]!;
  const to = anchors[Math.min(index + 1, anchors.length - 1)]!;
  return to.y > from.y ? from.line + ((y - from.y) / (to.y - from.y)) * (to.line - from.line) : from.line;
}

// --- Changer de mode sans perdre sa place : la ligne du haut de l'écran est suivie et retrouvée dans l'autre mode ---
/** Ligne du source en haut de l'écran (décimale), quel que soit le mode. */
let topLine = 1;
/** Pendant qu'on rétablit la position, les défilements ne remplacent pas la ligne mémorisée. */
let restoringPosition = false;
let restoreTimer: number | undefined;

watch([mode, writing], async () => {
  const line = topLine;
  restoringPosition = true;
  window.clearTimeout(restoreTimer);
  const restore = (): void => {
    if (writing.value) editor.value?.scrollToSourceLine(line);
    else if (previewPane.value) scrollPreviewToLine(line, 0);
  };
  await nextTick();
  requestAnimationFrame(() => {
    restore();
    // Le rendu (images, schémas) et les hauteurs de l'éditeur se précisent juste après : un second calage.
    restoreTimer = window.setTimeout(() => {
      restore();
      restoreTimer = window.setTimeout(() => (restoringPosition = false), 150);
    }, 180);
  });
});
// Une autre note repart du haut.
watch(() => selected.value?.id, () => (topLine = 1));

// --- Suivre quelqu'un : notre page défile là où il lit ---
let lineSharedAt = 0;
let lineShareTimer = 0;
/** Publie la ligne du haut de l'écran (8 fois par seconde au plus) : ceux qui nous suivent s'y calent. */
function shareLine(): void {
  window.clearTimeout(lineShareTimer);
  const wait = 120 - (Date.now() - lineSharedAt);
  if (wait > 0) {
    lineShareTimer = window.setTimeout(shareLine, wait);
    return;
  }
  lineSharedAt = Date.now();
  session.value?.awareness.setLocalStateField('view', { line: Math.round(topLine * 100) / 100, at: lineSharedAt });
}

/** Ligne du source en haut de l'écran de la personne suivie. */
const followLine = computed(() => {
  const line = (follow.followedState.value?.view as { line?: unknown } | undefined)?.line;
  return typeof line === 'number' && Number.isFinite(line) ? line : null;
});
function followScroll(): void {
  const line = followLine.value;
  if (line === null || follow.following.value === null) return;
  if (writing.value) editor.value?.scrollToSourceLine(line);
  else if (previewPane.value) scrollPreviewToLine(line, 0);
}
watch(followLine, followScroll);
// Note qui vient de s'ouvrir, mode changé : le rendu arrive un peu après, on se recale dessus.
let followTimers: number[] = [];
watch([() => follow.following.value, synced, mode, writing, () => selected.value?.id], () => {
  followTimers.forEach((timer) => window.clearTimeout(timer));
  followTimers = follow.following.value === null ? [] : [0, 300, 900].map((delay) => window.setTimeout(followScroll, delay));
});

/** Notre première action dans la note (clic, molette, touche) nous rend la main. */
function onFollowAction(event: Event): void {
  // On reprend la main : les lignes citées ne ramènent plus l'écran sur elles.
  citedScroll = false;
  if (follow.following.value === null) return;
  if (event instanceof KeyboardEvent && ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
  follow.stop();
}

// --- Lignes citées (lien d'une citation, `?lines=12-18`) : surlignées et amenées à l'écran ---
const cited = computed(() => {
  const file = queryFile();
  return file !== null && file === selected.value?.id ? citedLinesFromQuery(route.query.lines) : null;
});
const citedKey = computed(() => (cited.value ? `${selected.value?.id}:${linesParam(cited.value)}` : ''));
const citedCount = computed(() => cited.value?.reduce((sum, range) => sum + range.to - range.from + 1, 0) ?? 0);
/** Tant que l'on n'a pas repris la main, le surlignage ramène l'écran sur les lignes (le rendu se précise peu à peu). */
let citedScroll = false;
let citedTimers: number[] = [];
let citedContentTimer: number | undefined;

/** Surligne les lignes citées dans l'éditeur et dans l'aperçu ; avec `scroll`, les amène en haut de l'écran. */
function showCited(scroll: boolean): void {
  const ranges = cited.value;
  if (writing.value) editor.value?.citeLines(ranges, scroll);
  const pane = previewPane.value;
  const root = pane?.querySelector<HTMLElement>('.doc-preview .markdown');
  if (!pane || !root) return;
  if (!ranges) {
    clearCitedBlocks(root);
    return;
  }
  const marked = markCitedBlocks(root, content.value, obsidian.value, ranges);
  const found = marked.length ? null : previewAnchors();
  if (found) {
    // Rendu qui ne suit pas le texte bloc à bloc : une bande placée d'après la hauteur des lignes.
    const origin = pane.getBoundingClientRect().top - pane.scrollTop;
    const rootTop = root.getBoundingClientRect().top - origin;
    root.classList.add('md-cited-root');
    for (const range of ranges) {
      const top = lineY(found.anchors, range.from);
      const band = document.createElement('div');
      band.className = 'md-cited-band wide';
      band.style.top = `${top - rootTop}px`;
      band.style.height = `${Math.max(18, lineY(found.anchors, range.to + 1) - top)}px`;
      root.append(band);
    }
  }
  if (!scroll || writing.value) return;
  const first = marked[0] ?? root.querySelector<HTMLElement>('.md-cited-band');
  if (first) pane.scrollTop += first.getBoundingClientRect().top - pane.getBoundingClientRect().top - 72;
}

/** Plusieurs passages : le texte, les images et les schémas se dessinent peu à peu. */
function scheduleCited(scroll: boolean): void {
  citedTimers.forEach((timer) => window.clearTimeout(timer));
  citedScroll = scroll;
  citedTimers = [60, 350, 900].map((delay) => window.setTimeout(() => showCited(citedScroll), delay));
}
watch([citedKey, synced], () => scheduleCited(Boolean(cited.value)));
// Autre mode, aperçu ouvert ou fermé : le surlignage suit, sans déplacer l'écran.
watch([mode, writing, showPreview], () => scheduleCited(false));
// Le rendu de la lecture est refait quand le texte change : le surlignage aussi (le rendu suit la frappe de peu).
watch(content, () => {
  if (!cited.value || writing.value) return;
  window.clearTimeout(citedContentTimer);
  citedContentTimer = window.setTimeout(() => showCited(false), 400);
});

// Numéros de ligne en lecture (et dans l'aperçu à côté de l'éditeur) : posés sur le rendu, refaits quand il change.
let numbersTimer: number | undefined;
function showPreviewLines(): void {
  const root = previewPane.value?.querySelector<HTMLElement>('.doc-preview .markdown');
  if (!root) return;
  if (lineNumbers.value) numberPreviewLines(root, content.value, obsidian.value, headings.value.map((heading) => heading.line));
  else clearPreviewLines(root);
}
function scheduleLines(delay = 60): void {
  window.clearTimeout(numbersTimer);
  numbersTimer = window.setTimeout(showPreviewLines, delay);
}
watch([lineNumbers, mode, writing, showPreview, synced, () => selected.value?.id], () => scheduleLines());
// Le rendu suit la frappe de peu (et les images, les schémas se dessinent ensuite) : on repose les numéros après.
watch(content, () => lineNumbers.value && scheduleLines(400));

function revealCited(): void {
  scheduleCited(true);
}

function dismissCited(): void {
  const { lines: _lines, ...rest } = route.query;
  void router.replace({ query: rest });
}

// Le rendu change avec le texte : on recale l'aperçu sur le curseur une fois l'aperçu redessiné.
watch(content, () => {
  if (!lastCursor || !splitView.value) return;
  void nextTick(() => requestAnimationFrame(() => lastCursor && syncPreview(lastCursor.line, lastCursor.ratio)));
});

/** `next` : le fichier où l'on va, annoncé à ceux qui nous suivent avant que notre présence ne quitte la note. */
function closeSession(next: number | null = null): void {
  follow.detach(next);
  session.value?.close();
  session.value = null;
  content.value = '';
  activeHeading.value = 0;
}

function openSession(nodeId: number): void {
  closeSession(nodeId);
  if (!auth.user) return;
  const next = new DocSession(nodeId, { id: auth.user.id, name: auth.user.name });
  next.text.observe(() => (content.value = next.text.toString()));
  follow.attach(next.awareness, next.doc.clientID);
  session.value = next;
  shareLine();
}

watch(
  () => (isText(selected.value) ? selected.value!.id : null),
  (nodeId) => (nodeId === null ? closeSession(selected.value?.id ?? null) : openSession(nodeId)),
  { immediate: true },
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

// --- Panneau flottant : liens, rétroliens et commentaires ---
const sideOpen = ref(false);
const sideTab = ref<'links' | 'comments'>('links');
const links = ref<DocLinksDTO | null>(null);
const draft = ref<DocQuote | null>(null);
const focusedComment = ref<number | null>(null);
const editor = ref<InstanceType<typeof DocEditor> | null>(null);

// --- Recherche dans la note (Ctrl F) ---
const find = useDocFind({
  editor,
  preview: previewPane,
  writing: () => writing.value,
  active: () => isText(selected.value) && synced.value,
  target: () => [selected.value?.id, mode.value, writing.value],
  content,
});
function setFindBar(instance: unknown): void {
  find.bar.value = instance as typeof find.bar.value;
}

const noteId = computed(() => (isText(selected.value) ? selected.value!.id : null));
const openComments = computed(() => store.comments.filter((comment) => comment.parentId === null && !comment.resolvedAt).length);
const linkCount = computed(() => (links.value ? links.value.outgoing.notes.length + links.value.outgoing.tickets.length + links.value.outgoing.boards.length : 0));
const backlinkCount = computed(() => (links.value ? links.value.backlinks.notes.length + links.value.backlinks.tickets.length + links.value.backlinks.boards.length : 0));
const members = computed(() => users.value.filter((user) => store.members.some((member) => member.userId === user.id)));
const words = computed(() => content.value.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0);

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
    // Un modèle n'est la cible d'aucun lien : ses compteurs ne veulent rien dire.
    if (nodeId !== null && !isTemplate.value) void loadLinks(nodeId);
  },
  { immediate: true },
);

// Les liens suivent la frappe, sans la gêner.
let linksTimer: number | undefined;
watch(content, () => {
  window.clearTimeout(linksTimer);
  linksTimer = window.setTimeout(() => {
    if (noteId.value !== null && !isTemplate.value) void loadLinks(noteId.value);
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
  if (reason === 'deleted') tabsState.prune(new Set(allNodes.value.filter((node) => node.id !== session.value?.nodeId).map((node) => node.id)));
  else if (reason === 'revoked' && !store.revoked) void store.reload(spaceId.value).catch(() => undefined);
});

onBeforeUnmount(() => {
  window.clearTimeout(linksTimer);
  window.clearTimeout(lineShareTimer);
  followTimers.forEach((timer) => window.clearTimeout(timer));
  cancelAnimationFrame(spyFrame);
  closeSession();
  void store.loadComments(null);
  store.closeSpace();
});

// --- Arbre : créer, renommer, déplacer, supprimer ---
/** `sourceId` : note dont un nouveau modèle reprend le texte. */
const nameDialog = ref<{ kind: 'create-note' | 'create-folder' | 'create-template' | 'rename'; folder: string; node: DocNodeDTO | null; sourceId?: number } | null>(null);
const nameValue = ref('');
/** Modèle dont part la nouvelle note (0 : note vide ; PrimeVue prend `null` pour « rien de choisi »). */
const nameTemplate = ref(0);
const nameBusy = ref(false);
const NAME_TITLES = { rename: 'Renommer', 'create-folder': 'Nouveau dossier', 'create-template': 'Nouveau modèle', 'create-note': 'Nouvelle note' } as const;
const nameTitle = computed(() => t(NAME_TITLES[nameDialog.value?.kind ?? 'create-note']));
const templateOptions = computed(() => [{ label: t('Note vide'), value: 0 }, ...store.templates.map((node) => ({ label: docTitle(node.path), value: node.id }))]);

function askCreate(kind: 'folder' | 'markdown' | 'template', folder: string, templateId: number | null = null): void {
  nameDialog.value = { kind: kind === 'folder' ? 'create-folder' : kind === 'template' ? 'create-template' : 'create-note', folder: kind === 'template' ? '' : folder, node: null };
  nameValue.value = '';
  nameTemplate.value = templateId ?? 0;
}

/** Nouveau modèle d'après une note : il en reprend le texte. */
function askSaveAsTemplate(node: DocNodeDTO): void {
  nameDialog.value = { kind: 'create-template', folder: '', node: null, sourceId: node.id };
  nameValue.value = docTitle(node.path);
}

function askRename(node: DocNodeDTO): void {
  nameDialog.value = { kind: 'rename', folder: docParent(node.path), node };
  nameValue.value = isText(node) ? docTitle(node.path) : docBaseName(node.path);
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
    } else if (dialog.kind === 'create-template') {
      const { node } = await api.docCreateNode(spaceId.value, name, 'template', dialog.sourceId ? { fromId: dialog.sourceId } : {});
      store.templates = [...store.templates.filter((entry) => entry.id !== node.id), node];
      // Depuis une note, on y reste ; un modèle vide s'ouvre pour être écrit.
      if (dialog.sourceId) notify('success', t('Modèle créé'), t('« {name} » est dans les modèles de l’espace.', { name: docTitle(node.path) }));
      else {
        if (mode.value === 'read') chooseMode('live');
        openNode(node);
      }
    } else {
      const kind = dialog.kind === 'create-folder' ? 'folder' : 'markdown';
      const from = kind === 'markdown' && nameTemplate.value ? { fromId: nameTemplate.value } : {};
      const { node } = await api.docCreateNode(spaceId.value, inFolder(dialog.folder, name), kind, from);
      if (node.kind === 'markdown') {
        store.nodes = [...store.nodes.filter((entry) => entry.id !== node.id), node];
        if (mode.value === 'read') chooseMode('live');
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
    header: t('Supprimer « {name} » ?', { name: node.kind === 'template' ? docTitle(node.path) : docBaseName(node.path) }),
    message: node.kind === 'folder' ? t('Le dossier et son contenu vont à la corbeille pendant 15 jours.') : node.kind === 'template' ? t('Le modèle va à la corbeille pendant 15 jours ; les notes créées d’après lui ne changent pas.') : t('Le fichier va à la corbeille pendant 15 jours.'),
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

/** Plusieurs éléments choisis dans l'arbre : une seule confirmation, puis la corbeille. */
function askRemoveMany(nodes: DocNodeDTO[]): void {
  confirm.require({
    header: t('Supprimer {n} éléments ?', { n: nodes.length }),
    message: t('Ils vont à la corbeille pendant 15 jours, avec le contenu des dossiers choisis.'),
    icon: 'pi pi-trash',
    acceptLabel: t('Supprimer'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      for (const node of nodes) {
        try {
          await api.docDeleteNode(node.id);
        } catch (error) {
          notifyError(error);
          return;
        }
      }
    },
  });
}

// --- Infos et note d'un fichier ou d'un dossier ---
const infoNode = ref<DocNodeDTO | null>(null);
const infoMode = ref<'info' | 'memo'>('info');
const infoOpen = ref(false);
function showInfo(node: DocNodeDTO, view: 'info' | 'memo'): void {
  infoNode.value = node;
  infoMode.value = view;
  infoOpen.value = true;
}

// --- Export et réimport ---
const importOpen = ref(false);
const importNode = ref<DocNodeDTO | null>(null);

function exportNode(node: DocNodeDTO | null): void {
  downloadFrom(node ? `/api/documentation/nodes/${node.id}/export` : `/api/documentation/spaces/${spaceId.value}/export`);
}

function askImport(node: DocNodeDTO | null): void {
  // Une image se remplace directement, sur place (l'ancienne va dans la corbeille).
  if (node?.kind === 'image') {
    void replaceDocImage(node);
    return;
  }
  importNode.value = node;
  importOpen.value = true;
}

// --- Image ouverte : clic droit ---
const imageMenu = ref<InstanceType<typeof ContextMenu> | null>(null);
const imageMenuItems = ref<MenuItem[]>([]);
function openImageMenu(event: MouseEvent, node: DocNodeDTO): void {
  event.preventDefault();
  const url = docImageUrl(node);
  imageMenuItems.value = [
    { label: t('Agrandir l’image'), icon: 'pi pi-expand', command: () => openLightbox(url, docBaseName(node.path)) },
    { label: t('Ouvrir l’image dans un nouvel onglet'), icon: 'pi pi-external-link', command: () => window.open(url, '_blank', 'noopener') },
    { label: t('Exporter l’image'), icon: 'pi pi-download', command: () => exportNode(node) },
    ...(store.canEdit ? [{ separator: true }, { label: t('Remplacer l’image…'), icon: 'pi pi-sync', command: () => void replaceDocImage(node) }] : []),
  ];
  imageMenu.value?.show(event);
}

// --- Note : menu « ⋯ » ---
const noteMenu = ref<InstanceType<typeof Menu> | null>(null);
const noteMenuItems = computed<MenuItem[]>(() => {
  const node = selected.value;
  if (!node) return [];
  if (node.kind === 'template') {
    return [
      { label: t('Historique'), icon: 'pi pi-history', command: () => (historyOpen.value = true) },
      { label: t('Infos'), icon: 'pi pi-info-circle', command: () => showInfo(node, 'info') },
      ...(store.canEdit ? [{ label: node.memo ? t('Modifier la note') : t('Ajouter une note'), icon: 'pi pi-comment', command: () => showInfo(node, 'memo') }] : []),
      { separator: true },
      ...(store.canEdit ? [{ label: t('Nouvelle note depuis ce modèle'), icon: 'pi pi-file-plus', command: () => askCreate('markdown', '', node.id) }] : []),
      { label: t('Exporter en .md'), icon: 'pi pi-download', command: () => exportNode(node) },
      ...(store.canEdit ? [{ separator: true }, { label: t('Renommer'), icon: 'pi pi-pencil', command: () => askRename(node) }, { label: t('Supprimer'), icon: 'pi pi-trash', command: () => askRemove(node) }] : []),
    ];
  }
  return [
    { label: t('Historique'), icon: 'pi pi-history', command: () => (historyOpen.value = true) },
    { label: t('Infos'), icon: 'pi pi-info-circle', command: () => showInfo(node, 'info') },
    ...(store.canEdit ? [{ label: node.memo ? t('Modifier la note') : t('Ajouter une note'), icon: 'pi pi-comment', command: () => showInfo(node, 'memo') }] : []),
    ...(store.canEdit && node.kind === 'markdown' ? [{ label: t('Enregistrer comme modèle'), icon: 'pi pi-clone', command: () => askSaveAsTemplate(node) }] : []),
    { separator: true },
    { label: t('Exporter en .md'), icon: 'pi pi-download', command: () => exportNode(node) },
    ...(store.canEdit ? [{ label: t('Importer un .md'), icon: 'pi pi-upload', command: () => askImport(node) }] : []),
    ...(store.canEdit ? [{ separator: true }, { label: t('Renommer'), icon: 'pi pi-pencil', command: () => askRename(node) }, { label: t('Supprimer'), icon: 'pi pi-trash', command: () => askRemove(node) }] : []),
  ];
});

// --- Insérer un modèle dans la note ouverte ---
const insertMenu = ref<InstanceType<typeof Menu> | null>(null);
const insertable = computed(() => store.templates.filter((node) => node.id !== selected.value?.id));
const insertItems = computed<MenuItem[]>(() => [
  { label: t('Insérer un modèle'), items: insertable.value.map((node) => ({ label: docTitle(node.path), icon: 'pi pi-clone', command: () => void insertTemplate(node) })) },
]);

/** Au curseur dans l'éditeur, sinon à la fin de la note ; dans un modèle, les variables restent à remplir. */
async function insertTemplate(template: DocNodeDTO): Promise<void> {
  const note = selected.value;
  const current = session.value;
  if (!note || !current) return;
  try {
    const raw = (await api.docNode(template.id)).content ?? '';
    const text = note.kind === 'template' ? raw : applyDocTemplate(raw, { title: docTitle(note.path), author: auth.user?.name ?? '', locale: currentLocale() });
    if (session.value !== current) return;
    if (editor.value?.insertBlock(text)) return;
    const existing = current.text.toString();
    current.doc.transact(() => current.text.insert(existing.length, `${existing && !existing.endsWith('\n') ? '\n\n' : ''}${text}`));
    notify('success', t('Modèle inséré'), t('À la fin de la note.'));
  } catch (error) {
    notifyError(error, t('Modèle non inséré'));
  }
}

// --- Espace : en bas de l'arbre, comme le coffre d'Obsidian ---
const membersOpen = ref(false);
const trashOpen = ref(false);
const historyOpen = ref(false);
const settingsOpen = ref(false);
const siteOpen = ref(false);
const spaceMenu = ref<InstanceType<typeof Menu> | null>(null);
const switchMenu = ref<InstanceType<typeof Menu> | null>(null);

const spaceMenuItems = computed<MenuItem[]>(() => [
  ...(store.isOwner
    ? [
        { label: t('Modifier l’espace'), icon: 'pi pi-cog', command: () => (settingsOpen.value = true) },
        { label: store.space?.site ? t('Site web…') : t('Activer le site web'), icon: 'pi pi-globe', command: () => (siteOpen.value = true) },
        { label: t('Actualiser depuis le disque'), icon: 'pi pi-refresh', command: askRescan },
      ]
    : []),
  ...(store.space?.site ? [{ label: t('Ouvrir le site web'), icon: 'pi pi-external-link', command: () => window.open(`/wiki/${store.space!.site!.slug}`, '_blank', 'noopener') }] : []),
  { separator: true },
  { label: t('Exporter l’espace en ZIP'), icon: 'pi pi-download', command: () => exportNode(null) },
  ...(store.canEdit ? [{ label: t('Importer un .md ou un ZIP'), icon: 'pi pi-upload', command: () => askImport(null) }] : []),
  { label: t('Corbeille'), icon: 'pi pi-trash', command: () => (trashOpen.value = true) },
  ...(store.isOwner ? [{ separator: true }, { label: t('Supprimer l’espace'), icon: 'pi pi-times', class: 'danger-item', command: askDeleteSpace }] : []),
]);

const switchItems = computed<MenuItem[]>(() => [
  ...store.spaces.filter((space) => space.id !== spaceId.value).map((space) => ({ label: space.name, icon: 'pi pi-book', command: () => void router.push({ name: 'doc-space', params: { spaceId: space.id } }) })),
  ...(store.spaces.length > 1 ? [{ separator: true }] : []),
  { label: t('Toutes les documentations'), icon: 'pi pi-th-large', command: () => void router.push({ name: 'docs' }) },
]);

async function openSwitcher(event: MouseEvent): Promise<void> {
  switchMenu.value?.toggle(event);
  if (!store.loaded) await store.fetchSpaces().catch(() => undefined);
}

/** Relit le dossier de l'espace sur le serveur : fichiers ajoutés, modifiés ou supprimés hors de FastBoard. */
function askRescan(): void {
  confirm.require({
    header: t('Actualiser depuis le disque ?'),
    message: t('Le dossier de l’espace sur le serveur est relu : les notes, images et dossiers ajoutés à la main entrent dans l’espace, les fichiers modifiés à côté sont relus (l’historique garde le texte précédent), et ceux qui ont disparu passent à la corbeille.'),
    icon: 'pi pi-refresh',
    acceptLabel: t('Actualiser'),
    rejectLabel: t('Annuler'),
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      try {
        const { result } = await api.docRescan(spaceId.value);
        await store.reload(spaceId.value);
        const changes = result.added + result.updated + result.removed;
        notify(
          'success',
          changes
            ? t('Espace actualisé : {added} ajouté(s), {updated} mis à jour, {removed} à la corbeille.', { added: result.added, updated: result.updated, removed: result.removed })
            : t('L’espace est déjà à jour avec le disque.'),
          result.skipped ? t('{n} fichier ignoré (format non pris en charge ou nom refusé).|{n} fichiers ignorés (format non pris en charge ou nom refusé).', { n: result.skipped }) : undefined,
        );
      } catch (error) {
        notifyError(error, t('Actualisation impossible'));
      }
    },
  });
}

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

// --- Page d'un nouvel onglet : favoris de l'espace et notes récentes ---
const spaceBookmarks = computed(() => store.bookmarks.filter((entry) => entry.spaceId === spaceId.value).slice(0, 8));
const recent = computed(() =>
  [...store.nodes]
    .filter((node) => node.kind === 'markdown')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8),
);
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

  <div v-else-if="store.space" class="doc-space" :class="{ 'tree-hidden': treeHidden }">
    <aside v-show="!treeHidden" class="tree-col">
      <DocTree
        class="tree"
        :nodes="store.nodes"
        :templates="store.templates"
        :selected-id="fileId"
        :editable="store.canEdit"
        :space-id="spaceId"
        @open="openNode"
        @create="askCreate"
        @use-template="(source, folder) => askCreate('markdown', folder, source.id)"
        @save-as-template="askSaveAsTemplate"
        @rename="askRename"
        @remove="askRemove"
        @remove-many="askRemoveMany"
        @move="moveNode"
        @export="exportNode"
        @import="askImport"
        @info="showInfo($event, 'info')"
        @memo="showInfo($event, 'memo')"
        @collapse="treeHidden = true"
      />
      <div v-if="store.space.adminAccess" class="admin-access">
        <Tag v-if="store.space.adminAccess" v-tooltip.top="$t('Vous n’êtes pas propriétaire de cet espace : vous y entrez grâce à vos droits d’administration.')" :value="$t('Accès avec droit admin')" icon="pi pi-shield" severity="warn" />
      </div>
      <footer class="space-foot">
        <button v-tooltip.top="$t('Changer d’espace')" type="button" class="space-switch" aria-haspopup="true" @click="openSwitcher">
          <i class="pi pi-sort-alt muted"></i>
          <strong class="truncate">{{ store.space.name }}</strong>
          <i v-if="store.space.site" v-tooltip.top="$t('Site web activé')" class="pi pi-globe site" :class="store.space.site.visibility"></i>
        </button>
        <Button v-tooltip.top="$t('Membres')" icon="pi pi-users" text rounded size="small" severity="secondary" :aria-label="$t('Membres')" @click="membersOpen = true" />
        <Button v-tooltip.top="$t('Réglages de l’espace')" icon="pi pi-cog" text rounded size="small" severity="secondary" :aria-label="$t('Réglages de l’espace')" aria-haspopup="true" @click="spaceMenu?.toggle($event)" />
        <Menu ref="switchMenu" :model="switchItems" popup />
        <Menu ref="spaceMenu" :model="spaceMenuItems" popup />
      </footer>
    </aside>

    <main class="note-col">
      <div class="tabbar" role="tablist" :aria-label="$t('Onglets')">
        <button v-if="treeHidden" v-tooltip.bottom="$t('Afficher les fichiers')" type="button" class="tab-add tree-show" :aria-label="$t('Afficher les fichiers')" @click="treeHidden = false"><i class="pi pi-angle-double-right"></i></button>
        <div
          v-for="tab in tabs"
          :key="tab.id"
          class="tab"
          :class="{ active: tab.id === active.id }"
          role="tab"
          :aria-selected="tab.id === active.id"
          tabindex="0"
          :title="store.nodes.find((node) => node.id === tab.nodeId)?.path ?? $t('Nouvel onglet')"
          @click="tabsState.activate(tab.id)"
          @keydown.enter="tabsState.activate(tab.id)"
          @auxclick.prevent="$event.button === 1 && tabsState.close(tab.id)"
          @contextmenu.prevent="openTabMenu($event, tab.id)"
        >
          <i :class="tabIcon(tab.nodeId)" class="tab-icon"></i>
          <span class="tab-title truncate">{{ tabTitle(tab.nodeId) }}</span>
          <button type="button" class="tab-close" :aria-label="$t('Fermer l’onglet')" @click.stop="tabsState.close(tab.id)"><i class="pi pi-times"></i></button>
        </div>
        <button v-tooltip.bottom="$t('Nouvel onglet')" type="button" class="tab-add" :aria-label="$t('Nouvel onglet')" @click="tabsState.openInNewTab(null)"><i class="pi pi-plus"></i></button>
        <ContextMenu ref="tabMenu" :model="tabMenuItems" />
      </div>

      <template v-if="selected">
        <header class="note-nav">
          <Button v-tooltip.bottom="$t('Précédent')" icon="pi pi-arrow-left" text rounded size="small" severity="secondary" :disabled="!active.back.length" :aria-label="$t('Précédent')" @click="tabsState.goBack()" />
          <Button v-tooltip.bottom="$t('Suivant')" icon="pi pi-arrow-right" text rounded size="small" severity="secondary" :disabled="!active.forward.length" :aria-label="$t('Suivant')" @click="tabsState.goForward()" />
          <div class="crumbs truncate">
            <span v-if="isTemplate" class="muted"><i class="pi pi-clone template-mark"></i> {{ $t('Modèles') }} / </span>
            <span v-else-if="docParent(selected.path)" class="muted">{{ docParent(selected.path).replaceAll('/', ' / ') }} / </span>
            <strong>{{ isText(selected) ? docTitle(selected.path) : docBaseName(selected.path) }}</strong>
          </div>
          <div class="people" @keydown.esc="follow.stop()">
            <button
              v-for="person in presence"
              :key="person.id"
              v-tooltip.bottom="follow.label(person, $t('{name} est sur cette note', { name: person.name }))"
              type="button"
              class="person"
              :class="{ followed: follow.following.value === person.id }"
              :style="{ '--ring': person.color }"
              :aria-label="follow.label(person, $t('{name} est sur cette note', { name: person.name }))"
              :aria-pressed="follow.following.value === person.id"
              @click="follow.toggle(person)"
            >
              <UserAvatar :user="users.find((user) => user.id === person.id) ?? { id: person.id, name: person.name, avatarVersion: 0 }" size="small" />
              <i v-if="follow.following.value === person.id || person.followsMe" class="pi pi-eye watch" :class="{ me: person.followsMe && follow.following.value !== person.id }" aria-hidden="true"></i>
            </button>
          </div>
          <template v-if="isText(selected)">
            <span v-if="writing && savedAt" v-tooltip.bottom="formatDateTime(savedAt)" class="muted small saved"><i class="pi pi-check"></i> {{ $t('Enregistré') }}</span>
            <span v-else-if="synced && !canWrite" class="muted small saved"><i class="pi pi-lock"></i> {{ $t('Lecture seule') }}</span>
            <div v-if="canWrite" class="modes" role="radiogroup" :aria-label="$t('Mode d’affichage')">
              <button v-for="option in modeOptions" :key="option.value" v-tooltip.bottom="option.label" type="button" class="mode" :class="{ active: mode === option.value }" role="radio" :aria-checked="mode === option.value" :aria-label="option.label" @click="chooseMode(option.value)">
                <i :class="option.icon"></i>
              </button>
            </div>
            <Button v-if="writing && !live" v-tooltip.bottom="showPreview ? $t('Masquer l’aperçu') : $t('Afficher l’aperçu')" icon="pi pi-objects-column" text rounded size="small" :severity="showPreview ? undefined : 'secondary'" :aria-pressed="showPreview" :aria-label="$t('Aperçu')" @click="showPreview = !showPreview" />
            <Button
              v-tooltip.bottom="lineNumbers ? $t('Masquer les numéros de ligne') : $t('Afficher les numéros de ligne')"
              icon="pi pi-sort-numeric-down"
              text
              rounded
              size="small"
              :severity="lineNumbers ? undefined : 'secondary'"
              :aria-pressed="lineNumbers"
              :aria-label="$t('Numéros de ligne')"
              class="lines-toggle"
              @click="toggleLineNumbers"
            />
            <Button v-if="outlineAvailable" v-tooltip.bottom="$t('Sommaire')" icon="pi pi-list" text rounded size="small" :severity="outlineOpen ? undefined : 'secondary'" :aria-pressed="outlineOpen" :aria-label="$t('Sommaire')" class="outline-toggle" @click="outlineOpen = !outlineOpen" />
          </template>
          <template v-if="isText(selected) && canWrite && insertable.length">
            <Button v-tooltip.bottom="$t('Insérer un modèle')" icon="pi pi-clone" text rounded size="small" severity="secondary" :aria-label="$t('Insérer un modèle')" aria-haspopup="true" @click="insertMenu?.toggle($event)" />
            <Menu ref="insertMenu" :model="insertItems" popup />
          </template>
          <Button
            v-if="!isTemplate"
            v-tooltip.bottom="store.bookmarked.has(selected.id) ? $t('Retirer des favoris') : $t('Ajouter aux favoris')"
            :icon="store.bookmarked.has(selected.id) ? 'pi pi-star-fill' : 'pi pi-star'"
            text
            rounded
            size="small"
            :severity="store.bookmarked.has(selected.id) ? 'warn' : 'secondary'"
            :aria-pressed="store.bookmarked.has(selected.id)"
            :aria-label="$t('Favori')"
            @click="store.toggleBookmark(selected.id)"
          />
          <Button v-tooltip.bottom="$t('Plus d’actions')" icon="pi pi-ellipsis-v" text rounded size="small" severity="secondary" :aria-label="$t('Plus d’actions')" aria-haspopup="true" @click="noteMenu?.toggle($event)" />
          <Menu ref="noteMenu" :model="noteMenuItems" popup />
        </header>

        <template v-if="isText(selected)">
          <div v-if="isTemplate" class="template-banner">
            <i class="pi pi-clone"></i>
            <span class="template-text">
              {{ $t('Modèle : les notes créées d’après lui reçoivent ce texte.') }}
              <span class="muted">{{ $t('Variables :') }}</span>
              <code v-for="variable in DOC_TEMPLATE_VARIABLES" :key="variable.name" v-tooltip.bottom="`${$t(variable.description)} · ${variable.aliases.join(', ')}`">{{ variable.name }}</code>
            </span>
            <Button v-if="store.canEdit" :label="$t('Nouvelle note')" icon="pi pi-file-plus" size="small" text @click="askCreate('markdown', '', selected.id)" />
          </div>
          <div v-if="!synced" class="waiting muted"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</div>
          <div v-else class="note-body" :class="{ 'with-outline': showOutline }">
            <DocOutline v-if="showOutline" class="outline" :headings="headings" :active="activeHeading" @go="goToHeading" @close="outlineOpen = false" />
            <div ref="panes" class="panes" :class="{ split: writing && !live && showPreview, writing }" @pointerdown.capture="onFollowAction" @wheel.capture.passive="onFollowAction" @keydown.capture="onFollowAction">
              <!-- Suivi d'une personne : cadre à sa couleur et rappel, tant que l'on ne reprend pas la main -->
              <template v-if="follow.followed.value">
                <div class="follow-frame" :style="{ '--follow': follow.followed.value.color }"></div>
                <FollowPill class="follow-banner" :name="follow.followed.value.name" :color="follow.followed.value.color" @stop="follow.stop()" />
              </template>
              <div v-if="cited" class="cited-banner" :class="{ raised: follow.followed.value }" role="status">
                <i class="pi pi-bookmark"></i>
                <span>{{ $t('Ligne {lines} citée|Lignes {lines} citées', { n: citedCount, lines: linesLabel(cited) }) }}</span>
                <button type="button" class="cited-action" @click="revealCited">{{ $t('Revoir') }}</button>
                <button type="button" class="cited-close" :aria-label="$t('Ne plus surligner')" @click="dismissCited"><i class="pi pi-times"></i></button>
              </div>
              <DocFindBar
                v-if="find.open.value"
                :ref="setFindBar"
                v-model="find.query.value"
                v-model:replace-open="find.replaceOpen.value"
                class="find-floating"
                :result="find.result.value"
                :can-replace="writing"
                :markdown-hint="!writing && searchHasMarkdown(find.query.value.search)"
                :can-switch="canWrite"
                @source="chooseMode('live')"
                @next="find.next"
                @previous="find.previous"
                @replace="find.replace"
                @replace-all="find.replaceAll"
                @close="find.close"
              />
              <div v-if="writing && session" class="pane editor">
                <DocEditor
                  :key="`${session.nodeId}-${mode}`"
                  ref="editor"
                  :session="session"
                  :space-id="spaceId"
                  :note-path="selected.path"
                  :users="users"
                  :nodes="store.nodes"
                  :comments="store.comments"
                  :live="live"
                  :obsidian="obsidian"
                  :line-numbers="lineNumbers"
                  :readonly="false"
                  @open="openNode"
                  @comment="startComment"
                  @focus-comment="focusComment"
                  @top-line="onEditorLine"
                  @cursor-line="onCursorLine"
                />
              </div>
              <div v-if="!writing || (showPreview && !live)" ref="previewPane" class="pane preview" @scroll.passive="onPreviewScroll">
                <DocPreview v-if="content" :text="content" :nodes="store.nodes" :note-path="selected.path" :users="users" :comments="store.comments" :obsidian="obsidian" :editable="store.canEdit" @open="openNode" @comment="startComment" @focus-comment="focusComment" />
                <p v-else class="muted empty-note">{{ canWrite ? $t('Cette note est vide. Passez en écriture pour la rédiger.') : $t('Cette note est vide.') }}</p>
              </div>
            </div>
          </div>

          <div class="status" role="toolbar" :aria-label="$t('Liens et commentaires')">
            <button v-if="!isTemplate" v-tooltip.top="$t('Notes, tickets et tableaux qui citent cette note')" type="button" class="status-item" :class="{ active: sideOpen && sideTab === 'links' }" @click="showSide('links')">
              <i class="pi pi-reply"></i> {{ $t('{n} rétrolien|{n} rétroliens', { n: backlinkCount }) }}
            </button>
            <button v-if="!isTemplate" v-tooltip.top="$t('Ce que cite cette note')" type="button" class="status-item" :class="{ active: sideOpen && sideTab === 'links' }" @click="showSide('links')">
              <i class="pi pi-link"></i> {{ $t('{n} lien|{n} liens', { n: linkCount }) }}
            </button>
            <button type="button" class="status-item" :class="{ active: sideOpen && sideTab === 'comments' }" @click="showSide('comments')">
              <i class="pi pi-comments"></i> {{ $t('{n} commentaire|{n} commentaires', { n: openComments }) }}
            </button>
            <span class="status-item plain">{{ $t('{n} mot|{n} mots', { n: words }) }} · {{ $t('{n} caractère|{n} caractères', { n: content.length }) }}</span>
          </div>
          <Transition name="float">
            <div v-if="sideOpen" class="floating-panel">
              <DocSidePanel
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
          </Transition>
        </template>

        <div v-else class="image-view">
          <img :src="docImageUrl(selected)" :alt="docBaseName(selected.path)" @contextmenu="openImageMenu($event, selected)" />
          <ContextMenu ref="imageMenu" :model="imageMenuItems" />
        </div>
      </template>

      <div v-else class="welcome">
        <div class="welcome-head">
          <i class="pi pi-book"></i>
          <h3>{{ store.space.name }}</h3>
          <p v-if="store.space.description" class="muted">{{ store.space.description }}</p>
        </div>
        <div class="welcome-actions">
          <Button v-if="store.canEdit" :label="$t('Nouvelle note')" icon="pi pi-file-plus" @click="askCreate('markdown', '')" />
        </div>
        <div v-if="spaceBookmarks.length || recent.length" class="welcome-lists">
          <section v-if="spaceBookmarks.length">
            <h4><i class="pi pi-star-fill star"></i> {{ $t('Favoris') }}</h4>
            <button v-for="entry in spaceBookmarks" :key="entry.nodeId" type="button" class="welcome-link" @click="tabsState.navigate(entry.nodeId)">
              <i :class="entry.kind === 'image' ? 'pi pi-image' : 'pi pi-file'" class="muted"></i>
              <span class="truncate">{{ docTitle(entry.path) }}</span>
            </button>
          </section>
          <section v-if="recent.length">
            <h4><i class="pi pi-clock"></i> {{ $t('Modifiées récemment') }}</h4>
            <button v-for="node in recent" :key="node.id" type="button" class="welcome-link" @click="openNode(node)">
              <i class="pi pi-file muted"></i>
              <span class="truncate">{{ docTitle(node.path) }}</span>
              <span class="muted small when">{{ formatRelative(node.updatedAt) }}</span>
            </button>
          </section>
        </div>
        <p v-else class="muted">{{ store.canEdit ? $t('Créez une première note pour commencer.') : $t('Cet espace est vide.') }}</p>
      </div>
    </main>

    <Dialog :visible="nameDialog !== null" modal :header="nameTitle" :style="{ width: 'min(26rem, calc(100vw - 2rem))' }" @update:visible="nameDialog = null">
      <form class="name-form" @submit.prevent="submitName">
        <p v-if="nameDialog?.folder" class="muted small">{{ $t('Dans {folder}', { folder: nameDialog.folder }) }}</p>
        <InputText v-model="nameValue" autofocus fluid :aria-label="$t('Nom')" :placeholder="$t('Nom')" />
        <label v-if="nameDialog?.kind === 'create-note' && store.templates.length" class="name-template">
          <span class="muted small">{{ $t('Modèle') }}</span>
          <Select v-model="nameTemplate" :options="templateOptions" option-label="label" option-value="value" size="small" fluid />
        </label>
        <p v-if="nameDialog?.kind === 'create-template'" class="muted small name-hint">
          {{ nameDialog.sourceId ? $t('Le modèle reprend le texte de la note : remplacez ce qui change d’une note à l’autre par des variables.') : $t('Les notes créées d’après ce modèle reçoivent son texte, variables remplies :') }}
          <code v-for="variable in DOC_TEMPLATE_VARIABLES" :key="variable.name">{{ variable.name }}</code>
        </p>
        <div class="name-actions">
          <Button type="button" :label="$t('Annuler')" severity="secondary" text @click="nameDialog = null" />
          <Button type="submit" :label="$t('Valider')" icon="pi pi-check" :disabled="!nameValue.trim()" :loading="nameBusy" />
        </div>
      </form>
    </Dialog>

    <DocMembersDialog v-model:visible="membersOpen" :users="users" />
    <DocImportDialog v-model:visible="importOpen" :space-id="spaceId" :node="importNode" @done="store.reload(spaceId)" />
    <DocTrashDialog v-model:visible="trashOpen" :space-id="spaceId" />
    <DocHistoryDialog v-if="selected && isText(selected)" v-model:visible="historyOpen" :node="selected" :nodes="store.nodes" :users="users" :can-restore="canWrite" :current="content" />
    <DocSpaceDialog v-model:visible="settingsOpen" :space="store.space" @saved="store.reload(spaceId)" />
    <DocSiteDialog v-model:visible="siteOpen" :space="store.space" @saved="store.reload(spaceId)" />
    <DocNodeInfoDialog v-model:visible="infoOpen" :node="infoNode" :mode="infoMode" :can-edit="store.canEdit" />
  </div>

  <div v-else class="page muted"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</div>
</template>

<style scoped>
.doc-space {
  display: grid;
  flex: 1;
  grid-template-columns: 17rem minmax(0, 1fr);
  min-height: 0;
}
.doc-space.tree-hidden {
  grid-template-columns: minmax(0, 1fr);
}
.tree-show {
  margin-right: 0.25rem;
}
.tree-col {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--fb-border);
  background: var(--fb-panel);
}
.tree {
  flex: 1;
  min-height: 0;
}
.admin-access {
  display: flex;
  justify-content: center;
  padding: 0.35rem 0.5rem 0;
}
.space-foot {
  display: flex;
  align-items: center;
  gap: 0.1rem;
  padding: 0.3rem 0.35rem;
  border-top: 1px solid var(--fb-border);
}
.space-switch {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
  padding: 0.35rem 0.5rem;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--fb-text);
  font: inherit;
  font-size: 0.88rem;
  text-align: left;
  cursor: pointer;
}
.space-switch:hover {
  background: var(--fb-panel-alt);
}
.site {
  margin-left: auto;
  color: var(--fb-muted);
  font-size: 0.75rem;
}
.site.public {
  color: #f59e0b;
}
.note-col {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.tabbar {
  display: flex;
  align-items: flex-end;
  gap: 0.15rem;
  min-height: 2.35rem;
  padding: 0.3rem 0.5rem 0;
  border-bottom: 1px solid var(--fb-border);
  background: var(--fb-panel-alt);
  overflow-x: auto;
  scrollbar-width: thin;
}
.tab {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 7rem;
  max-width: 13rem;
  flex: 0 1 13rem;
  height: 2rem;
  padding: 0 0.3rem 0 0.7rem;
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: 8px 8px 0 0;
  color: var(--fb-muted);
  font-size: 0.84rem;
  cursor: pointer;
  user-select: none;
}
.tab:hover {
  background: color-mix(in srgb, var(--fb-text) 5%, transparent);
  color: var(--fb-text);
}
.tab.active {
  position: relative;
  bottom: -1px;
  border-color: var(--fb-border);
  background: var(--fb-bg);
  color: var(--fb-text);
  font-weight: 600;
}
.tab:focus-visible {
  outline: 2px solid var(--fb-accent);
  outline-offset: -2px;
}
.tab-icon {
  font-size: 0.75rem;
  color: var(--fb-muted);
}
.tab-title {
  flex: 1;
  min-width: 0;
}
.tab-close,
.tab-add {
  display: grid;
  place-items: center;
  width: 1.4rem;
  height: 1.4rem;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: none;
  color: var(--fb-muted);
  font-size: 0.65rem;
  cursor: pointer;
}
.tab-close {
  opacity: 0;
}
.tab:hover .tab-close,
.tab.active .tab-close,
.tab-close:focus-visible {
  opacity: 1;
}
.tab-close:hover,
.tab-add:hover {
  background: color-mix(in srgb, var(--fb-text) 10%, transparent);
  color: var(--fb-text);
}
.tab-add {
  align-self: center;
  width: 1.8rem;
  height: 1.8rem;
  font-size: 0.75rem;
}
@media (hover: none) {
  .tab-close {
    opacity: 1;
  }
}
.note-nav {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  min-height: 2.5rem;
  padding: 0.15rem 0.5rem;
  border-bottom: 1px solid var(--fb-border);
}
.crumbs {
  flex: 1;
  min-width: 0;
  margin-left: 0.35rem;
  font-size: 0.9rem;
}
.people {
  display: flex;
  gap: 0.45rem;
}
.person {
  position: relative;
  display: inline-flex;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: none;
  box-shadow: 0 0 0 2px var(--ring);
  cursor: pointer;
  transition: transform 0.15s;
}
.person:hover,
.person:focus-visible {
  transform: translateY(-1px);
}
.person.followed {
  box-shadow: 0 0 0 2px var(--fb-panel), 0 0 0 4px var(--ring);
}
/* Œil : on suit cette personne (à sa couleur), ou elle nous suit (discret). */
.person .watch {
  position: absolute;
  right: -5px;
  bottom: -5px;
  display: grid;
  place-items: center;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: var(--ring);
  color: #fff;
  font-size: 9px;
  box-shadow: 0 0 0 1.5px var(--fb-panel);
}
.person .watch.me {
  background: var(--fb-panel);
  color: var(--fb-muted);
  box-shadow: 0 0 0 1px var(--fb-border);
}
.follow-frame {
  position: absolute;
  inset: 0;
  z-index: 7;
  border: 3px solid var(--follow);
  pointer-events: none;
}
/* En bas, au-dessus de la barre des liens et du compte des mots ; le haut est pris par les outils de l'éditeur. */
/* En bas à gauche : le panneau de l'assistant, d'où vient souvent la citation, couvre la droite. */
.cited-banner {
  position: absolute;
  bottom: 3.1rem;
  left: 1.2rem;
  z-index: 8;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  width: max-content;
  max-width: calc(100% - 2rem);
  padding: 0.3rem 0.35rem 0.3rem 0.75rem;
  border: 1px solid color-mix(in srgb, var(--fb-accent) 45%, var(--fb-border));
  border-radius: 999px;
  background: var(--fb-panel);
  box-shadow: var(--fb-shadow-lg);
  color: var(--fb-text);
  font-size: 0.85rem;
}
.cited-banner.raised {
  bottom: 5.8rem;
}
.cited-banner > .pi {
  color: var(--fb-accent);
}
.cited-action,
.cited-close {
  padding: 0.15rem 0.5rem;
  border: 0;
  border-radius: 999px;
  background: none;
  color: var(--fb-accent);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.cited-close {
  color: var(--fb-muted);
}
.cited-action:hover,
.cited-close:hover {
  background: var(--fb-accent-soft);
}
.follow-banner {
  position: absolute;
  bottom: 3.1rem;
  left: 50%;
  z-index: 8;
  width: max-content;
  transform: translateX(-50%);
}
.saved {
  margin: 0 0.35rem;
  white-space: nowrap;
}
.modes {
  display: inline-flex;
  padding: 0.12rem;
  border-radius: 8px;
  background: var(--fb-panel-alt);
}
.mode {
  display: grid;
  place-items: center;
  width: 1.85rem;
  height: 1.6rem;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--fb-muted);
  font-size: 0.8rem;
  cursor: pointer;
}
.mode:hover {
  color: var(--fb-text);
}
.mode.active {
  background: var(--fb-panel);
  box-shadow: var(--fb-shadow);
  color: var(--fb-accent);
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
.note-body.with-outline {
  grid-template-columns: 14rem minmax(0, 1fr);
}
.panes {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-height: 0;
}
/* Barre de recherche (Ctrl F) : en haut à droite du texte, au-dessus de l'éditeur quand l'aperçu est à côté. */
.find-floating {
  position: absolute;
  z-index: 6;
  top: 0.6rem;
  right: 1.4rem;
}
.panes.writing .find-floating {
  top: 2.75rem;
}
.panes.split .find-floating {
  right: calc(50% + 1rem);
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
  padding: 1.25rem 1.5rem 3.5rem;
}
/* « Toute la largeur » : le texte va presque jusqu'aux bords. */
:global(:root[data-reading='full']) .pane.preview {
  padding-right: 1rem;
  padding-left: 1rem;
}
.pane.preview :deep(.markdown > :is(h1, h2, h3, h4, h5, h6)) {
  scroll-margin-top: 0.75rem;
}
.empty-note {
  text-align: center;
}
/* Barre d'état flottante, en bas à droite, comme dans Obsidian. */
.status {
  position: absolute;
  right: 0.75rem;
  bottom: 0.6rem;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 0.1rem;
  padding: 0.15rem;
  border: 1px solid var(--fb-border);
  border-radius: 9px;
  background: color-mix(in srgb, var(--fb-panel) 92%, transparent);
  box-shadow: var(--fb-shadow);
  backdrop-filter: blur(4px);
}
.status-item {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0.5rem;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--fb-muted);
  font: inherit;
  font-size: 0.76rem;
  white-space: nowrap;
  cursor: pointer;
}
.status-item .pi {
  font-size: 0.7rem;
}
.status-item:hover:not(.plain) {
  background: var(--fb-panel-alt);
  color: var(--fb-text);
}
.status-item.active {
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
}
.status-item.plain {
  cursor: default;
}
.floating-panel {
  position: absolute;
  right: 0.75rem;
  bottom: 2.9rem;
  z-index: 6;
  display: flex;
  width: min(23rem, calc(100% - 1.5rem));
  height: min(32rem, calc(100% - 6rem));
  border: 1px solid var(--fb-border);
  border-radius: 12px;
  background: var(--fb-panel);
  box-shadow: var(--fb-shadow-lg);
  overflow: hidden;
}
.floating-panel > * {
  flex: 1;
  min-width: 0;
}
.float-enter-active,
.float-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.float-enter-from,
.float-leave-to {
  opacity: 0;
  transform: translateY(6px);
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
.welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  margin: 0 auto;
  padding: 3rem 1rem;
  width: min(40rem, 100%);
  overflow-y: auto;
}
.welcome-head {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  text-align: center;
}
.welcome-head > .pi,
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
.welcome-lists {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  gap: 1rem;
  width: 100%;
}
.welcome-lists h4 {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0 0.35rem;
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--fb-muted);
}
.star {
  color: #eab308;
}
.welcome-link {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.35rem 0.5rem;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--fb-text);
  font: inherit;
  font-size: 0.88rem;
  text-align: left;
  cursor: pointer;
}
.welcome-link:hover {
  background: var(--fb-panel-alt);
}
.welcome-link .truncate {
  flex: 1;
  min-width: 0;
}
.when {
  flex: none;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  margin: auto;
  padding: 2rem 1rem;
  text-align: center;
}
.name-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.name-form p {
  margin: 0;
}
.name-template {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.name-hint code,
.template-banner code {
  margin-left: 0.3rem;
  padding: 0.05rem 0.3rem;
  border-radius: 4px;
  background: var(--fb-panel-alt);
  font-size: 0.78rem;
  white-space: nowrap;
}
.template-banner {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.35rem 0.75rem;
  border-bottom: 1px solid var(--fb-border);
  background: color-mix(in srgb, #a855f7 8%, var(--fb-panel));
  font-size: 0.82rem;
}
.template-banner > .pi {
  color: #a855f7;
}
.template-text {
  flex: 1;
  min-width: 0;
  line-height: 1.7;
}
.template-banner code {
  cursor: help;
}
.template-mark,
.tab-icon.template-tab {
  color: #a855f7;
}
.name-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
@media (max-width: 1000px) {
  .note-body.with-outline {
    grid-template-columns: minmax(0, 1fr);
  }
  .outline {
    display: none;
  }
}
@media (max-width: 760px) {
  .doc-space {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 13rem) minmax(0, 1fr);
  }
  .doc-space.tree-hidden {
    grid-template-rows: minmax(0, 1fr);
  }
  .tree-col {
    border-right: 0;
    border-bottom: 1px solid var(--fb-border);
  }
  .panes.split {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  }
  .panes.split .pane.editor {
    border-right: 0;
    border-bottom: 1px solid var(--fb-border);
  }
  .outline-toggle,
  .crumbs .muted {
    display: none;
  }
  .status-item.plain {
    display: none;
  }
}
</style>
