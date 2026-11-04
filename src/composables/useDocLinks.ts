import { useRouter } from 'vue-router';
import type { DocNodeDTO } from '@shared/docs';
import { t } from '@/i18n';
import { api } from '@/api';
import { notifyError } from '@/utils/notify';

/** Suivre un lien d'une note : mention, fichier de l'espace ou adresse externe. */
export function useDocLinks(nodes: () => readonly DocNodeDTO[], open: (node: DocNodeDTO) => void) {
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

  function openNode(nodeId: number): void {
    const node = nodes().find((entry) => entry.id === nodeId);
    if (node) open(node);
    else void router.push({ name: 'doc-file', params: { nodeId } });
  }

  /** Suit le lien d'un élément rendu ; vrai si l'élément en est un (une adresse externe s'ouvre d'elle-même). */
  function follow(element: HTMLElement, event: Event): boolean {
    const link = element.closest<HTMLAnchorElement>('a');
    if (!link) return false;
    if (link.dataset.user) {
      event.preventDefault();
      void router.push({ name: 'user', params: { id: link.dataset.user } });
    } else if (link.dataset.doc) {
      event.preventDefault();
      openNode(Number(link.dataset.doc));
    } else if (link.dataset.ticket) {
      event.preventDefault();
      void openTicket(Number(link.dataset.ticket));
    } else if (link.dataset.node) {
      event.preventDefault();
      openNode(Number(link.dataset.node));
    } else if (link.classList.contains('broken')) {
      event.preventDefault();
    }
    return true;
  }

  return { follow, openTicket, openNode };
}
