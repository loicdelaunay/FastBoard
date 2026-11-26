<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, pickedCompletion, startCompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSection } from '@codemirror/autocomplete';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches } from '@codemirror/search';
import { Compartment, EditorState } from '@codemirror/state';
import { drawSelection, dropCursor, EditorView, GutterMarker, highlightActiveLine, keymap, lineNumbers, lineNumberWidgetMarker, placeholder, type Command } from '@codemirror/view';
import ContextMenu from 'primevue/contextmenu';
import type { MenuItem } from 'primevue/menuitem';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import * as Y from 'yjs';
import { citedElementsOf, citedLinesOf, citedVersionOf, linesLabel, type LineRange } from '@shared/citations';
import { findQuote, quoteFromSource, sourceOffset, type DocCommentDTO, type DocQuote } from '@shared/docComments';
import { findHeading, imageMarkdown, resolveDocLink } from '@shared/docLinks';
import { docOutline } from '@shared/docOutline';
import { docBaseName, docParent, docTitle, type DocNodeDTO } from '@shared/docs';
import type { UserSummaryDTO } from '@shared/types';
import { api } from '@/api';
import { useDocLinks, wantsNewTab } from '@/composables/useDocLinks';
import { useAppStore } from '@/stores/app';
import { codeLanguage } from '@/utils/codeHighlight';
import { boardCitationRoute, docCitationRoute } from '@/utils/citations';
import type { DocSession } from '@/realtime/docSession';
import { copyText, pendingAnchor, renderDocBlock, selectionQuote } from '@/utils/docRender';
import { markdownBlocks } from '@/utils/markdown';
import { mentionToken } from '@/utils/mentions';
import { mentionFilterInfo, mentionFilters, searchMentions, type MentionFilter, type MentionGroup, type MentionSources, type MentionSuggestion } from '@/utils/mentionSources';
import MentionPickerDialog from '@/components/common/MentionPickerDialog.vue';
import DocImagePickerDialog from '@/components/docs/DocImagePickerDialog.vue';
import CodeLanguagePicker from '@/components/docs/CodeLanguagePicker.vue';
import { fenceLanguageChange, matchingFences } from '@shared/codeFences';
import { notify, notifyError } from '@/utils/notify';
import { pickImage } from '@/utils/image';
import { docImageIdOf, docImageUrl, replaceDocImage } from '@/utils/replaceImage';
import { matchesQuery, normalizeText } from '@/utils/search';
import { boardChoice, boardMentionAt, showBoardChoice } from './editor/boardMention';
import { taskLine, toggleTask } from './editor/commands';
import { citedLines, showCitedLines } from './editor/cited';

/** Numéros de ligne (bouton « Numéros de ligne ») : la gouttière, et une classe pour la coller au texte en « Lecture et écriture ». */
const numbering = new Compartment();
/** Numéro de la première ligne d'un bloc rendu (tableau, code, schéma…) en « Lecture et écriture ». */
class FirstLineNumber extends GutterMarker {
  constructor(readonly number: number) {
    super();
  }
  override eq(other: FirstLineNumber): boolean {
    return other.number === this.number;
  }
  override toDOM(): Node {
    return document.createTextNode(String(this.number));
  }
}
const numbersOf = (on: boolean) =>
  on
    ? [
        lineNumbers(),
        // Un bloc rendu remplace ses lignes : il porte le numéro de la première (un widget inséré, aucun).
        lineNumberWidgetMarker.of((view, _widget, block) => (block.to > block.from ? new FirstLineNumber(view.state.doc.lineAt(block.from).number) : null)),
        EditorView.editorAttributes.of({ class: 'cm-numbered' }),
      ]
    : [];
import { docComments, setDocComments } from './editor/comments';
import { docHighlight, docLiveHighlight } from './editor/highlight';
import { editImageSource, liveInline } from './editor/liveInline';
import { livePreview, refreshLive, textBeforePoint } from './editor/live';
import { markdownFromHtmlTable, tableCellAt } from './editor/tableWidget';
import { editorMenu, type MenuHandlers, type MenuTarget } from './editor/menu';
import { completionIcon, inlineTools, insertTools, lineTools, slashCommands, type DocTool, type ToolHandlers } from './editor/tools';
import { NO_RESULT, type FindOptions, type FindResult } from './find/find';
import { findField, setFindState } from './editor/findState';
import { markdownLines, parseNoteSearch, runNoteSearch, type ParsedSearch, type SearchMatch } from '@shared/noteSearch';
import { highlightColors } from './editor/highlightColors';

import { t } from '@/i18n';
import { spellcheck } from '@/theme/themeManager';
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
  /** Syntaxe propre à Obsidian (réglage de l'espace). */
  obsidian?: boolean;
  /** Numéros de ligne dans la marge. */
  lineNumbers?: boolean;
}>();
const emit = defineEmits<{
  open: [node: DocNodeDTO, newTab?: boolean];
  comment: [quote: DocQuote];
  'focus-comment': [commentId: number];
  /** Ligne du source en haut de l'éditeur, et la part déjà défilée de cette ligne (0–1) quand elle est longue. */
  'top-line': [line: number, fraction: number];
  /** Ligne du curseur, et sa hauteur dans l'éditeur (0 en haut, 1 en bas) : l'aperçu se cale dessus. */
  'cursor-line': [line: number, ratio: number];
}>();

const host = ref<HTMLElement | null>(null);
const picker = ref<HTMLInputElement | null>(null);
let view: EditorView | null = null;
const editable = new Compartment();
const editableState = (readonly: boolean) => [EditorState.readOnly.of(readonly), EditorView.editable.of(!readonly)];
/** Correcteur orthographique du navigateur (préférence du compte) : CodeMirror le coupe d'office, on le rallume. */
const spelling = new Compartment();
const spellingState = (enabled: boolean) => EditorView.contentAttributes.of({ spellcheck: enabled ? 'true' : 'false', autocorrect: enabled ? 'on' : 'off' });
watch(spellcheck, (enabled) => view?.dispatch({ effects: spelling.reconfigure(spellingState(enabled)) }));

const router = useRouter();
const app = useAppStore();
const { follow, openNode, openTicket } = useDocLinks(
  () => props.nodes,
  (node, newTab) => emit('open', node, newTab),
);

/** Adresse web : toujours dans un autre onglet du navigateur, pas dans la documentation. */
function openAddress(url: string): void {
  window.open(url, '_blank', 'noopener');
}

// --- Mentions « @ » : pastilles de filtre par type en tête de liste, et « Voir tout » quand il y en a plus ---
const mentionSources = computed<MentionSources>(() => ({ people: props.users, docs: app.info.docs, boards: app.info.boards }));
/** Type choisi pour la mention en cours ; chaque nouvelle mention repart de « Tout ». */
let mentionFilter: MentionFilter = 'all';
let mentionStart = -1;
const mentionPickerOpen = ref(false);
const mentionPending = ref<{ from: number; to: number; query: string; filter: MentionFilter } | null>(null);

/** Pastilles de filtre, dans la liste de CodeMirror : un clic garde le focus dans le texte et relance la recherche. */
function mentionFilterBar(editor: EditorView): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'mention-filters cm-mention-filters';
  for (const entry of mentionFilters(mentionSources.value)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `mention-filter${entry.key === mentionFilter ? ' active' : ''}`;
    button.style.setProperty('--chip-color', entry.color);
    const icon = document.createElement('i');
    icon.className = entry.icon;
    button.append(icon, t(entry.label));
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      mentionFilter = entry.key;
      startCompletion(editor);
    });
    bar.append(button);
  }
  return bar;
}

/** Titre d'un type dans la liste (le premier porte aussi les pastilles de filtre). */
function mentionSection(editor: EditorView, group: MentionGroup | 'more', rank: number, withFilters: boolean): CompletionSection {
  return {
    name: group,
    rank,
    header: () => {
      const box = document.createElement('div');
      box.className = 'cm-mention-head';
      if (withFilters) box.append(mentionFilterBar(editor));
      if (group !== 'more') {
        const info = mentionFilterInfo(group);
        const title = document.createElement('div');
        title.className = 'cm-mention-title';
        title.style.setProperty('--chip-color', info.color);
        const icon = document.createElement('i');
        icon.className = info.icon;
        title.append(icon, t(info.label));
        box.append(title);
      } else if (!withFilters) box.classList.add('more');
      return box;
    },
  };
}

/** Pose la mention entre `from` et `to` ; un tableau blanc ouvre la petite barre de son affichage. */
function insertMention(editor: EditorView, suggestion: MentionSuggestion, from: number, to: number, completion?: Completion): void {
  const insert = `${mentionToken(suggestion.kind, suggestion.id, suggestion.label, null, suggestion.suffix)} `;
  editor.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    ...(suggestion.kind === 'board' && !suggestion.suffix ? { effects: showBoardChoice.of(from) } : {}),
    ...(completion ? { annotations: pickedCompletion.of(completion) } : {}),
    userEvent: 'input.complete',
  });
}

/** `@` propose les personnes, les tickets, les notes, les tableaux et les versions étiquetées, filtrables par type. */
async function mentions(context: CompletionContext): Promise<CompletionResult | null> {
  const match = context.matchBefore(/(^|[\s(])@[^\s@[\]()]{0,30}/);
  if (!match) return null;
  const at = match.text.indexOf('@');
  const from = match.from + at;
  const query = match.text.slice(at + 1);
  if (from !== mentionStart) {
    mentionStart = from;
    mentionFilter = 'all';
  }
  const filter = mentionFilter;
  const found = await searchMentions(query, filter, filter === 'all' ? 4 : 8, mentionSources.value);
  if (context.aborted) return null;
  const editor = context.view;
  if (!editor) return null;
  const groups = [...new Set(found.items.map((item) => item.group))];
  const sections = new Map(groups.map((group, index) => [group, mentionSection(editor, group, index, index === 0)]));
  const options: Completion[] = found.items.map((suggestion) => {
    const info = mentionFilterInfo(suggestion.group);
    return {
      label: suggestion.label,
      detail: suggestion.hint,
      type: 'mention',
      section: sections.get(suggestion.group),
      icon: info.icon,
      color: info.color,
      apply: (view: EditorView, completion: Completion, start: number, end: number) => insertMention(view, suggestion, start, end, completion),
    } as Completion;
  });
  if (!options.length) {
    // Rien pour ce type : la liste reste ouverte, pour changer de filtre.
    if (filter === 'all' && !query) return null;
    options.push({
      label: filter === 'all' ? t('Rien ne correspond.') : t('Rien ne correspond : revenir à « Tout »'),
      type: 'mention',
      section: mentionSection(editor, 'more', 0, true),
      icon: 'pi pi-filter-slash',
      apply: (view: EditorView) => {
        mentionFilter = 'all';
        startCompletion(view);
      },
    } as Completion);
  } else if (found.more) {
    options.push({
      label: t('Voir tout…'),
      detail: t('Chercher parmi tous les éléments'),
      type: 'mention',
      section: mentionSection(editor, 'more', groups.length, false),
      icon: 'pi pi-search-plus',
      color: 'var(--fb-accent)',
      apply: (_view: EditorView, _completion: Completion, start: number, end: number) => {
        mentionPending.value = { from: start, to: end, query, filter };
        mentionPickerOpen.value = true;
      },
    } as Completion);
  }
  return { from, filter: false, options };
}

/** Élément choisi dans « Voir tout » : il remplace la mention commencée si elle est toujours là, sinon il va au curseur. */
function pickMention(suggestion: MentionSuggestion): void {
  const pending = mentionPending.value;
  mentionPending.value = null;
  if (!view) return;
  const still = pending !== null && view.state.sliceDoc(pending.from, pending.to) === `@${pending.query}`;
  const { from, to } = still ? pending : view.state.selection.main;
  insertMention(view, suggestion, from, to);
  view.focus();
}

/** Texte le plus court qui désigne `node` depuis la note, comme dans Obsidian : son nom, sinon son chemin. */
function linkTarget(node: DocNodeDTO): string {
  const name = node.kind === 'markdown' ? docTitle(node.path) : docBaseName(node.path);
  if (resolveDocLink(props.nodes, props.notePath, name)?.id === node.id) return name;
  return node.kind === 'markdown' ? node.path.replace(/\.md$/i, '') : node.path;
}

/** Aperçu agrandi d'une image proposée, à côté de la liste. */
function imageInfo(node: DocNodeDTO): HTMLElement {
  const box = document.createElement('div');
  box.className = 'cm-image-info';
  const image = document.createElement('img');
  image.src = docImageUrl(node);
  image.alt = docBaseName(node.path);
  const caption = document.createElement('span');
  caption.textContent = node.path;
  box.append(image, caption);
  return box;
}

const WIKI_RESULTS = 60;

/**
 * `[[` propose les notes et les images de l'espace, cherchées dans leur nom et leur chemin (une image s'insère
 * en `![[…]]`, avec sa miniature) ; `[[#` propose les titres de la note.
 */
function wikiLinks(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/!?\[\[[^\]\n]*/);
  if (!match) return null;
  const embed = match.text.startsWith('!');
  const start = match.from + (embed ? 3 : 2);
  const query = match.text.slice(embed ? 3 : 2);
  if (query.includes('|')) return null;
  const close = (editor: EditorView, to: number): number => (editor.state.sliceDoc(to, to + 2) === ']]' ? to + 2 : to);

  if (query.startsWith('#')) {
    const wanted = query.slice(1);
    return {
      from: start + 1,
      filter: false,
      options: docOutline(context.state.doc.toString())
        .filter((heading) => matchesQuery(wanted, [heading.title]))
        .slice(0, WIKI_RESULTS)
        .map((heading): Completion => ({
          label: heading.title,
          detail: `H${heading.level}`,
          type: 'keyword',
          apply: (editor, completion, from, to) => {
            const text = `${heading.title}]]`;
            editor.dispatch({ changes: { from, to: close(editor, to), insert: text }, selection: { anchor: from + text.length }, annotations: pickedCompletion.of(completion) });
          },
        })),
    };
  }

  const wanted = normalizeText(query);
  const rank = (node: DocNodeDTO): number | null => {
    const name = normalizeText(node.kind === 'markdown' ? docTitle(node.path) : docBaseName(node.path));
    // Les images d'abord après `![[`, les notes d'abord après `[[`.
    const kind = (node.kind === 'image') === embed ? 0 : 10;
    if (!wanted) return kind;
    if (name.startsWith(wanted)) return kind;
    if (name.includes(wanted)) return kind + 1;
    return matchesQuery(query, [node.path]) ? kind + 2 : null;
  };
  const options = props.nodes
    .filter((node) => node.kind !== 'folder' && node.path !== props.notePath)
    .map((node) => ({ node, score: rank(node) }))
    .filter((entry): entry is { node: DocNodeDTO; score: number } => entry.score !== null)
    .sort((a, b) => a.score - b.score || a.node.path.localeCompare(b.node.path, undefined, { sensitivity: 'base', numeric: true }))
    .slice(0, WIKI_RESULTS)
    .map(({ node }): Completion & { icon?: string; thumb?: string } => {
      const image = node.kind === 'image';
      return {
        label: image ? docBaseName(node.path) : docTitle(node.path),
        detail: docParent(node.path) || undefined,
        type: image ? 'doc-image' : 'doc-note',
        ...(image ? { thumb: docImageUrl(node), info: () => imageInfo(node) } : { icon: 'pi pi-file' }),
        apply: (editor, completion, from, to) => {
          const text = `${linkTarget(node)}]]`;
          // Une image s'intègre : le « ! » s'ajoute devant les crochets s'il manque.
          const bang = image && !embed ? 1 : 0;
          editor.dispatch({
            changes: [...(bang ? [{ from: from - 2, insert: '!' }] : []), { from, to: close(editor, to), insert: text }],
            selection: { anchor: from + bang + text.length },
            annotations: pickedCompletion.of(completion),
          });
        },
      };
    });
  return { from: start, filter: false, options };
}

/**
 * « Remplacer l'image » sur une image de la note. Une image de l'espace est remplacée sur place (elle change partout où
 * elle est montrée). Une image d'un autre site, affichée seule, est remplacée par une image envoyée dans l'espace : son
 * adresse change dans le Markdown.
 */
function imageReplacer(editor: EditorView, src: string, figure: HTMLElement | null, range?: { from: number; to: number }): (() => void) | null {
  const imageId = docImageIdOf(src);
  const node = imageId === null ? undefined : props.nodes.find((entry) => entry.id === imageId);
  if (node) return () => void replaceDocImage(node);
  if ((!figure && !range) || !/^https?:/i.test(src)) return null;
  const from = range?.from ?? editor.posAtDOM(figure!);
  const to = range?.to ?? from + Number(figure!.dataset.length ?? 0);
  const source = editor.state.sliceDoc(from, to);
  const link = /^(!\[[^\]\n]*\]\()(<[^>\n]*>|[^)\s]+)/.exec(source);
  if (!link) return null;
  return () =>
    void (async () => {
      const file = await pickImage();
      if (!file) return;
      try {
        const { node: added } = await api.docUploadImage(props.spaceId, docParent(props.notePath), file);
        // Le texte a pu bouger pendant l'envoi : on retrouve le lien à sa place, sinon on renonce.
        if (editor.state.sliceDoc(from, to) !== source) throw new Error(t('La note a changé pendant l’envoi : l’image a été ajoutée à l’espace, mais pas remplacée ici.'));
        const target = /\(([^)\s]+)\)$/.exec(imageMarkdown(props.notePath, added.path))![1]!;
        const start = from + link[1]!.length;
        editor.dispatch({ changes: { from: start, to: start + link[2]!.length, insert: target }, userEvent: 'input' });
        notify('success', t('Image remplacée'), t('La nouvelle image est rangée dans l’espace.'));
      } catch (error) {
        notifyError(error, t('Image non remplacée'));
      }
    })();
}

/** Image écrite sous une position du source (mode Écriture) : son adresse et de quoi la remplacer. */
function sourceImage(editor: EditorView, position: number): MenuTarget['image'] {
  const line = editor.state.doc.lineAt(position);
  for (const match of line.text.matchAll(/!\[\[([^\]|#\n]+)[^\]\n]*\]\]|!\[[^\]\n]*\]\((<[^>\n]*>|[^)\s]+)[^)\n]*\)/g)) {
    const from = line.from + match.index;
    const to = from + match[0].length;
    if (position < from || position > to) continue;
    const written = (match[1] ?? match[2] ?? '').replace(/^<|>$/g, '').trim();
    let src = written;
    if (!/^(https?:|data:)/i.test(written)) {
      let target = written;
      try {
        if (!match[1]) target = decodeURIComponent(written);
      } catch {
        // Adresse mal encodée : prise telle quelle.
      }
      const node = resolveDocLink(props.nodes, props.notePath, target);
      if (node?.kind !== 'image') return null;
      src = docImageUrl(node);
    }
    return { src, alt: '', edit: null, replace: props.readonly ? null : imageReplacer(editor, src, null, { from, to }) };
  }
  return null;
}

/** Lien d'image à poser à `position` : sur sa propre ligne, même si le curseur est au milieu d'un texte. */
function imageLine(path: string, position: number): string {
  const before = position > 0 ? (view?.state.sliceDoc(position - 1, position) ?? '\n') : '\n';
  return `${before === '\n' ? '' : '\n'}${imageMarkdown(props.notePath, path)}\n`;
}

/** Une image collée ou glissée est envoyée au serveur, puis son lien s'insère au curseur. */
async function insertImages(files: File[], position: number): Promise<void> {
  for (const file of files) {
    try {
      const { node } = await api.docUploadImage(props.spaceId, docParent(props.notePath), file);
      const text = imageLine(node.path, Math.min(position, view?.state.doc.length ?? 0));
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

// « Image » (barre d’outils, « / ») : une image déjà dans l’espace, ou une nouvelle depuis l’ordinateur.
const imagePickerOpen = ref(false);
const handlers: ToolHandlers = { pickImage: () => (imagePickerOpen.value = true) };

/** Image de l’espace choisie : son lien s’insère au curseur, comme une image envoyée. */
function insertExistingImage(node: DocNodeDTO): void {
  if (!view) return;
  const position = view.state.selection.main.head;
  const text = imageLine(node.path, position);
  view.dispatch({ changes: { from: position, insert: text }, selection: { anchor: position + text.length }, userEvent: 'input' });
  view.focus();
}

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
  render: (source, block, state) => renderDocBlock(source, { nodes: props.nodes, notePath: props.notePath, users: props.users, obsidian: props.obsidian }, commentsIn(state, block)),
  obsidian: () => props.obsidian ?? false,
  follow: (element, event) => followCell(element, event),
  undo: (editor) => void yUndoManagerKeymap[0]!.run!(editor),
  redo: (editor) => void yUndoManagerKeymap[1]!.run!(editor),
});

/** Lien cliqué dans une cellule de tableau : comme dans un bloc rendu, adresses externes comprises. */
function followCell(element: HTMLElement, event: MouseEvent): boolean {
  if (follow(element, event)) return true;
  const link = element.closest<HTMLAnchorElement>('a');
  if (!link || !/^(https?:|mailto:)/i.test(link.getAttribute('href') ?? '')) return false;
  window.open(link.href, '_blank', 'noopener');
  return true;
}

/** Suit un lien rendu dans le texte : mention, note de l'espace (lien Markdown ou wiki) ou adresse externe. */
function followRendered(element: HTMLElement, event: MouseEvent): boolean {
  const { kind, id, href, wiki, suffix } = element.dataset;
  if (kind && id) {
    const lines = citedLinesOf(suffix);
    const version = citedVersionOf(suffix);
    if (kind === 'user') void router.push({ name: 'user', params: { id } });
    else if (kind === 'ticket') void openTicket(Number(id));
    else if (kind === 'board') void router.push(boardCitationRoute(Number(id), citedElementsOf(suffix), version));
    else if (kind === 'project') void router.push({ name: 'project', params: { projectId: id } });
    else if ((lines || version) && !wantsNewTab(event)) void router.push(docCitationRoute(Number(id), lines, version));
    else openNode(Number(id), wantsNewTab(event));
    return true;
  }
  if (href && /^https?:/i.test(href)) {
    openAddress(href);
    return true;
  }
  if (href && /^mailto:/i.test(href)) {
    window.open(href, '_blank', 'noopener');
    return true;
  }
  let raw = wiki ?? href ?? '';
  try {
    if (!wiki) raw = decodeURIComponent(raw);
  } catch {
    // Adresse mal encodée : prise telle quelle.
  }
  const [target = '', heading] = raw.split('#');
  // Un titre de la note : on y va, sans ouvrir le lien en écriture (un clic au bout de la ligne le fait).
  if (!target.trim()) {
    if (heading === undefined) return false;
    scrollToAnchor(heading);
    return true;
  }
  const node = resolveDocLink(props.nodes, props.notePath, target.trim());
  if (!node) return false;
  pendingAnchor.value = heading ? { path: node.path, heading } : null;
  emit('open', node, wantsNewTab(event));
  return true;
}

const inline = liveInline({
  obsidian: () => props.obsidian ?? false,
  skipped: (state) => live.complexRanges(state),
  imageUrl: (target) => {
    const node = resolveDocLink(props.nodes, props.notePath, target);
    return node?.kind === 'image' ? docImageUrl(node) : null;
  },
  mentionLabel: (kind, id, label, suffix) => {
    if (kind === 'user') return `@${props.users.find((user) => user.id === id)?.name ?? label}`;
    const lines = kind === 'doc' ? citedLinesOf(suffix) : null;
    return lines && !/\b(?:l|ll|lignes?|lines?)\.?\s*\d/i.test(label) ? `${label} · l. ${linesLabel(lines)}` : label;
  },
  follow: (element, event) => followRendered(element, event),
});

/** Le rendu dépend aussi des commentaires et de l'arbre : le refaire, sans toucher au bloc en cours. */
watch(
  () => props.comments,
  (comments) => view?.dispatch({ effects: [setDocComments.of(comments), ...(props.live ? [refreshLive.of()] : [])] }),
);
watch(
  () => props.lineNumbers,
  (on) => view?.dispatch({ effects: numbering.reconfigure(numbersOf(on)) }),
);
watch(
  () => props.nodes,
  () => {
    if (props.live) view?.dispatch({ effects: refreshLive.of() });
  },
);

// --- Clics ---
// --- Langage d'un bloc de code (pastille en haut à droite du bloc rendu) ---
const languagePicker = ref<InstanceType<typeof CodeLanguagePicker> | null>(null);

/** Propose un autre langage pour le bloc de code rendu dans `box`, puis l'écrit après sa clôture d'ouverture. */
function pickCodeLanguage(event: MouseEvent, box: HTMLElement, chip: HTMLElement): void {
  if (!view) return;
  const lang = chip.dataset.lang ?? '';
  const code = chip.closest('pre')?.querySelector('code')?.textContent ?? '';
  const start = view.posAtDOM(box);
  // Rang du bloc parmi ceux de même langage et de même code : il le retrouve même si le texte a bougé entre-temps.
  const occurrence = matchingFences(view.state.doc.toString(), lang, code).findIndex((fence) => fence.from >= start);
  if (occurrence < 0) return;
  languagePicker.value?.open(event, chip, lang, (next) => {
    if (!view) return;
    const text = view.state.doc.toString();
    const fence = matchingFences(text, lang, code)[occurrence];
    if (!fence) {
      notify('warn', t('Ce bloc de code a changé entre-temps.'));
      return;
    }
    view.dispatch({ changes: fenceLanguageChange(text, fence, next), userEvent: 'input' });
  });
}

function onClick(event: MouseEvent): void {
  const element = event.target as HTMLElement;
  if (!view || element.closest('.cm-table-editor')) return;
  const box = element.closest<HTMLElement>('.cm-live-block');
  const chip = element.closest<HTMLElement>('.md-code-lang');
  if (box && chip) {
    event.preventDefault();
    if (!props.readonly) pickCodeLanguage(event, box, chip);
    return;
  }
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
  for (const match of line.text.matchAll(/@\[[^\]\n]*\]\((user|ticket|doc|board|project):(\d+)(?:#([A-Za-z0-9:,_-]{1,400}))?\)|\[\[([^\]|#\n]+)[^\]\n]*\]\]|\[[^\]\n]*\]\(([^)\s]+)[^)\n]*\)/g)) {
    if (position < line.from + match.index || position > line.from + match.index + match[0].length) continue;
    if (match[1] === 'ticket') return { address: null, open: () => void openTicket(Number(match[2])) };
    const lines = citedLinesOf(match[3]);
    const version = citedVersionOf(match[3]);
    if (match[1] === 'doc' && (lines || version)) return { address: null, open: () => void router.push(docCitationRoute(Number(match[2]), lines, version)) };
    if (match[1] === 'doc') return { address: null, open: () => openNode(Number(match[2])) };
    if (match[1] === 'board') return { address: null, open: () => void router.push(boardCitationRoute(Number(match[2]), citedElementsOf(match[3]), version)) };
    if (match[1] === 'project') return { address: null, open: () => void router.push({ name: 'project', params: { projectId: match[2]! } }) };
    if (match[1]) return null;
    const target = (match[4] ?? match[5])!;
    if (/^https?:/i.test(target)) return { address: target, open: () => openAddress(target) };
    const node = resolveDocLink(props.nodes, props.notePath, target);
    return node ? { address: null, open: () => emit('open', node) } : null;
  }
  return null;
}

function renderedLink(element: HTMLElement, event: MouseEvent): MenuTarget['link'] {
  const link = element.closest<HTMLAnchorElement>('a');
  if (!link) return null;
  const web = /^https?:/i.test(link.href) && !link.classList.contains('md-mention') && !link.dataset.node;
  return { address: web ? link.href : null, open: () => (web ? openAddress(link.href) : void follow(link, event)) };
}

/** Ce qui se trouve sous le clic droit, dans un bloc rendu ou dans le source. */
function targetOf(editor: EditorView, event: MouseEvent): MenuTarget {
  const element = event.target as HTMLElement;
  const box = element.closest<HTMLElement>('.cm-live-block, .cm-table-editor');
  const figure = element.closest<HTMLElement>('.cm-lp-figure');
  /** Tableau blanc cité, affiché rendu (pastille, carte, image ou vue intégrée). */
  const boardBox = element.closest<HTMLElement>('.cm-lp-board, .cm-lp-mention.board');
  const picture = element.closest<HTMLImageElement>('img');
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
  } else if (figure || boardBox) {
    // Le curseur ne bouge pas : il ferait réapparaître le Markdown de l'image (ou du tableau cité) sous le menu.
    position = editor.posAtDOM((figure ?? boardBox)!);
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
  const shown = box ? live.blockAt(editor.state, position) : undefined;
  const rendered = shown ? { from: editor.state.doc.lineAt(shown.from).from, to: editor.state.doc.lineAt(shown.to).to } : null;
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
    rendered,
    cell: box ? tableCellAt(element) : null,
    image:
      picture && (figure || box)
        ? {
            src: picture.currentSrc || picture.src,
            alt: picture.alt,
            edit: figure ? () => editImageSource(editor, figure) : null,
            replace: props.readonly ? null : imageReplacer(editor, picture.currentSrc || picture.src, figure),
          }
        : box || figure
          ? null
          : sourceImage(editor, position),
    board: box ? null : boardMentionAt(editor.state, position),
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

/**
 * Met en haut de l'éditeur la ligne `line` du source ; sa partie décimale avance dans une longue ligne (paragraphe
 * replié sur plusieurs lignes d'écran). Sert à garder sa place en changeant de mode.
 */
function scrollToSourceLine(line: number): void {
  if (!view) return;
  const doc = view.state.doc;
  const whole = Math.min(Math.max(1, Math.floor(line)), doc.lines);
  const target = doc.line(whole);
  const position = target.from + Math.round((line - whole) * target.length);
  view.dispatch({ effects: EditorView.scrollIntoView(position, { y: 'start', yMargin: 16 }) });
}

/** Amène au titre visé par une ancre (`#1.1.1 UAV OAT`, `#uav-oat`…) ou à un bloc `#^id` ; faux s'il n'existe pas. */
function scrollToAnchor(anchor: string): boolean {
  if (!view) return false;
  const text = view.state.doc.toString();
  const headings = docOutline(text);
  const index = findHeading(
    headings.map((heading) => heading.title),
    anchor,
    headings.map((heading) => heading.ids),
  );
  if (index >= 0) {
    scrollToLine(headings[index]!.line);
    return true;
  }
  const block = /^\^([\w-]+)$/.exec(anchor.trim());
  const line = block ? text.split('\n').findIndex((entry) => new RegExp(`\\s\\^${block[1]}\\s*$`).test(entry)) : -1;
  if (line < 0) return false;
  scrollToLine(line + 1);
  return true;
}

/** Ancre demandée en ouvrant la note (lien `[[Note#Titre]]` suivi d'une autre note) : dès que le texte est là. */
function takePendingAnchor(): void {
  const anchor = pendingAnchor.value;
  if (!anchor || anchor.path !== props.notePath) return;
  if (scrollToAnchor(anchor.heading)) pendingAnchor.value = null;
}

/**
 * Insère des blocs (un modèle) au curseur, à la place de la sélection : ils commencent et finissent sur leurs propres
 * lignes s'il y a du texte autour. Faux sans éditeur.
 */
function insertBlock(text: string): boolean {
  if (!view) return false;
  const { state } = view;
  const { from, to } = state.selection.main;
  const body = text.replace(/\n+$/, '');
  const before = state.sliceDoc(state.doc.lineAt(from).from, from).trim() ? '\n\n' : '';
  const after = state.sliceDoc(to, state.doc.lineAt(to).to).trim() ? '\n\n' : '';
  const insert = `${before}${body}${after}`;
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + before.length + body.length }, scrollIntoView: true });
  view.focus();
  return true;
}

// --- Recherche (Ctrl F), pilotée par la barre de la note : syntaxe d'Obsidian, dans le source Markdown ---

let findQuery: { parsed: ParsedSearch; options: FindOptions } | null = null;

function computeMatches(): SearchMatch[] {
  if (!view || !findQuery) return [];
  const text = view.state.doc.toString();
  return runNoteSearch(findQuery.parsed, text, markdownLines(text));
}

/** Rang du résultat sélectionné dans l'éditeur, sinon celui retenu. */
function currentIndex(matches: readonly SearchMatch[], fallback: number): number {
  if (!view) return -1;
  const { from, to } = view.state.selection.main;
  const exact = matches.findIndex((match) => match.from === from && match.to === to);
  return exact >= 0 ? exact : Math.min(fallback, matches.length - 1);
}

/** Choisit un résultat : il devient la sélection, au milieu de l'écran. */
function showMatch(matches: SearchMatch[], current: number): void {
  if (!view) return;
  const match = matches[current];
  view.dispatch({
    effects: [setFindState.of({ matches, current }), ...(match ? [EditorView.scrollIntoView(match.from, { y: 'center' })] : [])],
    ...(match ? { selection: { anchor: match.from, head: match.to }, userEvent: 'select.search' } : {}),
  });
}

/** Nombre de résultats et rang du résultat choisi, sans rien modifier (le curseur vient de bouger). */
function findResult(): FindResult {
  if (!view || !findQuery) return NO_RESULT;
  if (findQuery.parsed.error) return { ...NO_RESULT, invalid: true };
  const state = view.state.field(findField, false);
  const matches = state?.matches ?? [];
  const current = currentIndex(matches, state?.current ?? 0);
  // Le résultat sous le curseur devient le résultat choisi (surlignage), juste après cette mise à jour.
  if (state && current !== state.current) requestAnimationFrame(() => view?.dispatch({ effects: setFindState.of({ matches, current }) }));
  return { total: matches.length, current };
}

/** Le texte a changé : les résultats sont recalculés, le résultat choisi reste au plus près. */
function findRefresh(): FindResult {
  if (!view || !findQuery) return NO_RESULT;
  const previous = view.state.field(findField, false)?.current ?? 0;
  const matches = computeMatches();
  view.dispatch({ effects: setFindState.of({ matches, current: currentIndex(matches, previous) }) });
  return findResult();
}

/** Nouvelle recherche : le résultat choisi est le premier à partir du curseur, comme dans VS Code. */
function findSet(options: FindOptions): FindResult {
  if (!view) return NO_RESULT;
  const parsed = parseNoteSearch(options.search, options);
  findQuery = { parsed, options };
  const matches = computeMatches();
  const start = view.state.selection.main.from;
  const after = matches.findIndex((match) => match.from >= start);
  showMatch(matches, matches.length ? (after >= 0 ? after : 0) : -1);
  return findResult();
}

/** Texte qui remplace un résultat : `$1`… avec une expression régulière, le texte tel quel sinon. */
function replacementFor(text: string): string {
  if (!findQuery) return '';
  const { parsed, options } = findQuery;
  const single = parsed.single;
  if (single && (options.regexp || /^\/.+\/[a-z]*$/.test(options.search.trim()))) return text.replace(new RegExp(single.source, single.flags.replace('g', '')), options.replace);
  return options.replace;
}

function findStep(direction: 'next' | 'previous' | 'replace' | 'replaceAll'): FindResult {
  if (!view || !findQuery) return NO_RESULT;
  const state = view.state.field(findField, false);
  const matches = state?.matches ?? [];
  if (!matches.length) return findResult();
  const current = currentIndex(matches, state?.current ?? 0);
  if (direction === 'next' || direction === 'previous') {
    showMatch(matches, (current + (direction === 'next' ? 1 : -1) + matches.length) % matches.length);
    return findResult();
  }
  const targets = direction === 'replaceAll' ? matches : [matches[Math.max(0, current)]!];
  const changes = targets.map((match) => ({ from: match.from, to: match.to, insert: replacementFor(view!.state.sliceDoc(match.from, match.to)) }));
  view.dispatch({ changes, userEvent: 'input.replace' });
  // Puis le résultat suivant celui qui vient d'être remplacé.
  const resume = direction === 'replace' ? changes[0]!.from + changes[0]!.insert.length : 0;
  const next = computeMatches();
  const after = next.findIndex((match) => match.from >= resume);
  showMatch(next, next.length ? (after >= 0 ? after : 0) : -1);
  return findResult();
}

function findClose(): void {
  findQuery = null;
  if (view?.state.field(findField, false)) view.dispatch({ effects: setFindState.of(null) });
}

/** Texte sélectionné d'une seule ligne, pour préremplir la recherche. */
function selectionText(): string {
  if (!view) return '';
  const { from, to } = view.state.selection.main;
  const text = view.state.sliceDoc(from, to);
  return text.length <= 200 && !text.includes('\n') ? text : '';
}

/** Surligne les lignes citées (`null` : les efface) ; avec `scroll`, les amène à l'écran. */
function citeLines(ranges: readonly LineRange[] | null, scroll: boolean): void {
  if (view) showCitedLines(view, ranges, scroll);
}

defineExpose({ reveal, scrollToLine, scrollToSourceLine, citeLines, insertBlock, findSet, findStep, findResult, findRefresh, findClose, selectionText, focus: () => view?.focus() });

// Pour le sommaire : la ligne lue, signalée une fois par image.
let scrollFrame = 0;
function onScroll(): void {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    if (!view) return;
    const height = view.scrollDOM.scrollTop + 16;
    const block = view.lineBlockAtHeight(height);
    const fraction = block.height > 0 ? Math.min(1, Math.max(0, (height - block.top) / block.height)) : 0;
    emit('top-line', view.state.doc.lineAt(block.from).number, fraction);
  });
}

// Pour l'aperçu à côté : la ligne du curseur et sa hauteur à l'écran, une fois par image.
let cursorFrame = 0;
function reportCursor(): void {
  if (cursorFrame) return;
  cursorFrame = requestAnimationFrame(() => {
    cursorFrame = 0;
    if (!view) return;
    const head = view.state.selection.main.head;
    const coords = view.coordsAtPos(head);
    const box = view.scrollDOM.getBoundingClientRect();
    const ratio = coords && box.height ? (coords.top - box.top) / box.height : 0.35;
    emit('cursor-line', view.state.doc.lineAt(head).number, Math.min(1, Math.max(0, ratio)));
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
        ...(props.live ? [live.extension, inline] : [highlightActiveLine()]),
        numbering.of(numbersOf(props.lineNumbers)),
        docComments,
        citedLines,
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        // Autres occurrences du texte choisi : seulement des mots entiers d'au moins 3 lettres, et pas en « Lecture et
        // écriture », où les repères au milieu des mots gênent la lecture.
        ...(props.live ? [] : [highlightSelectionMatches({ wholeWords: true, minSelectionLength: 3 })]),
        syntaxHighlighting(props.live ? docLiveHighlight : docHighlight),
        // Les blocs ```python, ```sql… sont colorés selon leur langage (grammaire chargée à la demande).
        markdown({ base: markdownLanguage, codeLanguages: (info) => codeLanguage(info) }),
        EditorView.lineWrapping,
        spelling.of(spellingState(spellcheck.value)),
        placeholder(t('Écrivez en Markdown… @ pour mentionner, / pour insérer un élément.')),
        autocompletion({ override: [mentions, wikiLinks, slashCommands(handlers), highlightColors(() => props.obsidian)], addToOptions: [{ render: completionIcon, position: 20 }] }),
        // Recherche (Ctrl F) : résultats surlignés, et révélés dans le rendu « Lecture et écriture ».
        findField,
        boardChoice,
        yCollab(text, awareness, { undoManager: new Y.UndoManager(text) }),
        keymap.of([
          { key: 'Mod-b', run: shortcut(t('Gras')) },
          { key: 'Mod-i', run: shortcut(t('Italique')) },
          { key: 'Mod-k', run: shortcut(t('Lien')), stopPropagation: true },
          ...yUndoManagerKeymap,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        editable.of(editableState(props.readonly)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && pendingAnchor.value) requestAnimationFrame(takePendingAnchor);
          if ((update.selectionSet || update.docChanged) && update.view.hasFocus) reportCursor();
        }),
        EditorView.domEventHandlers({
          paste(event, editor) {
            // Un tableau copié d'un tableur, d'un traitement de texte ou d'une page web devient un tableau Markdown.
            const table = markdownFromHtmlTable(event.clipboardData?.getData('text/html') ?? '');
            if (table) {
              event.preventDefault();
              const { from, to } = editor.state.selection.main;
              // Une ligne vide avant le tableau : sinon il prolongerait le paragraphe précédent.
              const head = editor.state.sliceDoc(0, from);
              const before = !head.trim() || /\n[ \t]*\n[ \t]*$/.test(head) ? '' : /\n[ \t]*$/.test(head) ? '\n' : '\n\n';
              const insert = `${before}${table}\n`;
              editor.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true, userEvent: 'input.paste' });
              return true;
            }
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
          // Sélection dessinée au-dessus du texte, translucide : un fond (citation, code, surlignage) ne la cache plus. Elle
          // laisse passer les clics : sinon un clic sur du texte sélectionné tombe sur elle, et la sélection ne se défait pas.
          '& .cm-selectionLayer': { zIndex: '2 !important', pointerEvents: 'none' },
          '& .cm-selectionLayer .cm-selectionBackground': { background: 'color-mix(in srgb, var(--fb-accent) 18%, transparent) !important' },
          '&.cm-focused .cm-selectionLayer .cm-selectionBackground': { background: 'color-mix(in srgb, var(--fb-accent) 30%, transparent) !important' },
          '.cm-scroller': { fontFamily: FONT_MONO, lineHeight: '1.55' },
          '.cm-gutters': { backgroundColor: 'transparent', borderRight: '1px solid var(--fb-border)', color: 'var(--fb-muted)' },
          '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--fb-text) 5%, transparent)' },
          '.cm-cursor': { borderLeftColor: 'var(--fb-text)' },
          '.cm-tooltip': { border: '1px solid var(--fb-border)', backgroundColor: 'var(--fb-panel)', color: 'var(--fb-text)' },
          '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'inherit', maxHeight: '18rem' },
          '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '0.2rem 0.5rem' },
          '.cm-slash-icon': { width: '1.4rem', color: 'var(--fb-muted)', fontSize: '0.8rem' },
          '.cm-completionIcon-doc-image, .cm-completionIcon-doc-note, .cm-completionIcon-highlight, .cm-completionIcon-mention': { display: 'none' },
          // Mentions « @ » : pastilles de filtre et titre de chaque type, à sa couleur.
          '.cm-tooltip-autocomplete completion-section': { display: 'block', padding: '0', border: '0', fontFamily: 'var(--fb-font, system-ui, sans-serif)' },
          '.cm-mention-head .cm-mention-filters': { padding: '0.35rem 0.35rem 0.2rem', maxWidth: '26rem' },
          '.cm-mention-title': { display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.35rem 0.55rem 0.15rem', fontSize: '0.7rem', fontWeight: '700', letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--fb-muted)' },
          '.cm-mention-title .pi': { color: 'var(--chip-color)', fontSize: '0.72rem' },
          '.cm-mention-head.more': { borderTop: '1px solid var(--fb-border)', margin: '0.2rem 0' },
          '.cm-file-thumb': { width: '2.2rem', height: '1.6rem', marginRight: '0.5rem', borderRadius: '4px', objectFit: 'cover', verticalAlign: 'middle', backgroundColor: 'var(--fb-panel-alt)' },
          '.cm-tooltip.cm-completionInfo': { padding: '0.4rem', maxWidth: '18rem' },
          // Choix de l'affichage d'un tableau qu'on vient de citer.
          '.cm-board-choice': { display: 'flex', alignItems: 'center', gap: '0.15rem', padding: '0.25rem', borderRadius: '10px', fontFamily: 'var(--fb-font, system-ui, sans-serif)', fontSize: '0.8rem', boxShadow: 'var(--fb-shadow-lg)' },
          '.cm-tooltip:has(> .cm-board-choice)': { borderRadius: '10px' },
          '.cm-board-choice-label': { padding: '0 0.4rem 0 0.35rem', color: 'var(--fb-muted)' },
          '.cm-board-choice button': { display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.3rem 0.55rem', border: '0', borderRadius: '7px', background: 'none', color: 'var(--fb-text)', font: 'inherit', cursor: 'pointer' },
          '.cm-board-choice button:hover': { backgroundColor: 'var(--fb-panel-alt)' },
          '.cm-board-choice button.active': { backgroundColor: 'var(--fb-accent-soft)', color: 'var(--fb-accent)', fontWeight: '600' },
          '.cm-board-choice button .pi': { fontSize: '0.8rem' },
          '.cm-image-info': { display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.75rem', color: 'var(--fb-muted)', wordBreak: 'break-all' },
          '.cm-image-info img': { maxWidth: '16rem', maxHeight: '12rem', borderRadius: '6px', objectFit: 'contain', backgroundColor: 'var(--fb-panel-alt)' },
          '.cm-ySelectionInfo': { padding: '1px 4px', borderRadius: '4px', fontFamily: 'inherit', fontSize: '0.7rem', fontWeight: '600', opacity: '1' },
          '.cm-doc-comment': { borderRadius: '2px', backgroundColor: 'color-mix(in srgb, #f59e0b 28%, transparent)' },
          // Lignes citées (lien d'une citation) : bande à la couleur du thème, filet à gauche.
          // En « Lecture et écriture », la bande déborde à gauche pour laisser la puce d'une liste lisible, filet compris.
          '.cm-cited-line': props.live
            ? { position: 'relative', backgroundColor: 'var(--fb-cited-bg)', boxShadow: '-8px 0 0 var(--fb-cited-bg)' }
            : { backgroundColor: 'var(--fb-cited-bg)', boxShadow: 'inset 3px 0 0 var(--fb-cited-edge)' },
          ...(props.live ? { '.cm-cited-line::before': { content: '""', position: 'absolute', top: '0', bottom: '0', left: '-11px', width: '3px', backgroundColor: 'var(--fb-cited-edge)', pointerEvents: 'none' } } : {}),
          // Recherche (Ctrl F) : mêmes couleurs que les résultats en lecture ; le panneau de CodeMirror reste caché.
          '.cm-searchMatch': { borderRadius: '2px', backgroundColor: 'var(--fb-find-match)', outline: 'none' },
          '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--fb-find-current)', color: 'var(--fb-find-current-text)' },
          '.cm-searchMatch-selected *': { color: 'inherit !important' },
          // Autres occurrences du mot choisi : discrètes, dans la couleur du thème (le vert vif par défaut attire l'œil).
          '.cm-selectionMatch': { borderRadius: '2px', backgroundColor: 'color-mix(in srgb, var(--fb-accent) 18%, transparent)' },
          ...(props.live
            ? {
                '.cm-scroller': { fontFamily: "var(--fb-font-doc, var(--fb-font, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif))", fontSize: 'var(--fb-doc-size, 1rem)', lineHeight: '1.65' },
                // Même largeur de texte que la lecture (52rem et ses marges), centrée sur l'écran si possible.
                // Marges extérieures plutôt qu'intérieures : la sélection de CodeMirror part du bord du contenu, elle ne
                // déborde ainsi pas à côté du texte (ni d'une citation).
                '.cm-content': {
                  boxSizing: 'border-box',
                  width: 'calc(100% - 3rem)',
                  maxWidth: 'var(--fb-reading-width, 52rem)',
                  marginRight: '1.5rem',
                  marginLeft: 'max(1.5rem, calc((100% - var(--fb-reading-width, 52rem)) / 2 + var(--reading-shift, 0px)))',
                  padding: '1.25rem 0 4rem',
                  color: 'var(--md-text, currentColor)',
                },
                '.cm-line': { padding: '0' },
                // Numéros de ligne : la gouttière se colle au texte centré, au lieu de rester au bord de l'écran.
                '&.cm-numbered .cm-gutters': {
                  marginLeft: 'max(0px, calc((100% - var(--fb-reading-width, 52rem)) / 2 + var(--reading-shift, 0px) - 3.5rem))',
                  borderRight: '0',
                },
                '&.cm-numbered .cm-lineNumbers .cm-gutterElement': { padding: '0 0.75rem 0 0.25rem', fontFamily: FONT_MONO, fontSize: '0.75rem', opacity: '0.75' },
                '&.cm-numbered .cm-content': { width: 'calc(100% - 5rem)', marginLeft: '0.5rem' },
                '.cm-lp-source': { fontFamily: FONT_MONO, fontSize: '0.88rem' },
                '.cm-lp-h1': { fontSize: '1.6em', fontWeight: '700', lineHeight: '1.3', paddingTop: '0.35em', color: 'var(--md-h1, currentColor)' },
                '.cm-lp-h2': { fontSize: '1.35em', fontWeight: '700', lineHeight: '1.3', paddingTop: '0.3em', color: 'var(--md-h2, currentColor)' },
                '.cm-lp-h3': { fontSize: '1.17em', fontWeight: '700', paddingTop: '0.2em', color: 'var(--md-h3, currentColor)' },
                '.cm-lp-h4': { fontSize: '1.05em', fontWeight: '700', color: 'var(--md-h4, currentColor)' },
                '.cm-lp-h5': { fontWeight: '700', color: 'var(--md-h4, currentColor)' },
                '.cm-lp-h6': { fontWeight: '700', color: 'var(--md-h4, var(--fb-muted))' },
                '.cm-lp-strong': { fontWeight: '700', color: 'var(--md-strong, currentColor)' },
                '.cm-lp-em': { fontStyle: 'italic', color: 'var(--md-em, currentColor)' },
                '.cm-lp-strike': { textDecoration: 'line-through' },
                // Gras, code et citations : mêmes couleurs, police et fond qu'en lecture (thème courant compris).
                '.cm-lp-code': {
                  fontFamily: `var(--fb-font-mono, ${FONT_MONO})`,
                  fontSize: '0.85em',
                  padding: '0.1em 0.35em',
                  borderRadius: '5px',
                  color: 'var(--md-code, var(--fb-md-code))',
                  backgroundColor: 'var(--md-code-bg, var(--fb-md-code-bg))',
                },
                '.cm-lp-link': { color: 'var(--md-link, var(--fb-accent))', textDecoration: 'underline', textUnderlineOffset: '2px', cursor: 'pointer' },
                '.cm-lp-syntax': { color: 'var(--fb-muted)' },
                '.cm-lp-quote': {
                  borderLeft: '3px solid var(--md-quote-bar, var(--fb-accent))',
                  padding: '0 0.9rem !important',
                  color: 'var(--md-quote, var(--fb-muted))',
                  backgroundColor: 'var(--md-quote-bg, var(--fb-md-quote-bg))',
                },
                '.cm-lp-quote-first': { paddingTop: '0.25rem !important' },
                '.cm-lp-quote-last': { paddingBottom: '0.25rem !important' },
                '.cm-lp-bullet': { display: 'inline-block', minWidth: '0.9em', color: 'var(--md-marker, var(--fb-md-marker))', fontWeight: '700' },
                '.cm-lp-ordinal': { color: 'var(--md-marker, var(--fb-md-marker))' },
                '.cm-lp-task': { margin: '0 0.45em 0 0', verticalAlign: 'middle', cursor: 'pointer', accentColor: 'var(--md-marker, var(--fb-md-marker))' },
                '.cm-lp-done': { color: 'var(--fb-muted)', textDecoration: 'line-through' },
                '.cm-lp-hr-line': { position: 'relative' },
                '.cm-lp-hr': { display: 'inline-block', width: '100%', borderTop: '1px solid var(--md-hr, var(--fb-border))', verticalAlign: 'middle' },
                '.cm-lp-figure': { position: 'relative', display: 'inline-block', maxWidth: '100%', verticalAlign: 'middle' },
                '.cm-lp-image': { display: 'block', maxWidth: '100%', borderRadius: '6px' },
                '.cm-lp-image-tools': { position: 'absolute', top: '0.4rem', right: '0.4rem', display: 'flex', gap: '0.25rem', opacity: '0', transition: 'opacity 0.15s' },
                '.cm-lp-figure:hover .cm-lp-image-tools': { opacity: '1' },
                '.cm-lp-image-tools button': {
                  display: 'grid',
                  placeItems: 'center',
                  width: '1.9rem',
                  height: '1.9rem',
                  padding: '0',
                  border: '0',
                  borderRadius: '6px',
                  backgroundColor: 'rgb(15 18 24 / 0.62)',
                  color: '#fff',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  backdropFilter: 'blur(4px)',
                },
                '.cm-lp-image-tools button:hover': { backgroundColor: 'rgb(15 18 24 / 0.85)' },
                '.cm-lp-board': {
                  display: 'flex',
                  flexDirection: 'column',
                  maxWidth: '100%',
                  margin: '0.3rem 0',
                  overflow: 'hidden',
                  border: '1px solid var(--fb-border)',
                  borderRadius: '10px',
                  backgroundColor: 'var(--board-canvas)',
                  cursor: 'pointer',
                },
                '.cm-lp-board:hover': { borderColor: 'var(--fb-accent)' },
                '.cm-lp-board-head': { display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.35rem 0.5rem 0.35rem 0.75rem', borderBottom: '1px solid var(--fb-border)', backgroundColor: 'var(--fb-panel)', fontWeight: '600' },
                '.cm-lp-board-head .pi-objects-column': { color: '#a855f7' },
                '.cm-lp-board-title': { flex: '1', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                '.cm-lp-board-open': { color: 'var(--fb-muted)', fontSize: '0.8rem', marginRight: '0.25rem' },
                '.cm-lp-board-tools': { display: 'flex', alignItems: 'center', opacity: '0', transition: 'opacity 0.15s' },
                '.cm-lp-board-tools button.active': { backgroundColor: 'var(--fb-accent-soft)', color: 'var(--fb-accent)' },
                '.cm-lp-board-tools button .pi': { fontSize: '0.8rem' },
                '.cm-lp-board-sep': { width: '1px', height: '1rem', margin: '0 0.2rem', backgroundColor: 'var(--fb-border)' },
                '.cm-lp-board-zoom': { display: 'flex' },
                // Affiché en image : l'image seule ; ses outils flottent en haut à droite.
                '.cm-lp-board.image': { position: 'relative', border: '0', borderRadius: '8px', backgroundColor: 'transparent' },
                '.cm-lp-board.image .cm-lp-board-preview': { maxHeight: 'none', padding: '0', borderRadius: '8px' },
                '.cm-lp-board.image .cm-lp-board-tools': { position: 'absolute', top: '0.4rem', right: '0.4rem', padding: '0.15rem', border: '1px solid var(--fb-border)', borderRadius: '8px', backgroundColor: 'var(--fb-panel)' },
                // Vue intégrée : l'en-tête ouvre le tableau, le cadre se parcourt.
                '.cm-lp-board.embed': { cursor: 'default' },
                '.cm-lp-board.embed .cm-lp-board-head': { cursor: 'pointer' },
                '.cm-lp-board.embed .fb-board-view img': { maxHeight: 'none' },
                '.cm-lp-board:hover .cm-lp-board-tools': { opacity: '1' },
                '.cm-lp-board-tools button': { display: 'grid', placeItems: 'center', width: '1.7rem', height: '1.7rem', padding: '0', border: '0', borderRadius: '6px', background: 'none', color: 'var(--fb-muted)', cursor: 'pointer' },
                '.cm-lp-board-tools button:hover': { backgroundColor: 'var(--fb-panel-alt)', color: 'var(--fb-text)' },
                '.cm-lp-board-preview': { display: 'block', width: '100%', maxHeight: '30rem', padding: '0.75rem', objectFit: 'contain', boxSizing: 'border-box' },
                '.cm-lp-mention, .cm-lp-embed': {
                  padding: '0.05em 0.45em',
                  borderRadius: '999px',
                  backgroundColor: 'color-mix(in srgb, var(--md-link, var(--fb-accent)) 12%, transparent)',
                  color: 'var(--md-link, var(--fb-accent))',
                  fontWeight: '600',
                  cursor: 'pointer',
                },
                '.cm-lp-embed::before': { content: '"\\e9c3"', marginRight: '0.3em', fontFamily: 'primeicons', fontSize: '0.8em', fontWeight: 'normal' },
                '.cm-lp-highlight': { borderRadius: '3px', backgroundColor: 'var(--md-highlight, color-mix(in srgb, #facc15 38%, transparent))' },
                // Formules et HTML en ligne, comme en lecture.
                '.cm-lp-math': { display: 'inline-block', maxWidth: '100%', overflowX: 'auto', verticalAlign: 'middle' },
                '.cm-lp-math-source': { fontFamily: `var(--fb-font-mono, ${FONT_MONO})`, fontSize: '0.88em', color: 'var(--md-code, var(--fb-hl-code))' },
                '.cm-lp-html-sup': { verticalAlign: 'super', fontSize: '0.75em', lineHeight: '0' },
                '.cm-lp-html-sub': { verticalAlign: 'sub', fontSize: '0.75em', lineHeight: '0' },
                '.cm-lp-html-kbd': {
                  padding: '0.05em 0.35em',
                  border: '1px solid var(--fb-border)',
                  borderBottomWidth: '2px',
                  borderRadius: '4px',
                  backgroundColor: 'var(--fb-panel-alt)',
                  fontFamily: `var(--fb-font-mono, ${FONT_MONO})`,
                  fontSize: '0.85em',
                },
                '.cm-lp-html-mark': { borderRadius: '3px', backgroundColor: 'var(--md-highlight, color-mix(in srgb, #facc15 38%, transparent))' },
                '.cm-lp-html-u, .cm-lp-html-ins': { textDecoration: 'underline' },
                '.cm-lp-html-del, .cm-lp-html-s': { textDecoration: 'line-through' },
                '.cm-lp-html-small': { fontSize: '0.85em' },
                '.cm-lp-html-b, .cm-lp-html-strong': { fontWeight: '700', color: 'var(--md-strong, currentColor)' },
                '.cm-lp-html-i, .cm-lp-html-em': { fontStyle: 'italic', color: 'var(--md-em, currentColor)' },
                '.cm-lp-hl-red': { backgroundColor: 'color-mix(in srgb, #ef4444 30%, transparent)' },
                '.cm-lp-hl-orange': { backgroundColor: 'color-mix(in srgb, #f97316 32%, transparent)' },
                '.cm-lp-hl-green': { backgroundColor: 'color-mix(in srgb, #22c55e 30%, transparent)' },
                '.cm-lp-hl-blue': { backgroundColor: 'color-mix(in srgb, #3b82f6 28%, transparent)' },
                '.cm-lp-hl-purple': { backgroundColor: 'color-mix(in srgb, #a855f7 28%, transparent)' },
                '.cm-lp-hl-brown': { backgroundColor: 'color-mix(in srgb, #a16207 30%, transparent)' },
                '.cm-lp-hl-black': { backgroundColor: 'color-mix(in srgb, #6b7280 35%, transparent)' },
                '.cm-lp-hl-white': { backgroundColor: 'color-mix(in srgb, #cbd5e1 45%, transparent)' },
                '.cm-lp-comment': { color: 'var(--fb-muted)', fontStyle: 'italic' },
                '.cm-lp-tag': { padding: '0 0.4em', borderRadius: '999px', backgroundColor: 'color-mix(in srgb, var(--md-tag, var(--fb-accent)) 14%, transparent)', color: 'var(--md-tag, var(--fb-accent))', fontSize: '0.9em' },
                '.cm-lp-footnote': { color: 'var(--md-link, var(--fb-accent))', fontSize: '0.75em', verticalAlign: 'super' },
                '.cm-live-block': { padding: '0.15rem 0.35rem', margin: '0 -0.35rem', borderRadius: '6px', cursor: 'text', whiteSpace: 'normal' },
                '.cm-live-block:hover': { backgroundColor: 'color-mix(in srgb, var(--fb-text) 4%, transparent)' },
                // Tableaux : poignées ⋮⋮ de ligne (à gauche) et de colonne (au-dessus), sélection de cellules, comme dans Obsidian.
                '.cm-table-editor': { position: 'relative', width: 'fit-content', maxWidth: '100%', padding: '0.7rem 1.4rem 1.4rem 0', whiteSpace: 'normal', outline: 'none' },
                '.cm-table-scroll': { overflowX: 'auto' },
                '.cm-table-editor table': { display: 'table', margin: '0' },
                '.cm-table-editor th, .cm-table-editor td': { padding: '0', verticalAlign: 'top' },
                '.cm-table-cell': { minWidth: '3rem', minHeight: '1.6em', padding: '0.35rem 0.6rem', outline: 'none', cursor: 'text', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
                '.cm-table-editor td.editing, .cm-table-editor th.editing': { boxShadow: 'inset 0 0 0 2px var(--fb-accent)' },
                '.cm-table-editor .editing .cm-table-cell': { backgroundColor: 'color-mix(in srgb, var(--fb-accent) 5%, transparent)' },
                '.cm-table-editor td.selected, .cm-table-editor th.selected': {
                  backgroundColor: 'color-mix(in srgb, var(--fb-accent) 16%, transparent)',
                  boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--fb-accent) 45%, transparent)',
                },
                '.cm-table-editor.ranging .cm-table-cell': { caretColor: 'transparent', userSelect: 'none' },
                '.cm-table-grip': {
                  position: 'absolute',
                  zIndex: '3',
                  display: 'grid',
                  placeItems: 'center',
                  padding: '0',
                  border: '1px solid var(--fb-border)',
                  borderRadius: '5px',
                  backgroundColor: 'var(--fb-panel)',
                  color: 'var(--fb-muted)',
                  fontSize: '0.62rem',
                  cursor: 'grab',
                  opacity: '0',
                  pointerEvents: 'none',
                  transition: 'opacity 0.12s',
                  touchAction: 'none',
                },
                '.cm-table-grip.row': { width: '0.95rem', height: '1.5rem', transform: 'translate(calc(-100% - 2px), -50%)' },
                '.cm-table-grip.col': { width: '1.5rem', height: '0.95rem', transform: 'translate(-50%, -50%)' },
                '.cm-table-editor.hovering .cm-table-grip, .cm-table-editor.dragging .cm-table-grip': { opacity: '1', pointerEvents: 'auto' },
                '.cm-table-grip:hover': { borderColor: 'var(--fb-accent)', backgroundColor: 'var(--fb-accent-soft)', color: 'var(--fb-accent)' },
                '.cm-table-editor.dragging, .cm-table-editor.dragging *': { cursor: 'grabbing !important' },
                '.cm-table-drop': { position: 'absolute', zIndex: '4', display: 'none', borderRadius: '2px', backgroundColor: 'var(--fb-accent)', pointerEvents: 'none' },
                '.cm-table-add': {
                  position: 'absolute',
                  display: 'grid',
                  placeItems: 'center',
                  padding: '0',
                  border: '0',
                  borderRadius: '5px',
                  backgroundColor: 'color-mix(in srgb, var(--fb-text) 6%, transparent)',
                  color: 'var(--fb-muted)',
                  fontSize: '0.65rem',
                  cursor: 'pointer',
                  opacity: '0',
                  transition: 'opacity 0.15s',
                },
                '.cm-table-add.row': { left: '0', right: '1.4rem', bottom: '0.1rem', height: '1.1rem' },
                '.cm-table-add.col': { top: '0.7rem', right: '0.1rem', bottom: '1.4rem', width: '1.1rem' },
                '.cm-table-editor:hover .cm-table-add, .cm-table-editor:focus-within .cm-table-add': { opacity: '1' },
                '.cm-table-add:hover': { backgroundColor: 'var(--fb-accent-soft)', color: 'var(--fb-accent)' },
              }
            : {}),
        }),
      ],
    }),
  });
  view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });
  requestAnimationFrame(takePendingAnchor);
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
  cancelAnimationFrame(cursorFrame);
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
    <div ref="host" class="host" :class="{ 'code-lang-editable': live && !readonly }" @click="onClick" @contextmenu="onContextMenu"></div>
    <input ref="picker" type="file" accept="image/*" multiple class="picker" @change="onPicked" />
    <ContextMenu ref="menu" :model="menuItems" />
    <CodeLanguagePicker ref="languagePicker" />
    <DocImagePickerDialog v-model:visible="imagePickerOpen" :nodes="nodes" :note-path="notePath" @pick="insertExistingImage" @upload="picker?.click()" />
    <MentionPickerDialog v-model:visible="mentionPickerOpen" :sources="mentionSources" :query="mentionPending?.query" :filter="mentionPending?.filter" @pick="pickMention" />
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
