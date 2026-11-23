/**
 * Recherche dans une note (Ctrl F), avec la syntaxe de recherche d'Obsidian :
 *
 * - `mot` ou plusieurs mots : le texte tel quel ;
 * - `"phrase exacte"`, `a OR b`, `-mot` (exclu), `( … )` pour grouper ;
 * - `/expression/` : expression régulière ;
 * - `match-case:Mot`, `ignore-case:mot` : casse respectée ou ignorée pour ce terme ;
 * - `tag:#projet` : une étiquette ;
 * - `task:mot`, `task-todo:mot`, `task-done:mot` : dans une tâche (à faire, faite) ; sans mot, toute la tâche ;
 * - `line:(a b)` : a et b sur une même ligne ; `section:(a b)` : sous un même titre.
 *
 * Le même moteur cherche dans le source Markdown (écriture) et dans le texte rendu (lecture) : seules changent les
 * lignes qu'on lui donne (tâches et titres reconnus d'après le Markdown, ou d'après le rendu).
 */

export interface SearchFlags {
  caseSensitive: boolean;
  wholeWord: boolean;
  /** Toute la saisie est une expression régulière (pas d'opérateurs). */
  regexp: boolean;
}

export interface SearchLine {
  from: number;
  to: number;
  /** Début du texte d'une tâche, après sa case. */
  contentFrom: number;
  task: 'todo' | 'done' | null;
  /** Niveau du titre (1 à 6), 0 pour une autre ligne. */
  heading: number;
}

export interface SearchMatch {
  from: number;
  to: number;
}

export type SearchScope = 'line' | 'section' | 'task' | 'task-todo' | 'task-done';

export type SearchNode =
  | { kind: 'term'; regex: RegExp; label: string; type: 'text' | 'regex' | 'tag'; caseSensitive: boolean }
  | { kind: 'and'; items: Array<{ negate: boolean; node: SearchNode }> }
  | { kind: 'or'; alternatives: SearchNode[] }
  | { kind: 'scope'; scope: SearchScope; inner: SearchNode | null };

export interface ParsedSearch {
  node: SearchNode | null;
  /** Saisie fautive (expression régulière, parenthèse) : le message dit pourquoi. */
  error: string | null;
  /** Une seule expression (saisie simple ou régulière) : sert au remplacement avec `$1`. */
  single: RegExp | null;
  /** La saisie utilise la syntaxe de recherche (opérateurs, guillemets, OR…). */
  advanced: boolean;
}

export const SEARCH_LIMIT = 1000;

const OPERATOR = /^(line|section|task|task-todo|task-done|tag|match-case|ignore-case):(.*)$/;
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type Token =
  | { type: 'word'; text: string }
  | { type: 'phrase'; text: string }
  | { type: 'regex'; source: string; flags: string }
  | { type: 'op'; name: string; arg: string }
  | { type: 'open' | 'close' | 'or' | 'not' };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  const readPhrase = (): string => {
    let text = '';
    index += 1;
    while (index < input.length && input[index] !== '"') {
      if (input[index] === '\\' && input[index + 1] === '"') index += 1;
      text += input[index];
      index += 1;
    }
    index += 1;
    return text;
  };
  while (index < input.length) {
    const char = input[index]!;
    if (/\s/.test(char)) {
      index += 1;
    } else if (char === '"') {
      tokens.push({ type: 'phrase', text: readPhrase() });
    } else if (char === '(') {
      tokens.push({ type: 'open' });
      index += 1;
    } else if (char === ')') {
      tokens.push({ type: 'close' });
      index += 1;
    } else if (char === '-' && input[index + 1] && !/[\s)]/.test(input[index + 1]!)) {
      tokens.push({ type: 'not' });
      index += 1;
    } else if (char === '/' && /^\/(?:\\.|[^/\\])+\/[a-z]*(?=$|[\s)])/.test(input.slice(index))) {
      const match = /^\/((?:\\.|[^/\\])+)\/([a-z]*)/.exec(input.slice(index))!;
      tokens.push({ type: 'regex', source: match[1]!, flags: match[2]! });
      index += match[0].length;
    } else {
      let word = '';
      while (index < input.length && !/[\s()"]/.test(input[index]!)) {
        word += input[index];
        index += 1;
      }
      const operator = OPERATOR.exec(word);
      if (operator) {
        let arg = operator[2]!;
        if (!arg && input[index] === '"') arg = `"${readPhrase()}"`;
        tokens.push({ type: 'op', name: operator[1]!, arg });
      } else if (word === 'OR') tokens.push({ type: 'or' });
      else tokens.push({ type: 'word', text: word });
    }
  }
  return tokens;
}

function termRegex(source: string, caseSensitive: boolean, extra = ''): RegExp {
  const flags = new Set(['g', 'm', ...extra.replace(/[gmy]/g, '')]);
  if (!caseSensitive) flags.add('i');
  if (source.includes('\\p{')) flags.add('u');
  return new RegExp(source, [...flags].join(''));
}

function literal(text: string, flags: SearchFlags, caseSensitive: boolean): SearchNode {
  let source = escape(text);
  if (flags.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  return { kind: 'term', regex: termRegex(source, caseSensitive), label: text, type: 'text', caseSensitive };
}

/** Lit une saisie de recherche ; `node` est nul pour une saisie vide. */
export function parseNoteSearch(input: string, flags: SearchFlags): ParsedSearch {
  const empty: ParsedSearch = { node: null, error: null, single: null, advanced: false };
  if (!input.trim()) return empty;
  if (flags.regexp) {
    try {
      const regex = termRegex(flags.wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${input})(?![\\p{L}\\p{N}_])` : input, flags.caseSensitive);
      return { ...empty, node: { kind: 'term', regex, label: input, type: 'regex', caseSensitive: flags.caseSensitive }, single: regex };
    } catch {
      return { ...empty, error: 'Expression régulière invalide.' };
    }
  }
  const tokens = tokenize(input);
  const plain = (): ParsedSearch => {
    const node = literal(input, flags, flags.caseSensitive);
    return { ...empty, node, single: node.kind === 'term' ? node.regex : null };
  };
  // Sans opérateur, guillemets, OR, exclusion ni /expression/, la saisie est cherchée telle quelle, espaces et
  // parenthèses comprises (« mot de passe », « f(x) »).
  if (!tokens.some((token) => token.type === 'op' || token.type === 'phrase' || token.type === 'or' || token.type === 'not' || token.type === 'regex')) return plain();

  let position = 0;
  const peek = (): Token | undefined => tokens[position];
  const parseOr = (caseSensitive: boolean): SearchNode => {
    const alternatives = [parseAnd(caseSensitive)];
    while (peek()?.type === 'or') {
      position += 1;
      alternatives.push(parseAnd(caseSensitive));
    }
    return alternatives.length === 1 ? alternatives[0]! : { kind: 'or', alternatives };
  };
  const parseAnd = (caseSensitive: boolean): SearchNode => {
    const items: Array<{ negate: boolean; node: SearchNode }> = [];
    while (peek() && peek()!.type !== 'or' && peek()!.type !== 'close') {
      const negate = peek()!.type === 'not';
      if (negate) position += 1;
      if (!peek()) break;
      items.push({ negate, node: parseAtom(caseSensitive) });
    }
    if (!items.length) throw new Error('Terme manquant.');
    return items.length === 1 && !items[0]!.negate ? items[0]!.node : { kind: 'and', items };
  };
  /** Argument d'un opérateur : `(groupe)`, `"phrase"`, ou un mot collé. */
  const parseArgument = (arg: string, caseSensitive: boolean): SearchNode | null => {
    if (arg.startsWith('"')) return literal(arg.slice(1, -1), flags, caseSensitive);
    if (arg) return literal(arg, flags, caseSensitive);
    if (peek()?.type === 'open') return parseAtom(caseSensitive);
    return null;
  };
  const parseAtom = (caseSensitive: boolean): SearchNode => {
    const token = tokens[position++];
    if (!token) throw new Error('Terme manquant.');
    switch (token.type) {
      case 'word':
      case 'phrase':
        return literal(token.text, flags, caseSensitive);
      case 'regex':
        return { kind: 'term', regex: termRegex(token.source, caseSensitive && !token.flags.includes('i'), token.flags), label: `/${token.source}/${token.flags}`, type: 'regex', caseSensitive };
      case 'open': {
        const node = parseOr(caseSensitive);
        if (tokens[position++]?.type !== 'close') throw new Error('Parenthèse non fermée.');
        return node;
      }
      case 'op': {
        if (token.name === 'match-case' || token.name === 'ignore-case') {
          const node = parseArgument(token.arg, token.name === 'match-case');
          if (!node) throw new Error('Terme manquant : écrivez par exemple match-case:Mot.');
          return node;
        }
        if (token.name === 'tag') {
          const tag = token.arg.replace(/^"|"$/g, '').replace(/^#/, '');
          if (!tag) throw new Error('Étiquette manquante : écrivez par exemple tag:#projet.');
          const source = `(?<![\\p{L}\\p{N}_/#-])#${escape(tag)}(?:/[\\p{L}\\p{N}_/-]*)?(?![\\p{L}\\p{N}_-])`;
          return { kind: 'term', regex: termRegex(source, caseSensitive), label: `#${tag}`, type: 'tag', caseSensitive };
        }
        const scope = token.name as SearchScope;
        const inner = parseArgument(token.arg, caseSensitive);
        if (!inner && (scope === 'line' || scope === 'section')) throw new Error('Termes manquants : écrivez par exemple line:(a b).');
        return { kind: 'scope', scope, inner };
      }
      default:
        throw new Error('Saisie incomplète.');
    }
  };

  try {
    const node = parseOr(flags.caseSensitive);
    if (position < tokens.length) throw new Error('Parenthèse fermante en trop.');
    // Que des exclusions (« -5 ») : rien à surligner, c'est sans doute le texte lui-même qu'on cherche.
    if (node.kind === 'and' && node.items.every((item) => item.negate)) return plain();
    return { node, error: null, single: node.kind === 'term' ? node.regex : null, advanced: true };
  } catch (error) {
    // Messages fixes (traduits dans l'interface) ; une expression régulière fautive a le sien.
    const message = error instanceof SyntaxError ? 'Expression régulière invalide.' : error instanceof Error ? error.message : 'Saisie incomplète.';
    return { ...empty, error: message, advanced: true };
  }
}

interface Context {
  text: string;
  lines: SearchLine[];
}

/** Lignes d'un texte entre `from` et `to`. */
function linesIn(context: Context, from: number, to: number): SearchLine[] {
  return context.lines.filter((line) => line.to >= from && line.from <= to);
}

/** Sections : du début (ou d'un titre) jusqu'au titre suivant. */
function sections(context: Context): Array<{ from: number; to: number }> {
  const starts = [0, ...context.lines.filter((line) => line.heading > 0 && line.from > 0).map((line) => line.from)];
  return starts.map((start, index) => ({ from: start, to: index + 1 < starts.length ? starts[index + 1]! - 1 : context.text.length }));
}

function trimRange(text: string, from: number, to: number): SearchMatch | null {
  while (from < to && /\s/.test(text[from]!)) from += 1;
  while (to > from && /\s/.test(text[to - 1]!)) to -= 1;
  return to > from ? { from, to } : null;
}

/** Résultats d'un nœud entre `from` et `to` ; `null` quand il n'est pas satisfait. */
function evaluate(node: SearchNode, context: Context, from: number, to: number): SearchMatch[] | null {
  switch (node.kind) {
    case 'term': {
      const found: SearchMatch[] = [];
      const slice = context.text.slice(from, to);
      node.regex.lastIndex = 0;
      for (const match of slice.matchAll(node.regex)) {
        if (!match[0].length) continue;
        found.push({ from: from + match.index, to: from + match.index + match[0].length });
        if (found.length >= SEARCH_LIMIT) break;
      }
      return found.length ? found : null;
    }
    case 'and': {
      const found: SearchMatch[] = [];
      for (const item of node.items) {
        const result = evaluate(item.node, context, from, to);
        if (item.negate) {
          if (result) return null;
          continue;
        }
        if (!result) return null;
        found.push(...result);
      }
      return found;
    }
    case 'or': {
      const found = node.alternatives.map((alternative) => evaluate(alternative, context, from, to)).filter((result): result is SearchMatch[] => result !== null);
      return found.length ? found.flat() : null;
    }
    case 'scope': {
      let ranges: Array<{ from: number; to: number }>;
      if (node.scope === 'section') ranges = sections(context);
      else if (node.scope === 'line') ranges = linesIn(context, from, to);
      else {
        const wanted = node.scope === 'task-todo' ? 'todo' : node.scope === 'task-done' ? 'done' : null;
        ranges = linesIn(context, from, to)
          .filter((line) => line.task !== null && (wanted === null || line.task === wanted))
          .map((line) => ({ from: line.contentFrom, to: line.to }));
      }
      const found: SearchMatch[] = [];
      let satisfied = false;
      for (const range of ranges) {
        const start = Math.max(range.from, from);
        const end = Math.min(range.to, to);
        if (end < start) continue;
        const result = node.inner ? evaluate(node.inner, context, start, end) : [];
        if (result === null) continue;
        satisfied = true;
        if (result.length) found.push(...result);
        else {
          const whole = trimRange(context.text, start, end);
          if (whole) found.push(whole);
        }
      }
      return satisfied ? found : null;
    }
  }
}

/** Résultats d'une recherche dans un texte découpé en lignes, triés et sans chevauchement. */
export function runNoteSearch(parsed: ParsedSearch, text: string, lines: SearchLine[]): SearchMatch[] {
  if (!parsed.node) return [];
  const found = evaluate(parsed.node, { text, lines }, 0, text.length) ?? [];
  found.sort((a, b) => a.from - b.from || b.to - a.to);
  const matches: SearchMatch[] = [];
  for (const match of found) {
    if (matches.length && match.from < matches.at(-1)!.to) continue;
    matches.push(match);
    if (matches.length >= SEARCH_LIMIT) break;
  }
  return matches;
}

const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s?)/;
const HEADING = /^ {0,3}(#{1,6})(?:\s|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Lignes d'un source Markdown : tâches et titres reconnus, sauf dans les blocs de code. */
export function markdownLines(text: string): SearchLine[] {
  const lines: SearchLine[] = [];
  let offset = 0;
  let fence: string | null = null;
  for (const raw of text.split('\n')) {
    const from = offset;
    const to = offset + raw.length;
    offset = to + 1;
    const marker = FENCE.exec(raw)?.[1];
    if (fence) {
      if (marker?.startsWith(fence[0]!) && marker.length >= fence.length) fence = null;
      lines.push({ from, to, contentFrom: from, task: null, heading: 0 });
      continue;
    }
    if (marker) fence = marker;
    const task = TASK.exec(raw);
    const heading = HEADING.exec(raw);
    lines.push({
      from,
      to,
      contentFrom: task ? from + task[1]!.length : from,
      task: task ? (task[2] === ' ' ? 'todo' : 'done') : null,
      heading: heading ? heading[1]!.length : 0,
    });
  }
  return lines;
}

/** La saisie contient de la syntaxe Markdown, qu'on ne trouve que dans le source. */
export function searchHasMarkdown(input: string): boolean {
  return /\*\*|__|~~|==|`|\[\[|\]\]|\]\(|^\s*#{1,6}\s|^\s*>|(^|\s)[*_][^\s*_]/.test(input);
}
