import { plainText } from './docComments.ts';

/** Sommaire d'une note : ses titres et sous-titres, lus directement dans le source pour suivre la frappe sans ralentir. */

export interface DocHeading {
  /** De 1 à 6. */
  level: number;
  title: string;
  /** Ligne du titre dans le source, à partir de 1. */
  line: number;
  /** Identifiants donnés au titre, `{#id}` à la fin ou `<a id="…">` : des liens `#id` y mènent. */
  ids?: string[];
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
/** Ce qui ne peut pas être le texte d'un titre souligné : la ligne n'est pas un paragraphe. */
const NOT_PARAGRAPH = /^\s*$|^ {0,3}(?:#{1,6}(?:\s|$)|>|[-*+]\s|\d+[.)]\s|\||`{3}|~{3})/;

/**
 * Texte lisible d'un titre et ses identifiants : la numérotation reste (« 1. Disponibilité »), un `{#id}` final et les
 * ancres HTML `<a id="…">` deviennent des identifiants, les autres balises HTML disparaissent.
 */
export function headingTitle(raw: string): { title: string; ids: string[] } {
  const ids: string[] = [];
  const text = raw
    .replace(/[ \t]*\{#([^\s{}]+)[^{}]*\}[ \t]*$/, (_match, id: string) => {
      ids.push(id);
      return '';
    })
    .replace(/<a\s[^>]*?\b(?:id|name)\s*=\s*["']?([^"'\s>]+)["']?[^>]*>/gi, (_match, id: string) => {
      ids.push(id);
      return '';
    })
    .replace(/<\/?[a-z][^<>]*>/gi, '')
    .replace(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g, (_match, target: string, label?: string) => label ?? target);
  return { title: plainText(text, true).trim(), ids };
}

export function docOutline(text: string): DocHeading[] {
  const lines = text.split('\n');
  const headings: DocHeading[] = [];
  const add = (level: number, raw: string, line: number): void => {
    const { title, ids } = headingTitle(raw);
    if (title) headings.push({ level, title, line, ...(ids.length ? { ids } : {}) });
  };
  let fence: string | null = null;
  // Propriétés en tête de note (---…---) : ni filet ni titre souligné.
  const front = /^﻿?---\s*$/.test(lines[0] ?? '') ? lines.findIndex((entry, index) => index > 0 && /^---\s*$/.test(entry)) : -1;
  lines.forEach((raw, index) => {
    if (index <= front) return;
    const line = raw.replace(/\r$/, '');
    const marker = FENCE.exec(line)?.[1];
    if (fence) {
      if (marker?.startsWith(fence[0]!) && marker.length >= fence.length && line.trim() === marker) fence = null;
      return;
    }
    if (marker) {
      fence = marker;
      return;
    }
    const heading = ATX.exec(line);
    if (heading) {
      add(heading[1]!.length, heading[2] ?? '', index + 1);
      return;
    }
    const underline = SETEXT.exec(line)?.[1];
    const above = lines[index - 1]?.replace(/\r$/, '');
    if (underline && above !== undefined && !NOT_PARAGRAPH.test(above)) add(underline.startsWith('=') ? 1 : 2, above, index);
  });
  return headings;
}
