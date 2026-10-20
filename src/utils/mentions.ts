/**
 * Mentions dans les textes libres (description, commentaires) :
 * `@[Alice Martin](user:12)` pour une personne, `@[APP-12](ticket:34)` pour un ticket.
 * Le nom entre crochets est celui du moment de la saisie ; l'affichage utilise le nom à jour quand il est connu.
 */

export type MentionKind = 'user' | 'ticket';

export type TextSegment =
  | { type: 'text'; text: string }
  | { type: 'mention'; kind: MentionKind; id: number; label: string }
  | { type: 'link'; url: string };

const MENTION = /@\[([^\]\n]{1,80})\]\((user|ticket):(\d+)\)/g;
const URL = /\bhttps?:\/\/[^\s<>"')\]]+/g;

export function mentionToken(kind: MentionKind, id: number, label: string): string {
  return `@[${label.replace(/[[\]\n]/g, ' ').trim().slice(0, 80)}](${kind}:${id})`;
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
    segments.push({ type: 'mention', kind: match[2] as MentionKind, id: Number(match[3]), label: match[1]! });
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
