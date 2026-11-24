import DOMPurify from 'dompurify';
import katex from 'katex';
import { Marked, type Tokens, type TokenizerAndRendererExtension } from 'marked';
import { boardMentionView, MENTION_VIEW_SUFFIX, type BoardMentionView } from '@shared/boards';
import { citedElementsOf, citedLinesOf, linesLabel, linesParam } from '@shared/citations';
import { headingKey } from '@shared/docLinks';
import { headingTitle } from '@shared/docOutline';
import { highlightColor, highlightMarker } from '@shared/docObsidian';
import 'katex/dist/katex.min.css';

/**
 * Rendu Markdown des descriptions : GitHub Flavored Markdown (tableaux, listes de tâches, barré), formules KaTeX
 * (`$…$`, `$$…$$` ou bloc ```math), diagrammes Mermaid (bloc ```mermaid, dessinés ensuite par `renderMermaid`) et
 * mentions `@[Nom](user:12)` / `@[APP-12](ticket:34)` / `@[Note](doc:56)` / `@[Projet](project:3)`, avec au besoin des
 * lignes citées (`doc:56#L4-9`) ou des éléments cités d'un tableau (`board:7#el:a1b2c3`). Avec `obsidian`, la syntaxe propre à
 * Obsidian : callouts, `==surlignage==`, `%%commentaires%%` et `#étiquettes`. Le HTML produit est toujours assaini.
 */

export interface MentionResolver {
  userName: (id: number) => string | undefined;
  /** `label` : texte enregistré dans la mention, seule information hors du contexte d'un projet. */
  ticketLabel: (id: number, label: string) => { key: string; title: string } | undefined;
}

export interface RenderOptions {
  /** Syntaxe propre à Obsidian (réglage de l'espace de documentation). */
  obsidian?: boolean;
  /** Tableau blanc cité seul sur sa ligne : montré en aperçu (`false` sur le site public, qui n'y a pas accès). */
  boardPreviews?: boolean;
}

/**
 * Tableau blanc cité seul sur sa ligne. `card` : son nom et son aperçu, un clic l'ouvre ; `image` : son image seule ;
 * `embed` : une vue où l'on se déplace et où l'on zoome (rendue vivante par `mountBoardEmbeds`).
 */
export function boardPreviewHtml(id: number, label: string, view: Exclude<BoardMentionView, 'link'> = 'card'): string {
  const name = escapeHtml(label);
  const image = (theme: 'light' | 'dark', width: number): string =>
    `<img class="md-board-preview ${theme}" src="/api/boards/nodes/${id}/preview?width=${width}${theme === 'dark' ? '&amp;theme=dark' : ''}" alt="${name}" loading="lazy" draggable="false">`;
  const images = (width: number): string => image('light', width) + image('dark', width);
  const head = `<i class="pi pi-objects-column"></i><span class="md-board-title">${name}</span><i class="pi pi-external-link md-board-open"></i>`;
  if (view === 'image') return `<a class="md-board md-board-image" href="/tableaux/t/${id}" data-board="${id}" title="${name}">${images(1600)}</a>`;
  if (view === 'embed') {
    return `<div class="md-board md-board-embed" data-embed="${id}"><a class="md-board-head" href="/tableaux/t/${id}" data-board="${id}">${head}</a><div class="fb-board-view">${images(1600)}</div></div>`;
  }
  return `<a class="md-board" href="/tableaux/t/${id}" data-board="${id}"><span class="md-board-head">${head}</span>${images(960)}</a>`;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function math(tex: string, displayMode: boolean): string {
  return katex.renderToString(tex, { displayMode, throwOnError: false, output: 'htmlAndMathml', strict: 'ignore' });
}

function toBase64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

export function fromBase64(value: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(value), (char) => char.charCodeAt(0)));
}

/** Types de callouts d'Obsidian et leurs alias, ramenés à une famille de couleur et d'icône. */
const CALLOUT_FAMILIES: Record<string, string> = {
  note: 'note',
  abstract: 'abstract',
  summary: 'abstract',
  tldr: 'abstract',
  info: 'info',
  todo: 'todo',
  tip: 'tip',
  hint: 'tip',
  important: 'tip',
  success: 'success',
  check: 'success',
  done: 'success',
  question: 'question',
  help: 'question',
  faq: 'question',
  warning: 'warning',
  caution: 'warning',
  attention: 'warning',
  failure: 'failure',
  fail: 'failure',
  missing: 'failure',
  danger: 'danger',
  error: 'danger',
  bug: 'bug',
  example: 'example',
  quote: 'quote',
  cite: 'quote',
};

function obsidianExtensions(): TokenizerAndRendererExtension[] {
  const highlight: TokenizerAndRendererExtension = {
    name: 'highlight',
    level: 'inline',
    start: (src: string) => src.indexOf('=='),
    tokenizer(src: string) {
      const match = /^==(?!=)(?=\S)([\s\S]*?\S)\s*==(?!=)/.exec(src);
      if (!match) return undefined;
      // La bille de couleur (==🟢 Titre==) donne la couleur, et ne s'affiche pas.
      const body = match[1]!.slice(highlightMarker(match[1]!));
      return { type: 'highlight', raw: match[0], text: match[1], tokens: this.lexer.inlineTokens(body || match[1]!) };
    },
    renderer(token) {
      const color = highlightColor(String(token.text ?? ''));
      return `<mark class="md-highlight"${color ? ` data-color="${color}"` : ''}>${this.parser.parseInline(token.tokens ?? [])}</mark>`;
    },
  };
  const comment: TokenizerAndRendererExtension = {
    name: 'obsidianComment',
    level: 'inline',
    start: (src: string) => src.indexOf('%%'),
    tokenizer(src: string) {
      const match = /^%%[\s\S]*?%%/.exec(src);
      return match ? { type: 'obsidianComment', raw: match[0] } : undefined;
    },
    renderer: () => '',
  };
  const blockComment: TokenizerAndRendererExtension = {
    name: 'obsidianBlockComment',
    level: 'block',
    start: (src: string) => src.match(/^%%/m)?.index,
    tokenizer(src: string) {
      const match = /^%%[\s\S]*?%%[ \t]*(?:\n|$)/.exec(src);
      return match ? { type: 'obsidianBlockComment', raw: match[0] } : undefined;
    },
    renderer: () => '',
  };
  const tag: TokenizerAndRendererExtension = {
    name: 'tag',
    level: 'inline',
    start: (src: string) => {
      const match = /(^|[\s(])#[\p{L}\p{N}_/-]*[\p{L}_/-]/u.exec(src);
      return match ? match.index + match[1]!.length : undefined;
    },
    tokenizer(src: string) {
      const match = /^#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/u.exec(src);
      return match ? { type: 'tag', raw: match[0], text: match[1] } : undefined;
    },
    renderer: (token) => `<span class="md-tag">#${escapeHtml(token.text as string)}</span>`,
  };
  const callout: TokenizerAndRendererExtension = {
    name: 'callout',
    level: 'block',
    start: (src: string) => src.match(/^ {0,3}>[ \t]?\[!/m)?.index,
    tokenizer(src: string) {
      const match = /^ {0,3}>[ \t]?\[!([\w-]+)\]([+-]?)[ \t]*([^\n]*)(?:\n|$)((?: {0,3}>[^\n]*(?:\n|$))*)/.exec(src);
      if (!match) return undefined;
      const token = {
        type: 'callout',
        raw: match[0],
        kind: match[1]!.toLowerCase(),
        fold: match[2],
        title: match[3]!.trim(),
        titleTokens: this.lexer.inlineTokens(match[3]!.trim()),
        tokens: [],
      };
      this.lexer.blockTokens(match[4]!.replace(/^ {0,3}>[ \t]?/gm, ''), token.tokens);
      return token;
    },
    renderer(token) {
      const kind = token.kind as string;
      const family = CALLOUT_FAMILIES[kind] ?? 'note';
      const title = token.title ? this.parser.parseInline(token.titleTokens as never) : escapeHtml(kind.charAt(0).toUpperCase() + kind.slice(1));
      const body = this.parser.parse(token.tokens ?? []);
      const attributes = `class="md-callout" data-callout="${family}"`;
      if (token.fold) return `<details ${attributes}${token.fold === '+' ? ' open' : ''}><summary class="md-callout-title">${title}</summary><div class="md-callout-content">${body}</div></details>`;
      return `<div ${attributes}><div class="md-callout-title">${title}</div>${body ? `<div class="md-callout-content">${body}</div>` : ''}</div>`;
    },
  };
  return [callout, blockComment, highlight, comment, tag];
}

/** Ligne faite d'une seule mention de tableau blanc, avec son affichage au besoin (`board:7#image`). */
const BOARD_LINE = new RegExp(String.raw`^@\[([^\]\n]{1,80})\]\(board:(\d+)${MENTION_VIEW_SUFFIX}\)[ \t]*(?:\n|$)`);
const BOARD_LINE_START = new RegExp(String.raw`^@\[[^\]\n]{1,80}\]\(board:\d+${MENTION_VIEW_SUFFIX}\)[ \t]*$`, 'm');
const MENTION_START = new RegExp(String.raw`^@\[([^\]\n]{1,80})\]\((user|ticket|doc|board|project):(\d+)${MENTION_VIEW_SUFFIX}\)`);

/** Le texte d'une mention dit déjà les lignes citées (« Guide, l. 12-18 ») : on ne les répète pas. */
const LINES_IN_LABEL = /\b(?:l|ll|lignes?|lines?)\.?\s*\d/i;

function createMarked(resolver: MentionResolver, obsidian = false, boardPreviews = true): Marked {
  const boardPreview: TokenizerAndRendererExtension = {
    name: 'boardPreview',
    level: 'block',
    start: (src: string) => BOARD_LINE_START.exec(src)?.index,
    tokenizer(src: string) {
      const match = BOARD_LINE.exec(src);
      const view = boardMentionView(match?.[3]) ?? 'card';
      // « Lien » : la mention reste une simple pastille, même seule sur sa ligne ; de même pour des éléments cités.
      return match && view !== 'link' && !citedElementsOf(match[3]) ? { type: 'boardPreview', raw: match[0], label: match[1], id: Number(match[2]), view } : undefined;
    },
    renderer: (token) => boardPreviewHtml(token.id as number, token.label as string, token.view as Exclude<BoardMentionView, 'link'>),
  };
  const mention: TokenizerAndRendererExtension = {
    name: 'mention',
    level: 'inline',
    start: (src: string) => src.indexOf('@['),
    tokenizer(src: string) {
      const match = MENTION_START.exec(src);
      if (!match) return undefined;
      return { type: 'mention', raw: match[0], label: match[1], kind: match[2], id: Number(match[3]), suffix: match[4] ?? '' };
    },
    renderer(token) {
      const id = token.id as number;
      if (token.kind === 'user') {
        const name = resolver.userName(id) ?? (token.label as string);
        return `<a class="md-mention user" href="/users/${id}" data-user="${id}">@${escapeHtml(name)}</a>`;
      }
      const label = token.label as string;
      if (token.kind === 'doc') {
        const lines = citedLinesOf(token.suffix as string);
        if (!lines) return `<a class="md-mention doc" href="/documentation/f/${id}" data-doc="${id}">${escapeHtml(label)}</a>`;
        const param = linesParam(lines);
        const shown = LINES_IN_LABEL.test(label) ? '' : `<span class="md-mention-lines">l. ${linesLabel(lines)}</span>`;
        return `<a class="md-mention doc cited" href="/documentation/f/${id}?lines=${param}" data-doc="${id}" data-lines="${param}">${escapeHtml(label)}${shown}</a>`;
      }
      if (token.kind === 'board') {
        const elements = citedElementsOf(token.suffix as string);
        if (!elements) return `<a class="md-mention board" href="/tableaux/t/${id}" data-board="${id}">${escapeHtml(label)}</a>`;
        const param = elements.join(',');
        return `<a class="md-mention board cited" href="/tableaux/t/${id}?elements=${param}" data-board="${id}" data-elements="${param}">${escapeHtml(label)}</a>`;
      }
      if (token.kind === 'project') {
        return `<a class="md-mention project" href="/p/${id}" data-project="${id}">${escapeHtml(label)}</a>`;
      }
      const ticket = resolver.ticketLabel(id, token.label as string);
      return ticket
        ? `<a class="md-mention ticket" href="#" data-ticket="${id}">${escapeHtml(ticket.key)}</a>`
        : `<span class="md-mention ticket gone">${escapeHtml(token.label as string)}</span>`;
    },
  };
  const blockMath: TokenizerAndRendererExtension = {
    name: 'blockMath',
    level: 'block',
    start: (src: string) => src.indexOf('$$'),
    tokenizer(src: string) {
      const match = /^\$\$\n?([\s\S]+?)\n?\$\$(?:\n|$)/.exec(src);
      return match ? { type: 'blockMath', raw: match[0], text: match[1]!.trim() } : undefined;
    },
    renderer: (token) => `<div class="md-math">${math(token.text as string, true)}</div>`,
  };
  const inlineMath: TokenizerAndRendererExtension = {
    name: 'inlineMath',
    level: 'inline',
    start: (src: string) => src.indexOf('$'),
    tokenizer(src: string) {
      // « $x$ » : pas d'espace juste après le premier $ ni juste avant le second (évite « 5 $ et 10 $ »).
      // Une formule ne traverse pas un `code` : « 10 $, ni `$x$` » n'en contient pas.
      const match = /^\$(?!\s)((?:\\\$|[^$\n`])+?)(?<!\s)\$(?!\d)/.exec(src);
      return match ? { type: 'inlineMath', raw: match[0], text: match[1]! } : undefined;
    },
    renderer: (token) => math(token.text as string, false),
  };

  /**
   * Texte entre crochets qui n'est ni un lien ni une note de bas de page (`[REQ-012]`, `[À valider]`) : coloré comme
   * en « Lecture et écriture », où l'éditeur le lit comme un lien de référence. Un lien de référence défini reste un lien.
   */
  const bracketRef: TokenizerAndRendererExtension = {
    name: 'bracketRef',
    level: 'inline',
    start: (src: string) => src.indexOf('['),
    tokenizer(src: string) {
      const match = /^\[(?!\^)(?![ xX]?\])([^[\]\n]+)\](?![([:])/.exec(src);
      if (!match) return undefined;
      const label = match[1]!.trim().toLowerCase().replace(/\s+/g, ' ');
      if ((this.lexer.tokens.links as Record<string, unknown> | undefined)?.[label]) return undefined;
      return { type: 'bracketRef', raw: match[0], text: match[1]!, tokens: this.lexer.inlineTokens(match[1]!) };
    },
    renderer(token) {
      return `<span class="md-ref"><span class="md-ref-mark">[</span>${this.parser.parseInline(token.tokens ?? [])}<span class="md-ref-mark">]</span></span>`;
    },
  };

  const marked = new Marked({ gfm: true, breaks: true });
  marked.use({
    extensions: [...(boardPreviews ? [boardPreview] : []), mention, blockMath, inlineMath, ...(obsidian ? obsidianExtensions() : []), bracketRef],
    renderer: {
      code({ text, lang }) {
        const language = (lang ?? '').trim().toLowerCase();
        if (language === 'mermaid') {
          return `<div class="md-mermaid" data-code="${toBase64(text)}"><pre class="md-mermaid-source">${escapeHtml(text)}</pre></div>`;
        }
        if (language === 'math' || language === 'latex' || language === 'katex') {
          return `<div class="md-math">${math(text, true)}</div>`;
        }
        return `<pre class="md-code"><code${language ? ` data-lang="${escapeHtml(language)}"` : ''}>${escapeHtml(text)}</code></pre>`;
      },
      // Repère de chaque titre (numérotation comprise), pour le sommaire et les liens [[Note#Titre]] ou #ancre ; un
      // `{#id}` final ne s'affiche pas, il devient un identifiant du titre comme `<a id="…">`.
      // Case d'une liste de tâches : en lecture seule sans être « disabled », qui la grise et ignore la couleur du thème.
      checkbox({ checked }) {
        return `<input type="checkbox"${checked ? ' checked' : ''} tabindex="-1" data-readonly="1"> `;
      },
      heading({ tokens, depth, text }) {
        const { title, ids } = headingTitle(text);
        const last = tokens.at(-1);
        const ID = /[ \t]*\{#[^\s{}]+[^{}]*\}\s*$/;
        const inline = last?.type === 'text' && ID.test(last.raw) ? [...tokens.slice(0, -1), { ...last, raw: last.raw.replace(ID, ''), text: (last as Tokens.Text).text.replace(ID, '') }] : tokens;
        const anchors = ids.length ? ` data-ids="${escapeHtml(ids.join(' '))}"` : '';
        return `<h${depth} data-heading="${escapeHtml(headingKey(title))}"${anchors}>${this.parser.parseInline(inline)}</h${depth}>\n`;
      },
    },
  });
  return marked;
}

export interface MarkdownBlock {
  from: number;
  to: number;
  /** Nature du bloc pour marked : `heading`, `paragraph`, `list`, `table`, `code`, `callout`… */
  type: string;
}

const lexers = new Map<boolean, Marked>();

/** Blocs de premier niveau d'un texte et leur position ; vide si elle ne peut pas être établie. */
export function markdownBlocks(text: string, obsidian = false): MarkdownBlock[] {
  let lexer = lexers.get(obsidian);
  if (!lexer) {
    lexer = createMarked({ userName: () => undefined, ticketLabel: () => undefined }, obsidian);
    lexers.set(obsidian, lexer);
  }
  const blocks: MarkdownBlock[] = [];
  let offset = 0;
  for (const token of lexer.lexer(text)) {
    const from = text.indexOf(token.raw, offset);
    if (from < 0) return [];
    offset = from + token.raw.length;
    if (token.type !== 'space' && token.type !== 'def') blocks.push({ from, to: from + token.raw.replace(/\n+$/, '').length, type: token.type });
  }
  return blocks;
}

let hooked = false;

/** Markdown → HTML assaini, prêt pour `v-html`. */
export function renderMarkdown(text: string, resolver: MentionResolver, options: RenderOptions = {}): string {
  if (!hooked) {
    // Les liens externes s'ouvrent dans un nouvel onglet, sans accès à cette page.
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A' && node.getAttribute('href')?.match(/^(https?:|mailto:)/i)) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
    hooked = true;
  }
  const html = createMarked(resolver, options.obsidian, options.boardPreviews ?? true).parse(text, { async: false }) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select'] });
}

let mermaidPromise: Promise<typeof import('mermaid')['default']> | null = null;
let diagramCount = 0;

/** Dessine les diagrammes Mermaid d'un conteneur (bibliothèque chargée à la demande, mode sécurisé). */
export async function renderMermaid(root: HTMLElement, dark: boolean): Promise<void> {
  const blocks = [...root.querySelectorAll<HTMLElement>('.md-mermaid[data-code]:not(.rendered)')];
  if (!blocks.length) return;
  mermaidPromise ??= import('mermaid').then((module) => module.default);
  const mermaid = await mermaidPromise;
  // Libellés en texte SVG (et non en HTML dans foreignObject) : ils survivent à l'assainissement ci-dessous.
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default', fontFamily: 'inherit', htmlLabels: false, flowchart: { htmlLabels: false } });
  for (const block of blocks) {
    const code = fromBase64(block.dataset.code ?? '');
    const id = `fb-mermaid-${++diagramCount}`;
    try {
      const { svg } = await mermaid.render(id, code);
      block.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
      block.classList.add('rendered');
    } catch (error) {
      block.classList.add('failed');
      block.title = error instanceof Error ? error.message : String(error);
    } finally {
      // Mermaid laisse parfois un élément temporaire dans la page en cas d'erreur.
      document.getElementById(`d${id}`)?.remove();
    }
  }
}
