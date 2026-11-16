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
    case 'align-left':
    case 'align-center':
    case 'align-right': {
      const value = action.slice(6) as TableAlign;
      align[col] = align[col] === value ? null : value;
      return done({ row, col });
    }
  }
}
