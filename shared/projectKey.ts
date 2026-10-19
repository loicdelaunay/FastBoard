/** Propose une clé de projet (préfixe des tickets, ex. « RS-12 ») à partir de son nom. */
export function suggestProjectKey(name: string): string {
  const cleaned = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  const key = words.length > 1 ? words.map((word) => word[0]).join('') : (words[0] ?? '').slice(0, 4);
  return key.slice(0, 6);
}
