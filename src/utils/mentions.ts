/**
 * Mentions dans les textes libres (description, commentaires) :
 * `@[Alice Martin](user:12)` pour une personne, `@[APP-12](ticket:34)` pour un ticket, `@[Note](doc:56)` pour un fichier
 * de documentation, `@[Architecture](board:7)` pour un tableau blanc (avec son affichage au besoin : `board:7#image`).
 * Le nom entre crochets est celui du moment de la saisie ; l'affichage utilise le nom à jour quand il est connu.
 */

import { MENTION_VIEW_SUFFIX, type BoardMentionView } from '@shared/boards';

export type MentionKind = 'user' | 'ticket' | 'doc' | 'board';

export type TextSegment =
  | { type: 'text'; text: string }
  /** `suffix` : ce qui suit le `#` (lignes citées d'une note, éléments cités d'un tableau…). */
  | { type: 'mention'; kind: MentionKind | 'project'; id: number; label: string; suffix: string }
  | { type: 'link'; url: string };

const MENTION = new RegExp(String.raw`@\[([^\]\n]{1,80})\]\((user|ticket|doc|board|project):(\d+)${MENTION_VIEW_SUFFIX}\)`, 'g');
const URL = /\bhttps?:\/\/[^\s<>"')\]]+/g;

/** `view` : affichage d'un tableau blanc (`image`, `embed`, `link`) ; absent, il s'affiche en carte ou en lien. */
/** `suffix` : ce qui suit le `#` (version étiquetée `v:345`…) ; il l'emporte sur l'affichage d'un tableau. */
export function mentionToken(kind: MentionKind, id: number, label: string, view?: BoardMentionView | null, suffix?: string): string {
  const after = suffix ? `#${suffix}` : kind === 'board' && view && view !== 'card' ? `#${view}` : '';
  return `@[${label.replace(/[[\]\n]/g, ' ').trim().slice(0, 80)}](${kind}:${id}${after})`;
}

function splitLinks(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(URL)) {
    if (match.index > last) segments.push({ type: 'text', text: text.slice(last, match.index) });
    segments.push({ type: 'link', url: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ type: 'text', text: text.slice(last) });
  return segments;
}

/** Découpe un texte en morceaux : texte brut, mentions et liens. */
export function parseRichText(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(MENTION)) {
    if (match.index > last) segments.push(...splitLinks(text.slice(last, match.index)));
    segments.push({ type: 'mention', kind: match[2] as MentionKind | 'project', id: Number(match[3]), label: match[1]!, suffix: match[4] ?? '' });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push(...splitLinks(text.slice(last)));
  return segments;
}

/** Texte lisible sans balisage des mentions (aperçus, PDF, recherche). */
export function plainText(text: string): string {
  return text.replace(MENTION, (_all, label: string) => `@${label}`);
}

/** Mention en cours de saisie juste avant le curseur : `@` en début de mot suivi d'au plus 30 caractères. */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|[\s(])@([^\s@[\]()]{0,30})$/.exec(before);
  if (!match) return null;
  return { start: caret - match[2]!.length - 1, query: match[2]! };
}
