import { codeFolding, ensureSyntaxTree, foldable, foldedRanges, foldEffect, foldKeymap, syntaxTree, unfoldEffect } from '@codemirror/language';
import type { EditorState, Extension } from '@codemirror/state';
import { Decoration, EditorView, gutter, GutterMarker, keymap, ViewPlugin, WidgetType, type BlockInfo, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { foldKeyOf, sourceHeading } from '@shared/docFolds';
import { t } from '@/i18n';

/**
 * Titres repliables dans l'éditeur (Écriture, Lecture et écriture), comme dans Obsidian : une flèche dans la marge, à
 * gauche de chaque titre, replie sa section jusqu'au prochain titre de même niveau ou plus haut (le repli des titres
 * de CodeMirror). Seuls les titres en ont une. Les titres repliés sont retenus avec ceux de la lecture.
 */

export interface HeadingFoldOptions {
  load: () => Set<string>;
  save: (keys: Set<string>) => void;
}

class FoldMarker extends GutterMarker {
  readonly folded: boolean;
  constructor(folded: boolean) {
    super();
    this.folded = folded;
  }
  override eq(other: FoldMarker): boolean {
    return other.folded === this.folded;
  }
  override toDOM(): HTMLElement {
    const marker = document.createElement('span');
    marker.className = `cm-heading-fold${this.folded ? ' folded' : ''}`;
    marker.title = this.folded ? t('Déplier la section') : t('Replier la section');
    marker.innerHTML = '<i class="pi pi-chevron-down" aria-hidden="true"></i>';
    return marker;
  }
}
const openMarker = new FoldMarker(false);
const closedMarker = new FoldMarker(true);

/** La ligne est un vrai titre (pas un `#` dans un bloc de code) : le repli de CodeMirror le sait. */
const isHeadingLine = (text: string): boolean => /^ {0,3}#{1,6}(?:[ \t]|$)/.test(text);

/** Repli posé sur le titre de cette ligne (il part de la fin de la ligne). */
function foldOf(state: EditorState, lineTo: number): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null;
  foldedRanges(state).between(lineTo, lineTo, (from, to) => {
    if (from === lineTo) found = { from, to };
  });
  return found;
}

/** Clé de chaque titre du texte, par numéro de ligne (titres reconnus par l'arbre syntaxique, dans l'ordre). */
function headingKeys(state: EditorState): Map<number, string> {
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
  const seen = new Map<string, number>();
  const keys = new Map<number, string>();
  tree.iterate({
    enter: (node) => {
      if (!/^ATXHeading[1-6]$/.test(node.name)) return;
      const line = state.doc.lineAt(node.from);
      const heading = sourceHeading(line.text);
      if (heading) keys.set(line.number, foldKeyOf(heading.depth, heading.normalized, seen));
      return false;
    },
  });
  return keys;
}

/** Les titres repliés, par leur clé. */
function foldedKeys(state: EditorState): Set<string> {
  const keys = headingKeys(state);
  const folded = new Set<string>();
  foldedRanges(state).between(0, state.doc.length, (from) => {
    const key = keys.get(state.doc.lineAt(from).number);
    if (key) folded.add(key);
  });
  return folded;
}

/** Replie les titres retenus (à l'ouverture, une fois le texte arrivé, ou quand la lecture les a changés). */
export function restoreHeadingFolds(view: EditorView, wanted: Set<string>): void {
  const { state } = view;
  const effects = [];
  for (const [number, key] of headingKeys(state)) {
    const line = state.doc.line(number);
    const current = foldOf(state, line.to);
    if (wanted.has(key) && !current) {
      const range = foldable(state, line.from, line.to);
      if (range) effects.push(foldEffect.of(range));
    } else if (!wanted.has(key) && current) {
      effects.push(unfoldEffect.of(current));
    }
  }
  if (effects.length) view.dispatch({ effects });
}

const foldChanged = (update: ViewUpdate): boolean => update.transactions.some((tr) => tr.effects.some((effect) => effect.is(foldEffect) || effect.is(unfoldEffect)));

/** Replie ou déplie le titre de la ligne qui commence en `lineFrom` ; vrai s'il y avait quelque chose à faire. */
function toggleAt(view: EditorView, lineFrom: number): boolean {
  const line = view.state.doc.lineAt(lineFrom);
  if (!isHeadingLine(line.text)) return false;
  const current = foldOf(view.state, line.to);
  const range = current ?? foldable(view.state, line.from, line.to);
  if (!range) return false;
  view.dispatch({ effects: current ? unfoldEffect.of(current) : foldEffect.of(range) });
  return true;
}

/** « Lecture et écriture » : la flèche se tient juste à gauche du titre (le texte est centré, loin de la marge). */
class FoldWidget extends WidgetType {
  readonly folded: boolean;
  readonly lineFrom: number;
  constructor(folded: boolean, lineFrom: number) {
    super();
    this.folded = folded;
    this.lineFrom = lineFrom;
  }
  override eq(other: FoldWidget): boolean {
    return other.folded === this.folded && other.lineFrom === this.lineFrom;
  }
  override toDOM(view: EditorView): HTMLElement {
    const anchor = document.createElement('span');
    anchor.className = 'cm-heading-fold-anchor';
    const marker = (this.folded ? closedMarker : openMarker).toDOM();
    marker.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleAt(view, this.lineFrom);
    });
    anchor.append(marker);
    return anchor;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

function inlineMarkers(view: EditorView): DecorationSet {
  const widgets = [];
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      if (isHeadingLine(line.text)) {
        const folded = Boolean(foldOf(view.state, line.to));
        if (folded || foldable(view.state, line.from, line.to)) widgets.push(Decoration.widget({ widget: new FoldWidget(folded, line.from), side: -1 }).range(line.from));
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(widgets);
}

const inlineFolds = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = inlineMarkers(view);
    }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged || foldChanged(update) || syntaxTree(update.startState) !== syntaxTree(update.state)) this.decorations = inlineMarkers(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** `inline` : flèches à gauche des titres (Lecture et écriture) ; sinon dans la marge (Écriture). */
export function headingFolds(options: HeadingFoldOptions, inline = false): Extension {
  const markers = gutter({
    class: 'cm-heading-folds',
    lineMarker(view, block: BlockInfo) {
      const line = view.state.doc.lineAt(block.from);
      if (!isHeadingLine(line.text)) return null;
      if (foldOf(view.state, line.to)) return closedMarker;
      return foldable(view.state, line.from, line.to) ? openMarker : null;
    },
    lineMarkerChange: (update) => update.docChanged || update.viewportChanged || foldChanged(update) || syntaxTree(update.startState) !== syntaxTree(update.state),
    initialSpacer: () => openMarker,
    domEventHandlers: {
      mousedown: (view, block) => toggleAt(view, block.from),
    },
  });
  const remember = EditorView.updateListener.of((update) => {
    if (foldChanged(update)) options.save(foldedKeys(update.state));
  });
  return [
    codeFolding({
      placeholderDOM: (_view, onclick) => {
        const placeholder = document.createElement('span');
        placeholder.className = 'cm-heading-fold-placeholder';
        placeholder.textContent = '…';
        placeholder.title = t('Déplier la section');
        placeholder.onclick = onclick;
        return placeholder;
      },
    }),
    inline ? inlineFolds : markers,
    keymap.of(foldKeymap),
    remember,
    EditorView.theme({
      '.cm-heading-folds .cm-gutterElement': { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '1.2rem', padding: '0' },
      '.cm-heading-fold': { display: 'grid', placeItems: 'center', width: '1.1rem', height: '1.1rem', borderRadius: '4px', color: 'var(--fb-muted)', cursor: 'pointer', opacity: '0', transition: 'opacity 0.12s' },
      '.cm-heading-fold i': { fontSize: '0.65rem', transition: 'transform 0.15s' },
      '.cm-heading-fold.folded': { opacity: '1' },
      '.cm-heading-fold.folded i': { transform: 'rotate(-90deg)' },
      '&:hover .cm-heading-fold': { opacity: '0.55' },
      // Ancre sans largeur : la flèche se place à gauche du titre sans décaler son texte.
      '.cm-heading-fold-anchor': { position: 'relative', display: 'inline-block', width: '0', height: '1em', verticalAlign: 'middle' },
      '.cm-heading-fold-anchor .cm-heading-fold': { position: 'absolute', right: '0.35rem', top: '50%', transform: 'translateY(-50%)' },
      '.cm-line:hover .cm-heading-fold': { opacity: '0.7' },
      '.cm-heading-fold:hover': { opacity: '1', background: 'var(--fb-panel-alt)', color: 'var(--fb-text)' },
      '.cm-heading-fold-placeholder': { margin: '0 0.3rem', padding: '0 0.35rem', borderRadius: '4px', background: 'var(--fb-panel-alt)', color: 'var(--fb-muted)', cursor: 'pointer' },
    }),
  ];
}
