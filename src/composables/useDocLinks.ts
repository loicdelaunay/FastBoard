import { useRouter } from 'vue-router';
import type { DocNodeDTO } from '@shared/docs';
import { citedElementsOf, citedLinesOf } from '@shared/citations';
import { t } from '@/i18n';
import { api } from '@/api';
import { boardCitationRoute, docCitationRoute } from '@/utils/citations';
import { pendingAnchor, scrollToHeading } from '@/utils/docRender';
import { notifyError } from '@/utils/notify';

/** Ctrl, Cmd, Maj ou le bouton du milieu : le lien s'ouvre à part (nouvel onglet, nouvelle page). */
export function wantsNewTab(event: Event): boolean {
  const mouse = event as MouseEvent;
  return Boolean(mouse.ctrlKey || mouse.metaKey || mouse.shiftKey || mouse.button === 1);
}

/**
 * Suivre un lien d'une note : mention, fichier de l'espace ou adresse externe. Une note s'ouvre dans l'onglet actif de la
 * documentation, ou dans un nouvel onglet avec Ctrl clic ; une adresse web (http, https) s'ouvre toujours dans un autre
 * onglet du navigateur, jamais dans la documentation.
 */
export function useDocLinks(nodes: () => readonly DocNodeDTO[], open: (node: DocNodeDTO, newTab?: boolean) => void) {
  const router = useRouter();

  /** Un ticket se trouve par son identifiant, quel que soit son projet. */
  async function openTicket(ticketId: number): Promise<void> {
    try {
      const { ticket } = await api.ticket(ticketId);
      await router.push({ name: 'project', params: { projectId: ticket.projectId }, query: { ticket: String(ticket.id) } });
    } catch (error) {
      notifyError(error, t('Ticket inaccessible'));
    }
  }

  function openNode(nodeId: number, newTab = false): void {
    const node = nodes().find((entry) => entry.id === nodeId);
    if (node) open(node, newTab);
    else void router.push({ name: 'doc-file', params: { nodeId } });
  }

  /** Suit le lien d'un élément rendu ; vrai si l'élément en est un (une adresse externe s'ouvre d'elle-même). */
  function follow(element: HTMLElement, event: Event): boolean {
    const link = element.closest<HTMLAnchorElement>('a');
    if (!link) return false;
    const href = link.getAttribute('href') ?? '';
    const root = link.closest('.markdown') ?? document;
    if (link.dataset.fn || link.dataset.fnBack) {
      // Note de bas de page : de l'appel à la note, et retour.
      event.preventDefault();
      const selector = link.dataset.fn ? `[data-fn-def="${CSS.escape(link.dataset.fn)}"]` : `[data-fn-ref="${CSS.escape(link.dataset.fnBack!)}"]`;
      root.querySelector(selector)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (href.startsWith('#') && !link.dataset.ticket) {
      // [[#Titre]] : un titre de la même note.
      event.preventDefault();
      scrollToHeading(root, decodeURIComponent(href.slice(1)));
    } else if (link.dataset.user) {
      event.preventDefault();
      void router.push({ name: 'user', params: { id: link.dataset.user } });
    } else if (link.dataset.board) {
      event.preventDefault();
      void router.push(boardCitationRoute(Number(link.dataset.board), citedElementsOf(link.dataset.elements ? `el:${link.dataset.elements}` : null), link.dataset.version ? Number(link.dataset.version) : null));
    } else if (link.dataset.project) {
      event.preventDefault();
      void router.push({ name: 'project', params: { projectId: link.dataset.project } });
    } else if (link.dataset.doc && (link.dataset.lines || link.dataset.version) && !wantsNewTab(event)) {
      // Lignes citées : la note s'ouvre, ces lignes surlignées ; version étiquetée : cette version, en lecture seule.
      event.preventDefault();
      void router.push(docCitationRoute(Number(link.dataset.doc), link.dataset.lines ? citedLinesOf(`L${link.dataset.lines}`) : null, link.dataset.version ? Number(link.dataset.version) : null));
    } else if (link.dataset.doc) {
      event.preventDefault();
      openNode(Number(link.dataset.doc), wantsNewTab(event));
    } else if (link.dataset.ticket) {
      event.preventDefault();
      void openTicket(Number(link.dataset.ticket));
    } else if (link.dataset.node) {
      event.preventDefault();
      const heading = href.includes('#') ? decodeURIComponent(href.slice(href.indexOf('#') + 1)) : '';
      const node = nodes().find((entry) => entry.id === Number(link.dataset.node));
      pendingAnchor.value = heading && node ? { path: node.path, heading } : null;
      openNode(Number(link.dataset.node), wantsNewTab(event));
    } else if (link.classList.contains('broken')) {
      event.preventDefault();
    } else if (/^https?:/i.test(href)) {
      // Adresse web : un autre onglet du navigateur (même si le lien rendu a perdu son `target`).
      event.preventDefault();
      window.open(link.href, '_blank', 'noopener');
    }
    return true;
  }

  return { follow, openTicket, openNode };
}
