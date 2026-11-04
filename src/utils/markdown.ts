import DOMPurify from 'dompurify';
import katex from 'katex';
import { Marked, type TokenizerAndRendererExtension } from 'marked';
import 'katex/dist/katex.min.css';

/**
 * Rendu Markdown des descriptions : GitHub Flavored Markdown (tableaux, listes de tâches, barré), formules KaTeX
 * (`$…$`, `$$…$$` ou bloc ```math), diagrammes Mermaid (bloc ```mermaid, dessinés ensuite par `renderMermaid`) et
 * mentions `@[Nom](user:12)` / `@[APP-12](ticket:34)` / `@[Note](doc:56)`. Le HTML produit est toujours assaini (DOMPurify).
 */

export interface MentionResolver {
  userName: (id: number) => string | undefined;
  /** `label` : texte enregistré dans la mention, seule information hors du contexte d'un projet. */
  ticketLabel: (id: number, label: string) => { key: string; title: string } | undefined;
}

function escapeHtml(text: string): string {
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

function createMarked(resolver: MentionResolver): Marked {
  const mention: TokenizerAndRendererExtension = {
    name: 'mention',
    level: 'inline',
    start: (src: string) => src.indexOf('@['),
    tokenizer(src: string) {
      const match = /^@\[([^\]\n]{1,80})\]\((user|ticket|doc):(\d+)\)/.exec(src);
      if (!match) return undefined;
      return { type: 'mention', raw: match[0], label: match[1], kind: match[2], id: Number(match[3]) };
    },
    renderer(token) {
      const id = token.id as number;
      if (token.kind === 'user') {
        const name = resolver.userName(id) ?? (token.label as string);
        return `<a class="md-mention user" href="/users/${id}" data-user="${id}">@${escapeHtml(name)}</a>`;
      }
      if (token.kind === 'doc') {
        return `<a class="md-mention doc" href="/documentation/f/${id}" data-doc="${id}">${escapeHtml(token.label as string)}</a>`;
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
      const match = /^\$(?!\s)((?:\\\$|[^$\n])+?)(?<!\s)\$(?!\d)/.exec(src);
      return match ? { type: 'inlineMath', raw: match[0], text: match[1]! } : undefined;
    },
    renderer: (token) => math(token.text as string, false),
  };

  const marked = new Marked({ gfm: true, breaks: true });
  marked.use({
    extensions: [mention, blockMath, inlineMath],
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
    },
  });
  return marked;
}

export interface MarkdownBlock {
  from: number;
  to: number;
  /** Nature du bloc pour marked : `heading`, `paragraph`, `list`, `table`, `code`… */
  type: string;
}

let lexer: Marked | null = null;

/** Blocs de premier niveau d'un texte et leur position ; vide si elle ne peut pas être établie. */
export function markdownBlocks(text: string): MarkdownBlock[] {
  lexer ??= createMarked({ userName: () => undefined, ticketLabel: () => undefined });
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
export function renderMarkdown(text: string, resolver: MentionResolver): string {
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
  const html = createMarked(resolver).parse(text, { async: false }) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select'] });
}

let mermaidPromise: Promise<typeof import('mermaid')['default']> | null = null;
let diagramCount = 0;

/** Dessine les diagrammes Mermaid d'un conteneur (bibliothèque chargée à la demande, mode sécurisé). */
export async function renderMermaid(root: HTMLElement, dark: boolean): Promise<void> {
  const blocks = [...root.querySelectorAll<HTMLElement>('.md-mermaid[data-code]')];
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
