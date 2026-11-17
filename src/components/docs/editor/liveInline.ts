import { syntaxTree } from '@codemirror/language';
import type { EditorState, Extension, Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import katex from 'katex';
import { imageSize } from '@shared/docLinks';
import { highlightColor, highlightMarker } from '@shared/docObsidian';
import { docBaseName } from '@shared/docs';
import { t } from '@/i18n';
import { openLightbox } from '@/utils/lightbox';
import { toggleTask, type TextRange } from './commands';

/**
 * « Lecture et écriture » à la manière d'Obsidian : le texte reste rendu (titres, gras, liens, cases, images…) et seule
 * la syntaxe de l'élément sous le curseur réapparaît, au lieu du bloc entier. Les blocs complexes (code, tableaux,
 * formules, callouts) sont rendus à part, par `live.ts`, et passent en source quand on y entre.
 */

export interface LiveInlineOptions {
  obsidian: () => boolean;
  /** Blocs rendus en entier ailleurs : rien à décorer à l'intérieur. */
  skipped: (state: EditorState) => TextRange[];
  /** Adresse d'une image écrite dans la note, ou `null` si elle est introuvable. */
  imageUrl: (target: string) => string | null;
  /** Nom à afficher pour une mention. */
  mentionLabel: (kind: string, id: number, label: string) => string;
  /** Suit un lien rendu (adresse, note, mention) ; vrai s'il a été suivi. */
  follow: (element: HTMLElement, event: MouseEvent) => boolean;
}

class TextWidget extends WidgetType {
  readonly text: string;
  readonly className: string;
  readonly attributes: Record<string, string>;

  constructor(text: string, className: string, attributes: Record<string, string> = {}) {
    super();
    this.text = text;
    this.className = className;
    this.attributes = attributes;
  }

  override eq(other: TextWidget): boolean {
    return other.text === this.text && other.className === this.className && JSON.stringify(other.attributes) === JSON.stringify(this.attributes);
  }

  override toDOM(): HTMLElement {
    const element = document.createElement('span');
    element.className = this.className;
    element.textContent = this.text;
    for (const [name, value] of Object.entries(this.attributes)) element.setAttribute(name, value);
    return element;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

class CheckboxWidget extends WidgetType {
  readonly checked: boolean;

  constructor(checked: boolean) {
    super();
    this.checked = checked;
  }

  override eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked;
  }

  override toDOM(): HTMLElement {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-lp-task';
    box.checked = this.checked;
    return box;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/** Sélectionne le Markdown d'une image affichée : la syntaxe réapparaît, prête à être modifiée. */
export function editImageSource(view: EditorView, figure: HTMLElement): void {
  const from = view.posAtDOM(figure);
  view.focus();
  view.dispatch({ selection: { anchor: from, head: Math.min(view.state.doc.length, from + Number(figure.dataset.length ?? 0)) }, scrollIntoView: true });
}

class ImageWidget extends WidgetType {
  readonly url: string;
  readonly alt: string;
  /** Longueur du Markdown remplacé. */
  readonly length: number;
  readonly width: number | null;
  readonly height: number | null;

  /** `alt` peut porter la taille d'Obsidian : « Légende|300 », « 300x200 ». */
  constructor(url: string, alt: string, length: number) {
    super();
    const size = imageSize(alt);
    this.url = url;
    this.alt = size.alt || alt;
    this.width = size.width;
    this.height = size.height;
    this.length = length;
  }

  override eq(other: ImageWidget): boolean {
    return other.url === this.url && other.alt === this.alt && other.length === this.length && other.width === this.width && other.height === this.height;
  }

  override toDOM(view: EditorView): HTMLElement {
    const figure = document.createElement('span');
    figure.className = 'cm-lp-figure';
    figure.dataset.length = String(this.length);
    const image = document.createElement('img');
    image.className = 'cm-lp-image';
    image.src = this.url;
    image.alt = this.alt;
    if (this.width) image.width = this.width;
    if (this.height) image.height = this.height;
    image.addEventListener('load', () => view.requestMeasure());
    image.addEventListener('dblclick', () => openLightbox(this.url, this.alt));
    const tools = document.createElement('span');
    tools.className = 'cm-lp-image-tools';
    const button = (icon: string, label: string, run: () => void): HTMLButtonElement => {
      const element = document.createElement('button');
      element.type = 'button';
      element.title = label;
      element.setAttribute('aria-label', label);
      element.innerHTML = `<i class="pi ${icon}"></i>`;
      element.addEventListener('mousedown', (event) => event.preventDefault());
      element.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        run();
      });
      return element;
    };
    tools.append(button('pi-expand', t('Agrandir l’image'), () => openLightbox(this.url, this.alt)), button('pi-pencil', t('Modifier le Markdown'), () => editImageSource(view, figure)));
    figure.append(image, tools);
    return figure;
  }
}

/** Tableau blanc cité seul sur sa ligne : son aperçu, qui l'ouvre ; le crayon rend le Markdown. */
class BoardWidget extends WidgetType {
  readonly id: number;
  readonly label: string;
  readonly length: number;

  constructor(id: number, label: string, length: number) {
    super();
    this.id = id;
    this.label = label;
    this.length = length;
  }

  override eq(other: BoardWidget): boolean {
    return other.id === this.id && other.label === this.label && other.length === this.length;
  }

  override toDOM(view: EditorView): HTMLElement {
    const card = document.createElement('span');
    card.className = 'cm-lp-board';
    card.dataset.kind = 'board';
    card.dataset.id = String(this.id);
    card.dataset.length = String(this.length);
    const head = document.createElement('span');
    head.className = 'cm-lp-board-head';
    const icon = document.createElement('i');
    icon.className = 'pi pi-objects-column';
    const title = document.createElement('span');
    title.className = 'cm-lp-board-title';
    title.textContent = this.label;
    const tools = document.createElement('span');
    tools.className = 'cm-lp-board-tools';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.title = t('Modifier le Markdown');
    edit.setAttribute('aria-label', edit.title);
    edit.innerHTML = '<i class="pi pi-pencil"></i>';
    edit.addEventListener('mousedown', (event) => event.preventDefault());
    edit.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      editImageSource(view, card);
    });
    const open = document.createElement('i');
    open.className = 'pi pi-external-link cm-lp-board-open';
    tools.append(edit);
    head.append(icon, title, tools, open);
    // Les deux thèmes : la feuille de style montre le bon, même après un changement de thème.
    const images = (['light', 'dark'] as const).map((theme) => {
      const image = document.createElement('img');
      image.className = `cm-lp-board-preview ${theme}`;
      image.src = `/api/boards/nodes/${this.id}/preview?width=960${theme === 'dark' ? '&theme=dark' : ''}`;
      image.alt = this.label;
      image.loading = 'lazy';
      image.draggable = false;
      image.addEventListener('load', () => view.requestMeasure());
      return image;
    });
    card.append(head, ...images);
    return card;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

class MathWidget extends WidgetType {
  readonly tex: string;

  constructor(tex: string) {
    super();
    this.tex = tex;
  }

  override eq(other: MathWidget): boolean {
    return other.tex === this.tex;
  }

  override toDOM(): HTMLElement {
    const element = document.createElement('span');
    element.className = 'cm-lp-math';
    element.innerHTML = katex.renderToString(this.tex, { throwOnError: false, output: 'html', strict: 'ignore' });
    return element;
  }
}

const hidden = Decoration.replace({});
const mark = (className: string, attributes?: Record<string, string>) => Decoration.mark({ class: className, ...(attributes ? { attributes } : {}) });
const line = (className: string) => Decoration.line({ class: className });

const MENTION_URL = /^(user|ticket|doc|board):(\d+)$/;
const WIKI = /(!?)\[\[([^\]\n]+?)\]\]/g;
const HIGHLIGHT = /==(?!=)(?=\S)(.+?\S)\s*==/g;
const COMMENT = /%%.*?%%/g;
const TAG = /(^|[\s(])(#[\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;
const FOOTNOTE = /\[\^[^\]\s]+\](?!:)/g;
const MATH = /\$(?!\s)((?:\\\$|[^$\n])+?)(?<!\s)\$(?!\d)/g;
const BLOCK_ID = /\s\^[A-Za-z0-9-]+\s*$/g;

function build(view: EditorView, options: LiveInlineOptions): DecorationSet {
  const { state } = view;
  const { doc } = state;
  const focused = view.hasFocus;
  const selections = state.selection.ranges;
  const touches = (from: number, to: number) => focused && selections.some((range) => range.from <= to && range.to >= from);
  const onActiveLine = (position: number) => {
    if (!focused) return false;
    const number = doc.lineAt(position).number;
    return selections.some((range) => doc.lineAt(range.from).number <= number && doc.lineAt(range.to).number >= number);
  };
  const skipped = options.skipped(state);
  const inSkipped = (from: number, to: number) => skipped.some((block) => from < block.to && to > block.from);
  /** Nœud tout entier dans un bloc rendu à part (le document, lui, déborde de tous). */
  const insideSkipped = (from: number, to: number) => skipped.some((block) => from >= block.from && to <= block.to);
  const obsidian = options.obsidian();

  const decorations: Array<Range<Decoration>> = [];
  /** Plages déjà remplacées : aucune autre décoration de remplacement ne doit les chevaucher. */
  const replaced: Array<[number, number]> = [];
  const code: Array<[number, number]> = [];
  const free = (from: number, to: number) => !replaced.some(([start, end]) => from < end && to > start);
  const hide = (from: number, to: number) => {
    if (to <= from || !free(from, to)) return;
    replaced.push([from, to]);
    decorations.push(hidden.range(from, to));
  };
  const swap = (from: number, to: number, widget: WidgetType) => {
    if (!free(from, to)) return;
    replaced.push([from, to]);
    decorations.push(Decoration.replace({ widget }).range(from, to));
  };
  const linesDone = new Set<string>();
  const lineClass = (position: number, className: string) => {
    const start = doc.lineAt(position).from;
    const key = `${start}:${className}`;
    if (linesDone.has(key)) return;
    linesDone.add(key);
    decorations.push(line(className).range(start));
  };

  for (const visible of view.visibleRanges) {
    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter: (node) => {
        const { name, from, to } = node;
        if (name === 'Document') return true;
        if (insideSkipped(from, to)) {
          for (let position = from; position <= to; ) {
            const current = doc.lineAt(position);
            lineClass(current.from, 'cm-lp-source');
            position = current.to + 1;
          }
          return false;
        }
        const heading = /^ATXHeading(\d)$/.exec(name);
        if (heading) {
          lineClass(from, `cm-lp-h${heading[1]}`);
          if (!onActiveLine(from)) {
            for (const markNode of node.node.getChildren('HeaderMark')) {
              const after = doc.sliceString(markNode.to, markNode.to + 1) === ' ' ? 1 : 0;
              const before = markNode.from > from && doc.sliceString(markNode.from - 1, markNode.from) === ' ' ? 1 : 0;
              hide(markNode.from - before, markNode.to + (markNode.from === from ? after : 0));
            }
          }
          return true;
        }
        const setext = /^SetextHeading(\d)$/.exec(name);
        if (setext) {
          lineClass(from, `cm-lp-h${setext[1]}`);
          const underline = node.node.getChild('HeaderMark');
          if (underline) decorations.push(mark('cm-lp-syntax').range(underline.from, underline.to));
          return true;
        }
        switch (name) {
          case 'FencedCode':
          case 'CodeBlock':
          case 'HTMLBlock':
          case 'Table':
          case 'LinkReference':
            code.push([from, to]);
            return false;
          case 'InlineCode':
            code.push([from, to]);
            decorations.push(mark('cm-lp-code').range(from, to));
            if (!touches(from, to)) for (const child of node.node.getChildren('CodeMark')) hide(child.from, child.to);
            return false;
          case 'Emphasis':
          case 'StrongEmphasis':
            decorations.push(mark(name === 'Emphasis' ? 'cm-lp-em' : 'cm-lp-strong').range(from, to));
            if (!touches(from, to)) for (const child of node.node.getChildren('EmphasisMark')) hide(child.from, child.to);
            return true;
          case 'Strikethrough':
            decorations.push(mark('cm-lp-strike').range(from, to));
            if (!touches(from, to)) for (const child of node.node.getChildren('StrikethroughMark')) hide(child.from, child.to);
            return true;
          case 'Escape':
            if (!touches(from, to)) hide(from, from + 1);
            return false;
          case 'Link': {
            const marks = node.node.getChildren('LinkMark');
            const url = node.node.getChild('URL');
            const target = url ? doc.sliceString(url.from, url.to) : '';
            const mention = MENTION_URL.exec(target);
            if (mention && from > 0 && doc.sliceString(from - 1, from) === '@') {
              code.push([from - 1, to]);
              if (!touches(from - 1, to)) {
                const label = doc.sliceString(from + 1, marks[1]?.from ?? from + 1);
                // Un tableau blanc seul sur sa ligne s'affiche en aperçu.
                if (mention[1] === 'board' && doc.lineAt(from).text.trim() === doc.sliceString(from - 1, to)) {
                  swap(from - 1, to, new BoardWidget(Number(mention[2]), label, to - from + 1));
                  return false;
                }
                swap(from - 1, to, new TextWidget(options.mentionLabel(mention[1]!, Number(mention[2]), label), `cm-lp-mention ${mention[1]}`, { 'data-kind': mention[1]!, 'data-id': mention[2]!, ...(mention[1] === 'ticket' ? { 'data-ticket': mention[2]! } : {}), ...(mention[1] === 'board' ? { 'data-board': mention[2]! } : {}) }));
              }
              return false;
            }
            const close = marks.find((child) => doc.sliceString(child.from, child.to) === ']');
            if (!close || !url) return true;
            code.push([close.from, to]);
            if (touches(from, to)) {
              decorations.push(mark('cm-lp-syntax').range(close.from, to));
              return true;
            }
            hide(from, from + 1);
            hide(close.from, to);
            decorations.push(mark('cm-lp-link', { 'data-href': target }).range(from + 1, close.from));
            return true;
          }
          case 'Image': {
            const url = node.node.getChild('URL');
            // ![[image.png]] n'est pas une image Markdown : le lien wiki est traité plus bas.
            if (!url) return true;
            code.push([from, to]);
            if (url && !touches(from, to)) {
              const target = doc.sliceString(url.from, url.to);
              const address = /^(https?:|data:)/i.test(target) ? target : options.imageUrl(target);
              const alt = doc.sliceString(from + 2, Math.max(from + 2, (node.node.getChildren('LinkMark')[1]?.from ?? from + 2)));
              if (address) swap(from, to, new ImageWidget(address, alt, to - from));
            }
            return false;
          }
          case 'Blockquote':
            for (let position = from; position <= to; ) {
              const current = doc.lineAt(position);
              lineClass(current.from, 'cm-lp-quote');
              position = current.to + 1;
            }
            return true;
          case 'QuoteMark':
            if (!onActiveLine(from)) hide(from, to + (doc.sliceString(to, to + 1) === ' ' ? 1 : 0));
            return false;
          case 'ListMark': {
            const item = node.node.parent;
            const task = item?.getChild('Task');
            if (onActiveLine(from)) {
              decorations.push(mark('cm-lp-syntax').range(from, to));
              return false;
            }
            if (task) hide(from, to + (doc.sliceString(to, to + 1) === ' ' ? 1 : 0));
            else if (item?.parent?.name === 'BulletList') swap(from, to, new TextWidget('•', 'cm-lp-bullet'));
            else decorations.push(mark('cm-lp-ordinal').range(from, to));
            return false;
          }
          case 'TaskMarker': {
            const checked = /x/i.test(doc.sliceString(from, to));
            if (checked) decorations.push(mark('cm-lp-done').range(to, doc.lineAt(to).to));
            if (!touches(from, to)) swap(from, to, new CheckboxWidget(checked));
            return false;
          }
          case 'HorizontalRule':
            lineClass(from, 'cm-lp-hr-line');
            if (!onActiveLine(from)) swap(from, to, new TextWidget('', 'cm-lp-hr'));
            return false;
          default:
            return true;
        }
      },
    });
  }

  // Ce que le Markdown ordinaire ne connaît pas : liens wiki, et la syntaxe d'Obsidian.
  const outsideCode = (from: number, to: number) => !code.some(([start, end]) => from < end && to > start);
  const scanned = new Set<number>();
  for (const visible of view.visibleRanges) {
    for (let position = visible.from; position <= visible.to; ) {
      const current = doc.lineAt(position);
      position = current.to + 1;
      if (scanned.has(current.from) || inSkipped(current.from, current.to)) continue;
      scanned.add(current.from);
      const text = current.text;
      const base = current.from;
      for (const match of text.matchAll(WIKI)) {
        const from = base + match.index;
        const to = from + match[0].length;
        if (!outsideCode(from, to)) continue;
        code.push([from, to]);
        const inner = match[2]!;
        const pipe = inner.indexOf('|');
        const target = pipe < 0 ? inner : inner.slice(0, pipe);
        if (touches(from, to)) {
          decorations.push(mark('cm-lp-syntax').range(from, from + 2 + match[1]!.length), mark('cm-lp-syntax').range(to - 2, to));
          continue;
        }
        if (match[1]) {
          const address = /\.(png|jpe?g|gif|webp|svg)$/i.test(target.trim()) ? options.imageUrl(target.trim()) : null;
          const label = pipe < 0 ? docBaseName(target.trim()) : `${docBaseName(target.trim())}|${inner.slice(pipe + 1)}`;
          swap(from, to, address ? new ImageWidget(address, label, to - from) : new TextWidget(target.split('#')[0]!.trim(), 'cm-lp-embed', { 'data-wiki': target.trim() }));
          continue;
        }
        // [[#Titre]] : le titre seul, sans son dièse.
        const textStart = pipe >= 0 ? from + 2 + pipe + 1 : inner.startsWith('#') ? from + 3 : from + 2;
        hide(from, textStart);
        hide(to - 2, to);
        decorations.push(mark('cm-lp-link', { 'data-wiki': target.trim() }).range(textStart, to - 2));
      }
      if (!obsidian) continue;
      for (const match of text.matchAll(HIGHLIGHT)) {
        const from = base + match.index;
        const to = from + match[0].length;
        if (!outsideCode(from, to)) continue;
        const color = highlightColor(match[1]!);
        decorations.push(mark(color ? `cm-lp-highlight cm-lp-hl-${color}` : 'cm-lp-highlight').range(from, to));
        if (!touches(from, to)) {
          // Les == et la bille de couleur disparaissent tant que le curseur n'y est pas.
          const marker = color ? highlightMarker(match[1]!) : 0;
          hide(from, from + 2 + (marker < match[1]!.length ? marker : 0));
          // L'espace avant les == de fin non plus.
          const trailing = match[0].length - 4 - match[1]!.length;
          hide(to - 2 - Math.max(0, trailing), to);
        }
      }
      for (const match of text.matchAll(COMMENT)) {
        const from = base + match.index;
        if (outsideCode(from, from + match[0].length)) decorations.push(mark('cm-lp-comment').range(from, from + match[0].length));
      }
      for (const match of text.matchAll(TAG)) {
        const from = base + match.index + match[1]!.length;
        const to = from + match[2]!.length;
        if (outsideCode(from, to) && !(match.index === 0 && /^#{1,6}\s/.test(text))) decorations.push(mark('cm-lp-tag').range(from, to));
      }
      for (const match of text.matchAll(FOOTNOTE)) {
        const from = base + match.index;
        if (outsideCode(from, from + match[0].length)) decorations.push(mark('cm-lp-footnote').range(from, from + match[0].length));
      }
      for (const match of text.matchAll(BLOCK_ID)) {
        const from = base + match.index;
        decorations.push(mark('cm-lp-syntax').range(from, from + match[0].length));
      }
      for (const match of text.matchAll(MATH)) {
        const from = base + match.index;
        const to = from + match[0].length;
        if (outsideCode(from, to) && !touches(from, to)) swap(from, to, new MathWidget(match[1]!));
      }
    }
  }
  return Decoration.set(decorations, true);
}

export function liveInline(options: LiveInlineOptions): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = build(view, options);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged || syntaxTree(update.state) !== syntaxTree(update.startState)) {
          this.decorations = build(update.view, options);
        }
      }
    },
    { decorations: (value) => value.decorations },
  );
  const events = EditorView.domEventHandlers({
    mousedown(event, view) {
      const target = event.target as HTMLElement;
      if (event.button !== 0) return false;
      if (target instanceof HTMLInputElement && target.classList.contains('cm-lp-task')) {
        event.preventDefault();
        toggleTask(view, view.state.doc.lineAt(view.posAtDOM(target)).from);
        return true;
      }
      if (target.closest('.cm-lp-board-tools')) return false;
      const link = target.closest<HTMLElement>('.cm-lp-link, .cm-lp-mention, .cm-lp-embed, .cm-lp-board');
      if (link && options.follow(link, event)) {
        event.preventDefault();
        return true;
      }
      return false;
    },
  });
  return [plugin, events];
}
