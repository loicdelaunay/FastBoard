<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import ContextMenu from 'primevue/contextmenu';
import type { MenuItem } from 'primevue/menuitem';
import type { DocCommentDTO, DocQuote } from '@shared/docComments';
import type { DocNodeDTO } from '@shared/docs';
import type { UserSummaryDTO } from '@shared/types';
import { api } from '@/api';
import MarkdownView from '@/components/common/MarkdownView.vue';
import CodeLanguagePicker from '@/components/docs/CodeLanguagePicker.vue';
import { useDocLinks } from '@/composables/useDocLinks';
import { openLightbox, zoomImageOnClick } from '@/utils/lightbox';
import { docImageIdOf, replaceDocImage } from '@/utils/replaceImage';
import { copyText, docResolver, finishDocHtml, hydrateEmbeds, pendingAnchor, prepareDocText, scrollToHeading, selectionQuote } from '@/utils/docRender';

import { t } from '@/i18n';
/** Rendu d'une note : Markdown, Mermaid, images de l'espace, liens entre notes, notes intégrées, mentions et passages commentés. */
const props = defineProps<{
  text: string;
  nodes: DocNodeDTO[];
  notePath: string;
  users: UserSummaryDTO[];
  /** Commentaires de la note ; sans cela, le texte ne se commente pas (ancienne version). */
  comments?: DocCommentDTO[];
  /** Syntaxe propre à Obsidian (réglage de l'espace). */
  obsidian?: boolean;
  /** On peut modifier l'espace : ses images se remplacent au clic droit. */
  editable?: boolean;
  /** On peut écrire dans la note : la pastille d'un bloc de code en change le langage. */
  writable?: boolean;
}>();
const emit = defineEmits<{
  open: [node: DocNodeDTO, newTab?: boolean];
  comment: [quote: DocQuote];
  'focus-comment': [commentId: number];
  /** Nouveau langage d'un bloc de code, retrouvé dans le texte par son langage, son code et son rang parmi les mêmes. */
  'code-language': [change: { lang: string; code: string; occurrence: number; next: string }];
}>();

const root = ref<HTMLElement | null>(null);
const { follow, openTicket } = useDocLinks(
  () => props.nodes,
  (node, newTab) => emit('open', node, newTab),
);

/** Le rendu suit la frappe avec un léger retard : redessiner un diagramme à chaque touche ferait clignoter la page. */
const shown = ref(props.text);
let timer: number | undefined;
watch(
  () => props.text,
  (text) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => (shown.value = text), 250);
  },
);
onBeforeUnmount(() => window.clearTimeout(timer));

const context = computed(() => ({ nodes: props.nodes, notePath: props.notePath, users: props.users, obsidian: props.obsidian }));
const resolver = computed(() => docResolver(props.users));
const prepare = (text: string): string => prepareDocText(text, props.obsidian);
const finish = (html: string): string => finishDocHtml(html, context.value, (props.comments ?? []).filter((comment) => comment.quote && !comment.resolvedAt));

/** Notes intégrées lues une fois par rendu de cette note. */
const loaded = new Map<number, Promise<string>>();
const load = (nodeId: number): Promise<string> => {
  if (!loaded.has(nodeId)) loaded.set(nodeId, api.docNode(nodeId).then((result) => result.content ?? ''));
  return loaded.get(nodeId)!;
};

// Après chaque rendu : notes intégrées, et titre visé par un lien venu d'une autre note.
watch(
  [shown, () => props.nodes, () => props.obsidian],
  async () => {
    await nextTick();
    if (!root.value) return;
    loaded.clear();
    void hydrateEmbeds(root.value, context.value, load);
    const anchor = pendingAnchor.value;
    if (anchor?.path === props.notePath) {
      pendingAnchor.value = null;
      scrollToHeading(root.value, anchor.heading);
    }
  },
  { immediate: true },
);

const languagePicker = ref<InstanceType<typeof CodeLanguagePicker> | null>(null);

/** Pastille d'un bloc de code de la note (pas d'une note intégrée) : choisir un autre langage. */
function pickCodeLanguage(event: MouseEvent, chip: HTMLElement): void {
  const lang = chip.dataset.lang ?? '';
  const code = chip.closest('pre')?.querySelector('code')?.textContent ?? '';
  const same = [...(root.value?.querySelectorAll<HTMLElement>('.md-code-lang') ?? [])].filter(
    (entry) => !entry.closest('.md-embed') && (entry.dataset.lang ?? '') === lang && (entry.closest('pre')?.querySelector('code')?.textContent ?? '') === code,
  );
  const occurrence = same.indexOf(chip);
  if (occurrence < 0) return;
  languagePicker.value?.open(event, chip, lang, (next) => emit('code-language', { lang, code, occurrence, next }));
}

function onClick(event: MouseEvent): void {
  const element = event.target as HTMLElement;
  const chip = element.closest<HTMLElement>('.md-code-lang');
  if (chip && props.writable && !chip.closest('.md-embed')) {
    pickCodeLanguage(event, chip);
    return;
  }
  if (follow(element, event) || zoomImageOnClick(event)) return;
  const mark = element.closest<HTMLElement>('[data-comment]');
  if (mark && window.getSelection()?.isCollapsed) emit('focus-comment', Number(mark.dataset.comment));
}

const menu = ref<InstanceType<typeof ContextMenu> | null>(null);
const menuItems = ref<MenuItem[]>([]);

/** Sur un texte sélectionné ou une image seulement : ailleurs, le menu du navigateur reste disponible. */
function onContextMenu(event: MouseEvent): void {
  const image = (event.target as HTMLElement).closest<HTMLImageElement>('img');
  if (image?.src && !image.closest('a')) {
    event.preventDefault();
    const src = image.currentSrc || image.src;
    // Une image de l'espace se remplace sur place ; une image d'un autre site se change dans le Markdown.
    const imageId = docImageIdOf(src);
    const node = imageId === null ? undefined : props.nodes.find((entry) => entry.id === imageId);
    menuItems.value = [
      { label: t('Agrandir l’image'), icon: 'pi pi-expand', command: () => openLightbox(src, image.alt) },
      { label: t('Ouvrir l’image dans un nouvel onglet'), icon: 'pi pi-external-link', command: () => window.open(src, '_blank', 'noopener') },
      ...(props.editable && node ? [{ separator: true }, { label: t('Remplacer l’image…'), icon: 'pi pi-sync', command: () => void replaceDocImage(node) }] : []),
    ];
    menu.value?.show(event);
    return;
  }
  const quote = root.value && props.comments ? selectionQuote(root.value) : null;
  if (!quote) return;
  event.preventDefault();
  const selected = window.getSelection()?.toString() ?? '';
  menuItems.value = [
    { label: t('Ajouter un commentaire'), icon: 'pi pi-comment', command: () => emit('comment', quote) },
    { label: t('Copier'), icon: 'pi pi-copy', command: () => void copyText(selected) },
  ];
  menu.value?.show(event);
}
</script>

<template>
  <div ref="root" class="doc-preview" :class="{ 'code-lang-editable': writable }" @click="onClick" @contextmenu="onContextMenu">
    <MarkdownView :text="shown" :resolver="resolver" :obsidian="obsidian" :prepare="prepare" :finish="finish" :open-ticket-with="openTicket" />
    <ContextMenu ref="menu" :model="menuItems" />
    <CodeLanguagePicker v-if="writable" ref="languagePicker" />
  </div>
</template>

<style scoped>
.doc-preview {
  max-width: var(--fb-reading-width, 52rem);
  margin-right: auto;
  margin-left: max(0px, calc((100% - var(--fb-reading-width, 52rem)) / 2 + var(--reading-shift, 0px)));
  font-family: var(--fb-font-doc, var(--fb-font, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif));
  font-size: var(--fb-doc-size, 1rem);
}
.doc-preview :deep(img:not(a img)) {
  cursor: zoom-in;
}
</style>

<style>
.doc-preview a.broken,
.cm-live-block a.broken,
.wiki-page a.broken {
  color: var(--fb-danger);
  text-decoration: underline dotted;
  cursor: help;
}
/* Numéros de ligne du texte, en marge (bouton « Numéros de ligne ») : le premier de chaque bloc, élément de liste et
   rangée de tableau ; toutes les lignes d'un bloc de code, dans sa marge intérieure. */
.doc-preview .markdown.md-numbered {
  padding-left: 2.9rem;
}
.doc-preview .md-numbered > [data-line],
.doc-preview .md-numbered :is(li, td, th)[data-line] {
  position: relative;
}
/* Un tableau défile en largeur (et coupe ce qui dépasse) : ses numéros vont dans une marge intérieure, à la même place. */
.doc-preview .md-numbered > table:has([data-line]) {
  margin-left: -2.9rem;
  padding-left: 2.9rem;
}
.doc-preview .md-numbered [data-line]::after,
.doc-preview .md-numbered-code::after {
  position: absolute;
  color: var(--fb-muted);
  font-family: var(--fb-mono, ui-monospace, monospace);
  font-size: 0.75rem;
  font-style: normal;
  font-weight: 400;
  letter-spacing: 0;
  text-align: right;
  text-transform: none;
  opacity: 0.75;
  pointer-events: none;
  user-select: none;
}
.doc-preview .md-numbered [data-line]::after {
  content: attr(data-line);
  top: 0;
  left: -2.9rem;
  width: 2.2rem;
  line-height: 1.6rem;
}
.doc-preview .md-numbered li[data-line]::after {
  left: calc(-2.9rem - var(--md-list-indent, 1.5em));
}
.doc-preview .md-numbered :is(td, th)[data-line]::after {
  top: 50%;
  left: calc(-2.9rem - 1px);
  line-height: 1;
  transform: translateY(-50%);
}
.doc-preview .md-numbered-code {
  position: relative;
  padding-left: 3.1rem !important;
}
.doc-preview .md-numbered-code::after {
  content: attr(data-lines);
  top: var(--md-code-top, 0);
  left: 0.35rem;
  width: 2.2rem;
  line-height: var(--md-code-line, 1.5);
  white-space: pre;
}

/* Lignes citées (lien d'une citation, ?lines=…) : blocs teintés, filet à gauche ; au plus près dans une liste, un
   tableau ou un bloc de code (bandes). */
/* La bande déborde sur les côtés seulement (ombres hors de la boîte) : deux éléments voisins se touchent sans se
   superposer. La puce d'un élément de liste reste dans la bande, le filet à sa gauche. */
.doc-preview .md-cited {
  --cited-pad: 0.4rem;
  position: relative;
  background: var(--fb-cited-bg);
  box-shadow:
    calc(-1 * var(--cited-pad)) 0 0 var(--fb-cited-bg),
    0.4rem 0 0 var(--fb-cited-bg);
}
.doc-preview .md-cited:not(tr)::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(-1 * var(--cited-pad) - 3px);
  width: 3px;
  background: var(--fb-cited-edge);
  pointer-events: none;
}
.doc-preview li.md-cited {
  --cited-pad: 1.5rem;
}
.doc-preview tr.md-cited {
  box-shadow: none;
}
.doc-preview tr.md-cited > * {
  background: var(--fb-cited-bg);
}
.doc-preview tr.md-cited > :first-child {
  box-shadow: inset 3px 0 0 var(--fb-cited-edge);
}
.doc-preview .md-cited-code,
.doc-preview .md-cited-root {
  position: relative;
}
.doc-preview .md-cited-band {
  position: absolute;
  right: 0;
  left: 0;
  background: var(--fb-cited-bg);
  box-shadow: inset 3px 0 0 var(--fb-cited-edge);
  pointer-events: none;
}
.doc-preview .md-cited-band.wide {
  right: -0.5rem;
  left: -0.7rem;
  border-radius: 3px;
}
.doc-preview .md-mention.doc::before,
.cm-live-block .md-mention.doc::before {
  content: '\e9c3';
  margin-right: 0.25rem;
  font-family: primeicons;
  font-size: 0.8em;
}
</style>
