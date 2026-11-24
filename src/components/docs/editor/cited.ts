import { StateEffect, StateField, type Range, type Text } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { LineRange } from '@shared/citations';

/**
 * Lignes citées (lien d'une citation, `?lines=12-18`) : surlignées dans l'éditeur. Elles suivent le texte quand on
 * écrit autour ; `null` les efface.
 */

export const setCitedLines = StateEffect.define<readonly LineRange[] | null>();

/** Au-delà, une plage n'est pas décorée ligne à ligne (citation démesurée). */
const MAX_LINES = 2_000;

function decorate(doc: Text, ranges: readonly LineRange[] | null): DecorationSet {
  if (!ranges?.length) return Decoration.none;
  const decorations: Array<Range<Decoration>> = [];
  let count = 0;
  for (const range of ranges) {
    const last = Math.min(range.to, doc.lines);
    for (let number = Math.max(1, range.from); number <= last && count < MAX_LINES; number += 1, count += 1) {
      const edges = `${number === range.from ? ' cm-cited-first' : ''}${number === last ? ' cm-cited-last' : ''}`;
      decorations.push(Decoration.line({ class: `cm-cited-line${edges}` }).range(doc.line(number).from));
    }
  }
  return Decoration.set(decorations, true);
}

export const citedLines = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    const effect = transaction.effects.find((entry) => entry.is(setCitedLines));
    if (effect) return decorate(transaction.state.doc, effect.value);
    return transaction.docChanged ? value.map(transaction.changes) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Surligne `ranges` (ou efface avec `null`) ; avec `scroll`, amène la première ligne citée en haut de l'éditeur. */
export function showCitedLines(view: EditorView, ranges: readonly LineRange[] | null, scroll: boolean): void {
  const first = ranges?.[0] ? Math.min(ranges[0].from, view.state.doc.lines) : null;
  view.dispatch({
    effects: [setCitedLines.of(ranges), ...(scroll && first ? [EditorView.scrollIntoView(view.state.doc.line(first).from, { y: 'start', yMargin: 72 })] : [])],
  });
}
