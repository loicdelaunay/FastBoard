import { DOC_COMMENT_LIMITS, findQuote, type DocCommentDTO, type DocQuote } from '@shared/docComments';
import { ref } from 'vue';
import { findHeading, imageSize, resolveDocLink } from '@shared/docLinks';
import { prepareDocText, sectionOf } from '@shared/docObsidian';
import { docBaseName, docTitle, type DocNodeDTO } from '@shared/docs';
import type { UserSummaryDTO } from '@shared/types';
import { t } from '@/i18n';
import { escapeHtml, renderMarkdown, type MentionResolver } from '@/utils/markdown';

/** Rendu d'une note, commun à la lecture et aux blocs du mode « Lecture et écriture ». */

export interface DocRenderContext {
  nodes: readonly DocNodeDTO[];
  notePath: string;
  users: readonly UserSummaryDTO[];
  /** Syntaxe propre à Obsidian (réglage de l'espace). */
  obsidian?: boolean;
  /** Adresse d'une image de l'espace (le site web public ne passe pas par l'API de la documentation). */
  fileUrl?: (nodeId: number) => string;
}

export { prepareDocText, sectionOf };

/** Titre visé par un lien d'une autre note : la note ouverte y descend une fois rendue. */
export const pendingAnchor = ref<{ path: string; heading: string } | null>(null);

/** Amène un titre à l'écran ; vrai s'il a été trouvé. */
export function scrollToHeading(root: ParentNode, heading: string): boolean {
  const headings = [...root.querySelectorAll<HTMLElement>('[data-heading]')];
  const ids = headings.map((element) => (element.dataset.ids ? element.dataset.ids.split(' ') : undefined));
  const target = headings[findHeading(headings.map((element) => element.dataset.heading ?? ''), heading, ids)];
  target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  return Boolean(target);
}

/**
 * Remplit les notes intégrées `![[Note]]` d'un rendu, sans en intégrer d'autres à l'intérieur. `load` lit le texte
 * d'une note ; une note introuvable reste signalée comme telle.
 */
export async function hydrateEmbeds(root: HTMLElement, context: DocRenderContext, load: (nodeId: number) => Promise<string>): Promise<void> {
  for (const box of root.querySelectorAll<HTMLElement>('.md-embed[data-embed]:not([data-ready])')) {
    box.dataset.ready = '1';
    const [target = '', heading] = (box.dataset.embed ?? '').split('#');
    const node = resolveDocLink(context.nodes, context.notePath, target);
    if (!node || node.kind !== 'markdown') {
      box.classList.add('broken');
      box.textContent = t('Note introuvable : {name}', { name: target });
      continue;
    }
    try {
      const text = await load(node.id);
      const part = heading ? sectionOf(text, heading) : text;
      const html = finishDocHtml(renderMarkdown(prepareDocText(part.replace(/!\[\[[^\]\n]*\]\]/g, (embed) => embed.slice(1)), context.obsidian), docResolver(context.users), { obsidian: context.obsidian }), { ...context, notePath: node.path });
      box.innerHTML = `<span class="md-embed-head"><a href="#" data-node="${node.id}">${escapeHtml(docTitle(node.path))}${heading ? ` › ${escapeHtml(heading)}` : ''}</a></span><span class="md-embed-body markdown">${html}</span>`;
    } catch {
      box.classList.add('broken');
      box.textContent = t('Note inaccessible : {name}', { name: target });
    }
  }
}

export function docResolver(users: readonly UserSummaryDTO[]): MentionResolver {
  return {
    userName: (id) => users.find((user) => user.id === id)?.name,
    // Un ticket peut venir de n'importe quel projet : on garde la clé écrite dans la mention.
    ticketLabel: (_id, label) => ({ key: label, title: label }),
  };
}

/** Surligne chaque passage commenté, y compris à cheval sur plusieurs éléments (gras, lien…). */
function markComments(root: HTMLElement, comments: readonly DocCommentDTO[]): void {
  for (const comment of comments) {
    const parts: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (!node.parentElement?.closest('.md-mermaid, .katex')) parts.push(node);
    }
    const found = findQuote(parts.map((node) => node.data).join(''), comment, false);
    if (!found) continue;
    let offset = 0;
    for (const node of parts) {
      const length = node.length;
      const start = Math.max(found.from - offset, 0);
      const end = Math.min(found.to - offset, length);
      if (start < end) {
        const piece = node.splitText(start);
        piece.splitText(end - start);
        const mark = document.createElement('mark');
        mark.className = 'doc-mark';
        mark.dataset.comment = String(comment.id);
        piece.replaceWith(mark);
        mark.append(piece);
      }
      offset += length;
    }
  }
}

/** Remplace les adresses d'images, repère les liens vers d'autres fichiers de l'espace et surligne les commentaires. */
export function finishDocHtml(html: string, context: DocRenderContext, comments: readonly DocCommentDTO[] = []): string {
  const box = document.createElement('div');
  box.innerHTML = html;
  // L'aperçu d'un tableau blanc n'est pas un fichier de l'espace.
  for (const image of box.querySelectorAll<HTMLImageElement>('img:not(.md-board-preview)')) {
    const source = image.getAttribute('src') ?? '';
    const size = imageSize(image.getAttribute('alt') ?? '');
    if (size.width) {
      image.width = size.width;
      if (size.height) image.height = size.height;
      image.alt = size.alt || docBaseName(decodeURI(source));
    }
    if (/^(https?:|data:)/i.test(source)) continue;
    const node = resolveDocLink(context.nodes, context.notePath, source);
    if (node) image.src = context.fileUrl ? context.fileUrl(node.id) : `/api/documentation/nodes/${node.id}/raw`;
    else image.alt = t('Image introuvable : {name}', { name: decodeURI(source) });
  }
  for (const link of box.querySelectorAll('a')) {
    const target = link.getAttribute('href') ?? '';
    if (link.classList.contains('md-mention') || link.classList.contains('md-board') || /^(https?:|mailto:|#)/i.test(target)) continue;
    const node = resolveDocLink(context.nodes, context.notePath, target);
    if (node) link.dataset.node = String(node.id);
    else link.classList.add('broken');
  }
  markComments(box, comments);
  return box.innerHTML;
}

export function renderDocBlock(source: string, context: DocRenderContext, comments: readonly DocCommentDTO[]): string {
  return finishDocHtml(renderMarkdown(prepareDocText(source, context.obsidian), docResolver(context.users), { obsidian: context.obsidian }), context, comments);
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Ancre du texte sélectionné dans la page, s'il se trouve dans `root`. */
export function selectionQuote(root: HTMLElement): DocQuote | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const quote = squash(selection.toString()).slice(0, DOC_COMMENT_LIMITS.quote);
  if (!quote) return null;
  const around = document.createRange();
  around.selectNodeContents(root);
  around.setEnd(range.startContainer, range.startOffset);
  const before = squash(around.toString()).slice(-DOC_COMMENT_LIMITS.context);
  around.selectNodeContents(root);
  around.setStart(range.endContainer, range.endOffset);
  return { quote, before, after: squash(around.toString()).slice(0, DOC_COMMENT_LIMITS.context) };
}

/** Copie un texte, y compris là où le navigateur refuse l'accès au presse-papiers (page non sécurisée). */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    document.execCommand('copy');
  }
}
