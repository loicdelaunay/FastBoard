import { docBaseName, docParent, type DocNodeDTO } from './docs.ts';

/**
 * Liens entre fichiers d'un espace, tels qu'on les écrit dans Obsidian : liens wiki `[[Note]]`, `[[Note|Texte]]`,
 * images `![[schema.png]]`, et liens Markdown relatifs à la note.
 */

const WIKI = /(!?)\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]+))?\]\]/g;
/** Blocs et portions de code, où rien ne doit être réécrit. */
const CODE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g;

const encodePath = (path: string): string => path.split('/').map(encodeURIComponent).join('/');

/** Transforme les liens wiki en liens Markdown ordinaires, en laissant le code intact. */
export function expandWikiLinks(text: string): string {
  return text
    .split(CODE)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(WIKI, (_all, image: string, target: string, label: string | undefined) => {
            const name = target.trim();
            return image ? `![${label?.trim() ?? name}](${encodePath(name)})` : `[${(label ?? name).trim()}](${encodePath(name)})`;
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

/** Fichier visé par un lien écrit dans `fromPath` : à côté de la note, depuis la racine, ou par son seul nom. */
export function resolveDocLink(nodes: readonly DocNodeDTO[], fromPath: string, link: string): DocNodeDTO | undefined {
  let target: string;
  try {
    target = decodeURIComponent(link).split('#')[0]!.split('?')[0]!;
  } catch {
    return undefined;
  }
  if (!target) return undefined;
  const files = nodes.filter((node) => node.kind !== 'folder');
  const same = (candidate: string) => (node: DocNodeDTO) => {
    const path = node.path.toLowerCase();
    const wanted = candidate.toLowerCase();
    return path === wanted || path === `${wanted}.md`;
  };
  const beside = withoutDots(`${docParent(fromPath)}/${target}`);
  const byName = (node: DocNodeDTO) => same(docBaseName(target))({ ...node, path: docBaseName(node.path) });
  return files.find(same(beside)) ?? files.find(same(withoutDots(target))) ?? files.find(byName);
}

/** Ce qu'une note cite : chemins écrits tels quels, à résoudre au moment de la lecture, et mentions par identifiant. */
export interface DocLinkTargets {
  paths: string[];
  docs: number[];
  tickets: number[];
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
  return { paths: [...paths], docs: mentioned('doc'), tickets: mentioned('ticket') };
}

/** Texte à insérer pour une image rangée dans `imagePath`, depuis la note `notePath`. */
export function imageMarkdown(notePath: string, imagePath: string): string {
  const folder = docParent(notePath);
  const relative = folder && imagePath.startsWith(`${folder}/`) ? imagePath.slice(folder.length + 1) : imagePath;
  return `![${docBaseName(imagePath)}](${encodePath(relative)})`;
}
