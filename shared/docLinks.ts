import { docBaseName, docParent, type DocNodeDTO } from './docs.ts';

/**
 * Liens entre fichiers d'un espace, tels qu'on les écrit dans Obsidian : liens wiki `[[Note]]`, `[[Note|Texte]]`,
 * images `![[schema.png]]`, et liens Markdown relatifs à la note.
 */

const WIKI = /(!?)\[\[([^\]|#\n]*)(#[^\]|\n]*)?(?:\|([^\]\n]+))?\]\]/g;
/** Blocs et portions de code, où rien ne doit être réécrit. */
const CODE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g;

const encodePath = (path: string): string => path.split('/').map(encodeURIComponent).join('/');

/** Applique `change` au texte hors du code (blocs et portions), où rien ne doit être réécrit. */
export function mapOutsideCode(text: string, change: (part: string) => string): string {
  return text
    .split(CODE)
    .map((part, index) => (index % 2 === 1 ? part : change(part)))
    .join('');
}

/** Forme comparable d'un titre, pour les liens `[[Note#Titre]]`. */
export function headingKey(text: string): string {
  return text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Titre réduit à ses lettres et chiffres : `#1.1.1^UAV^OAT`, `#uav-oat` ou `#UAV%20OAT` retrouvent leur titre. */
export function anchorKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Position, dans `titles`, du titre visé par une ancre : à l'identique d'abord, puis aux lettres et chiffres près. */
export function findHeading(titles: readonly string[], anchor: string): number {
  const exact = headingKey(anchor);
  const found = titles.findIndex((title) => headingKey(title) === exact);
  if (found >= 0) return found;
  const loose = anchorKey(anchor);
  return loose ? titles.findIndex((title) => anchorKey(title) === loose) : -1;
}

/** Transforme les liens wiki en liens Markdown ordinaires, en laissant le code intact. */
export function expandWikiLinks(text: string): string {
  return text
    .split(CODE)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(WIKI, (all, image: string, target: string, heading: string | undefined, label: string | undefined) => {
            const name = target.trim();
            const anchor = heading && heading.length > 1 ? `#${encodeURIComponent(heading.slice(1).trim())}` : '';
            if (!name && !anchor) return all;
            if (image) return `![${label?.trim() ?? name}](${encodePath(name)})`;
            return `[${(label ?? (name ? `${name}${heading ? ` › ${heading.slice(1).trim()}` : ''}` : heading!.slice(1))).trim()}](${encodePath(name)}${anchor})`;
          }),
    )
    .join('');
}

function withoutDots(path: string): string {
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '..') segments.pop();
    else if (segment && segment !== '.') segments.push(segment);
  }
  return segments.join('/');
}

/** Nombre de dossiers en commun au début de deux chemins. */
function sharedFolders(a: string, b: string): number {
  const left = docParent(a).split('/');
  const right = docParent(b).split('/');
  let count = 0;
  while (count < left.length && count < right.length && left[count] && left[count] === right[count]) count += 1;
  return count;
}

/**
 * Fichier visé par un lien écrit dans `fromPath`, comme le fait Obsidian : à côté de la note, depuis la racine, puis
 * n'importe où dans l'espace pourvu que la fin du chemin corresponde (`Pictures/schema.png`), et enfin par son seul
 * nom. Entre homonymes, le plus proche de la note l'emporte.
 */
export function resolveDocLink(nodes: readonly DocNodeDTO[], fromPath: string, link: string): DocNodeDTO | undefined {
  let target: string;
  try {
    target = decodeURIComponent(link).split('#')[0]!.split('?')[0]!;
  } catch {
    return undefined;
  }
  if (!target) return undefined;
  const files = nodes.filter((node) => node.kind !== 'folder');
  const matches = (path: string, wanted: string): boolean => {
    const lower = path.toLowerCase();
    return lower === wanted || lower === `${wanted}.md`;
  };
  const endsWith = (path: string, wanted: string): boolean => {
    const lower = path.toLowerCase();
    return lower.endsWith(`/${wanted}`) || lower.endsWith(`/${wanted}.md`);
  };
  const closest = (list: DocNodeDTO[]): DocNodeDTO | undefined =>
    list.sort((a, b) => sharedFolders(b.path, fromPath) - sharedFolders(a.path, fromPath) || a.path.length - b.path.length || a.path.localeCompare(b.path))[0];
  const relative = withoutDots(target).toLowerCase();
  const beside = withoutDots(`${docParent(fromPath)}/${target}`).toLowerCase();
  const name = docBaseName(relative);
  return (
    files.find((node) => matches(node.path, beside)) ??
    files.find((node) => matches(node.path, relative)) ??
    closest(files.filter((node) => endsWith(node.path, relative))) ??
    closest(files.filter((node) => matches(docBaseName(node.path), name)))
  );
}

/** Ce qu'une note cite : chemins écrits tels quels, à résoudre au moment de la lecture, et mentions par identifiant. */
export interface DocLinkTargets {
  paths: string[];
  docs: number[];
  tickets: number[];
  /** Absent des notes indexées avant la 2.4. */
  boards?: number[];
}

/** Liens et mentions d'une note, hors du code ; les images n'en sont pas. */
export function extractDocLinks(text: string): DocLinkTargets {
  const plain = expandWikiLinks(text)
    .split(CODE)
    .filter((_part, index) => index % 2 === 0)
    .join(' ');
  const paths = new Set<string>();
  for (const match of plain.matchAll(/(?<![!@])\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"\n]*")?\)/g)) {
    if (!/^([a-z][a-z0-9+.-]*:|#)/i.test(match[1]!)) paths.add(match[1]!);
  }
  const mentioned = (kind: string): number[] => [...new Set([...plain.matchAll(new RegExp(`@\\[[^\\]\\n]{1,80}\\]\\(${kind}:(\\d+)\\)`, 'g'))].map((match) => Number(match[1])))];
  return { paths: [...paths], docs: mentioned('doc'), tickets: mentioned('ticket'), boards: mentioned('board') };
}

/** Texte alternatif d'une image et sa taille à la manière d'Obsidian : `![[x.png|300]]`, `![Légende|300x200](x.png)`. */
export function imageSize(alt: string): { alt: string; width: number | null; height: number | null } {
  const match = /^(?:(.*)\|)?\s*(\d{1,4})(?:\s*x\s*(\d{1,4}))?\s*$/.exec(alt);
  if (!match) return { alt, width: null, height: null };
  return { alt: (match[1] ?? '').trim(), width: Number(match[2]), height: match[3] ? Number(match[3]) : null };
}

/** Texte à insérer pour une image rangée dans `imagePath`, depuis la note `notePath`. */
export function imageMarkdown(notePath: string, imagePath: string): string {
  const folder = docParent(notePath);
  const relative = folder && imagePath.startsWith(`${folder}/`) ? imagePath.slice(folder.length + 1) : imagePath;
  return `![${docBaseName(imagePath)}](${encodePath(relative)})`;
}
