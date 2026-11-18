<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import ContextMenu from 'primevue/contextmenu';
import type { MenuItem } from 'primevue/menuitem';
import type { DocCommentDTO, DocQuote } from '@shared/docComments';
import type { DocNodeDTO } from '@shared/docs';
import type { UserSummaryDTO } from '@shared/types';
import { api } from '@/api';
import MarkdownView from '@/components/common/MarkdownView.vue';
import { useDocLinks } from '@/composables/useDocLinks';
import { openLightbox, zoomImageOnClick } from '@/utils/lightbox';
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
}>();
const emit = defineEmits<{ open: [node: DocNodeDTO]; comment: [quote: DocQuote]; 'focus-comment': [commentId: number] }>();

const root = ref<HTMLElement | null>(null);
const { follow, openTicket } = useDocLinks(() => props.nodes, (node) => emit('open', node));

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

function onClick(event: MouseEvent): void {
  const element = event.target as HTMLElement;
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
    menuItems.value = [
      { label: t('Agrandir l’image'), icon: 'pi pi-expand', command: () => openLightbox(src, image.alt) },
      { label: t('Ouvrir l’image dans un nouvel onglet'), icon: 'pi pi-external-link', command: () => window.open(src, '_blank', 'noopener') },
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
  <div ref="root" class="doc-preview" @click="onClick" @contextmenu="onContextMenu">
    <MarkdownView :text="shown" :resolver="resolver" :obsidian="obsidian" :prepare="prepare" :finish="finish" :open-ticket-with="openTicket" />
    <ContextMenu ref="menu" :model="menuItems" />
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
.doc-preview .md-mention.doc::before,
.cm-live-block .md-mention.doc::before {
  content: '\e9c3';
  margin-right: 0.25rem;
  font-family: primeicons;
  font-size: 0.8em;
}
</style>
