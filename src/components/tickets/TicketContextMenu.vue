<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import ContextMenu from 'primevue/contextmenu';
import type { MenuItem } from 'primevue/menuitem';
import type { TicketStatus } from '@shared/constants';
import type { TicketDTO } from '@shared/types';
import { useTicketActions } from '@/composables/useTicketActions';
import { useTicketRoute } from '@/composables/useTicketRoute';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/project';
import { useUiStore } from '@/stores/ui';
import { notifyError } from '@/utils/notify';
import { ticketKey } from '@/utils/tickets';

import { t } from '@/i18n';
/**
 * Menu contextuel unique des tickets, ouvert par le clic droit (ou le bouton « ⋯ ») depuis le Kanban, la liste et le Gantt.
 * Les entrées affichées dépendent des permissions de l'utilisateur dans le projet.
 */
const ui = useUiStore();
const auth = useAuthStore();
const project = useProjectStore();
const actions = useTicketActions();
const { openTicket } = useTicketRoute();

const menu = ref<InstanceType<typeof ContextMenu> | null>(null);
const ticketId = ref<number | null>(null);
const ticket = computed(() => (ticketId.value !== null ? project.ticketsById.get(ticketId.value) : undefined));

watch(
  () => ui.ticketMenu,
  async (request) => {
    if (!request) {
      return;
    }
    ticketId.value = request.ticketId;
    await nextTick();
    menu.value?.show(request.event);
  },
);

async function run(task: () => Promise<unknown>, failure: string): Promise<void> {
  try {
    await task();
  } catch (error) {
    notifyError(error, failure);
  }
}

function moveItems(current: TicketDTO): MenuItem[] {
  return project.visibleColumns.filter((column) => column.status !== current.status).map(({ status }: { status: TicketStatus }) => ({
    label: project.statusMeta(status).label,
    icon: project.statusMeta(status).icon,
    command: () => void run(() => project.moveTicket(current.id, status, null), t('Déplacement impossible')),
  }));
}

const items = computed<MenuItem[]>(() => {
  const current = ticket.value;
  if (!current) {
    return [];
  }
  const key = ticketKey(project.project, current);
  const editable = project.can('ticket.edit') && !project.archived;
  const me = auth.user?.id;
  const isMember = me !== undefined && project.usersById.has(me);
  const mine = current.assignees.find((assignee) => assignee.userId === me);
  const canUpdateMyPart = !project.archived && (project.can('ticket.update_own_part') || project.can('ticket.edit'));

  const list: MenuItem[] = [
    { label: `${key} — ${current.title.length > 32 ? `${current.title.slice(0, 31)}…` : current.title}`, disabled: true, class: 'menu-title' },
    { separator: true },
    { label: t('Ouvrir'), icon: 'pi pi-external-link', command: () => openTicket(current.id) },
    { label: t('Copier le lien'), icon: 'pi pi-link', command: () => void actions.copyLink(current.id) },
    { label: t('Copier la clé'), icon: 'pi pi-hashtag', command: () => void actions.copyKey(current) },
  ];

  const edits: MenuItem[] = [];
  if (editable) {
    edits.push({ label: t('Déplacer vers'), icon: 'pi pi-arrow-right-arrow-left', items: moveItems(current) });
    if (isMember) {
      const ids = current.assignees.map((assignee) => assignee.userId);
      edits.push({
        label: mine ? t('Me retirer du ticket') : t('M\'assigner'),
        icon: mine ? 'pi pi-user-minus' : 'pi pi-user-plus',
        command: () => void run(() => project.updateTicket(current.id, { assigneeIds: mine ? ids.filter((id) => id !== me) : [...ids, me] }, { label: t('Assignation') }), 'Assignation impossible'),
      });
    }
  }
  if (mine && canUpdateMyPart) {
    edits.push({
      label: mine.done ? t('Rouvrir ma part') : t('Terminer ma part'),
      icon: mine.done ? 'pi pi-replay' : 'pi pi-check-circle',
      command: () => void run(() => project.updatePart(current.id, me!, { done: !mine.done }), t('Mise à jour impossible')),
    });
  }
  if (project.can('ticket.create') && !project.archived) {
    edits.push({ label: t('Dupliquer'), icon: 'pi pi-clone', command: () => void actions.duplicate(current) });
  }
  if (edits.length) {
    list.push({ separator: true }, ...edits);
  }

  if (project.can('ticket.delete') && !project.archived) {
    list.push({ separator: true }, { label: t('Supprimer'), icon: 'pi pi-trash', class: 'menu-danger', command: () => actions.confirmDelete(current) });
  }
  return list;
});
</script>

<template>
  <ContextMenu ref="menu" :model="items" />
</template>
