<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, pickedCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState } from '@codemirror/state';
import { drawSelection, dropCursor, EditorView, highlightActiveLine, keymap, lineNumbers, placeholder, type Command } from '@codemirror/view';
import ContextMenu from 'primevue/contextmenu';
import type { MenuItem } from 'primevue/menuitem';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import * as Y from 'yjs';
import { findQuote, quoteFromSource, sourceOffset, type DocCommentDTO, type DocQuote } from '@shared/docComments';
import { imageMarkdown, resolveDocLink } from '@shared/docLinks';
import { docParent, docTitle, type DocNodeDTO } from '@shared/docs';
import type { UserSummaryDTO } from '@shared/types';
import { api } from '@/api';
import { useDocLinks } from '@/composables/useDocLinks';
import type { DocSession } from '@/realtime/docSession';
import { copyText, renderDocBlock, selectionQuote } from '@/utils/docRender';
import { markdownBlocks } from '@/utils/markdown';
import { mentionToken, type MentionKind } from '@/utils/mentions';
import { notifyError } from '@/utils/notify';
import { matchesQuery } from '@/utils/search';
import { taskLine, toggleTask } from './editor/commands';
import { docComments, setDocComments } from './editor/comments';
import { livePreview, refreshLive, textBeforePoint } from './editor/live';
import { editorMenu, type MenuHandlers, type MenuTarget } from './editor/menu';
import { completionIcon, inlineTools, insertTools, lineTools, slashCommands, type DocTool, type ToolHandlers } from './editor/tools';

import { t } from '@/i18n';
/**
 * Éditeur Markdown partagé : le texte vit dans le document Yjs de la session, avec les curseurs des autres personnes.
 * `live` : mode « Lecture et écriture », où chaque bloc s'affiche rendu jusqu'à ce qu'on y place le curseur.
 */
const props = defineProps<{
  session: DocSession;
  spaceId: number;
  notePath: string;
  users: UserSummaryDTO[];
  nodes: DocNodeDTO[];
  comments: DocCommentDTO[];
  live: boolean;
  readonly: boolean;
}>();
const emit = defineEmits<{ open: [node: DocNodeDTO]; comment: [quote: DocQuote]; 'focus-comment': [commentId: number]; 'top-line': [line: number] }>();

const host = ref<HTMLElement | null>(null);
const picker = ref<HTMLInputElement | null>(null);
let view: EditorView | null = null;
const editable = new Compartment();
const editableState = (readonly: boolean) => [EditorState.readOnly.of(readonly), EditorView.editable.of(!readonly)];

const { follow, openNode, openTicket } = useDocLinks(() => props.nodes, (node) => emit('open', node));

/** `@` propose les personnes, les tickets et les fichiers de documentation. */
async function mentions(context: CompletionContext): Promise<CompletionResult | null> {
  const match = context.matchBefore(/(^|[\s(])@[^\s@[\]()]{0,30}/);
  if (!match) return null;
  const at = match.text.indexOf('@');
  const query = match.text.slice(at + 1);
  const option = (kind: MentionKind, id: number, label: string, detail: string, type: string): Completion => ({ label, detail, type, apply: `${mentionToken(kind, id, label)} ` });
  const people = props.users
    .filter((user) => user.isActive && (!query || matchesQuery(query, [user.name, user.email])))
    .slice(0, 5)
    .map((user) => option('user', user.id, user.name, user.email, 'variable'));
  if (!query) return { from: match.from + at, options: people, filter: false };
  const [tickets, files] = await Promise.all([
    api.search(query, { type: ['tickets'], limit: 5 }).catch(() => null),
    api.docSearch(query).catch(() => null),
  ]);
  if (context.aborted) return null;
  return {
    from: match.from + at,
    filter: false,
    options: [
      ...people,
      ...(tickets?.tickets.items ?? []).map((ticket) => option('ticket', ticket.id, ticket.key, ticket.title, 'class')),
      ...(files?.files ?? []).slice(0, 5).map((file) => option('doc', file.id, file.title, `${file.spaceName} · ${file.path}`, 'text')),
    ],
  };
}

/** `[[` propose les notes de l'espace. */
function wikiLinks(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/\[\[[^\]\n]*/);
  if (!match) return null;
  return {
    from: match.from + 2,
    validFor: /^[^\]\n]*$/,
    options: props.nodes
      .filter((node) => node.kind === 'markdown' && node.path !== props.notePath)
      .map((node): Completion => ({
        label: docTitle(node.path),
        detail: docParent(node.path),
        type: 'text',
        apply: (editor, completion, from, to) => {
          const closed = editor.state.sliceDoc(to, to + 2) === ']]';
          const text = `${docTitle(node.path)}]]`;
          editor.dispatch({ changes: { from, to: closed ? to + 2 : to, insert: text }, selection: { anchor: from + text.length }, annotations: pickedCompletion.of(completion) });
        },
      })),
  };
}

/** Une image collée ou glissée est envoyée au serveur, puis son lien s'insère au curseur. */
async function insertImages(files: File[], position: number): Promise<void> {
  for (const file of files) {
    try {
      const { node } = await api.docUploadImage(props.spaceId, docParent(props.notePath), file);
      const text = `${imageMarkdown(props.notePath, node.path)}\n`;
      view?.dispatch({ changes: { from: Math.min(position, view.state.doc.length), insert: text } });
      position += text.length;
    } catch (error) {
      notifyError(error, t('Image non ajoutée'));
    }
  }
}

const images = (list: FileList | undefined | null): File[] => [...(list ?? [])].filter((file) => file.type.startsWith('image/'));

function onPicked(event: Event): void {
  const element = event.target as HTMLInputElement;
  const files = images(element.files);
  element.value = '';
  if (view && files.length) void insertImages(files, view.state.selection.main.head);
}

const handlers: ToolHandlers = { pickImage: () => picker.value?.click() };

// --- Barre d'outils ---
const toolbar = computed<Array<DocTool | 'sep'>>(() => {
  const inline = inlineTools();
  const lines = lineTools();
  const inserts = insertTools(handlers);
  return [...inline, 'sep', ...lines.slice(1), 'sep', ...inserts.slice(0, 6)];
});

function runTool(tool: DocTool): void {
  if (view) tool.run(view);
}

const shortcut = (label: string): Command => (editor) => {
  inlineTools().find((tool) => tool.label === label)?.run(editor);
  return true;
};

// --- Rendu des blocs (mode « Lecture et écriture ») ---
/** Commentaires ouverts dont le passage se trouve dans le bloc. */
function commentsIn(state: EditorState, block: { from: number; to: number }): DocCommentDTO[] {
  return state.field(docComments).located.filter(({ range }) => range.from >= block.from && range.to <= block.to).map(({ comment }) => comment);
}

const live = livePreview({
  render: (source, block, state) => renderDocBlock(source, { nodes: props.nodes, notePath: props.notePath, users: props.users }, commentsIn(state, block)),
});

/** Le rendu dépend aussi des commentaires et de l'arbre : le refaire, sans toucher au bloc en cours. */
watch(
  () => props.comments,
  (comments) => view?.dispatch({ effects: [setDocComments.of(comments), ...(props.live ? [refreshLive.of()] : [])] }),
);
watch(
  () => props.nodes,
  () => {
    if (props.live) view?.dispatch({ effects: refreshLive.of() });
  },
);

// --- Clics ---
function onClick(event: MouseEvent): void {
  const element = event.target as HTMLElement;
  if (!view) return;
  const box = element.closest<HTMLElement>('.cm-live-block');
  if (box && element instanceof HTMLInputElement && element.type === 'checkbox') {
    event.preventDefault();
    const from = view.posAtDOM(box);
    const block = live.blockAt(view.state, from);
    const line = block ? taskLine(view, from, block, [...box.querySelectorAll('input[type="checkbox"]')].indexOf(element)) : null;
    if (line !== null) toggleTask(view, line);
    return;
  }
  if (box && follow(element, event)) return;
  const collapsed = window.getSelection()?.isCollapsed ?? true;
  const mark = element.closest<HTMLElement>('[data-comment]');
  if (mark && (box ? collapsed : view.state.selection.main.empty)) {
    emit('focus-comment', Number(mark.dataset.comment));
    return;
  }
  if (!box || !collapsed) return;
  // Le clic ouvre le bloc avec le curseur à l'endroit visé.
  const from = view.posAtDOM(box);
  const block = live.blockAt(view.state, from);
  const offset = block ? sourceOffset(view.state.sliceDoc(block.from, block.to), textBeforePoint(box, event.clientX, event.clientY)) : 0;
  view.focus();
  view.dispatch({ selection: { anchor: Math.min(from + offset, view.state.doc.length) } });
}

/** Lien écrit sous une position du source : mention, lien wiki ou lien Markdown. */
function sourceLink(editor: EditorView, position: number): MenuTarget['link'] {
  const line = editor.state.doc.lineAt(position);
  for (const match of line.text.matchAll(/@\[[^\]\n]*\]\((user|ticket|doc):(\d+)\)|\[\[([^\]|#\n]+)[^\]\n]*\]\]|\[[^\]\n]*\]\(([^)\s]+)[^)\n]*\)/g)) {
    if (position < line.from + match.index || position > line.from + match.index + match[0].length) continue;
    if (match[1] === 'ticket') return { address: null, open: () => void openTicket(Number(match[2])) };
    if (match[1] === 'doc') return { address: null, open: () => openNode(Number(match[2])) };
    if (match[1]) return null;
    const target = (match[3] ?? match[4])!;
    if (/^https?:/i.test(target)) return { address: target, open: () => window.open(target, '_blank', 'noopener') };
    const node = resolveDocLink(props.nodes, props.notePath, target);
    return node ? { address: null, open: () => emit('open', node) } : null;
  }
  return null;
}

function renderedLink(element: HTMLElement, event: MouseEvent): MenuTarget['link'] {
  const link = element.closest<HTMLAnchorElement>('a');
  if (!link) return null;
  return { address: /^https?:/i.test(link.href) && !link.classList.contains('md-mention') ? link.href : null, open: () => void (follow(link, event) && !link.dataset.node && !link.classList.contains('md-mention') && window.open(link.href, '_blank', 'noopener')) };
}

/** Ce qui se trouve sous le clic droit, dans un bloc rendu ou dans le source. */
function targetOf(editor: EditorView, event: MouseEvent): MenuTarget {
  const element = event.target as HTMLElement;
  const box = element.closest<HTMLElement>('.cm-live-block');
  const text = editor.state.doc.toString();
  const blocks = markdownBlocks(text);
  const main = editor.state.selection.main;
  let selection: MenuTarget['selection'] = null;
  let quote: DocQuote | null = null;
  let selected = '';
  let position: number;
  if (box) {
    position = editor.posAtDOM(box);
    quote = selectionQuote(editor.contentDOM);
    selection = quote && findQuote(text, quote, true);
    selected = quote ? (window.getSelection()?.toString() ?? '') : '';
  } else {
    const at = editor.posAtCoords({ x: event.clientX, y: event.clientY }) ?? main.head;
    if (!main.empty && at >= main.from && at <= main.to) {
      selection = { from: main.from, to: main.to };
      quote = quoteFromSource(text, main.from, main.to);
      selected = text.slice(main.from, main.to);
      position = main.from;
    } else {
      editor.dispatch({ selection: { anchor: at } });
      position = at;
    }
  }
  const block = blocks.find((entry) => position >= entry.from && position <= entry.to) ?? null;
  const checkbox = box ? (element.closest('li')?.querySelector<HTMLInputElement>(':scope > input[type="checkbox"]') ?? null) : null;
  const task = box ? (checkbox && block ? taskLine(editor, position, block, [...box.querySelectorAll('input[type="checkbox"]')].indexOf(checkbox)) : null) : taskLine(editor, position);
  return {
    position,
    block,
    selection,
    quote,
    selected,
    link: box ? renderedLink(element, event) : sourceLink(editor, position),
    task,
    code: block?.type === 'code' ? text.slice(block.from, block.to).replace(/^[`~]{3,}[^\n]*\n|\n?[`~]{3,}\s*$/g, '') : null,
  };
}

const menu = ref<InstanceType<typeof ContextMenu> | null>(null);
const menuItems = ref<MenuItem[]>([]);

function onContextMenu(event: MouseEvent): void {
  if (!view) return;
  event.preventDefault();
  const editor = view;
  const menuHandlers: MenuHandlers = {
    ...handlers,
    comment: (quote) => emit('comment', quote),
    copy: (text) => void copyText(text),
    blocks: () => markdownBlocks(editor.state.doc.toString()),
  };
  menuItems.value = editorMenu(editor, targetOf(editor, event), menuHandlers);
  menu.value?.show(event);
}

/** Amène un passage commenté à l'écran et y place le curseur. */
function reveal(comment: DocCommentDTO): void {
  if (!view) return;
  const range = findQuote(view.state.doc.toString(), comment, true);
  if (!range) return;
  view.dispatch({ selection: { anchor: range.from, head: range.to }, effects: EditorView.scrollIntoView(range.from, { y: 'center' }) });
  view.focus();
}

/** Amène une ligne en haut de l'écran, sans y placer le curseur : le bloc reste rendu. */
function scrollToLine(line: number): void {
  if (!view) return;
  const position = view.state.doc.line(Math.min(line, view.state.doc.lines)).from;
  view.dispatch({ effects: EditorView.scrollIntoView(position, { y: 'start', yMargin: 12 }) });
}

defineExpose({ reveal, scrollToLine });

// Pour le sommaire : la ligne lue, signalée une fois par image.
let scrollFrame = 0;
function onScroll(): void {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    if (!view) return;
    const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop + 16);
    emit('top-line', view.state.doc.lineAt(block.from).number);
  });
}

const FONT_MONO = 'ui-monospace, SFMono-Regular, Consolas, monospace';

onMounted(() => {
  if (!host.value) return;
  const { text, awareness } = props.session;
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: text.toString(),
      extensions: [
        ...(props.live ? [live.extension] : [lineNumbers(), highlightActiveLine()]),
        docComments,
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        markdown(),
        EditorView.lineWrapping,
        placeholder(t('Écrivez en Markdown… @ pour mentionner, / pour insérer un élément.')),
        autocompletion({ override: [mentions, wikiLinks, slashCommands(handlers)], addToOptions: [{ render: completionIcon, position: 20 }] }),
        yCollab(text, awareness, { undoManager: new Y.UndoManager(text) }),
        keymap.of([
          { key: 'Mod-b', run: shortcut(t('Gras')) },
          { key: 'Mod-i', run: shortcut(t('Italique')) },
          { key: 'Mod-k', run: shortcut(t('Lien')), stopPropagation: true },
          ...yUndoManagerKeymap,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        editable.of(editableState(props.readonly)),
        EditorView.domEventHandlers({
          paste(event, editor) {
            const files = images(event.clipboardData?.files);
            if (!files.length) return false;
            event.preventDefault();
            void insertImages(files, editor.state.selection.main.head);
            return true;
          },
          drop(event, editor) {
            const files = images(event.dataTransfer?.files);
            if (!files.length) return false;
            event.preventDefault();
            void insertImages(files, editor.posAtCoords({ x: event.clientX, y: event.clientY }) ?? editor.state.selection.main.head);
            return true;
          },
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '0.9rem', backgroundColor: 'transparent', color: 'var(--fb-text)' },
          '&.cm-focused': { outline: 'none' },
          '.cm-scroller': { fontFamily: FONT_MONO, lineHeight: '1.55' },
          '.cm-gutters': { backgroundColor: 'transparent', borderRight: '1px solid var(--fb-border)', color: 'var(--fb-muted)' },
          '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--fb-text) 5%, transparent)' },
          '.cm-cursor': { borderLeftColor: 'var(--fb-text)' },
          '.cm-tooltip': { border: '1px solid var(--fb-border)', backgroundColor: 'var(--fb-panel)', color: 'var(--fb-text)' },
          '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'inherit', maxHeight: '18rem' },
          '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '0.2rem 0.5rem' },
          '.cm-slash-icon': { width: '1.4rem', color: 'var(--fb-muted)', fontSize: '0.8rem' },
          '.cm-ySelectionInfo': { padding: '1px 4px', borderRadius: '4px', fontFamily: 'inherit', fontSize: '0.7rem', fontWeight: '600', opacity: '1' },
          '.cm-doc-comment': { borderRadius: '2px', backgroundColor: 'color-mix(in srgb, #f59e0b 28%, transparent)' },
          ...(props.live
            ? {
                '.cm-scroller': { fontFamily: 'inherit', fontSize: '1rem', lineHeight: '1.6' },
                '.cm-content': { boxSizing: 'border-box', width: '100%', maxWidth: '55rem', margin: '0 auto', padding: '1.25rem 1.5rem 3rem' },
                '.cm-line': { padding: '0', fontFamily: FONT_MONO, fontSize: '0.9rem' },
                '.cm-live-block': { padding: '0.15rem 0.35rem', margin: '0 -0.35rem', borderRadius: '6px', cursor: 'text', whiteSpace: 'normal' },
                '.cm-live-block:hover': { backgroundColor: 'color-mix(in srgb, var(--fb-text) 4%, transparent)' },
              }
            : {}),
        }),
      ],
    }),
  });
  view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });
  if (props.comments.length) view.dispatch({ effects: [setDocComments.of(props.comments), ...(props.live ? [refreshLive.of()] : [])] });
  // En lecture et écriture, un curseur posé d'office ouvrirait le premier bloc.
  if (!props.live) view.focus();
});

watch(
  () => props.readonly,
  (readonly) => view?.dispatch({ effects: editable.reconfigure(editableState(readonly)) }),
);

onBeforeUnmount(() => {
  cancelAnimationFrame(scrollFrame);
  view?.destroy();
  view = null;
});
</script>

<template>
  <div class="doc-editor">
    <div class="tools" role="toolbar" :aria-label="$t('Mise en forme')">
      <template v-for="(tool, index) in toolbar" :key="index">
        <span v-if="tool === 'sep'" class="sep"></span>
        <button v-else v-tooltip.bottom="tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label" type="button" class="tool" :aria-label="tool.label" @mousedown.prevent @click="runTool(tool)">
          <i :class="tool.icon"></i>
        </button>
      </template>
      <span class="hint muted small">{{ $t('/ pour insérer · clic droit pour plus d’actions') }}</span>
    </div>
    <div ref="host" class="host" @click="onClick" @contextmenu="onContextMenu"></div>
    <input ref="picker" type="file" accept="image/*" multiple class="picker" @change="onPicked" />
    <ContextMenu ref="menu" :model="menuItems" />
  </div>
</template>

<style scoped>
.doc-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.05rem;
  padding: 0.15rem 0.5rem;
  border-bottom: 1px solid var(--fb-border);
}
.tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--fb-muted);
  font-size: 0.8rem;
  cursor: pointer;
}
.tool:hover {
  background: var(--fb-panel-alt);
  color: var(--fb-text);
}
.sep {
  width: 1px;
  height: 1rem;
  margin: 0 0.25rem;
  background: var(--fb-border);
}
.hint {
  flex: 1 1 0;
  min-width: 0;
  padding-left: 0.5rem;
  overflow: hidden;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.host {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.host :deep(.cm-editor) {
  height: 100%;
}
.picker {
  display: none;
}
@media (max-width: 900px) {
  .hint {
    display: none;
  }
}
</style>
