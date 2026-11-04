import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/** Actions d'écriture sur le Markdown de l'éditeur : mise en forme, lignes, blocs, tableaux et cases à cocher. */

export interface TextRange {
  from: number;
  to: number;
}

const input = { userEvent: 'input', scrollIntoView: true } as const;

function slice(view: EditorView, from: number, to: number): string {
  return view.state.sliceDoc(Math.max(0, from), Math.min(view.state.doc.length, to));
}

/** Encadre la sélection, ou retire l'encadrement s'il y est déjà. */
export function wrapSelection(view: EditorView, before: string, after: string, placeholder: string, range?: TextRange): void {
  if (range) view.dispatch({ selection: { anchor: range.from, head: range.to } });
  const { state } = view;
  view.dispatch(
    state.update(
      state.changeByRange((selection) => {
        if (slice(view, selection.from - before.length, selection.from) === before && slice(view, selection.to, selection.to + after.length) === after) {
          return {
            changes: [
              { from: selection.from - before.length, to: selection.from },
              { from: selection.to, to: selection.to + after.length },
            ],
            range: EditorSelection.range(selection.from - before.length, selection.to - before.length),
          };
        }
        const inner = selection.empty ? placeholder : state.sliceDoc(selection.from, selection.to);
        return {
          changes: { from: selection.from, to: selection.to, insert: `${before}${inner}${after}` },
          range: EditorSelection.range(selection.from + before.length, selection.from + before.length + inner.length),
        };
      }),
      input,
    ),
  );
  view.focus();
}

/** Début de ligne qui donne sa nature à une ligne : titre, citation, case à cocher, puce, numéro. */
const LINE_PREFIX = /^(\s*)(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)?/;

/** Donne le même début aux lignes de `range` ; refaire la même action le retire. */
export function setLinePrefix(view: EditorView, prefix: string | ((index: number) => string), range?: TextRange): void {
  const { doc } = view.state;
  const { from, to } = range ?? view.state.selection.main;
  const first = doc.lineAt(from).number;
  const last = doc.lineAt(to).number;
  const lines = [];
  for (let number = first; number <= last; number += 1) {
    const line = doc.line(number);
    if (line.text.trim() || first === last) lines.push(line);
  }
  const wanted = (index: number): string => (typeof prefix === 'string' ? prefix : prefix(index));
  const current = (text: string): string => LINE_PREFIX.exec(text)![2] ?? '';
  const already = lines.every((line, index) => current(line.text).trim() === wanted(index).trim() && wanted(index) !== '');
  view.dispatch({
    changes: lines.map((line, index) => {
      const match = LINE_PREFIX.exec(line.text)!;
      const start = line.from + match[1]!.length;
      return { from: start, to: start + (match[2] ?? '').length, insert: already ? '' : wanted(index) };
    }),
    ...input,
  });
  view.focus();
}

/** Marque de la position du curseur dans un modèle de bloc. */
export const CURSOR = '§';

/** Insère un bloc sur ses propres lignes, séparé du texte voisin, et place le curseur à la marque. */
export function insertBlock(view: EditorView, template: string, range?: TextRange): void {
  const { state } = view;
  const { from, to } = range ?? state.selection.main;
  const line = state.doc.lineAt(from);
  const lineEnd = state.doc.lineAt(to);
  const previous = line.number > 1 ? state.doc.line(line.number - 1).text : '';
  const head = state.sliceDoc(line.from, from).trim() ? '\n\n' : previous.trim() ? '\n' : '';
  const tail = state.sliceDoc(to, lineEnd.to).trim() ? '\n\n' : '';
  const cursor = template.indexOf(CURSOR);
  const body = template.replace(CURSOR, '');
  view.dispatch({
    changes: { from, to, insert: `${head}${body}${tail}` },
    selection: { anchor: from + head.length + (cursor < 0 ? body.length : cursor) },
    ...input,
  });
  view.focus();
}

export function insertText(view: EditorView, text: string): void {
  view.dispatch(view.state.replaceSelection(text), input);
  view.focus();
}

// --- Blocs --------------------------------------------------------------------------------------------------------------

export function duplicateBlock(view: EditorView, block: TextRange): void {
  const text = slice(view, block.from, block.to);
  view.dispatch({ changes: { from: block.to, insert: `\n\n${text}` }, selection: { anchor: block.to + 2 }, ...input });
  view.focus();
}

/** Échange un bloc avec son voisin : le texte entre les deux ne bouge pas. */
export function swapBlocks(view: EditorView, first: TextRange, second: TextRange): void {
  view.dispatch({
    changes: [
      { from: first.from, to: first.to, insert: slice(view, second.from, second.to) },
      { from: second.from, to: second.to, insert: slice(view, first.from, first.to) },
    ],
    ...input,
  });
  view.focus();
}

/** Retire un bloc et les lignes vides qui le suivent. */
export function deleteBlock(view: EditorView, block: TextRange): void {
  const after = slice(view, block.to, view.state.doc.length);
  view.dispatch({ changes: { from: block.from, to: block.to + (/^\s*/.exec(after)?.[0].length ?? 0) }, selection: { anchor: block.from }, ...input });
  view.focus();
}

// --- Tableaux ----------------------------------------------------------------------------------------------------------

const cells = (line: string): string[] => line.trim().replace(/^\||\|$/g, '').split('|');

export function addTableRow(view: EditorView, table: TextRange): void {
  const last = view.state.doc.lineAt(table.to);
  const row = `\n|${'   |'.repeat(cells(last.text).length)}`;
  view.dispatch({ changes: { from: last.to, insert: row }, selection: { anchor: last.to + 3 }, ...input });
  view.focus();
}

export function addTableColumn(view: EditorView, table: TextRange): void {
  const { doc } = view.state;
  const changes = [];
  for (let number = doc.lineAt(table.from).number; number <= doc.lineAt(table.to).number; number += 1) {
    const line = doc.line(number);
    const end = line.from + line.text.trimEnd().length;
    const closed = line.text.trimEnd().endsWith('|');
    changes.push({ from: end, insert: `${closed ? '' : ' |'} ${number === doc.lineAt(table.from).number + 1 ? '---' : '  '} |` });
  }
  view.dispatch({ changes, ...input });
  view.focus();
}

// --- Cases à cocher ----------------------------------------------------------------------------------------------------

const TASK = /^(\s*[-*+]\s+\[)([ xX])(\])/;

/** Ligne de la case à cocher sous `position`, ou de la énième case d'un bloc. */
export function taskLine(view: EditorView, position: number, block?: TextRange, index?: number): number | null {
  const { doc } = view.state;
  if (block && index !== undefined) {
    let seen = 0;
    for (let number = doc.lineAt(block.from).number; number <= doc.lineAt(block.to).number; number += 1) {
      if (!TASK.test(doc.line(number).text)) continue;
      if (seen === index) return doc.line(number).from;
      seen += 1;
    }
    return null;
  }
  const line = doc.lineAt(position);
  return TASK.test(line.text) ? line.from : null;
}

export function isTaskDone(view: EditorView, lineFrom: number): boolean {
  return /[xX]/.test(TASK.exec(view.state.doc.lineAt(lineFrom).text)?.[2] ?? '');
}

export function toggleTask(view: EditorView, lineFrom: number): void {
  const line = view.state.doc.lineAt(lineFrom);
  const match = TASK.exec(line.text);
  if (!match) return;
  const at = line.from + match[1]!.length;
  view.dispatch({ changes: { from: at, to: at + 1, insert: match[2] === ' ' ? 'x' : ' ' }, userEvent: 'input' });
}
