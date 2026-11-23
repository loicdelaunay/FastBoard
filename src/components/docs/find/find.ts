import { parseNoteSearch, runNoteSearch, SEARCH_LIMIT, type SearchLine } from '@shared/noteSearch';

/**
 * Recherche dans une note (Ctrl F), façon VS Code et Obsidian : la même barre et la même syntaxe de recherche
 * (`shared/noteSearch`) servent en lecture (texte rendu) et en écriture (source Markdown).
 */

export interface FindOptions {
  search: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
  replace: string;
}

export interface FindResult {
  total: number;
  /** Rang du résultat choisi (0 pour le premier), -1 s'il n'y en a pas. */
  current: number;
  /** Expression régulière invalide. */
  invalid?: boolean;
}

export const NO_RESULT: FindResult = { total: 0, current: -1 };
/** Au-delà, le compteur s'arrête (« 1000+ ») : une note géante ne fige pas la frappe. */
export const FIND_LIMIT = SEARCH_LIMIT;

export function emptyFindOptions(): FindOptions {
  return { search: '', caseSensitive: false, wholeWord: false, regexp: false, replace: '' };
}

/** Ce qui ne se lit pas comme du texte : formules (déjà lisibles en rendu), dessins, scripts. */
const SKIPPED = '.katex, svg, script, style, template, [hidden], .find-skip';
const BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, td, th, pre, blockquote, dt, dd, figcaption, summary, div';

interface Segment {
  node: Text;
  start: number;
}

/**
 * Recherche dans un texte rendu : surligne tous les résultats avec l'API CSS Custom Highlight (sans toucher au DOM, que
 * Vue réécrit) et fait défiler jusqu'au résultat choisi.
 */
export class DomFinder {
  #ranges: Range[] = [];
  #current = -1;
  #invalid = false;

  constructor(
    private readonly root: () => HTMLElement | null,
    private readonly scroller: () => HTMLElement | null,
  ) {}

  /** Nouvelle recherche : le premier résultat visible (ou le suivant) devient le résultat choisi. */
  set(options: FindOptions): FindResult {
    this.#collect(options);
    this.#current = this.#ranges.length ? this.#firstVisible() : -1;
    this.#paint(true);
    return this.result();
  }

  /** Le texte a changé (édition d'un collègue, rendu terminé) : mêmes options, résultat choisi au plus près. */
  refresh(options: FindOptions): FindResult {
    const previous = this.#current;
    this.#collect(options);
    this.#current = this.#ranges.length ? Math.min(Math.max(previous, 0), this.#ranges.length - 1) : -1;
    this.#paint(false);
    return this.result();
  }

  next(): FindResult {
    if (this.#ranges.length) this.#current = (this.#current + 1) % this.#ranges.length;
    this.#paint(true);
    return this.result();
  }

  previous(): FindResult {
    if (this.#ranges.length) this.#current = (this.#current - 1 + this.#ranges.length) % this.#ranges.length;
    this.#paint(true);
    return this.result();
  }

  result(): FindResult {
    return { total: this.#ranges.length, current: this.#current, invalid: this.#invalid };
  }

  clear(): void {
    this.#ranges = [];
    this.#current = -1;
    if (supported()) {
      CSS.highlights.delete('fb-find');
      CSS.highlights.delete('fb-find-current');
    }
  }

  #collect(options: FindOptions): void {
    this.#ranges = [];
    const parsed = parseNoteSearch(options.search, options);
    this.#invalid = parsed.error !== null;
    const root = this.root();
    if (!root || !parsed.node) return;

    // Tout le texte visible bout à bout, un saut de ligne entre deux blocs pour qu'un mot ne déborde pas sur le suivant.
    // Chaque bloc dit s'il est une tâche (cochée ou non) ou un titre : `task:`, `section:`… s'en servent.
    const segments: Segment[] = [];
    const blocks = new Map<number, Pick<SearchLine, 'task' | 'heading'>>();
    let text = '';
    let block: Element | null = null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (node.parentElement?.closest(SKIPPED) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const owner = node.parentElement?.closest(BLOCK) ?? null;
      if (owner !== block || !segments.length) {
        if (segments.length) text += '\n';
        const box = owner?.querySelector(':scope > input[type="checkbox"]') as HTMLInputElement | null;
        const level = owner && /^H[1-6]$/.test(owner.tagName) ? Number(owner.tagName[1]) : 0;
        blocks.set(text.length, { task: box ? (box.checked ? 'done' : 'todo') : null, heading: level });
      }
      block = owner;
      segments.push({ node, start: text.length });
      text += node.data;
    }
    const lines: SearchLine[] = [];
    let offset = 0;
    for (const line of text.split('\n')) {
      const meta = blocks.get(offset);
      lines.push({ from: offset, to: offset + line.length, contentFrom: offset, task: meta?.task ?? null, heading: meta?.heading ?? 0 });
      offset += line.length + 1;
    }

    const locate = (offset: number, end: boolean): { node: Text; offset: number } => {
      let low = 0;
      let high = segments.length - 1;
      while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (segments[middle]!.start < offset || (!end && segments[middle]!.start === offset)) low = middle;
        else high = middle - 1;
      }
      const segment = segments[low]!;
      return { node: segment.node, offset: Math.min(offset - segment.start, segment.node.length) };
    };

    for (const match of runNoteSearch(parsed, text, lines)) {
      const from = locate(match.from, false);
      const to = locate(match.to, true);
      const range = document.createRange();
      range.setStart(from.node, from.offset);
      range.setEnd(to.node, to.offset);
      this.#ranges.push(range);
      if (this.#ranges.length >= FIND_LIMIT) break;
    }
  }

  /** Premier résultat sous le haut de la zone visible, sinon le premier de la note. */
  #firstVisible(): number {
    const top = this.scroller()?.getBoundingClientRect().top ?? 0;
    const index = this.#ranges.findIndex((range) => range.getBoundingClientRect().bottom >= top);
    return index < 0 ? 0 : index;
  }

  #paint(scroll: boolean): void {
    const current = this.#ranges[this.#current];
    if (supported()) {
      CSS.highlights.set('fb-find', new Highlight(...this.#ranges));
      if (current) CSS.highlights.set('fb-find-current', new Highlight(current));
      else CSS.highlights.delete('fb-find-current');
    } else if (current) {
      // Sans l'API (anciens navigateurs) : le résultat choisi devient la sélection.
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(current);
    }
    const scroller = this.scroller();
    if (!scroll || !current || !scroller) return;
    // Un résultat dans un bloc replié (<details>) l'ouvre.
    const details = current.startContainer.parentElement?.closest('details');
    if (details && !details.open) details.open = true;
    const box = current.getBoundingClientRect();
    const frame = scroller.getBoundingClientRect();
    if (box.top < frame.top + 8 || box.bottom > frame.bottom - 8) {
      scroller.scrollTop += box.top - frame.top - scroller.clientHeight / 3;
    }
  }
}

function supported(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
}
