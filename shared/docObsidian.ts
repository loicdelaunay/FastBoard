import { expandWikiLinks, headingKey, mapOutsideCode } from './docLinks.ts';
import { docOutline } from './docOutline.ts';

/**
 * Syntaxe d'Obsidian que le Markdown ordinaire ne connaît pas, traitée avant le rendu : notes intégrées `![[Note]]`,
 * notes de bas de page, identifiants de bloc et propriétés en tête de note. Le HTML produit est assaini au rendu.
 */

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg)$/i;

/** `![[Note]]` qui n'est pas une image : la note s'intègre, son texte est chargé après le rendu. */
export function embeds(text: string): string {
  return mapOutsideCode(text, (part) =>
    part.replace(/!\[\[([^\]|#\n]+)(#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g, (all, target: string, heading: string | undefined) =>
      IMAGE_FILE.test(target.trim()) ? all : `<span class="md-embed" data-embed="${escapeHtml(target.trim() + (heading ?? ''))}"></span>`,
    ),
  );
}

/** Couleur des surlignages qui commencent par une bille ou un carré de couleur : `==🟢 Validé==`. */
const HIGHLIGHT_EMOJIS: Record<string, string> = {
  '🔴': 'red',
  '🟥': 'red',
  '🟠': 'orange',
  '🟧': 'orange',
  '🟡': 'yellow',
  '🟨': 'yellow',
  '🟢': 'green',
  '🟩': 'green',
  '🔵': 'blue',
  '🟦': 'blue',
  '🟣': 'purple',
  '🟪': 'purple',
  '🟤': 'brown',
  '🟫': 'brown',
  '⚫': 'black',
  '⬛': 'black',
  '⚪': 'white',
  '⬜': 'white',
};

/** Couleurs proposées, dans l'ordre. */
export const HIGHLIGHT_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'brown', 'black', 'white'] as const;

/** Couleur d'un surlignage d'après sa première bille emoji, ou `null` (jaune par défaut). */
export function highlightColor(text: string): string | null {
  const first = [...text.trimStart()][0];
  return first ? (HIGHLIGHT_EMOJIS[first] ?? null) : null;
}

/**
 * Longueur (en unités de `text`) de la bille de couleur qui ouvre un surlignage, avec ses espaces et sa variante
 * emoji : elle donne la couleur et ne s'affiche pas. 0 sans bille.
 */
export function highlightMarker(text: string): number {
  const match = /^\s*(\S)\uFE0F?\s*/u.exec(text);
  return match && HIGHLIGHT_EMOJIS[match[1]!] ? match[0].length : 0;
}

/** Notes de bas de page `[^1]` et `^[en ligne]`, numérotées dans l'ordre de leur premier appel, réunies en fin de note. */
export function footnotes(text: string): string {
  const definitions = new Map<string, string>();
  let body = mapOutsideCode(text, (part) =>
    part.replace(/^\[\^([^\]\s]+)\]:[ \t]?([^\n]*(?:\n(?: {2,}|\t)[^\n]*)*)/gm, (_all, id: string, value: string) => {
      definitions.set(id, value.replace(/\n(?: {2,}|\t)/g, ' '));
      return '';
    }),
  );
  let inline = 0;
  body = mapOutsideCode(body, (part) =>
    part.replace(/\^\[([^\]\n]+)\]/g, (_all, value: string) => {
      const id = `en-ligne-${++inline}`;
      definitions.set(id, value);
      return `[^${id}]`;
    }),
  );
  if (!definitions.size) return text;
  const order: string[] = [];
  body = mapOutsideCode(body, (part) =>
    part.replace(/\[\^([^\]\s]+)\](?!:)/g, (all, id: string) => {
      if (!definitions.has(id)) return all;
      if (!order.includes(id)) order.push(id);
      return `<sup class="md-fn-ref" data-fn-ref="${escapeHtml(id)}"><a href="#${encodeURIComponent(id)}" data-fn="${escapeHtml(id)}">${order.indexOf(id) + 1}</a></sup>`;
    }),
  );
  if (!order.length) return body;
  const items = order.map((id) => `1. <span data-fn-def="${escapeHtml(id)}"></span>${definitions.get(id)} <a href="#${encodeURIComponent(id)}" data-fn-back="${escapeHtml(id)}" class="md-fn-back">↩</a>`);
  return `${body.trimEnd()}\n\n<section class="md-footnotes">\n\n${items.join('\n')}\n\n</section>\n`;
}

/** Identifiants de bloc `^abc` : des repères pour les liens, invisibles à la lecture. */
export function blockIds(text: string): string {
  return mapOutsideCode(text, (part) => part.replace(/[ \t]\^[A-Za-z0-9-]+[ \t]*$/gm, '').replace(/^\^[A-Za-z0-9-]+[ \t]*$/gm, ''));
}

/** Propriétés en tête de note (YAML simple), présentées comme dans Obsidian. */
export function properties(text: string): string {
  const match = /^﻿?---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!match) return text;
  const rows: Array<[string, string[]]> = [];
  for (const line of match[1]!.split('\n')) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && rows.length) {
      rows.at(-1)![1].push(item[1]!);
      continue;
    }
    const pair = /^([^:#\s][^:]*):[ \t]*(.*)$/.exec(line);
    if (!pair) continue;
    const value = pair[2]!.trim();
    const list = /^\[(.*)\]$/.exec(value);
    rows.push([pair[1]!.trim(), list ? list[1]!.split(',') : value ? [value] : []]);
  }
  const clean = (value: string) => value.trim().replace(/^(["'])(.*)\1$/, '$2');
  const html = rows
    .map(([key, values]) => `<div class="md-property"><span class="md-property-key">${escapeHtml(key)}</span><span class="md-property-value">${values.map((value) => `<span>${escapeHtml(clean(value))}</span>`).join('') || '—'}</span></div>`)
    .join('');
  return `<div class="md-properties">${html}</div>\n\n${text.slice(match[0].length)}`;
}

/** Texte prêt pour le rendu : syntaxe d'Obsidian si l'espace l'accepte, puis liens wiki en liens ordinaires. */
export function prepareDocText(text: string, obsidian = false): string {
  return expandWikiLinks(obsidian ? properties(blockIds(footnotes(embeds(text)))) : text);
}

/** Section d'une note sous un titre, jusqu'au titre suivant de même niveau ou plus haut. */
export function sectionOf(text: string, heading: string): string {
  const headings = docOutline(text);
  const key = headingKey(heading);
  const index = headings.findIndex((entry) => headingKey(entry.title) === key);
  if (index < 0) return text;
  const start = headings[index]!;
  const end = headings.slice(index + 1).find((entry) => entry.level <= start.level);
  const lines = text.split('\n');
  return lines.slice(start.line - 1, end ? end.line - 1 : undefined).join('\n');
}
