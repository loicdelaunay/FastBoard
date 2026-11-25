/**
 * Blocs de code délimités d'un texte Markdown (```lang … ```, ~~~ aussi), y compris dans une citation ou une liste :
 * de quoi retrouver, depuis le rendu, le bloc d'où vient un code, et changer son langage dans le texte.
 */

export interface CodeFence {
  /** Début de la ligne d'ouverture. */
  from: number;
  /** Fin du bloc (après la clôture, ou fin du texte si le bloc n'est pas fermé). */
  to: number;
  /** Langage écrit (premier mot après la clôture d'ouverture), en minuscules ; vide sans langage. */
  lang: string;
  /** Ce qui suit la clôture d'ouverture sur sa ligne (langage et éventuels attributs). */
  infoFrom: number;
  infoTo: number;
  /** Code, tel que le rendu l'affiche : sans les marques de citation ni le retrait du bloc. */
  content: string;
}

const OPEN = /^((?:[ \t]*>)*)([ \t]*)(`{3,}|~{3,})(.*)$/;

/** Retire d'une ligne de contenu les marques de citation du bloc puis, au plus, son retrait. */
function contentLine(line: string, quotes: number, indent: number): string {
  let rest = line;
  for (let count = 0; count < quotes; count += 1) {
    const quote = /^[ \t]*>[ ]?/.exec(rest);
    if (!quote) break;
    rest = rest.slice(quote[0].length);
  }
  let removed = 0;
  while (removed < indent && (rest[0] === ' ' || rest[0] === '\t')) {
    rest = rest.slice(1);
    removed += 1;
  }
  return rest;
}

export function codeFences(text: string): CodeFence[] {
  const fences: CodeFence[] = [];
  const lines = text.split('\n');
  let offset = 0;
  let open: { fence: CodeFence; marker: string; quotes: number; indent: number; lines: string[] } | null = null;
  for (const line of lines) {
    const start = offset;
    offset += line.length + 1;
    if (open) {
      const body = contentLine(line, open.quotes, Number.MAX_SAFE_INTEGER);
      const closing = new RegExp(`^${open.marker[0] === '`' ? '`' : '~'}{${open.marker.length},}[ \\t]*$`);
      if (closing.test(body)) {
        open.fence.to = start + line.length;
        open.fence.content = open.lines.join('\n');
        fences.push(open.fence);
        open = null;
      } else open.lines.push(contentLine(line, open.quotes, open.indent));
      continue;
    }
    const match = OPEN.exec(line);
    if (!match) continue;
    const [, quotes = '', indent = '', marker = '', info = ''] = match;
    // Une clôture en accents graves n'a pas d'accent grave dans son texte d'information.
    if (marker[0] === '`' && info.includes('`')) continue;
    const infoFrom = start + quotes.length + indent.length + marker.length;
    open = {
      fence: { from: start, to: start + line.length, lang: (info.trim().split(/\s+/)[0] ?? '').toLowerCase(), infoFrom, infoTo: start + line.length, content: '' },
      marker,
      quotes: (quotes.match(/>/g) ?? []).length,
      indent: indent.replace(/\t/g, '    ').length,
      lines: [],
    };
  }
  if (open) {
    open.fence.to = text.length;
    open.fence.content = open.lines.join('\n').replace(/\n$/, '');
    fences.push(open.fence);
  }
  return fences;
}

/** Blocs écrits avec ce langage et ce code (dans l'ordre du texte). */
export function matchingFences(text: string, lang: string, code: string): CodeFence[] {
  const wanted = code.replace(/\n$/, '');
  return codeFences(text).filter((fence) => fence.lang === lang.trim().toLowerCase() && fence.content.replace(/\n$/, '') === wanted);
}

/** Change le langage d'un bloc (`next` vide : plus de langage) ; les attributs qui suivent le langage restent. */
export function fenceLanguageChange(text: string, fence: CodeFence, next: string): { from: number; to: number; insert: string } {
  const info = text.slice(fence.infoFrom, fence.infoTo).trim();
  const rest = info.replace(/^\S*/, '');
  // Sans langage mais avec des attributs, le premier attribut passerait pour le langage : « text » le garde à sa place.
  const insert = next ? `${next}${rest}` : rest.trim() ? `text${rest}` : '';
  return { from: fence.infoFrom, to: fence.infoTo, insert };
}
