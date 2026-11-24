import { syntaxTree } from '@codemirror/language';
import type { EditorState, Extension, Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import katex from 'katex';
import { boardMentionView, type BoardMentionView } from '@shared/boards';
import { citedVersionOf } from '@shared/citations';
import { imageSize } from '@shared/docLinks';
import { highlightColor, highlightMarker } from '@shared/docObsidian';
import { docBaseName } from '@shared/docs';
import { t } from '@/i18n';
import { mountBoardEmbed } from '@/utils/boardEmbed';
import { openLightbox } from '@/utils/lightbox';
import { boardMentionAt, boardViewChoices, setBoardMentionView } from './boardMention';
import { toggleTask, type TextRange } from './commands';
import { findField, findMatches, overlapsMatch } from './findState';
import { refreshLive } from './live';

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
  /** `suffix` : ce qui suit le `#` de la mention (lignes citées d'une note…). */
  mentionLabel: (kind: string, id: number, label: string, suffix: string) => string;
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

/**
 * Tableau blanc cité seul sur sa ligne, dans l'affichage choisi : carte (son nom et son aperçu, qui l'ouvre), image
 * seule, ou vue intégrée où l'on se déplace. Au survol : le choix de l'affichage, et le crayon qui rend le Markdown.
 */
class BoardWidget extends WidgetType {
  readonly id: number;
  readonly label: string;
  readonly length: number;
  readonly shown: Exclude<BoardMentionView, 'link'>;
  /** Version étiquetée citée (`board:7#v:88`) : son dessin, et le clic l'ouvre dans l'historique. */
  readonly version: number | null;

  constructor(id: number, label: string, length: number, shown: Exclude<BoardMentionView, 'link'>, version: number | null = null) {
    super();
    this.id = id;
    this.label = label;
    this.length = length;
    this.shown = shown;
    this.version = version;
  }

  override eq(other: BoardWidget): boolean {
    return other.id === this.id && other.label === this.label && other.length === this.length && other.shown === this.shown && other.version === this.version;
  }

  override toDOM(view: EditorView): HTMLElement {
    const card = document.createElement('span');
    card.className = `cm-lp-board ${this.shown}`;
    card.dataset.kind = 'board';
    card.dataset.id = String(this.id);
    card.dataset.length = String(this.length);
    if (this.version) card.dataset.suffix = `v:${this.version}`;
    const button = (icon: string, label: string, run: () => void, active = false): HTMLButtonElement => {
      const element = document.createElement('button');
      element.type = 'button';
      element.title = label;
      element.setAttribute('aria-label', label);
      if (active) element.className = 'active';
      element.innerHTML = `<i class="${icon}"></i>`;
      element.addEventListener('mousedown', (event) => event.preventDefault());
      element.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        run();
      });
      return element;
    };
    const tools = document.createElement('span');
    tools.className = 'cm-lp-board-tools';
    // Une version citée garde son suffixe : pas de choix d'affichage, qui le remplacerait.
    for (const choice of this.version ? [] : boardViewChoices()) {
      tools.append(
        button(choice.icon, t('Afficher en : {name}', { name: choice.label.toLowerCase() }), () => {
          const mention = boardMentionAt(view.state, view.posAtDOM(card));
          if (mention) setBoardMentionView(view, mention, choice.view);
        }, choice.view === this.shown),
      );
    }
    const separator = document.createElement('span');
    separator.className = 'cm-lp-board-sep';
    tools.append(separator, button('pi pi-pencil', t('Modifier le Markdown'), () => editImageSource(view, card)));
    // Les deux thèmes : la feuille de style montre le bon, même après un changement de thème.
    const width = this.shown === 'card' ? 960 : 1600;
    const images = (['light', 'dark'] as const).map((theme) => {
      const image = document.createElement('img');
      image.className = `cm-lp-board-preview ${theme}`;
      image.src = `/api/boards/nodes/${this.id}/preview?width=${width}${theme === 'dark' ? '&theme=dark' : ''}${this.version ? `&version=${this.version}` : ''}`;
      image.alt = this.label;
      image.loading = 'lazy';
      image.draggable = false;
      image.addEventListener('load', () => view.requestMeasure());
      return image;
    });
    if (this.shown === 'image') {
      card.title = this.label;
      card.append(...images, tools);
      return card;
    }
    const head = document.createElement('span');
    head.className = 'cm-lp-board-head';
    const icon = document.createElement('i');
    icon.className = 'pi pi-objects-column';
    const title = document.createElement('span');
    title.className = 'cm-lp-board-title';
    title.textContent = this.label;
    const open = document.createElement('i');
    open.className = 'pi pi-external-link cm-lp-board-open';
    head.append(icon, title, tools, open);
    if (this.shown === 'embed') {
      // L'en-tête ouvre le tableau ; le cadre se parcourt sans l'ouvrir.
      const frame = document.createElement('span');
      frame.className = 'fb-board-view';
      frame.append(...images);
      const zoom = document.createElement('span');
      zoom.className = 'cm-lp-board-zoom';
      head.insertBefore(zoom, tools);
      card.append(head, frame);
      mountBoardEmbed(frame, zoom, () => view.requestMeasure());
      return card;
    }
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

const MENTION_URL = /^(user|ticket|doc|board|project):(\d+)(?:#([A-Za-z0-9:,_-]{1,400}))?$/;
const WIKI = /(!?)\[\[([^\]\n]+?)\]\]/g;
const HIGHLIGHT = /==(?!=)(?=\S)(.+?\S)\s*==/g;
const COMMENT = /%%.*?%%/g;
const TAG = /(^|[\s(])(#[\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;
const FOOTNOTE = /\[\^[^\]\s]+\](?!:)/g;
const MATH = /\$(?!\s)((?:\\\$|[^$\n`])+?)(?<!\s)\$(?!\d)/g;
/** Balises HTML en ligne rendues comme en lecture (exposant, indice, touche…) ; les autres restent en source. */
const INLINE_HTML = /<(sup|sub|kbd|mark|u|ins|del|s|small|b|strong|i|em)(?:\s[^<>]*)?>((?:(?!<\/?\1[\s>]).)+?)<\/\1\s*>/gi;
/** Nœuds du Markdown où un « $ » n'ouvre pas de formule. */
const NO_MATH = /^(InlineCode|CodeText|FencedCode|CodeBlock|HTMLBlock|HTMLTag|URL|Autolink|LinkReference)$/;
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
  // Résultats de la recherche (Ctrl F) : la syntaxe qu'ils recouvrent reste visible (chercher « **s » montre « **s »).
  const finds = findMatches(state);
  const found = (from: number, to: number) => finds.length > 0 && overlapsMatch(finds, from, to);
  const hide = (from: number, to: number) => {
    if (to <= from || !free(from, to) || found(from, to)) return;
    replaced.push([from, to]);
    decorations.push(hidden.range(from, to));
  };
  const swap = (from: number, to: number, widget: WidgetType) => {
    if (!free(from, to) || found(from, to)) return;
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

  // Formules $…$ d'abord : la syntaxe Markdown qu'elles contiennent (x_1, a*b) ne doit ni les couper ni les décorer.
  const tree = syntaxTree(state);
  const maths: Array<[number, number]> = [];
  const noMath = (position: number): boolean => {
    for (let node: { name: string; parent: unknown } | null = tree.resolveInner(position, 1); node; node = node.parent as typeof node) {
      if (NO_MATH.test(node.name)) return true;
    }
    return false;
  };
  for (const visible of view.visibleRanges) {
    for (let position = visible.from; position <= visible.to; ) {
      const current = doc.lineAt(position);
      position = current.to + 1;
      if (inSkipped(current.from, current.to) || !current.text.includes('$')) continue;
      for (const match of current.text.matchAll(MATH)) {
        const from = current.from + match.index;
        const to = from + match[0].length;
        if (noMath(from) || noMath(to - 1) || maths.some(([start, end]) => from < end && to > start)) continue;
        maths.push([from, to]);
        code.push([from, to]);
        if (touches(from, to)) decorations.push(mark('cm-lp-math-source').range(from, to));
        else swap(from, to, new MathWidget(match[1]!));
      }
    }
  }
  const insideMath = (from: number, to: number) => maths.some(([start, end]) => from >= start && to <= end);

  for (const visible of view.visibleRanges) {
    tree.iterate({
      from: visible.from,
      to: visible.to,
      enter: (node) => {
        const { name, from, to } = node;
        if (name === 'Document') return true;
        if (insideMath(from, to)) return false;
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
            // Identifiants du titre ({#id} final, <a id="…"></a>) : ils servent aux liens, pas à la lecture.
            const title = doc.sliceString(from, to);
            const id = /[ \t]*\{#[^\s{}]+[^{}]*\}[ \t]*$/.exec(title);
            if (id) hide(from + id.index, to);
            for (const anchor of title.matchAll(/<a\s[^>]*?\b(?:id|name)\s*=[^>]*>\s*<\/a>\s*/gi)) hide(from + anchor.index, from + anchor.index + anchor[0].length);
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
                // Un tableau blanc seul sur sa ligne s'affiche en bloc (carte, image ou vue intégrée), sauf demandé en lien.
                const shown = boardMentionView(mention[3]) ?? 'card';
                if (mention[1] === 'board' && shown !== 'link' && doc.lineAt(from).text.trim() === doc.sliceString(from - 1, to)) {
                  swap(from - 1, to, new BoardWidget(Number(mention[2]), label, to - from + 1, shown, citedVersionOf(mention[3])));
                  return false;
                }
                swap(
                  from - 1,
                  to,
                  new TextWidget(options.mentionLabel(mention[1]!, Number(mention[2]), label, mention[3] ?? ''), `cm-lp-mention ${mention[1]}`, {
                    'data-kind': mention[1]!,
                    'data-id': mention[2]!,
                    ...(mention[3] ? { 'data-suffix': mention[3] } : {}),
                    ...(mention[1] === 'ticket' ? { 'data-ticket': mention[2]! } : {}),
                    ...(mention[1] === 'board' ? { 'data-board': mention[2]! } : {}),
                  }),
                );
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
            // Marges haute et basse du bloc, comme en lecture (pas pour une citation dans une citation).
            if (node.node.parent?.name !== 'Blockquote') {
              lineClass(from, 'cm-lp-quote-first');
              lineClass(to, 'cm-lp-quote-last');
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
      // HTML en ligne (<sup>2</sup>, <kbd>Ctrl</kbd>…) : les balises disparaissent, le texte prend leur rendu.
      if (text.includes('<')) {
        for (const match of text.matchAll(INLINE_HTML)) {
          const from = base + match.index;
          const to = from + match[0].length;
          if (!outsideCode(from, to)) continue;
          const open = match[0].indexOf('>') + 1;
          const close = match[0].lastIndexOf('<');
          decorations.push(mark(`cm-lp-html-${match[1]!.toLowerCase()}`).range(from + open, from + close));
          if (touches(from, to)) decorations.push(mark('cm-lp-syntax').range(from, from + open), mark('cm-lp-syntax').range(from + close, to));
          else {
            hide(from, from + open);
            hide(from + close, to);
          }
        }
      }
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
        const findChanged = update.state.field(findField, false) !== update.startState.field(findField, false);
        // L'arbre a changé (image remplacée, renommée…) : les adresses des images sont à refaire.
        const refreshed = update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(refreshLive)));
        if (refreshed || findChanged || update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged || syntaxTree(update.state) !== syntaxTree(update.startState)) {
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
      // Outils d'un tableau cité, et vue intégrée (on s'y déplace) : ni suivi du lien, ni curseur déplacé.
      if (target.closest('.cm-lp-board-tools, .cm-lp-board-zoom, .fb-board-view')) return false;
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
