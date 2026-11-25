import { anchorKey, findHeading } from './docLinks.ts';
import type { DocHeading } from './docOutline.ts';

/**
 * Ancre d'adresse d'un endroit d'une note : le titre au-dessus, à la façon de GitHub (`#etape-2`, `#installation-1`
 * pour le deuxième « Installation »), suivi du décalage en lignes (`#etape-2+12`) ; `#L57` quand aucun titre ne précède,
 * rien tout en haut de la note. Elle sert à revenir au même endroit et à partager un lien qui y mène.
 */

/** Titre réduit pour une adresse : minuscules sans accents, mots séparés par des tirets. */
export function headingSlug(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/** Ancre du titre `index` : son identifiant (`{#id}`) s'il en a, sinon son texte, numéroté s'il revient plusieurs fois. */
function headingAnchor(headings: readonly DocHeading[], index: number): string {
  const heading = headings[index]!;
  if (heading.ids?.[0]) return heading.ids[0];
  const slug = headingSlug(heading.title);
  if (!slug) return '';
  const key = anchorKey(heading.title);
  const before = headings.slice(0, index).filter((other) => anchorKey(other.title) === key).length;
  return before ? `${slug}-${before}` : slug;
}

/** Ancre (sans `#`) de la ligne `line` du source, décimale pour une partie de ligne ; vide en haut de la note. */
export function lineAnchor(headings: readonly DocHeading[], line: number): string {
  const top = Math.max(1, Math.round(line * 10) / 10);
  if (top < 1.5) return '';
  const index = headings.findLastIndex((heading) => heading.line <= top);
  const anchor = index >= 0 ? headingAnchor(headings, index) : '';
  if (!anchor) return `L${Math.floor(top)}`;
  const offset = Math.round((top - headings[index]!.line) * 10) / 10;
  return offset > 0 ? `${anchor}+${offset}` : anchor;
}

/** Ligne du source visée par une ancre (`#etape-2+12`, `#L57`, un titre écrit à la main…), ou `null`. */
export function anchorLine(headings: readonly DocHeading[], anchor: string): number | null {
  let raw = anchor.replace(/^#/, '');
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // Ancre mal encodée : prise telle quelle.
  }
  if (!raw) return null;
  const absolute = /^L(\d+(?:\.\d+)?)$/.exec(raw);
  if (absolute) return Number(absolute[1]);
  const [, target = raw, offset] = /^(.+?)(?:\+(\d+(?:\.\d+)?))?$/.exec(raw) ?? [];
  const index = findHeading(
    headings.map((heading) => heading.title),
    target,
    headings.map((heading) => heading.ids),
  );
  return index < 0 ? null : headings[index]!.line + Number(offset ?? 0);
}
