<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import ContextMenu from 'primevue/contextmenu';
import type { MenuItem } from 'primevue/menuitem';
import type { DocCommentDTO, DocQuote } from '@shared/docComments';
import { expandWikiLinks } from '@shared/docLinks';
import type { DocNodeDTO } from '@shared/docs';
import type { UserSummaryDTO } from '@shared/types';
import MarkdownView from '@/components/common/MarkdownView.vue';
import { useDocLinks } from '@/composables/useDocLinks';
import { copyText, docResolver, finishDocHtml, selectionQuote } from '@/utils/docRender';

import { t } from '@/i18n';
/** Rendu d'une note : Markdown, Mermaid, images de l'espace, liens entre notes, mentions et passages commentés. */
const props = defineProps<{
  text: string;
  nodes: DocNodeDTO[];
  notePath: string;
  users: UserSummaryDTO[];
  /** Commentaires de la note ; sans cela, le texte ne se commente pas (ancienne version). */
  comments?: DocCommentDTO[];
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

const resolver = computed(() => docResolver(props.users));
const finish = (html: string): string => finishDocHtml(html, { nodes: props.nodes, notePath: props.notePath, users: props.users }, (props.comments ?? []).filter((comment) => comment.quote && !comment.resolvedAt));

function onClick(event: MouseEvent): void {
  const element = event.target as HTMLElement;
  if (follow(element, event)) return;
  const mark = element.closest<HTMLElement>('[data-comment]');
  if (mark && window.getSelection()?.isCollapsed) emit('focus-comment', Number(mark.dataset.comment));
}

const menu = ref<InstanceType<typeof ContextMenu> | null>(null);
const menuItems = ref<MenuItem[]>([]);

/** Sur un texte sélectionné seulement : ailleurs, le menu du navigateur reste disponible. */
function onContextMenu(event: MouseEvent): void {
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
    <MarkdownView :text="shown" :resolver="resolver" :prepare="expandWikiLinks" :finish="finish" :open-ticket-with="openTicket" />
    <ContextMenu ref="menu" :model="menuItems" />
  </div>
</template>

<style scoped>
.doc-preview {
  max-width: 52rem;
  margin: 0 auto;
}
</style>

<style>
.doc-preview a.broken,
.cm-live-block a.broken {
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
