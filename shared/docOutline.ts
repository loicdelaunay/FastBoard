import { plainText } from './docComments.ts';

/** Sommaire d'une note : ses titres et sous-titres, lus directement dans le source pour suivre la frappe sans ralentir. */

export interface DocHeading {
  /** De 1 à 6. */
  level: number;
  title: string;
  /** Ligne du titre dans le source, à partir de 1. */
  line: number;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
/** Ce qui ne peut pas être le texte d'un titre souligné : la ligne n'est pas un paragraphe. */
const NOT_PARAGRAPH = /^\s*$|^ {0,3}(?:#{1,6}(?:\s|$)|>|[-*+]\s|\d+[.)]\s|\||`{3}|~{3})/;

function cleanTitle(raw: string): string {
  const unlinked = raw.replace(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g, (_match, target: string, label?: string) => label ?? target);
  return plainText(unlinked).trim();
}

export function docOutline(text: string): DocHeading[] {
  const lines = text.split('\n');
  const headings: DocHeading[] = [];
  const add = (level: number, raw: string, line: number): void => {
    const title = cleanTitle(raw);
    if (title) headings.push({ level, title, line });
  };
  let fence: string | null = null;
  lines.forEach((raw, index) => {
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
