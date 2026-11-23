import type { EditorState } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';
import { sourceOffset } from '@shared/docComments';
import {
  applyTableAction,
  cellRange,
  cellText,
  fillRange,
  gridFromText,
  gridToMarkdown,
  gridToTsv,
  inRange,
  moveColumn,
  moveRow,
  parseTable,
  pasteGrid,
  rangeCells,
  serializeTable,
  type CellRange,
  type TableAction,
  type TableFocus,
  type TableModel,
} from '@shared/docTable';
import { t } from '@/i18n';
import type { TextRange } from './commands';

/**
 * Tableau éditable sur place, comme dans Obsidian : chaque cellule s'affiche rendue, et passe en Markdown le temps
 * qu'on l'écrive. Le source est réécrit (colonnes alignées) au fil de la frappe, par la plus petite modification
 * possible, pour que les autres personnes gardent leurs curseurs.
 *
 * Comme dans Obsidian, des poignées ⋮⋮ apparaissent au survol sur la ligne et la colonne : un clic les sélectionne et
 * ouvre leur menu, un glisser les déplace. On sélectionne aussi des cellules en glissant, avec Maj (clic ou flèches) ou
 * Ctrl A ; la sélection se copie, se coupe, se vide (Suppr) et reçoit un collage, y compris depuis un tableur.
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
  /** Cellules sélectionnées (au moins une), quand on n'écrit pas dans une cellule. */
  selection: CellRange | null = null;
  /** Coin fixe de la sélection, et coin qui bouge avec Maj + flèches. */
  private anchor: TableFocus | null = null;
  private head: TableFocus | null = null;
  /** Cellule survolée : les poignées s'y rattachent. */
  private hover: TableFocus | null = null;
  private timer = 0;
  private readonly table: HTMLTableElement;
  private readonly scroller: HTMLElement;
  private readonly rowGrip: HTMLButtonElement;
  private readonly colGrip: HTMLButtonElement;
  private readonly indicator: HTMLElement;

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
    this.dom.tabIndex = -1;
    this.scroller = document.createElement('div');
    this.scroller.className = 'cm-table-scroll';
    this.scroller.append(this.table);
    const addRow = this.button('cm-table-add row', t('Ajouter une ligne'), () => this.act('row-below', this.model.rows.length - 1, this.editing?.col ?? 0));
    const addColumn = this.button('cm-table-add col', t('Ajouter une colonne'), () => this.act('col-right', this.editing?.row ?? 0, this.model.align.length - 1));
    this.rowGrip = this.grip('row', t('Ligne : clic pour le menu, glisser pour déplacer'));
    this.colGrip = this.grip('col', t('Colonne : clic pour le menu, glisser pour déplacer'));
    this.indicator = document.createElement('div');
    this.indicator.className = 'cm-table-drop';
    this.dom.append(this.scroller, addColumn, addRow, this.rowGrip, this.colGrip, this.indicator);
    (this.dom as HTMLElement & { tableEditor?: TableEditor }).tableEditor = this;
    this.dom.addEventListener('mousedown', (event) => this.onMouseDown(event));
    this.dom.addEventListener('mouseover', (event) => this.onMouseOver(event));
    this.dom.addEventListener('mouseleave', () => this.dom.classList.remove('hovering'));
    this.dom.addEventListener('focusin', (event) => this.onFocusIn(event));
    this.dom.addEventListener('focusout', (event) => this.onFocusOut(event));
    this.dom.addEventListener('input', (event) => this.onInput(event));
    this.dom.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.dom.addEventListener('copy', (event) => this.onCopy(event, false));
    this.dom.addEventListener('cut', (event) => this.onCopy(event, true));
    this.dom.addEventListener('paste', (event) => this.onPaste(event));
    this.scroller.addEventListener('scroll', () => this.hover && this.placeGrips(this.hover), { passive: true });
    this.build();
  }

  /** Poignée ⋮⋮ d'une ligne ou d'une colonne. */
  private grip(kind: 'row' | 'col', label: string): HTMLButtonElement {
    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = `cm-table-grip ${kind}`;
    grip.title = label;
    grip.setAttribute('aria-label', label);
    grip.innerHTML = `<i class="pi ${kind === 'row' ? 'pi-ellipsis-v' : 'pi-ellipsis-h'}"></i>`;
    grip.addEventListener('pointerdown', (event) => this.onGripDown(kind, event));
    return grip;
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
        td.classList.toggle('selected', inRange(this.selection, rowIndex, colIndex));
        if (editing) {
          if (cell.textContent !== value) cell.textContent = value;
        } else {
          cell.innerHTML = html[rowIndex]?.[colIndex] ?? escapeText(value);
        }
      });
    });
    this.dom.dataset.source = this.source;
    this.dom.classList.toggle('ranging', this.selection !== null);
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
    if (this.selection && (this.selection.bottom >= model.rows.length || this.selection.right >= model.align.length)) this.selection = null;
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
    this.selection = null;
    this.build();
    this.commit();
    this.focusCell(result.focus.row, result.focus.col, 'end');
  }

  /** Remplace la grille (collage, déplacement, effacement), l'envoie, puis sélectionne `range`. */
  private replace(model: TableModel, range: CellRange | null): void {
    this.commit();
    this.model = model;
    this.editing = null;
    this.selection = null;
    this.build();
    this.commit();
    if (range) this.select(range, { row: range.top, col: range.left });
  }

  // --- Sélection de cellules -------------------------------------------------------------------------------------------

  /** Sélectionne des cellules (sortie de la cellule en cours d'écriture) ; le tableau prend le clavier. */
  select(range: CellRange, anchor: TableFocus, head: TableFocus = { row: range.bottom, col: range.right }): void {
    this.stopEditing();
    this.selection = range;
    this.anchor = anchor;
    this.head = head;
    window.getSelection()?.removeAllRanges();
    if (document.activeElement !== this.dom) this.dom.focus({ preventScroll: true });
    this.paintRange();
  }

  private clearRange(): void {
    if (!this.selection) return;
    this.selection = null;
    this.paintRange();
  }

  private paintRange(): void {
    for (const [rowIndex, tr] of [...this.table.rows].entries()) {
      for (const [colIndex, td] of [...tr.cells].entries()) td.classList.toggle('selected', inRange(this.selection, rowIndex, colIndex));
    }
    this.dom.classList.toggle('ranging', this.selection !== null);
  }

  /** Toute une ligne, toute une colonne, ou tout le tableau. */
  selectRow(row: number): void {
    this.select({ top: row, left: 0, bottom: row, right: this.model.align.length - 1 }, { row, col: 0 });
  }

  selectColumn(col: number): void {
    this.select({ top: 0, left: col, bottom: this.model.rows.length - 1, right: col }, { row: 0, col });
  }

  private selectAll(): void {
    this.select({ top: 0, left: 0, bottom: this.model.rows.length - 1, right: this.model.align.length - 1 }, { row: 0, col: 0 });
  }

  /** Contenu sélectionné (ou de la cellule en cours) pour le presse-papiers. */
  selectedGrid(): string[][] {
    if (this.selection) return rangeCells(this.model, this.selection);
    if (this.editing) return [[this.model.rows[this.editing.row]?.[this.editing.col] ?? '']];
    return [];
  }

  /** Vide les cellules sélectionnées. */
  clearCells(): void {
    if (this.selection) this.replace(fillRange(this.model, this.selection), this.selection);
  }

  /** Colle une grille (ou une valeur) sur la sélection ou la cellule en cours. */
  pasteText(text: string, html = ''): void {
    const grid = gridFromHtml(html) ?? gridFromText(text);
    const at = this.selection ? { row: this.selection.top, col: this.selection.left } : this.editing;
    if (!at) return;
    if (grid && (grid.length > 1 || (grid[0]?.length ?? 0) > 1)) {
      const result = pasteGrid(this.model, at, grid);
      this.replace(result.model, result.range);
      return;
    }
    const value = cellText(grid?.[0]?.[0] ?? text);
    if (this.selection) {
      this.replace(fillRange(this.model, this.selection, value), this.selection);
      return;
    }
    // Une seule valeur dans la cellule en cours : elle s'insère au curseur, comme une frappe.
    document.execCommand('insertText', false, value);
  }

  private onCopy(event: ClipboardEvent, cut: boolean): void {
    if (!this.selection || !event.clipboardData) return;
    event.preventDefault();
    const grid = rangeCells(this.model, this.selection);
    event.clipboardData.setData('text/plain', gridToTsv(grid));
    event.clipboardData.setData('text/html', gridToHtml(grid));
    if (cut) this.clearCells();
  }

  private onPaste(event: ClipboardEvent): void {
    if ((!this.selection && !this.editing) || !event.clipboardData) return;
    event.preventDefault();
    this.pasteText(event.clipboardData.getData('text/plain'), event.clipboardData.getData('text/html'));
  }

  // --- Poignées : menu au clic, déplacement au glisser ------------------------------------------------------------------

  private onMouseOver(event: MouseEvent): void {
    const at = this.position(event.target as HTMLElement);
    if (!at) return;
    this.dom.classList.add('hovering');
    if (this.hover?.row === at.row && this.hover.col === at.col) return;
    this.hover = at;
    this.placeGrips(at);
  }

  private placeGrips(at: TableFocus): void {
    const tr = this.table.rows[at.row];
    const td = tr?.cells[at.col];
    if (!tr || !td) return;
    const box = this.dom.getBoundingClientRect();
    const line = tr.getBoundingClientRect();
    const cell = td.getBoundingClientRect();
    const table = this.table.getBoundingClientRect();
    this.rowGrip.style.top = `${line.top - box.top + line.height / 2}px`;
    this.rowGrip.style.left = `${Math.max(table.left, box.left) - box.left}px`;
    this.colGrip.style.top = `${table.top - box.top}px`;
    this.colGrip.style.left = `${cell.left - box.left + cell.width / 2}px`;
    this.colGrip.style.visibility = cell.right < box.left || cell.left > box.right ? 'hidden' : '';
  }

  private onGripDown(kind: 'row' | 'col', event: PointerEvent): void {
    const at = this.hover;
    if (!at || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.commit();
    const grip = kind === 'row' ? this.rowGrip : this.colGrip;
    const from = kind === 'row' ? at.row : at.col;
    const start = { x: event.clientX, y: event.clientY };
    let dragging = false;
    let target = from;
    grip.setPointerCapture(event.pointerId);

    const move = (next: PointerEvent): void => {
      if (!dragging && Math.hypot(next.clientX - start.x, next.clientY - start.y) < 5) return;
      // L'en-tête ne se déplace pas.
      if (kind === 'row' && from === 0) return;
      if (!dragging) {
        dragging = true;
        this.dom.classList.add('dragging');
        if (kind === 'row') this.selectRow(from);
        else this.selectColumn(from);
      }
      target = this.dropIndex(kind, from, kind === 'row' ? next.clientY : next.clientX);
    };
    const up = (): void => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      this.dom.classList.remove('dragging');
      this.indicator.style.display = 'none';
      if (dragging) {
        const moved = kind === 'row' ? moveRow(this.model, from, target) : moveColumn(this.model, from, target);
        if (moved) {
          const range = kind === 'row' ? { top: target, left: 0, bottom: target, right: moved.align.length - 1 } : { top: 0, left: target, bottom: moved.rows.length - 1, right: target };
          this.replace(moved, range);
        }
        return;
      }
      // Un clic : la ligne (ou la colonne) est sélectionnée et son menu s'ouvre, comme au clic droit.
      if (kind === 'row') this.selectRow(from);
      else this.selectColumn(from);
      const cell = this.table.rows[at.row]?.cells[at.col];
      const place = grip.getBoundingClientRect();
      cell?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: place.right, clientY: place.bottom, button: 2 }));
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  }

  /** Place visée par un glisser, et le trait qui la montre. */
  private dropIndex(kind: 'row' | 'col', from: number, pointer: number): number {
    const box = this.dom.getBoundingClientRect();
    // La ligne d'en-tête donne la largeur réelle des cellules (le tableau peut être plus large que son contenu).
    const table = this.table.rows[0]?.getBoundingClientRect() ?? this.table.getBoundingClientRect();
    const height = this.table.getBoundingClientRect().height;
    const items = kind === 'row' ? [...this.table.rows].map((tr) => tr.getBoundingClientRect()) : [...(this.table.rows[0]?.cells ?? [])].map((td) => td.getBoundingClientRect());
    const first = kind === 'row' ? 1 : 0;
    // Bord avant lequel on dépose : la première cellule dont le milieu est après le pointeur.
    let edge = items.length;
    for (let index = first; index < items.length; index += 1) {
      const rect = items[index]!;
      if (pointer < (kind === 'row' ? rect.top + rect.height / 2 : rect.left + rect.width / 2)) {
        edge = index;
        break;
      }
    }
    const style = this.indicator.style;
    style.display = 'block';
    if (kind === 'row') {
      const y = edge < items.length ? items[edge]!.top : items.at(-1)!.bottom;
      Object.assign(style, { top: `${y - box.top - 1}px`, left: `${table.left - box.left}px`, width: `${table.width}px`, height: '2px' });
    } else {
      const x = edge < items.length ? items[edge]!.left : items.at(-1)!.right;
      Object.assign(style, { left: `${x - box.left - 1}px`, top: `${table.top - box.top}px`, height: `${height}px`, width: '2px' });
    }
    const target = edge > from ? edge - 1 : edge;
    return Math.max(first, Math.min(target, items.length - 1));
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
    this.clearRange();
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
    if (!at) return;
    // Maj + clic : de la cellule en cours (ou du coin de la sélection) jusqu'à celle-ci.
    const base = this.editing ?? this.anchor;
    if (event.shiftKey && base && (this.editing || this.selection)) {
      event.preventDefault();
      this.select(cellRange(base, at), base, at);
      return;
    }
    this.followDrag(at);
    if (this.editing?.row === at.row && this.editing.col === at.col) return;
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

  /** Glisser d'une cellule à une autre : les cellules parcourues se sélectionnent. */
  private followDrag(start: TableFocus): void {
    const move = (event: MouseEvent): void => {
      const element = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const over = element ? this.position(element) : null;
      if (!over || (!this.selection && over.row === start.row && over.col === start.col)) return;
      event.preventDefault();
      this.select(cellRange(start, over), start, over);
    };
    const up = (): void => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  private onFocusIn(event: FocusEvent): void {
    const at = this.position(event.target as HTMLElement);
    if (at) this.startEditing(at.row, at.col);
  }

  private onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as HTMLElement | null;
    if (next && this.position(next)) return;
    this.stopEditing();
    // Hors du tableau (et pas vers son menu) : la sélection de cellules disparaît.
    if (!next || !this.dom.contains(next)) {
      if (!next?.closest('.p-contextmenu')) this.clearRange();
    }
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

  /** Clavier quand des cellules sont sélectionnées (le tableau a le focus). */
  private onRangeKey(event: KeyboardEvent): void {
    const range = this.selection;
    if (!range || event.target !== this.dom) return;
    const mod = event.ctrlKey || event.metaKey;
    const rows = this.model.rows.length;
    const cols = this.model.align.length;
    const anchor = this.anchor ?? { row: range.top, col: range.left };
    const head = this.head ?? { row: range.bottom, col: range.right };
    const handled = (): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const step = moves[event.key];
    if (step) {
      handled();
      const base = event.shiftKey ? head : anchor;
      const next = { row: Math.max(0, Math.min(rows - 1, base.row + step[0])), col: Math.max(0, Math.min(cols - 1, base.col + step[1])) };
      if (event.shiftKey) this.select(cellRange(anchor, next), anchor, next);
      else this.select(cellRange(next, next), next, next);
      this.table.rows[next.row]?.cells[next.col]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } else if (event.key === 'Escape') {
      handled();
      this.clearRange();
      this.focusCell(anchor.row, anchor.col, 'end');
    } else if (event.key === 'Enter' || event.key === 'F2') {
      handled();
      this.focusCell(anchor.row, anchor.col, 'end');
    } else if (event.key === 'Tab') {
      handled();
      const index = anchor.row * cols + anchor.col + (event.shiftKey ? -1 : 1);
      if (index >= 0 && index < rows * cols) this.focusCell(Math.floor(index / cols), index % cols, 'end');
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      handled();
      this.clearCells();
    } else if (mod && !event.altKey && event.key.toLowerCase() === 'a') {
      handled();
      this.selectAll();
    } else if (mod && !event.altKey && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
      handled();
      this.clearRange();
      if (event.key.toLowerCase() === 'y' || event.shiftKey) this.options.redo(this.view);
      else this.options.undo(this.view);
    } else if (!mod && !event.altKey && event.key.length === 1) {
      // Une frappe remplace le contenu de la cellule, comme dans un tableur.
      handled();
      this.model.rows[anchor.row]![anchor.col] = event.key;
      this.selection = null;
      this.build();
      this.focusCell(anchor.row, anchor.col, 'end');
      this.schedule();
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.target === this.dom) {
      this.onRangeKey(event);
      return;
    }
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
    // Ctrl A : le texte de la cellule, puis (une seconde fois, ou dans une cellule vide) tout le tableau.
    if (mod && !event.altKey && event.key.toLowerCase() === 'a' && (!length || window.getSelection()?.toString().length === length)) {
      handled();
      this.selectAll();
      return;
    }
    // Maj + flèches au bord du texte : la sélection passe aux cellules voisines.
    if (event.shiftKey && !mod) {
      const edge =
        event.key === 'ArrowUp' ? (row > 0 ? { row: row - 1, col } : null)
        : event.key === 'ArrowDown' ? (row < rows - 1 ? { row: row + 1, col } : null)
        : event.key === 'ArrowLeft' && caret === 0 ? (col > 0 ? { row, col: col - 1 } : null)
        : event.key === 'ArrowRight' && caret === length && (collapsed || window.getSelection()?.toString().length === length) ? (col < cols - 1 ? { row, col: col + 1 } : null)
        : undefined;
      if (edge) {
        handled();
        this.select(cellRange(at, edge), at, edge);
        return;
      }
    }
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

/** Grille copiée en HTML : les tableurs et les traitements de texte la collent en tableau. */
function gridToHtml(grid: string[][]): string {
  const cell = (value: string): string => escapeText(value.replace(/<br\s*\/?>/gi, '\n')).replace(/\n/g, '<br>');
  return `<table>${grid.map((cells) => `<tr>${cells.map((value) => `<td>${cell(value)}</td>`).join('')}</tr>`).join('')}</table>`;
}

/** Grille d'un tableau HTML collé (Excel, Google Sheets, Word, page web) ; `null` sans tableau. */
export function gridFromHtml(html: string): string[][] | null {
  if (!html || !/<table[\s>]/i.test(html)) return null;
  const page = new DOMParser().parseFromString(html, 'text/html');
  const table = page.querySelector('table');
  if (!table) return null;
  // Un passage de page web avec du texte autour du tableau reste un collage ordinaire : rien ne se perd.
  const squash = (text: string | null | undefined): number => (text ?? '').replace(/\s+/g, '').length;
  if (squash(table.textContent) < squash(page.body.textContent) * 0.9) return null;
  const text = (cell: HTMLTableCellElement): string => {
    for (const br of cell.querySelectorAll('br')) br.replaceWith('\n');
    return (cell.textContent ?? '').replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').trim();
  };
  const grid = [...table.rows].map((tr) => [...tr.cells].map(text));
  return grid.length ? grid : null;
}

/** Tableau HTML collé dans le texte d'une note : il devient un tableau Markdown. */
export function markdownFromHtmlTable(html: string): string | null {
  const grid = gridFromHtml(html);
  return grid && (grid.length > 1 || (grid[0]?.length ?? 0) > 1) ? gridToMarkdown(grid.map((cells) => cells.map(cellText))) : null;
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

/** Cellules sélectionnées du tableau, s'il y en a. */
export function tableRange(dom: HTMLElement): CellRange | null {
  return tableEditorOf(dom)?.selection ?? null;
}

/** Copie des cellules (la sélection, une ligne ou une colonne), en texte de tableur et en tableau HTML. */
export async function tableCopy(dom: HTMLElement, what: 'selection' | 'row' | 'col', row: number, col: number, cut = false): Promise<void> {
  const editor = tableEditorOf(dom);
  if (!editor) return;
  if (what === 'row') editor.selectRow(row);
  else if (what === 'col') editor.selectColumn(col);
  const grid = editor.selectedGrid();
  if (!grid.length) return;
  const text = gridToTsv(grid);
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([gridToHtml(grid)], { type: 'text/html' }) })]);
  } catch {
    await navigator.clipboard.writeText(text).catch(() => undefined);
  }
  if (cut) editor.clearCells();
}

/** Colle le presse-papiers sur la sélection (ou la cellule sous le clic droit). */
export async function tablePaste(dom: HTMLElement, row: number, col: number): Promise<void> {
  const editor = tableEditorOf(dom);
  if (!editor) return;
  let text = '';
  let html = '';
  try {
    for (const item of await navigator.clipboard.read()) {
      if (item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
      if (item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
    }
  } catch {
    text = await navigator.clipboard.readText().catch(() => '');
  }
  if (!text && !html) return;
  if (!editor.selection) editor.select({ top: row, left: col, bottom: row, right: col }, { row, col });
  editor.pasteText(text, html);
}

/** Vide les cellules sélectionnées. */
export function tableClear(dom: HTMLElement): void {
  tableEditorOf(dom)?.clearCells();
}

/** Termine la frappe en cours dans les tableaux de l'éditeur (avant une édition brute, par exemple). */
export function flushTables(view: EditorView): void {
  for (const dom of view.dom.querySelectorAll<HTMLElement>('.cm-table-editor')) tableEditorOf(dom)?.commit();
}

