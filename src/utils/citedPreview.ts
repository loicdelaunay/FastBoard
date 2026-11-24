import { lineCited, type LineRange } from '@shared/citations';
import { markdownBlocks } from '@/utils/markdown';

/**
 * Lignes citées d'une note, en lecture : les blocs rendus qui les contiennent sont surlignés (classe `md-cited`). Au
 * plus près quand le rendu le permet : les éléments d'une liste, les lignes d'un tableau, les lignes d'un bloc de code
 * (bandes posées dessus). Renvoie les éléments surlignés, dans l'ordre, ou une liste vide si le rendu ne correspond pas
 * bloc à bloc au texte (l'appelant se rabat alors sur une bande placée d'après la hauteur des lignes).
 */

const CLASSES = ['md-cited', 'md-cited-code'];

/** Retire les surlignages posés par `markCitedBlocks`. */
export function clearCitedBlocks(root: ParentNode): void {
  for (const element of root.querySelectorAll<HTMLElement>(CLASSES.map((name) => `.${name}`).join(','))) element.classList.remove(...CLASSES);
  for (const band of root.querySelectorAll('.md-cited-band')) band.remove();
}

const overlaps = (ranges: readonly LineRange[], from: number, to: number): boolean => ranges.some((range) => range.from <= to && range.to >= from);

/** Numéro de ligne (à partir de 1) de chaque position : compte des retours à la ligne, en une passe. */
function lineCounter(text: string): (offset: number) => number {
  let at = 0;
  let line = 1;
  return (offset) => {
    if (offset < at) {
      at = 0;
      line = 1;
    }
    for (; at < offset && at < text.length; at += 1) if (text.charCodeAt(at) === 10) line += 1;
    return line;
  };
}

/** Éléments de premier niveau d'une liste et la ligne où commence chacun ; `null` s'ils ne se correspondent pas. */
function listItemStarts(element: HTMLElement, source: string, first: number): { items: HTMLElement[]; starts: number[]; end: number } | null {
  const items = [...element.children].filter((child): child is HTMLElement => child.tagName === 'LI');
  const lines = source.split('\n');
  const base = /^ */.exec(lines[0] ?? '')![0].length;
  const starts = lines.flatMap((line, index) => {
    const marker = /^( *)(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/.exec(line);
    return marker && marker[1]!.length <= base + 1 ? [first + index] : [];
  });
  return items.length && starts.length === items.length ? { items, starts, end: first + lines.length } : null;
}

/** Éléments d'une liste : chacun couvre les lignes de son puce jusqu'à la suivante (sous-listes comprises). */
function listItems(element: HTMLElement, source: string, first: number, ranges: readonly LineRange[]): HTMLElement[] | null {
  const found = listItemStarts(element, source, first);
  if (!found) return null;
  return found.items.filter((_item, index) => overlaps(ranges, found.starts[index]!, (found.starts[index + 1] ?? found.end) - 1));
}

/** Lignes d'un tableau : l'en-tête est sa première ligne, puis une ligne de tirets, puis une ligne par rangée. */
function tableRows(element: HTMLElement, source: string, first: number, ranges: readonly LineRange[]): HTMLElement[] | null {
  const rows = [...element.querySelectorAll<HTMLElement>('tr')];
  const count = source.split('\n').length;
  if (!rows.length || rows.length !== count - 1) return null;
  return rows.filter((_row, index) => lineCited(ranges, index === 0 ? first : first + 1 + index));
}

/** Bandes sur les lignes citées d'un bloc de code entre clôtures ; vrai si elles ont pu être posées. */
function codeBands(element: HTMLElement, source: string, first: number, last: number, ranges: readonly LineRange[]): boolean {
  const pre = element.tagName === 'PRE' ? element : null;
  const code = pre?.querySelector('code');
  if (!pre || !code || !/^ {0,3}(`{3,}|~{3,})/.test(source)) return false;
  const count = (code.textContent ?? '').replace(/\n$/, '').split('\n').length;
  const box = code.getBoundingClientRect();
  const height = box.height / Math.max(1, count);
  if (!height) return false;
  const top = box.top - pre.getBoundingClientRect().top + pre.scrollTop;
  pre.classList.add('md-cited-code');
  let any = false;
  // Ligne j du code : ligne first + 1 + j du texte (la première est la clôture d'ouverture).
  for (let index = 0; index < count; index += 1) {
    const line = first + 1 + index;
    if (line >= last || !lineCited(ranges, line)) continue;
    let end = index;
    while (end + 1 < count && first + 2 + end < last && lineCited(ranges, first + 2 + end)) end += 1;
    const band = document.createElement('div');
    band.className = 'md-cited-band';
    band.style.top = `${top + index * height}px`;
    band.style.height = `${(end - index + 1) * height}px`;
    pre.append(band);
    any = true;
    index = end;
  }
  return any;
}

export function markCitedBlocks(root: HTMLElement, text: string, obsidian: boolean, ranges: readonly LineRange[]): HTMLElement[] {
  clearCitedBlocks(root);
  const blocks = markdownBlocks(text, obsidian);
  const elements = [...root.children] as HTMLElement[];
  if (!blocks.length || blocks.length !== elements.length) return [];
  const lineAt = lineCounter(text);
  const marked: HTMLElement[] = [];
  blocks.forEach((block, index) => {
    const first = lineAt(block.from);
    const last = lineAt(Math.max(block.from, block.to - 1));
    if (!overlaps(ranges, first, last)) return;
    const element = elements[index]!;
    const source = text.slice(block.from, block.to);
    const whole = ranges.some((range) => range.from <= first && range.to >= last);
    // Bloc de code : des bandes sur ses lignes (même entier : son fond reste celui du code).
    if (block.type === 'code' && codeBands(element, source, first, last, ranges)) {
      marked.push(element);
      return;
    }
    const parts = whole ? null : block.type === 'list' ? listItems(element, source, first, ranges) : block.type === 'table' ? tableRows(element, source, first, ranges) : null;
    for (const part of parts?.length ? parts : [element]) {
      part.classList.add('md-cited');
      marked.push(part);
    }
  });
  return marked;
}

// --- Numéros de ligne en lecture ---------------------------------------------------------------------------------------

const NUMBER_CLASSES = ['md-numbered', 'md-numbered-code'];

/** Retire les numéros posés par `numberPreviewLines`. */
export function clearPreviewLines(root: HTMLElement): void {
  root.classList.remove('md-numbered');
  for (const element of root.querySelectorAll<HTMLElement>('[data-line], [data-lines]')) {
    delete element.dataset.line;
    delete element.dataset.lines;
  }
  for (const element of root.querySelectorAll<HTMLElement>('.md-numbered-code')) element.classList.remove(...NUMBER_CLASSES);
}

/**
 * Numéros de ligne du texte en marge du rendu (bouton « Numéros de ligne ») : le premier numéro de chaque bloc, de
 * chaque élément de liste et de chaque rangée de tableau, et toutes les lignes d'un bloc de code. Si le rendu ne
 * correspond pas au texte bloc à bloc, seuls les titres sont numérotés (`headings` : leurs lignes, dans l'ordre).
 */
export function numberPreviewLines(root: HTMLElement, text: string, obsidian: boolean, headings: readonly number[]): void {
  clearPreviewLines(root);
  root.classList.add('md-numbered');
  const blocks = markdownBlocks(text, obsidian);
  const elements = [...root.children] as HTMLElement[];
  if (!blocks.length || blocks.length !== elements.length) {
    const rendered = [...root.querySelectorAll<HTMLElement>(':scope > :is(h1, h2, h3, h4, h5, h6)')];
    if (rendered.length === headings.length) rendered.forEach((element, index) => (element.dataset.line = String(headings[index])));
    return;
  }
  const lineAt = lineCounter(text);
  blocks.forEach((block, index) => {
    const element = elements[index]!;
    const first = lineAt(block.from);
    const source = text.slice(block.from, block.to);
    if (block.type === 'list') {
      const found = listItemStarts(element, source, first);
      if (found) {
        found.items.forEach((item, position) => (item.dataset.line = String(found.starts[position])));
        return;
      }
    }
    if (block.type === 'table') {
      const rows = [...element.querySelectorAll<HTMLElement>('tr')];
      if (rows.length && rows.length === source.split('\n').length - 1) {
        rows.forEach((row, position) => {
          const cell = row.firstElementChild as HTMLElement | null;
          if (cell) cell.dataset.line = String(position === 0 ? first : first + 1 + position);
        });
        return;
      }
    }
    if (block.type === 'code' && element.tagName === 'PRE' && /^ {0,3}(`{3,}|~{3,})/.test(source)) {
      const code = element.querySelector('code');
      const count = (code?.textContent ?? '').replace(/\n$/, '').split('\n').length;
      const box = code?.getBoundingClientRect();
      if (code && box && box.height) {
        // Ligne j du code : ligne first + 1 + j du texte (la première est la clôture d'ouverture).
        element.classList.add('md-numbered-code');
        element.dataset.lines = Array.from({ length: count }, (_value, position) => first + 1 + position).join('\n');
        element.style.setProperty('--md-code-top', `${box.top - element.getBoundingClientRect().top + element.scrollTop}px`);
        element.style.setProperty('--md-code-line', `${box.height / Math.max(1, count)}px`);
        return;
      }
    }
    element.dataset.line = String(first);
  });
}
