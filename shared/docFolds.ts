import { headingKey } from './docLinks.ts';
import { headingTitle } from './docOutline.ts';

/**
 * Titres repliés d'une note, façon Obsidian : un titre replié cache tout ce qui le suit jusqu'au prochain titre de même
 * niveau ou plus haut. Un titre se reconnaît par sa clé (niveau, titre normalisé comme `data-heading`, rang parmi les
 * titres identiques) : la même en lecture et dans le source, et qui survit aux modifications du reste du texte.
 */

/** Clé du titre ; `seen` compte les titres déjà vus (à partager pour toute la note, dans l'ordre). */
export function foldKeyOf(depth: number, normalized: string, seen: Map<string, number>): string {
  const base = `${depth}|${normalized}`;
  const rank = seen.get(base) ?? 0;
  seen.set(base, rank + 1);
  return `${base}|${rank}`;
}

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;

/** Niveau et titre normalisé d'une ligne `## Titre` du source, ou `null`. */
export function sourceHeading(line: string): { depth: number; normalized: string } | null {
  const match = ATX.exec(line);
  if (!match) return null;
  return { depth: match[1]!.length, normalized: headingKey(headingTitle(match[2] ?? '').title) };
}

/**
 * Pour une suite de blocs (titres avec leur niveau et leur clé, autres blocs sans niveau), ceux qui sont cachés par un
 * titre replié au-dessus d'eux. Un titre caché garde son propre état : on le retrouve en dépliant son parent.
 */
export function hiddenByFolds(blocks: ReadonlyArray<{ depth: number | null; key?: string }>, folded: ReadonlySet<string>): boolean[] {
  let hidingBelow: number | null = null;
  return blocks.map((block) => {
    if (block.depth !== null) {
      if (hidingBelow !== null && block.depth <= hidingBelow) hidingBelow = null;
      const hidden = hidingBelow !== null;
      if (!hidden && block.key && folded.has(block.key)) hidingBelow = block.depth;
      return hidden;
    }
    return hidingBelow !== null;
  });
}
