import { StateEffect, StateField, type EditorState } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { SearchMatch } from '@shared/noteSearch';

/**
 * Résultats de la recherche dans la note (Ctrl F) : surlignés dans l'éditeur, et lus par le rendu « Lecture et écriture »
 * qui y montre la syntaxe Markdown (chercher `**s` surligne `**s`, astérisques comprises).
 */

export interface FindState {
  matches: SearchMatch[];
  /** Rang du résultat choisi, -1 sans résultat. */
  current: number;
}

export const setFindState = StateEffect.define<FindState | null>();

const match = Decoration.mark({ class: 'cm-searchMatch' });
const selected = Decoration.mark({ class: 'cm-searchMatch cm-searchMatch-selected' });

export const findField = StateField.define<FindState | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setFindState)) return effect.value;
    if (!value || !transaction.docChanged) return value;
    // Le texte change pendant la recherche : les résultats suivent, en attendant d'être recalculés.
    const matches = value.matches
      .map((entry) => ({ from: transaction.changes.mapPos(entry.from, 1), to: transaction.changes.mapPos(entry.to, -1) }))
      .filter((entry) => entry.to > entry.from);
    return { matches, current: Math.min(value.current, matches.length - 1) };
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value): DecorationSet => {
      if (!value?.matches.length) return Decoration.none;
      return Decoration.set(value.matches.map((entry, index) => (index === value.current ? selected : match).range(entry.from, entry.to)));
    }),
});

/** Résultats de la recherche en cours (vide quand la recherche est fermée). */
export function findMatches(state: EditorState): SearchMatch[] {
  return state.field(findField, false)?.matches ?? [];
}

/** Un résultat de la recherche recouvre une partie de `from`–`to` (résultats triés, sans chevauchement). */
export function overlapsMatch(matches: readonly SearchMatch[], from: number, to: number): boolean {
  let low = 0;
  let high = matches.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (matches[middle]!.to > from) high = middle;
    else low = middle + 1;
  }
  return low < matches.length && matches[low]!.from < to;
}

/** Le résultat choisi, s'il y en a un. */
export function currentMatch(state: EditorState): SearchMatch | null {
  const value = state.field(findField, false);
  return value && value.current >= 0 ? (value.matches[value.current] ?? null) : null;
}
