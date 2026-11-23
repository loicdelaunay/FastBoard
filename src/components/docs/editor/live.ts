import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { highlightCodeBlocks } from '@/utils/codeHighlight';
import { markdownBlocks, renderMermaid, type MarkdownBlock } from '@/utils/markdown';
import type { TextRange } from './commands';
import { currentMatch, setFindState } from './findState';
import { flushTables, TableWidget, type TableOptions } from './tableWidget';

/**
 * Mode « Lecture et écriture » : les blocs complexes (code, diagrammes, tableaux, formules, callouts, propriétés)
 * s'affichent rendus, et repassent en Markdown quand le curseur y entre. Le reste du texte est décoré ligne à ligne
 * par `liveInline.ts`. Tout reste dans un seul éditeur, branché sur le document partagé.
 */

export interface LiveOptions {
  /** HTML assaini d'un bloc. */
  render: (source: string, block: TextRange, state: EditorState) => string;
  obsidian: () => boolean;
  /** Suit un lien rendu dans une cellule de tableau ; vrai s'il a été suivi. */
  follow: (element: HTMLElement, event: MouseEvent) => boolean;
  undo: (view: EditorView) => void;
  redo: (view: EditorView) => void;
}

const setFocus = StateEffect.define<boolean>();
/** Le rendu dépend d'autre chose que du texte (commentaires, arbre) : à refaire. */
export const refreshLive = StateEffect.define<void>();
/** « Modifier le Markdown » : le bloc reste en source tant que le curseur y est. */
export const editRawBlock = StateEffect.define<TextRange>();

/** Blocs rendus d'un seul tenant : les éditer ligne à ligne n'aurait pas de sens. */
const COMPLEX = new Set(['code', 'table', 'html', 'blockMath', 'callout', 'frontmatter']);

/** Blocs du texte, avec les propriétés d'Obsidian en tête de note comme un bloc à part. */
export function liveBlocks(text: string, obsidian: boolean): MarkdownBlock[] {
  const blocks = markdownBlocks(text, obsidian);
  const front = obsidian ? /^---[ \t]*\n[\s\S]*?\n---[ \t]*(?=\n|$)/.exec(text) : null;
  if (!front) return blocks;
  return [{ from: 0, to: front[0].length, type: 'frontmatter' }, ...blocks.filter((block) => block.from >= front[0].length)];
}

class BlockWidget extends WidgetType {
  readonly source: string;
  readonly version: number;
  readonly block: TextRange;
  readonly options: LiveOptions;

  constructor(source: string, version: number, block: TextRange, options: LiveOptions) {
    super();
    this.source = source;
    this.version = version;
    this.block = block;
    this.options = options;
  }

  override eq(other: BlockWidget): boolean {
    return other.source === this.source && other.version === this.version;
  }

  override toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('div');
    box.className = 'cm-live-block markdown';
    box.innerHTML = this.options.render(this.source, this.block, view.state);
    for (const checkbox of box.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      checkbox.disabled = false;
      checkbox.removeAttribute('data-readonly');
    }
    // Un diagramme ou une image change la hauteur du bloc une fois chargé.
    for (const image of box.querySelectorAll('img')) image.addEventListener('load', () => view.requestMeasure());
    void renderMermaid(box, document.documentElement.classList.contains('app-dark')).then(() => view.requestMeasure());
    void highlightCodeBlocks(box);
    return box;
  }

  /** Tout passe au navigateur : on sélectionne le texte rendu sans ouvrir le bloc, le clic est traité par l'éditeur. */
  override ignoreEvent(): boolean {
    return true;
  }
}

interface LiveValue {
  blocks: MarkdownBlock[];
  focused: boolean;
  version: number;
  /** Bloc ouvert en Markdown par « Modifier le Markdown ». */
  raw: TextRange | null;
  decorations: DecorationSet;
}

/** Plage d'un bloc complexe, en lignes entières. */
function wholeLines(state: EditorState, block: MarkdownBlock): TextRange {
  return { from: state.doc.lineAt(block.from).from, to: state.doc.lineAt(block.to).to };
}

function decorate(state: EditorState, value: Omit<LiveValue, 'decorations'>, options: LiveOptions, tables: TableOptions): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  let previous = -1;
  for (const block of value.blocks) {
    if (!COMPLEX.has(block.type)) continue;
    const { from, to } = wholeLines(state, block);
    if (from <= previous) continue;
    previous = to;
    if (value.raw && value.raw.from <= to && value.raw.to >= from) continue;
    // Le résultat choisi de la recherche (Ctrl F) est dans ce bloc : il s'affiche en Markdown, résultat surligné.
    const found = currentMatch(state);
    if (found && found.from < to && found.to > from) continue;
    // Un tableau s'écrit cellule par cellule, sans repasser en Markdown.
    if (block.type === 'table' && !state.readOnly) {
      builder.add(from, to, Decoration.replace({ widget: new TableWidget(state.sliceDoc(from, to), value.version, { from, to }, tables), block: true }));
      continue;
    }
    if (value.focused && state.selection.ranges.some((range) => range.from <= to && range.to >= from)) continue;
    const widget = new BlockWidget(state.sliceDoc(from, to), value.version, { from, to }, options);
    builder.add(from, to, Decoration.replace({ widget, block: true }));
  }
  return builder.finish();
}

export function livePreview(options: LiveOptions): {
  extension: Extension;
  blockAt: (state: EditorState, position: number) => MarkdownBlock | undefined;
  /** Blocs complexes, rendus ou en cours d'édition : la décoration ligne à ligne ne s'y applique pas. */
  complexRanges: (state: EditorState) => TextRange[];
} {
  const tables: TableOptions = {
    render: options.render,
    locate: (view, dom) => {
      const from = view.posAtDOM(dom);
      const block = view.state.field(field).blocks.find((entry) => entry.type === 'table' && view.state.doc.lineAt(entry.from).from === from);
      return block ? wholeLines(view.state, block) : null;
    },
    follow: options.follow,
    undo: options.undo,
    redo: options.redo,
  };
  const field: StateField<LiveValue> = StateField.define<LiveValue>({
    create(state) {
      const value = { blocks: liveBlocks(state.doc.toString(), options.obsidian()), focused: false, version: 0, raw: null };
      return { ...value, decorations: decorate(state, value, options, tables) };
    },
    update(current, transaction) {
      let { focused, version, raw } = current;
      if (raw && transaction.docChanged) raw = { from: transaction.changes.mapPos(raw.from, -1), to: transaction.changes.mapPos(raw.to, 1) };
      let opened = false;
      for (const effect of transaction.effects) {
        if (effect.is(setFocus)) focused = effect.value;
        if (effect.is(refreshLive)) version += 1;
        if (effect.is(editRawBlock)) {
          const { doc } = transaction.state;
          raw = { from: doc.lineAt(Math.min(effect.value.from, doc.length)).from, to: doc.lineAt(Math.min(effect.value.to, doc.length)).to };
          opened = true;
        }
      }
      // Le bloc repasse rendu dès que le curseur en sort.
      if (raw && transaction.selection && !opened) {
        const main = transaction.state.selection.main;
        if (main.from < raw.from || main.to > raw.to) raw = null;
      }
      const readOnlyChanged = transaction.startState.readOnly !== transaction.state.readOnly;
      const findChanged = transaction.effects.some((effect) => effect.is(setFindState));
      if (!transaction.docChanged && !transaction.selection && focused === current.focused && version === current.version && raw === current.raw && !readOnlyChanged && !findChanged) return current;
      const blocks = transaction.docChanged || version !== current.version ? liveBlocks(transaction.newDoc.toString(), options.obsidian()) : current.blocks;
      const value = { blocks, focused, version, raw };
      return { ...value, decorations: decorate(transaction.state, value, options, tables) };
    },
    provide: (self) => EditorView.decorations.from(self, (value) => value.decorations),
  });
  return {
    extension: [field, EditorView.focusChangeEffect.of((_state, focused) => setFocus.of(focused))],
    blockAt: (state, position) => state.field(field).blocks.find((block) => position >= state.doc.lineAt(block.from).from && position <= state.doc.lineAt(block.to).to),
    complexRanges: (state) => state.field(field).blocks.filter((block) => COMPLEX.has(block.type)).map((block) => wholeLines(state, block)),
  };
}

/** « Modifier le Markdown » : ouvre un bloc rendu en source, curseur au début. */
export function editRaw(view: EditorView, range: TextRange): void {
  flushTables(view);
  view.focus();
  view.dispatch({ selection: { anchor: range.from }, effects: [editRawBlock.of(range), EditorView.scrollIntoView(range.from, { y: 'nearest' })] });
}

/** Texte rendu qui précède le point cliqué dans un bloc. */
export function textBeforePoint(box: HTMLElement, x: number, y: number): string {
  const page = box.ownerDocument as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
  let node: Node | null | undefined;
  let offset = 0;
  if (typeof page.caretPositionFromPoint === 'function') {
    const caret = page.caretPositionFromPoint(x, y);
    node = caret?.offsetNode;
    offset = caret?.offset ?? 0;
  } else {
    const caret = page.caretRangeFromPoint?.(x, y);
    node = caret?.startContainer;
    offset = caret?.startOffset ?? 0;
  }
  if (!node || !box.contains(node)) return box.textContent ?? '';
  const range = page.createRange();
  range.selectNodeContents(box);
  range.setEnd(node, offset);
  return range.toString();
}
