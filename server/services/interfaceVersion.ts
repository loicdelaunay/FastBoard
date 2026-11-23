import fs from 'node:fs';

/**
 * Version de l'interface que ce serveur sert (celle notée dans `index.html` à sa construction). Elle peut différer de la
 * version du serveur quand l'interface n'a pas été reconstruite après une mise à jour : recharger la page n'y change
 * alors rien, et le message « Mise à jour disponible » le dit au lieu de proposer un rechargement sans fin.
 */

const META = /<meta\s+name="fastboard-version"\s+content="([^"]*)"/i;

/** Version notée dans une page d'accueil ; vide si elle a été construite avant qu'on la note. */
export function interfaceVersionOf(html: string): string {
  return META.exec(html)?.[1] ?? '';
}

let source: { file: string } | { html: string } | null = null;
let cached: { mtimeMs: number; version: string } | null = null;

/** Déclare d'où vient l'interface servie : un fichier (relu s'il change), une page embarquée, ou rien (développement). */
export function serveInterfaceFrom(next: { file: string } | { html: string } | null): void {
  source = next;
  cached = null;
}

/** `null` : ce serveur ne sert pas l'interface (développement) ; vide : interface construite avant la 2.16.1. */
export function servedInterfaceVersion(): string | null {
  if (!source) return null;
  if ('html' in source) return interfaceVersionOf(source.html);
  try {
    const { mtimeMs } = fs.statSync(source.file);
    if (cached?.mtimeMs !== mtimeMs) cached = { mtimeMs, version: interfaceVersionOf(fs.readFileSync(source.file, 'utf8')) };
    return cached.version;
  } catch {
    return null;
  }
}
