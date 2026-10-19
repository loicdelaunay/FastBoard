/** Normalise un texte pour la recherche : minuscules, sans accents. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Tous les mots de la requête doivent apparaître (dans n'importe quel champ). */
export function matchesQuery(query: string, fields: Array<string | null | undefined>): boolean {
  const tokens = normalizeText(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return true;
  }
  const haystack = normalizeText(fields.filter(Boolean).join(' \n '));
  return tokens.every((token) => haystack.includes(token));
}
