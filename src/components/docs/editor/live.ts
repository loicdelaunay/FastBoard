import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { markdownBlocks, renderMermaid, type MarkdownBlock } from '@/utils/markdown';
import type { TextRange } from './commands';

/**
 * Mode « Lecture et écriture » : chaque bloc s'affiche rendu, et seul celui qui porte le curseur redevient du Markdown.
 * Tout reste dans un seul éditeur, branché sur le document partagé : écrire à plusieurs fonctionne comme ailleurs.
 */

export interface LiveOptions {
  /** HTML assaini d'un bloc. */
  render: (source: string, block: TextRange, state: EditorState) => string;
}

const setFocus = StateEffect.define<boolean>();
/** Le rendu dépend d'autre chose que du texte (commentaires, arbre) : à refaire. */
export const refreshLive = StateEffect.define<void>();

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
    for (const checkbox of box.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) checkbox.disabled = false;
    // Un diagramme ou une image change la hauteur du bloc une fois chargé.
    for (const image of box.querySelectorAll('img')) image.addEventListener('load', () => view.requestMeasure());
    void renderMermaid(box, document.documentElement.classList.contains('app-dark')).then(() => view.requestMeasure());
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
  decorations: DecorationSet;
}

function decorate(state: EditorState, value: Omit<LiveValue, 'decorations'>, options: LiveOptions): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  let previous = -1;
  for (const block of value.blocks) {
    // Un bloc remplacé couvre des lignes entières.
    const from = state.doc.lineAt(block.from).from;
    const to = state.doc.lineAt(block.to).to;
    if (from <= previous) continue;
    previous = to;
    if (value.focused && state.selection.ranges.some((range) => range.from <= to && range.to >= from)) continue;
    const widget = new BlockWidget(state.sliceDoc(from, to), value.version, { from, to }, options);
    builder.add(from, to, Decoration.replace({ widget, block: true }));
  }
  return builder.finish();
}

export function livePreview(options: LiveOptions): { extension: Extension; blockAt: (state: EditorState, position: number) => MarkdownBlock | undefined } {
  const field = StateField.define<LiveValue>({
    create(state) {
      const value = { blocks: markdownBlocks(state.doc.toString()), focused: false, version: 0 };
      return { ...value, decorations: decorate(state, value, options) };
    },
    update(current, transaction) {
      let { focused, version } = current;
      for (const effect of transaction.effects) {
        if (effect.is(setFocus)) focused = effect.value;
        if (effect.is(refreshLive)) version += 1;
      }
      if (!transaction.docChanged && !transaction.selection && focused === current.focused && version === current.version) return current;
      const blocks = transaction.docChanged ? markdownBlocks(transaction.newDoc.toString()) : current.blocks;
      const value = { blocks, focused, version };
      return { ...value, decorations: decorate(transaction.state, value, options) };
    },
    provide: (self) => EditorView.decorations.from(self, (value) => value.decorations),
  });
  return {
    extension: [field, EditorView.focusChangeEffect.of((_state, focused) => setFocus.of(focused))],
    blockAt: (state, position) => state.field(field).blocks.find((block) => position >= state.doc.lineAt(block.from).from && position <= state.doc.lineAt(block.to).to),
  };
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
