/**
 * Commentaires posés sur un passage d'une note. Le passage est retrouvé par son texte et ce qui l'entoure (et non par une
 * position) : l'ancre survit aux modifications autour d'elle, à un import, et vaut pour le texte source comme pour le rendu.
 */

export interface DocQuote {
  /** Passage commenté, sans sa syntaxe Markdown. Vide pour une réponse. */
  quote: string;
  /** Ce qui précède et ce qui suit, pour départager un passage présent plusieurs fois. */
  before: string;
  after: string;
}

export interface DocCommentDTO extends DocQuote {
  id: number;
  nodeId: number;
  /** Commentaire auquel celui-ci répond. */
  parentId: number | null;
  userId: number | null;
  body: string;
  resolvedAt: string | null;
  resolvedBy: number | null;
  createdAt: string;
}

export const DOC_COMMENT_LIMITS = { body: 5_000, quote: 500, context: 80 };

/** Retire la syntaxe Markdown d'un texte : ce qui reste est ce que la lecture affiche. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/@\[([^\]\n]*)\]\((?:user|ticket|doc):\d+\)/g, '$1')
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+)/gm, '')
    .replace(/[*`~]+/g, '')
    .replace(/(^|\s)_+|_+(?=\s|$)/g, '$1');
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Ancre d'un passage sélectionné dans le texte source. */
export function quoteFromSource(text: string, from: number, to: number): DocQuote {
  return {
    quote: squash(plainText(text.slice(from, to))).slice(0, DOC_COMMENT_LIMITS.quote),
    before: squash(plainText(text.slice(Math.max(0, from - 200), from))).slice(-DOC_COMMENT_LIMITS.context),
    after: squash(plainText(text.slice(to, to + 200))).slice(0, DOC_COMMENT_LIMITS.context),
  };
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Entre deux mots du source peuvent se glisser de la syntaxe, ou l'adresse d'un lien. */
const SOURCE_GAP = String.raw`(?:\]\([^)\n]*\)|[\s*_~\x60\[\]>#|]|<[^>\n]*>)+`;

function sameEnd(a: string, b: string): number {
  let count = 0;
  while (count < a.length && count < b.length && a[a.length - 1 - count] === b[b.length - 1 - count]) count += 1;
  return count;
}

function sameStart(a: string, b: string): number {
  let count = 0;
  while (count < a.length && count < b.length && a[count] === b[count]) count += 1;
  return count;
}

/**
 * Position du passage dans `text`, le texte source (`source`) ou le texte rendu. Entre plusieurs occurrences, garde celle
 * dont l'entourage ressemble le plus à celui du passage d'origine. `null` : le passage n'existe plus.
 */
export function findQuote(text: string, anchor: DocQuote, source: boolean): { from: number; to: number } | null {
  const words = anchor.quote.split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const pattern = new RegExp(words.map(escapeRegExp).join(source ? SOURCE_GAP : String.raw`\s+`), 'g');
  let best: { from: number; to: number; score: number } | null = null;
  for (const match of text.matchAll(pattern)) {
    const from = match.index;
    const to = from + match[0].length;
    const near = (part: string) => squash(source ? plainText(part) : part);
    const score = sameEnd(near(text.slice(Math.max(0, from - 200), from)), squash(anchor.before)) + sameStart(near(text.slice(to, to + 200)), squash(anchor.after));
    if (!best || score > best.score) best = { from, to, score };
  }
  return best && { from: best.from, to: best.to };
}

/** Position dans le source d'un point du rendu, repéré par le texte qui le précède (pour y placer le curseur). */
export function sourceOffset(source: string, renderedBefore: string): number {
  const words = squash(renderedBefore).split(' ').filter(Boolean).slice(-5);
  if (!words.length) return 0;
  const found = findQuote(source, { quote: words.join(' '), before: '', after: '' }, true);
  return found ? found.to : source.length;
}
