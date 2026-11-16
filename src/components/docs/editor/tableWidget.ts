import type { EditorState } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';
import { sourceOffset } from '@shared/docComments';
import { applyTableAction, parseTable, serializeTable, type TableAction, type TableFocus, type TableModel } from '@shared/docTable';
import { t } from '@/i18n';
import type { TextRange } from './commands';

/**
 * Tableau éditable sur place, comme dans Obsidian : chaque cellule s'affiche rendue, et passe en Markdown le temps
 * qu'on l'écrive. Le source est réécrit (colonnes alignées) au fil de la frappe, par la plus petite modification
 * possible, pour que les autres personnes gardent leurs curseurs.
 */

export interface TableOptions {
  /** HTML assaini du tableau, situé à `block` dans le texte. */
  render: (source: string, block: TextRange, state: EditorState) => string;
  /** Plage du tableau dont `dom` est le rendu. */
  locate: (view: EditorView, dom: HTMLElement) => TextRange | null;
  /** Suit un lien rendu ; vrai s'il a été suivi. */
  follow: (element: HTMLElement, event: MouseEvent) => boolean;
  undo: (view: EditorView) => void;
  redo: (view: EditorView) => void;
}

const COMMIT_DELAY = 350;

class TableEditor {
  view: EditorView;
  readonly dom: HTMLElement;
  options: TableOptions;
  model: TableModel;
  source: string;
  version: number;
  /** Plage connue à la création, avant que le tableau soit dans la page. */
  block: TextRange;
  editing: TableFocus | null = null;
  private timer = 0;
  private readonly table: HTMLTableElement;

  constructor(view: EditorView, widget: TableWidget, model: TableModel) {
    this.view = view;
    this.options = widget.options;
    this.model = model;
    this.source = widget.source;
    this.version = widget.version;
    this.block = widget.block;
    this.dom = document.createElement('div');
    this.dom.className = 'cm-table-editor markdown';
    this.table = document.createElement('table');
    const scroller = document.createElement('div');
    scroller.className = 'cm-table-scroll';
    scroller.append(this.table);
    const addRow = this.button('cm-table-add row', t('Ajouter une ligne'), () => this.act('row-below', this.model.rows.length - 1, this.editing?.col ?? 0));
    const addColumn = this.button('cm-table-add col', t('Ajouter une colonne'), () => this.act('col-right', this.editing?.row ?? 0, this.model.align.length - 1));
    this.dom.append(scroller, addColumn, addRow);
    (this.dom as HTMLElement & { tableEditor?: TableEditor }).tableEditor = this;
    this.dom.addEventListener('mousedown', (event) => this.onMouseDown(event));
    this.dom.addEventListener('focusin', (event) => this.onFocusIn(event));
    this.dom.addEventListener('focusout', (event) => this.onFocusOut(event));
    this.dom.addEventListener('input', (event) => this.onInput(event));
    this.dom.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.build();
  }

  private button(className: string, label: string, run: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = '<i class="pi pi-plus"></i>';
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', run);
    return button;
  }

  // --- Affichage -------------------------------------------------------------------------------------------------------

  /** HTML rendu de chaque cellule, d'après le source courant. */
  private renderedCells(): string[][] {
    const box = document.createElement('div');
    box.innerHTML = this.options.render(serializeTable(this.model), this.range() ?? this.block, this.view.state);
    const table = box.querySelector('table');
    return table ? [...table.rows].map((row) => [...row.cells].map((cell) => cell.innerHTML)) : [];
  }

  /** Plage du tableau dans le texte. */
  range(): TextRange | null {
    if (!this.dom.isConnected) return this.block;
    try {
      return this.options.locate(this.view, this.dom);
    } catch {
      return null;
    }
  }

  private cellAt(row: number, col: number): HTMLElement | null {
    return this.table.rows[row]?.cells[col]?.querySelector<HTMLElement>('.cm-table-cell') ?? null;
  }

  /** Met le tableau à jour d'après le modèle, en gardant intacte la cellule en cours d'écriture. */
  build(): void {
    const html = this.renderedCells();
    const { rows, align } = this.model;
    const head = this.table.tHead ?? this.table.createTHead();
    const body = this.table.tBodies[0] ?? this.table.createTBody();
    const sections = [head, ...Array<HTMLTableSectionElement>(rows.length - 1).fill(body)];
    // Lignes en trop, puis lignes manquantes.
    while (head.rows.length > 1) head.deleteRow(-1);
    while (body.rows.length > rows.length - 1) body.deleteRow(-1);
    rows.forEach((cells, rowIndex) => {
      const section = sections[rowIndex]!;
      const sectionIndex = rowIndex === 0 ? 0 : rowIndex - 1;
      const tr = section.rows[sectionIndex] ?? section.insertRow();
      while (tr.cells.length > cells.length) tr.deleteCell(-1);
      cells.forEach((value, colIndex) => {
        let td = tr.cells[colIndex];
        if (!td) {
          td = document.createElement(rowIndex === 0 ? 'th' : 'td');
          const cell = document.createElement('div');
          cell.className = 'cm-table-cell';
          try {
            cell.contentEditable = 'plaintext-only';
          } catch {
            cell.contentEditable = 'true';
          }
          cell.spellcheck = true;
          td.append(cell);
          tr.append(td);
        }
        td.style.textAlign = align[colIndex] ?? '';
        const cell = td.firstElementChild as HTMLElement;
        cell.dataset.row = String(rowIndex);
        cell.dataset.col = String(colIndex);
        const editing = this.editing?.row === rowIndex && this.editing.col === colIndex;
        td.classList.toggle('editing', editing);
        if (editing) {
          if (cell.textContent !== value) cell.textContent = value;
        } else {
          cell.innerHTML = html[rowIndex]?.[colIndex] ?? escapeText(value);
        }
      });
    });
    this.dom.dataset.source = this.source;
    this.view.requestMeasure();
  }

  /** Le source a changé ailleurs (autre personne, annulation, édition brute) : on reprend sa grille. */
  receive(source: string, version: number): boolean {
    const model = parseTable(source);
    if (!model) return false;
    const editing = this.editing;
    // Une frappe pas encore envoyée l'emporte sur la version reçue.
    if (editing && this.timer && model.rows[editing.row]?.[editing.col] !== undefined) {
      model.rows[editing.row]![editing.col] = this.model.rows[editing.row]?.[editing.col] ?? '';
    }
    this.model = model;
    this.source = source;
    this.version = version;
    if (editing && model.rows[editing.row]?.[editing.col] === undefined) this.editing = null;
    this.build();
    if (editing && this.editing) {
      const cell = this.cellAt(editing.row, editing.col);
      if (cell && document.activeElement !== cell) this.focusCell(editing.row, editing.col, 'end');
    }
    return true;
  }

  // --- Écriture --------------------------------------------------------------------------------------------------------

  /** Envoie la grille dans le source, par la plus petite modification possible. */
  commit(): void {
    window.clearTimeout(this.timer);
    this.timer = 0;
    const text = serializeTable(this.model);
    if (text === this.source) return;
    const range = this.dom.isConnected ? this.range() : null;
    if (!range) return;
    const current = this.view.state.sliceDoc(range.from, range.to);
    let start = 0;
    while (start < current.length && start < text.length && current[start] === text[start]) start += 1;
    let end = 0;
    while (end < current.length - start && end < text.length - start && current[current.length - 1 - end] === text[text.length - 1 - end]) end += 1;
    this.source = text;
    this.dom.dataset.source = text;
    this.view.dispatch({ changes: { from: range.from + start, to: range.from + current.length - end, insert: text.slice(start, text.length - end) }, userEvent: 'input.table' });
  }

  private schedule(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.commit(), COMMIT_DELAY);
  }

  /** Opération sur une ligne ou une colonne, puis curseur dans la cellule visée. */
  act(action: TableAction, row: number, col: number): void {
    this.commit();
    const result = applyTableAction(this.model, action, row, col);
    if (!result) return;
    this.model = result.model;
    this.editing = null;
    this.build();
    this.commit();
    this.focusCell(result.focus.row, result.focus.col, 'end');
  }

  // --- Cellules --------------------------------------------------------------------------------------------------------

  focusCell(row: number, col: number, caret: 'start' | 'end' | number): void {
    const cell = this.cellAt(row, col);
    if (!cell) return;
    this.startEditing(row, col);
    cell.focus({ preventScroll: true });
    cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    placeCaret(cell, caret === 'start' ? 0 : caret === 'end' ? (cell.textContent ?? '').length : caret);
  }

  private startEditing(row: number, col: number): void {
    if (this.editing?.row === row && this.editing.col === col) return;
    this.stopEditing();
    this.editing = { row, col };
    const cell = this.cellAt(row, col);
    if (!cell) return;
    cell.parentElement!.classList.add('editing');
    cell.textContent = this.model.rows[row]?.[col] ?? '';
    this.view.requestMeasure();
  }

  private stopEditing(): void {
    if (!this.editing) return;
    this.commit();
    const { row, col } = this.editing;
    this.editing = null;
    const cell = this.cellAt(row, col);
    if (!cell) return;
    cell.parentElement!.classList.remove('editing');
    cell.innerHTML = this.renderedCells()[row]?.[col] ?? escapeText(this.model.rows[row]?.[col] ?? '');
    this.view.requestMeasure();
  }

  private position(element: HTMLElement): TableFocus | null {
    const cell = element.closest<HTMLElement>('.cm-table-cell');
    return cell && this.dom.contains(cell) ? { row: Number(cell.dataset.row), col: Number(cell.dataset.col) } : null;
  }

  private onMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    const at = this.position(target);
    if (!at || (this.editing?.row === at.row && this.editing.col === at.col)) return;
    const link = target.closest<HTMLElement>('a, .md-mention');
    if (link && this.options.follow(link, event)) {
      event.preventDefault();
      return;
    }
    // Le curseur se place à l'endroit visé dans le texte rendu, reporté sur le Markdown de la cellule.
    const cell = this.cellAt(at.row, at.col)!;
    const before = textBefore(cell, event.clientX, event.clientY);
    event.preventDefault();
    this.focusCell(at.row, at.col, sourceOffset(this.model.rows[at.row]?.[at.col] ?? '', before));
  }

  private onFocusIn(event: FocusEvent): void {
    const at = this.position(event.target as HTMLElement);
    if (at) this.startEditing(at.row, at.col);
  }

  private onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as HTMLElement | null;
    if (next && this.position(next)) return;
    this.stopEditing();
  }

  private onInput(event: Event): void {
    const at = this.position(event.target as HTMLElement);
    if (!at) return;
    const cell = this.cellAt(at.row, at.col)!;
    const value = (cell.textContent ?? '').replace(/\r?\n/g, ' ');
    this.model.rows[at.row]![at.col] = value;
    this.view.requestMeasure();
    this.schedule();
  }

  /** Quitte le tableau par le haut ou par le bas, curseur sur la ligne voisine (créée au besoin). */
  private leave(direction: 'up' | 'down'): void {
    this.stopEditing();
    const range = this.range();
    const view = this.view;
    view.focus();
    if (!range) return;
    const { doc } = view.state;
    if (direction === 'down') {
      if (range.to < doc.length) view.dispatch({ selection: { anchor: range.to + 1 }, scrollIntoView: true });
      else view.dispatch({ changes: { from: range.to, insert: '\n' }, selection: { anchor: range.to + 1 }, scrollIntoView: true });
    } else if (range.from > 0) {
      view.dispatch({ selection: { anchor: range.from - 1 }, scrollIntoView: true });
    } else {
      view.dispatch({ changes: { from: 0, insert: '\n' }, selection: { anchor: 0 }, scrollIntoView: true });
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    const at = this.position(event.target as HTMLElement);
    if (!at) return;
    const { row, col } = at;
    const rows = this.model.rows.length;
    const cols = this.model.align.length;
    const cell = this.cellAt(row, col)!;
    const length = (cell.textContent ?? '').length;
    const caret = caretOffset(cell);
    const mod = event.ctrlKey || event.metaKey;
    const handled = (): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (mod && !event.altKey && (event.key === 'z' || event.key === 'Z' || event.key === 'y')) {
      handled();
      this.commit();
      if (event.key === 'y' || event.shiftKey) this.options.redo(this.view);
      else this.options.undo(this.view);
      return;
    }
    if (event.key === 'Tab') {
      handled();
      const index = row * cols + col + (event.shiftKey ? -1 : 1);
      if (index < 0) return;
      if (index >= rows * cols) this.act('row-below', rows - 1, 0);
      else this.focusCell(Math.floor(index / cols), index % cols, 'end');
      return;
    }
    if (event.key === 'Enter') {
      handled();
      if (event.shiftKey) {
        document.execCommand('insertText', false, '<br>');
        return;
      }
      if (mod || row === rows - 1) this.act('row-below', row, col);
      else this.focusCell(row + 1, col, 'end');
      return;
    }
    if (event.key === 'Escape') {
      handled();
      this.leave('down');
      return;
    }
    const collapsed = window.getSelection()?.isCollapsed ?? true;
    if (event.key === 'ArrowUp' && !event.shiftKey) {
      handled();
      if (row === 0) this.leave('up');
      else this.focusCell(row - 1, col, 'end');
    } else if (event.key === 'ArrowDown' && !event.shiftKey) {
      handled();
      if (row === rows - 1) this.leave('down');
      else this.focusCell(row + 1, col, 'end');
    } else if (event.key === 'ArrowLeft' && collapsed && !event.shiftKey && caret === 0 && (col > 0 || row > 0)) {
      handled();
      if (col > 0) this.focusCell(row, col - 1, 'end');
      else this.focusCell(row - 1, cols - 1, 'end');
    } else if (event.key === 'ArrowRight' && collapsed && !event.shiftKey && caret === length && (col < cols - 1 || row < rows - 1)) {
      handled();
      if (col < cols - 1) this.focusCell(row, col + 1, 'start');
      else this.focusCell(row + 1, 0, 'start');
    }
  }

  destroy(): void {
    window.clearTimeout(this.timer);
  }
}

function escapeText(text: string): string {
  const span = document.createElement('span');
  span.textContent = text;
  return span.innerHTML;
}

function placeCaret(element: HTMLElement, offset: number): void {
  const selection = window.getSelection();
  if (!selection) return;
  const text = element.firstChild;
  const range = document.createRange();
  if (text?.nodeType === Node.TEXT_NODE) range.setStart(text, Math.max(0, Math.min(offset, text.textContent?.length ?? 0)));
  else range.setStart(element, 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function caretOffset(element: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !element.contains(selection.focusNode)) return 0;
  const range = document.createRange();
  range.selectNodeContents(element);
  range.setEnd(selection.focusNode!, selection.focusOffset);
  return range.toString().length;
}

/** Texte rendu qui précède le point cliqué dans une cellule. */
function textBefore(cell: HTMLElement, x: number, y: number): string {
  const page = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
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
  if (!node || !cell.contains(node)) return cell.textContent ?? '';
  const range = document.createRange();
  range.selectNodeContents(cell);
  range.setEnd(node, offset);
  return range.toString();
}

export class TableWidget extends WidgetType {
  readonly source: string;
  readonly version: number;
  readonly block: TextRange;
  readonly options: TableOptions;

  constructor(source: string, version: number, block: TextRange, options: TableOptions) {
    super();
    this.source = source;
    this.version = version;
    this.block = block;
    this.options = options;
  }

  override eq(other: TableWidget): boolean {
    return other.source === this.source && other.version === this.version;
  }

  override toDOM(view: EditorView): HTMLElement {
    return new TableEditor(view, this, parseTable(this.source) ?? { align: [null], rows: [['']] }).dom;
  }

  override updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const editor = tableEditorOf(dom);
    if (!editor) return false;
    editor.view = view;
    editor.options = this.options;
    editor.block = this.block;
    if (editor.source === this.source && editor.version === this.version) return true;
    if (editor.source === this.source) {
      editor.version = this.version;
      editor.build();
      return true;
    }
    return editor.receive(this.source, this.version);
  }

  override destroy(dom: HTMLElement): void {
    tableEditorOf(dom)?.destroy();
  }

  /** Les cellules gèrent elles-mêmes clavier, souris et sélection. */
  override ignoreEvent(): boolean {
    return true;
  }
}

function tableEditorOf(element: Element): TableEditor | undefined {
  return (element as HTMLElement & { tableEditor?: TableEditor }).tableEditor;
}

/** Tableau et cellule sous un élément (clic droit). */
export function tableCellAt(element: HTMLElement): { dom: HTMLElement; row: number; col: number } | null {
  const dom = element.closest<HTMLElement>('.cm-table-editor');
  const cell = element.closest<HTMLElement>('td, th')?.querySelector<HTMLElement>('.cm-table-cell');
  if (!dom || !cell || !tableEditorOf(dom)) return null;
  return { dom, row: Number(cell.dataset.row), col: Number(cell.dataset.col) };
}

/** Opération du menu contextuel sur un tableau éditable. */
export function tableAction(dom: HTMLElement, action: TableAction, row: number, col: number): void {
  tableEditorOf(dom)?.act(action, row, col);
}

/** Taille du tableau sous le clic droit, pour griser les opérations impossibles. */
export function tableSize(dom: HTMLElement): { rows: number; cols: number } {
  const model = tableEditorOf(dom)?.model;
  return { rows: model?.rows.length ?? 0, cols: model?.align.length ?? 0 };
}

/** Termine la frappe en cours dans les tableaux de l'éditeur (avant une édition brute, par exemple). */
export function flushTables(view: EditorView): void {
  for (const dom of view.dom.querySelectorAll<HTMLElement>('.cm-table-editor')) tableEditorOf(dom)?.commit();
}

