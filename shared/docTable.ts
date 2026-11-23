/**
 * Tableaux Markdown (GFM) vus comme une grille : lecture du source, opérations sur les lignes et les colonnes, et
 * écriture alignée. Sert à l'édition des tableaux cellule par cellule, en « Lecture et écriture ».
 */

export type TableAlign = 'left' | 'center' | 'right' | null;

export interface TableModel {
  align: TableAlign[];
  /** `rows[0]` : l'en-tête. Chaque cellule garde son Markdown, barres verticales échappées comprises. */
  rows: string[][];
}

export type TableAction =
  | 'row-above'
  | 'row-below'
  | 'row-up'
  | 'row-down'
  | 'row-delete'
  | 'col-left'
  | 'col-right'
  | 'col-move-left'
  | 'col-move-right'
  | 'col-delete'
  | 'row-duplicate'
  | 'col-duplicate'
  | 'sort-asc'
  | 'sort-desc'
  | 'align-left'
  | 'align-center'
  | 'align-right';

const DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** Cellules d'une ligne : on coupe sur les barres verticales non échappées, comme le fait GFM, même dans le code. */
export function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  const cells: string[] = [];
  let current = '';
  let closed = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === '\\' && index + 1 < text.length) {
      current += char + text[index + 1];
      index += 1;
      continue;
    }
    if (char === '|') {
      cells.push(current.trim());
      current = '';
      closed = index === text.length - 1;
      continue;
    }
    current += char;
    closed = false;
  }
  if (!closed && (current.trim() || !cells.length)) cells.push(current.trim());
  return cells;
}

function alignOf(cell: string): TableAlign {
  const value = cell.trim();
  const left = value.startsWith(':');
  const right = value.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

/** Grille d'un tableau, ou `null` si le texte n'en est pas un. Une ligne trop longue élargit le tableau : rien ne se perd. */
export function parseTable(source: string): TableModel | null {
  const lines = source.replace(/\r/g, '').split('\n').filter((line) => line.trim());
  if (lines.length < 2 || !DELIMITER.test(lines[1]!) || !lines[0]!.includes('|') && !lines[1]!.includes('|')) return null;
  const header = splitRow(lines[0]!);
  const delimiter = splitRow(lines[1]!);
  const body = lines.slice(2).map(splitRow);
  const width = Math.max(header.length, delimiter.length, ...body.map((row) => row.length));
  const pad = (row: string[]): string[] => [...row, ...Array<string>(width - row.length).fill('')];
  return { align: pad(delimiter).map((cell) => (cell ? alignOf(cell) : null)), rows: [pad(header), ...body.map(pad)] };
}

/** Une cellule tient sur une ligne, et ses barres verticales sont échappées. */
export function cleanCell(text: string): string {
  return text
    .replace(/\r?\n/g, ' ')
    .replace(/(^|[^\\])\|/g, '$1\\|')
    .replace(/(^|[^\\])\|/g, '$1\\|')
    .trim();
}

function pad(text: string, width: number, align: TableAlign): string {
  const space = width - text.length;
  if (space <= 0) return text;
  if (align === 'right') return ' '.repeat(space) + text;
  if (align === 'center') return ' '.repeat(Math.floor(space / 2)) + text + ' '.repeat(Math.ceil(space / 2));
  return text + ' '.repeat(space);
}

function delimiterCell(width: number, align: TableAlign): string {
  if (align === 'center') return `:${'-'.repeat(Math.max(1, width - 2))}:`;
  if (align === 'right') return `${'-'.repeat(Math.max(2, width - 1))}:`;
  if (align === 'left') return `:${'-'.repeat(Math.max(2, width - 1))}`;
  return '-'.repeat(Math.max(3, width));
}

/** Source d'un tableau, colonnes alignées. */
export function serializeTable(model: TableModel): string {
  const rows = model.rows.map((row) => row.map(cleanCell));
  const columns = model.align.length;
  const widths = Array.from({ length: columns }, (_, column) => Math.max(3, ...rows.map((row) => (row[column] ?? '').length)));
  const line = (cells: string[]): string => `| ${cells.join(' | ')} |`;
  return [
    line(rows[0]!.map((cell, column) => pad(cell, widths[column]!, model.align[column] ?? null))),
    line(widths.map((width, column) => delimiterCell(width, model.align[column] ?? null))),
    ...rows.slice(1).map((row) => line(row.map((cell, column) => pad(cell, widths[column]!, model.align[column] ?? null)))),
  ].join('\n');
}

/** Cellule où placer le curseur après une opération. */
export interface TableFocus {
  row: number;
  col: number;
}

/** Opération sur la ligne `row` ou la colonne `col` ; renvoie la nouvelle grille et la cellule à garder en vue. */
export function applyTableAction(model: TableModel, action: TableAction, row: number, col: number): { model: TableModel; focus: TableFocus } | null {
  const rows = model.rows.map((cells) => [...cells]);
  const align = [...model.align];
  const empty = (): string[] => Array<string>(align.length).fill('');
  const done = (focus: TableFocus) => ({ model: { align, rows }, focus });
  switch (action) {
    case 'row-above':
      if (row < 1) return null;
      rows.splice(row, 0, empty());
      return done({ row, col });
    case 'row-below':
      rows.splice(row + 1, 0, empty());
      return done({ row: row + 1, col });
    case 'row-up':
      if (row < 2) return null;
      [rows[row - 1], rows[row]] = [rows[row]!, rows[row - 1]!];
      return done({ row: row - 1, col });
    case 'row-down':
      if (row < 1 || row >= rows.length - 1) return null;
      [rows[row + 1], rows[row]] = [rows[row]!, rows[row + 1]!];
      return done({ row: row + 1, col });
    case 'row-delete':
      if (row < 1) return null;
      rows.splice(row, 1);
      return done({ row: Math.min(row, rows.length - 1), col });
    case 'col-left':
    case 'col-right': {
      const at = action === 'col-left' ? col : col + 1;
      for (const cells of rows) cells.splice(at, 0, '');
      align.splice(at, 0, null);
      return done({ row, col: at });
    }
    case 'col-move-left':
    case 'col-move-right': {
      const other = action === 'col-move-left' ? col - 1 : col + 1;
      if (other < 0 || other >= align.length) return null;
      for (const cells of rows) [cells[col], cells[other]] = [cells[other]!, cells[col]!];
      [align[col], align[other]] = [align[other]!, align[col]!];
      return done({ row, col: other });
    }
    case 'col-delete':
      if (align.length < 2) return null;
      for (const cells of rows) cells.splice(col, 1);
      align.splice(col, 1);
      return done({ row, col: Math.min(col, align.length - 1) });
    case 'row-duplicate':
      if (row < 1) return null;
      rows.splice(row + 1, 0, [...rows[row]!]);
      return done({ row: row + 1, col });
    case 'col-duplicate':
      for (const cells of rows) cells.splice(col + 1, 0, cells[col] ?? '');
      align.splice(col + 1, 0, align[col] ?? null);
      return done({ row, col: col + 1 });
    case 'sort-asc':
    case 'sort-desc': {
      // L'en-tête reste en haut ; les cellules vides vont à la fin, les nombres se comparent comme des nombres.
      const sign = action === 'sort-asc' ? 1 : -1;
      const body = rows.slice(1).sort((a, b) => {
        const left = (a[col] ?? '').trim();
        const right = (b[col] ?? '').trim();
        if (!left || !right) return left ? -1 : right ? 1 : 0;
        return sign * left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
      });
      rows.splice(1, body.length, ...body);
      return done({ row: 1, col });
    }
    case 'align-left':
    case 'align-center':
    case 'align-right': {
      const value = action.slice(6) as TableAlign;
      align[col] = align[col] === value ? null : value;
      return done({ row, col });
    }
  }
}

// --- Plages de cellules et presse-papiers ------------------------------------------------------------------------------

/** Rectangle de cellules, bornes comprises. */
export interface CellRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** Rectangle entre deux cellules, dans n'importe quel sens. */
export function cellRange(a: TableFocus, b: TableFocus): CellRange {
  return { top: Math.min(a.row, b.row), left: Math.min(a.col, b.col), bottom: Math.max(a.row, b.row), right: Math.max(a.col, b.col) };
}

export function inRange(range: CellRange | null, row: number, col: number): boolean {
  return !!range && row >= range.top && row <= range.bottom && col >= range.left && col <= range.right;
}

/** Contenu d'un rectangle, ligne par ligne. */
export function rangeCells(model: TableModel, range: CellRange): string[][] {
  return model.rows.slice(range.top, range.bottom + 1).map((cells) => cells.slice(range.left, range.right + 1));
}

/** Les cellules d'un rectangle reçoivent `value` (vides par défaut). */
export function fillRange(model: TableModel, range: CellRange, value = ''): TableModel {
  const rows = model.rows.map((cells, row) => cells.map((cell, col) => (inRange(range, row, col) ? value : cell)));
  return { align: [...model.align], rows };
}

/** Texte collé dans une cellule : une ligne, les retours à la ligne deviennent des <br> comme dans Obsidian. */
export function cellText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '').replace(/\n/g, '<br>');
}

/**
 * Colle une grille à partir de la cellule `at` ; le tableau s'agrandit (lignes et colonnes) pour la recevoir. Renvoie la
 * nouvelle grille et le rectangle collé.
 */
export function pasteGrid(model: TableModel, at: TableFocus, grid: string[][]): { model: TableModel; range: CellRange } {
  const height = grid.length;
  const width = Math.max(1, ...grid.map((cells) => cells.length));
  const align = [...model.align];
  while (align.length < at.col + width) align.push(null);
  const rows = model.rows.map((cells) => [...cells, ...Array<string>(align.length - cells.length).fill('')]);
  while (rows.length < at.row + height) rows.push(Array<string>(align.length).fill(''));
  grid.forEach((cells, row) => cells.forEach((value, col) => (rows[at.row + row]![at.col + col] = cellText(value))));
  return { model: { align, rows }, range: { top: at.row, left: at.col, bottom: at.row + height - 1, right: at.col + width - 1 } };
}

/** Déplace la ligne `from` à la place `to` (l'en-tête ne bouge pas). */
export function moveRow(model: TableModel, from: number, to: number): TableModel | null {
  if (from < 1 || to < 1 || from >= model.rows.length || to >= model.rows.length || from === to) return null;
  const rows = model.rows.map((cells) => [...cells]);
  const [moved] = rows.splice(from, 1);
  rows.splice(to, 0, moved!);
  return { align: [...model.align], rows };
}

/** Déplace la colonne `from` à la place `to`, avec son alignement. */
export function moveColumn(model: TableModel, from: number, to: number): TableModel | null {
  const width = model.align.length;
  if (from < 0 || to < 0 || from >= width || to >= width || from === to) return null;
  const move = <T>(list: T[]): T[] => {
    const copy = [...list];
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved!);
    return copy;
  };
  return { align: move(model.align), rows: model.rows.map(move) };
}

/** Grille au format des tableurs (Excel, Google Sheets) : tabulations, et guillemets autour des cellules qui en ont besoin. */
export function gridToTsv(grid: string[][]): string {
  const quote = (value: string): string => (/[\t\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return grid.map((cells) => cells.map((cell) => quote(cell.replace(/<br\s*\/?>/gi, '\n'))).join('\t')).join('\n');
}

/** Grille en tableau Markdown, la première ligne servant d'en-tête. */
export function gridToMarkdown(grid: string[][]): string {
  const width = Math.max(1, ...grid.map((cells) => cells.length));
  const rows = grid.map((cells) => [...cells, ...Array<string>(width - cells.length).fill('')]);
  if (rows.length === 1) rows.push(Array<string>(width).fill(''));
  return serializeTable({ align: Array<TableAlign>(width).fill(null), rows });
}

/** Texte des tableurs (TSV) en grille : guillemets doublés, retours à la ligne dans une cellule entre guillemets. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === '\t') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

/**
 * Grille contenue dans un texte collé : tableau Markdown, ou texte de tableur (avec des tabulations). `null` pour un
 * texte ordinaire, qui va dans une seule cellule.
 */
export function gridFromText(text: string): string[][] | null {
  const table = parseTable(text.trim());
  if (table) return table.rows;
  if (!text.includes('\t')) return null;
  return parseTsv(text);
}
