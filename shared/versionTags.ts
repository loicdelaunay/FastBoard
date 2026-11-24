/**
 * Étiquettes de versions : une version d'une note ou d'un tableau blanc reçoit un nom (« v1.0 », « Validé client »),
 * unique pour cet élément ; elle n'est alors jamais effacée de l'historique, et se cite avec `@` :
 * `@[Guide · v1.0](doc:12#v:345)`, `@[Architecture · v2](board:7#v:88)`.
 */

export const VERSION_TAG_LIMITS = { nameMax: 60, searchResults: 12 } as const;

/** Nom d'étiquette nettoyé (espaces resserrés), ou `null` s'il est vide. */
export function cleanTagName(raw: string): string | null {
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, VERSION_TAG_LIMITS.nameMax);
  return name || null;
}

/** Étiquette trouvée par la recherche (`@`). */
export interface VersionTagHitDTO {
  kind: 'doc' | 'board';
  /** Note ou tableau. */
  id: number;
  versionId: number;
  tag: string;
  title: string;
  spaceName: string;
  createdAt: string;
}
