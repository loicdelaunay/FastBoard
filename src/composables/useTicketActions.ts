import { useConfirm } from 'primevue/useconfirm';
import { useRoute, useRouter } from 'vue-router';
import type { TicketDTO } from '@shared/types';
import { useProjectStore } from '@/stores/project';
import { copyText } from '@/utils/clipboard';
import { notify, notifyError } from '@/utils/notify';
import { ticketKey } from '@/utils/tickets';

import { t } from '@/i18n';
/** Actions sur un ticket partagées par le menu contextuel, l'en-tête et le détail du ticket. */
export function useTicketActions() {
  const project = useProjectStore();
  const confirm = useConfirm();
  const router = useRouter();
  const route = useRoute();

  /** Demande confirmation puis supprime le ticket (définitif : historique et commentaires inclus). */
  function confirmDelete(ticket: TicketDTO, onDeleted?: () => void): void {
    const key = ticketKey(project.project, ticket);
    confirm.require({
      header: t('Supprimer {key} ?', { key }),
      message: t('« {title} » sera définitivement supprimé, avec ses commentaires et son historique.', { title: ticket.title }),
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: t('Supprimer'),
      rejectLabel: t('Annuler'),
      acceptProps: { severity: 'danger' },
      rejectProps: { severity: 'secondary', text: true },
      accept: async () => {
        try {
          await project.deleteTicket(ticket.id);
          notify('success', t('{key} supprimé', { key }));
          onDeleted?.();
        } catch (error) {
          notifyError(error, t('Suppression impossible'));
        }
      },
    });
  }

  /** Crée une copie dans le Backlog (titre suffixé « (copie) ») avec les mêmes champs. */
  async function duplicate(ticket: TicketDTO): Promise<void> {
    try {
      const copy = await project.createTicket({
        title: t('{title} (copie)', { title: ticket.title }).slice(0, 200),
        description: ticket.description,
        status: 'backlog',
        categoryId: ticket.categoryId,
        deliveryId: ticket.deliveryId,
        startDate: ticket.startDate,
        endDate: ticket.endDate,
        assigneeIds: ticket.assignees.map((assignee) => assignee.userId),
      });
      notify('success', t('{value} créé', { value: ticketKey(project.project, copy) }), t('Copie placée dans le Backlog.'));
    } catch (error) {
      notifyError(error, t('Duplication impossible'));
    }
  }

  function linkTo(ticketId: number): string {
    const { href } = router.resolve({ path: route.path, query: { ...route.query, ticket: String(ticketId) } });
    return new URL(href, window.location.origin).toString();
  }

  async function copyLink(ticketId: number): Promise<void> {
    const copied = await copyText(linkTo(ticketId));
    notify(copied ? 'success' : 'warn', copied ? t('Lien copié') : t('Copie impossible'), copied ? t('Partagez-le avec votre équipe.') : t('Copiez l\'adresse depuis la barre du navigateur.'));
  }

  async function copyKey(ticket: TicketDTO): Promise<void> {
    const key = ticketKey(project.project, ticket);
    const copied = await copyText(key);
    notify(copied ? 'success' : 'warn', copied ? t('{key} copié', { key }) : t('Copie impossible'));
  }

  return { confirmDelete, duplicate, copyLink, copyKey };
}
