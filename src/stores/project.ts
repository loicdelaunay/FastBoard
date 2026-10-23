import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { STATUS_META, type TicketStatus } from '@shared/constants';
import { defaultSettings, type ColumnConfig, type ProjectSettingsDTO } from '@shared/settings';
import type { PresenceUser, ProjectEvent } from '@shared/realtime';
import type { TicketFieldKey } from '@shared/ticketFields';
import type {
  AttachmentDTO,
  CategoryDTO,
  CommentDTO,
  DeliveryDTO,
  HistoryEntryDTO,
  ProjectDTO,
  ProjectListItemDTO,
  ProjectMemberDTO,
  ProjectSnapshotDTO,
  TicketDTO,
  UserSummaryDTO,
} from '@shared/types';
import { api, uploadAttachment, type DeliveryInput, type TicketInput } from '@/api';
import { ApiError, clientId, errorMessage } from '@/api/http';
import { useUndoStack } from '@/composables/useUndoStack';
import { realtime, type EventMeta } from '@/realtime/socket';
import { launchConfetti } from '@/utils/confetti';

import { t } from '@/i18n';
const POSITION_STEP = 1024;
const FLASH_MS = 2200;

/** Champs appliqués tout de suite en local (le serveur confirme ensuite). */
const OPTIMISTIC_KEYS = ['title', 'description', 'status', 'categoryId', 'priorityId', 'componentIds', 'deliveryId', 'startDate', 'endDate', 'progress', 'parentId'] as const;

export type ListKind = 'priority' | 'component';

type ProjectStatus = 'idle' | 'loading' | 'ready' | 'error' | 'revoked';

function byPosition(a: Pick<TicketDTO, 'position' | 'id'>, b: Pick<TicketDTO, 'position' | 'id'>): number {
  return a.position - b.position || a.id - b.id;
}

export const useProjectStore = defineStore('project', () => {
  const projectId = ref<number | null>(null);
  const project = ref<ProjectDTO | null>(null);
  const members = ref<ProjectMemberDTO[]>([]);
  const users = ref<UserSummaryDTO[]>([]);
  const rawCategories = ref<CategoryDTO[]>([]);
  /** Catégories ; les noms par défaut (créés avec le projet) sont affichés dans la langue de l'interface. */
  const categories = computed(() => rawCategories.value.map((category) => ({ ...category, name: t(category.name) })));
  const rawPriorities = ref<ProjectListItemDTO[]>([]);
  /** Priorités, de la plus haute à la plus basse ; les noms par défaut sont traduits. */
  const priorities = computed(() => rawPriorities.value.map((priority) => ({ ...priority, name: t(priority.name) })));
  const components = ref<ProjectListItemDTO[]>([]);
  const deliveries = ref<DeliveryDTO[]>([]);
  const tickets = ref<TicketDTO[]>([]);
  const permissions = ref<string[]>([]);
  const presence = ref<PresenceUser[]>([]);
  const status = ref<ProjectStatus>('idle');
  const error = ref('');
  /** Tickets modifiés par un collègue : identifiant → horodatage (sert à l'animation de mise en évidence). */
  const flashes = ref<Record<number, number>>({});
  const comments = ref<Record<number, CommentDTO[]>>({});
  const history = ref<Record<number, HistoryEntryDTO[]>>({});
  const attachments = ref<Record<number, AttachmentDTO[]>>({});
  /** Évènements d'activité survenus (par d'autres) pendant que l'onglet « Activités » n'était pas affiché. */
  const unseenActivity = ref(0);
  const activityViewOpen = ref(false);
  const deletedLocally = new Set<number>();
  const undoStack = useUndoStack();

  const ticketsById = computed(() => new Map(tickets.value.map((ticket) => [ticket.id, ticket])));
  /** Sous-tickets de chaque ticket parent, par numéro. */
  const childrenByParent = computed(() => {
    const map = new Map<number, TicketDTO[]>();
    for (const ticket of tickets.value) {
      if (ticket.parentId === null) continue;
      const list = map.get(ticket.parentId) ?? [];
      list.push(ticket);
      map.set(ticket.parentId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.number - b.number);
    return map;
  });
  const childrenOf = (ticketId: number): TicketDTO[] => childrenByParent.value.get(ticketId) ?? [];
  /** Champ standard affiché dans ce projet (onglet « Ticket » des réglages). */
  const fieldOn = (key: TicketFieldKey): boolean => settings.value.ticketFields?.[key] !== false;
  const usersById = computed(() => new Map(users.value.map((user) => [user.id, user])));
  const categoriesById = computed(() => new Map(categories.value.map((category) => [category.id, category])));
  const deliveriesById = computed(() => new Map(deliveries.value.map((delivery) => [delivery.id, delivery])));
  const prioritiesById = computed(() => new Map(priorities.value.map((priority) => [priority.id, priority])));
  const componentsById = computed(() => new Map(components.value.map((component) => [component.id, component])));
  /** Rang d'une priorité (0 = la plus haute) ; les tickets sans priorité passent en dernier. */
  const priorityRank = computed(() => new Map(priorities.value.map((priority, index) => [priority.id, index])));

  // --- Réglages : automatisations et colonnes personnalisées ---
  const settings = computed<ProjectSettingsDTO>(() => project.value?.settings ?? defaultSettings());
  /** Les six colonnes dans l'ordre choisi par le projet (masquées comprises) ; les noms par défaut sont traduits. */
  const columns = computed<ColumnConfig[]>(() => settings.value.columns.map((column) => ({ ...column, label: t(column.label) })));
  const visibleColumns = computed(() => columns.value.filter((column) => !column.hidden));
  const statusOrder = computed(() => new Map(columns.value.map((column, index) => [column.status, index])));

  /** Libellé, couleur et icône d'un statut dans ce projet (les noms et couleurs sont personnalisables). */
  function statusMeta(statusKey: TicketStatus): { label: string; color: string; icon: string } {
    const column = columns.value.find((entry) => entry.status === statusKey);
    const base = STATUS_META[statusKey];
    return { label: column?.label ?? base.label, color: column?.color ?? base.color, icon: base.icon };
  }

  /** Confettis quand un ticket arrive dans « Terminé » (si le projet les active). */
  function celebrate(previous: TicketStatus | undefined, next: TicketStatus): void {
    if (next === 'done' && previous !== undefined && previous !== 'done' && settings.value.confetti) {
      launchConfetti();
    }
  }

  function can(permission: string): boolean {
    return permissions.value.includes(permission);
  }
  const readOnly = computed(() => !can('ticket.edit'));
  const archived = computed(() => project.value?.archived === true);

  // -------------------------------------------------------------------------------------------------------------------
  // Chargement
  // -------------------------------------------------------------------------------------------------------------------

  function clearData(): void {
    project.value = null;
    members.value = [];
    users.value = [];
    rawCategories.value = [];
    rawPriorities.value = [];
    components.value = [];
    deliveries.value = [];
    tickets.value = [];
    permissions.value = [];
    presence.value = [];
    comments.value = {};
    history.value = {};
    attachments.value = {};
    flashes.value = {};
    unseenActivity.value = 0;
    undoStack.clear();
  }

  /** Appelé par l'onglet « Activités » à l'ouverture / fermeture : remet le compteur de nouveautés à zéro. */
  function setActivityViewOpen(open: boolean): void {
    activityViewOpen.value = open;
    if (open) {
      unseenActivity.value = 0;
    }
  }

  function applySnapshot(snapshot: ProjectSnapshotDTO): void {
    project.value = snapshot.project;
    members.value = snapshot.members;
    users.value = snapshot.users;
    rawCategories.value = snapshot.categories;
    rawPriorities.value = snapshot.priorities ?? [];
    components.value = snapshot.components ?? [];
    deliveries.value = snapshot.deliveries;
    tickets.value = snapshot.tickets;
    permissions.value = snapshot.permissions;
  }

  async function load(id: number, options: { silent?: boolean } = {}): Promise<void> {
    if (projectId.value !== id) {
      clearData();
    }
    projectId.value = id;
    if (!options.silent) {
      status.value = 'loading';
      error.value = '';
    }
    try {
      const snapshot = await api.snapshot(id);
      if (projectId.value !== id) {
        return;
      }
      applySnapshot(snapshot);
      status.value = 'ready';
      realtime.subscribe(id);
    } catch (cause) {
      if (projectId.value !== id || options.silent) {
        return;
      }
      status.value = 'error';
      error.value = cause instanceof ApiError && cause.status === 404 ? t(t(t("Ce projet n'existe pas ou vous n'y avez pas accès."))) : errorMessage(cause);
    }
  }

  function reload(): Promise<void> {
    return projectId.value === null ? Promise.resolve() : load(projectId.value, { silent: true });
  }

  function leave(): void {
    if (projectId.value !== null) {
      realtime.unsubscribe();
    }
    projectId.value = null;
    status.value = 'idle';
    clearData();
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Évènements temps réel
  // -------------------------------------------------------------------------------------------------------------------

  function flash(ticketId: number): void {
    flashes.value = { ...flashes.value, [ticketId]: Date.now() };
    window.setTimeout(() => {
      const { [ticketId]: _removed, ...rest } = flashes.value;
      flashes.value = rest;
    }, FLASH_MS);
  }

  function upsertTicket(ticket: TicketDTO): void {
    const index = tickets.value.findIndex((entry) => entry.id === ticket.id);
    if (index < 0) {
      tickets.value.push(ticket);
    } else if (ticket.updatedAt >= tickets.value[index]!.updatedAt) {
      celebrate(tickets.value[index]!.status, ticket.status);
      tickets.value[index] = ticket;
    }
  }

  function patchLocal(ticketId: number, patch: Partial<TicketDTO>): void {
    const ticket = ticketsById.value.get(ticketId);
    if (ticket) {
      Object.assign(ticket, patch);
    }
  }

  function upsertBy<T extends { id: number }>(list: T[], item: T): void {
    const index = list.findIndex((entry) => entry.id === item.id);
    if (index < 0) {
      list.push(item);
    } else {
      list[index] = item;
    }
  }

  function upsertComment(comment: CommentDTO): void {
    const list = comments.value[comment.ticketId];
    if (list) {
      upsertBy(list, comment);
    }
  }

  function applyEvent(event: ProjectEvent, meta: EventMeta): void {
    const foreign = meta.origin !== clientId;
    switch (event.type) {
      case 'ticket.created':
      case 'ticket.updated':
        upsertTicket(event.ticket);
        if (foreign) {
          flash(event.ticket.id);
        }
        break;
      case 'ticket.deleted':
        if (!foreign) {
          deletedLocally.add(event.ticketId);
        }
        tickets.value = tickets.value.filter((ticket) => ticket.id !== event.ticketId);
        delete comments.value[event.ticketId];
        delete history.value[event.ticketId];
        delete attachments.value[event.ticketId];
        break;
      case 'tickets.reordered':
        for (const entry of event.positions) {
          patchLocal(entry.id, { position: entry.position });
        }
        break;
      case 'comment.created':
      case 'comment.updated':
      case 'comment.deleted':
        upsertComment(event.comment);
        patchLocal(event.comment.ticketId, { commentCount: event.commentCount });
        break;
      case 'attachment.created': {
        const list = attachments.value[event.attachment.ticketId];
        if (list) {
          upsertBy(list, event.attachment);
        }
        patchLocal(event.attachment.ticketId, { attachmentCount: event.attachmentCount });
        break;
      }
      case 'attachment.deleted': {
        const list = attachments.value[event.attachment.ticketId];
        if (list) {
          attachments.value[event.attachment.ticketId] = list.filter((entry) => entry.id !== event.attachment.id);
        }
        patchLocal(event.attachment.ticketId, { attachmentCount: event.attachmentCount });
        break;
      }
      case 'activity.created':
        if (foreign && !activityViewOpen.value) {
          unseenActivity.value += 1;
        }
        break;
      case 'history.created': {
        const list = history.value[event.entry.ticketId];
        if (list && !list.some((entry) => entry.id === event.entry.id)) {
          list.unshift(event.entry);
        }
        break;
      }
      case 'category.upserted':
        upsertBy(rawCategories.value, event.category);
        rawCategories.value.sort((a, b) => a.position - b.position || a.id - b.id);
        break;
      case 'category.deleted':
        rawCategories.value = rawCategories.value.filter((category) => category.id !== event.categoryId);
        for (const ticket of tickets.value) {
          if (ticket.categoryId === event.categoryId) {
            ticket.categoryId = null;
          }
        }
        break;
      case 'priority.upserted':
        upsertBy(rawPriorities.value, event.priority);
        rawPriorities.value.sort((a, b) => a.position - b.position || a.id - b.id);
        break;
      case 'priority.deleted':
        rawPriorities.value = rawPriorities.value.filter((priority) => priority.id !== event.priorityId);
        for (const ticket of tickets.value) {
          if (ticket.priorityId === event.priorityId) ticket.priorityId = null;
        }
        break;
      case 'component.upserted':
        upsertBy(components.value, event.component);
        components.value.sort((a, b) => a.position - b.position || a.id - b.id);
        break;
      case 'component.deleted':
        components.value = components.value.filter((component) => component.id !== event.componentId);
        for (const ticket of tickets.value) {
          if (ticket.componentIds.includes(event.componentId)) ticket.componentIds = ticket.componentIds.filter((id) => id !== event.componentId);
        }
        break;
      case 'delivery.upserted':
        upsertBy(deliveries.value, event.delivery);
        deliveries.value.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.position - b.position);
        break;
      case 'delivery.deleted':
        deliveries.value = deliveries.value.filter((delivery) => delivery.id !== event.deliveryId);
        for (const ticket of tickets.value) {
          if (ticket.deliveryId === event.deliveryId) {
            ticket.deliveryId = null;
          }
          if (ticket.initialDeliveryId === event.deliveryId) {
            ticket.initialDeliveryId = null;
          }
        }
        break;
      case 'project.updated':
        project.value = event.project;
        break;
      case 'members.changed': {
        members.value = event.members;
        users.value = event.users;
        const memberIds = new Set(event.members.map((member) => member.userId));
        for (const ticket of tickets.value) {
          if (ticket.assignees.some((assignee) => !memberIds.has(assignee.userId))) {
            ticket.assignees = ticket.assignees.filter((assignee) => memberIds.has(assignee.userId));
          }
        }
        // Mes propres permissions ont pu changer.
        void reload();
        break;
      }
    }
  }

  realtime.on('event', (event, meta) => {
    if (meta.projectId === projectId.value) {
      applyEvent(event, meta);
    }
  });
  realtime.on('presence', (id, list) => {
    if (id === projectId.value) {
      presence.value = list;
    }
  });
  realtime.on('revoked', (id) => {
    if (id === projectId.value) {
      status.value = 'revoked';
      clearData();
    }
  });
  realtime.on('resync', () => {
    if (projectId.value !== null && status.value === 'ready') {
      void reload();
    }
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Actions sur les tickets
  // -------------------------------------------------------------------------------------------------------------------

  function requireTicket(ticketId: number): TicketDTO {
    const ticket = ticketsById.value.get(ticketId);
    if (!ticket) {
      throw new Error(t('Ticket introuvable.'));
    }
    return ticket;
  }

  async function createTicket(input: TicketInput & { title: string }): Promise<TicketDTO> {
    if (projectId.value === null) {
      throw new Error(t('Aucun projet ouvert.'));
    }
    const { ticket } = await api.createTicket(projectId.value, input);
    upsertTicket(ticket);
    return ticket;
  }

  /** Valeurs actuelles des champs d'un patch : sert de patch inverse pour « annuler ». */
  function inversePatch(ticket: TicketDTO, patch: TicketInput): TicketInput {
    const inverse: Record<string, unknown> = {};
    for (const key of Object.keys(patch) as Array<keyof TicketInput>) {
      if (key === 'customFields') {
        // Seuls les champs modifiés reviennent à leur valeur d'avant (null : ils étaient vides).
        inverse[key] = Object.fromEntries(Object.keys(patch.customFields ?? {}).map((id) => [id, ticket.customFields[id] ?? null]));
        continue;
      }
      inverse[key] = key === 'assigneeIds' ? ticket.assignees.map((assignee) => assignee.userId) : ticket[key];
    }
    return inverse as TicketInput;
  }

  async function sendPatch(ticketId: number, patch: TicketInput): Promise<TicketDTO> {
    const ticket = requireTicket(ticketId);
    const previous = { ...ticket };
    for (const key of OPTIMISTIC_KEYS) {
      if (key in patch) {
        (ticket as unknown as Record<string, unknown>)[key] = patch[key];
      }
    }
    if (patch.status) {
      celebrate(previous.status, patch.status);
    }
    try {
      const { ticket: fresh } = await api.updateTicket(ticketId, patch);
      upsertTicket(fresh);
      return fresh;
    } catch (cause) {
      for (const key of OPTIMISTIC_KEYS) {
        if (key in patch) {
          (ticket as unknown as Record<string, unknown>)[key] = previous[key];
        }
      }
      throw cause;
    }
  }

  async function updateTicket(ticketId: number, patch: TicketInput, options: { undoable?: boolean; label?: string } = {}): Promise<TicketDTO> {
    const inverse = inversePatch(requireTicket(ticketId), patch);
    const fresh = await sendPatch(ticketId, patch);
    if (options.undoable !== false) {
      undoStack.push({
        label: options.label ?? t('Modification du ticket'),
        undo: async () => void (await sendPatch(ticketId, inverse)),
        redo: async () => void (await sendPatch(ticketId, patch)),
      });
    }
    return fresh;
  }

  function columnOf(statusKey: TicketStatus, excludeId?: number): TicketDTO[] {
    return tickets.value.filter((ticket) => ticket.status === statusKey && ticket.id !== excludeId).sort(byPosition);
  }

  function localPosition(ticketId: number, target: TicketStatus, beforeId: number | null): number {
    const siblings = columnOf(target, ticketId);
    const index = beforeId === null ? -1 : siblings.findIndex((ticket) => ticket.id === beforeId);
    if (index < 0) {
      return (siblings.at(-1)?.position ?? 0) + POSITION_STEP;
    }
    const before = siblings[index]!;
    const previous = siblings[index - 1];
    return previous ? (previous.position + before.position) / 2 : before.position - POSITION_STEP;
  }

  async function sendMove(ticketId: number, target: TicketStatus, beforeId: number | null): Promise<void> {
    const ticket = requireTicket(ticketId);
    const previous = { status: ticket.status, position: ticket.position, completedAt: ticket.completedAt };
    celebrate(previous.status, target);
    ticket.status = target;
    ticket.position = localPosition(ticketId, target, beforeId);
    try {
      const { ticket: fresh } = await api.moveTicket(ticketId, target, beforeId);
      upsertTicket(fresh);
    } catch (cause) {
      Object.assign(ticket, previous);
      throw cause;
    }
  }

  /** Déplace un ticket (colonne + rang) ; `beforeId` = ticket devant lequel l'insérer, `null` = fin de colonne. */
  async function moveTicket(ticketId: number, target: TicketStatus, beforeId: number | null, options: { undoable?: boolean } = {}): Promise<void> {
    const ticket = requireTicket(ticketId);
    const originColumn = columnOf(ticket.status);
    const originIndex = originColumn.findIndex((entry) => entry.id === ticketId);
    const originalBeforeId = originColumn[originIndex + 1]?.id ?? null;
    const originalStatus = ticket.status;
    if (originalStatus === target && originalBeforeId === beforeId) {
      return;
    }
    await sendMove(ticketId, target, beforeId);
    if (options.undoable !== false) {
      undoStack.push({
        label: t('Déplacement du ticket'),
        undo: async () => {
          try {
            await sendMove(ticketId, originalStatus, originalBeforeId);
          } catch (cause) {
            if (cause instanceof ApiError && cause.status === 400) {
              await sendMove(ticketId, originalStatus, null);
              return;
            }
            throw cause;
          }
        },
        redo: () => sendMove(ticketId, target, beforeId),
      });
    }
  }

  async function updatePart(ticketId: number, userId: number, patch: { done?: boolean; progress?: number; note?: string }): Promise<void> {
    const { ticket } = await api.updatePart(ticketId, userId, patch);
    upsertTicket(ticket);
  }

  // --- Sous-tâches et dépendances ---

  async function addSubtask(ticketId: number, title: string, assigneeId: number | null = null): Promise<void> {
    upsertTicket((await api.addSubtask(ticketId, title, assigneeId)).ticket);
  }

  async function updateSubtask(ticketId: number, subtaskId: number, patch: { title?: string; done?: boolean; assigneeId?: number | null; position?: number }): Promise<void> {
    const subtask = requireTicket(ticketId).subtasks.find((entry) => entry.id === subtaskId);
    const previous = subtask ? { ...subtask } : null;
    if (subtask && patch.done !== undefined) subtask.done = patch.done;
    if (subtask && patch.title !== undefined) subtask.title = patch.title;
    try {
      upsertTicket((await api.updateSubtask(subtaskId, patch)).ticket);
    } catch (cause) {
      if (subtask && previous) Object.assign(subtask, previous);
      throw cause;
    }
  }

  async function deleteSubtask(subtaskId: number): Promise<void> {
    upsertTicket((await api.deleteSubtask(subtaskId)).ticket);
  }

  async function addLink(ticketId: number, targetId: number, reason: string): Promise<void> {
    upsertTicket((await api.addLink(ticketId, targetId, reason)).ticket);
  }

  async function deleteLink(linkId: number): Promise<void> {
    upsertTicket((await api.deleteLink(linkId)).ticket);
  }

  /** Dépendances d'un ticket : celles qu'il porte et celles des autres tickets qui pointent vers lui. */
  function linksOf(ticketId: number): Array<{ id: number; reason: string; other: TicketDTO; incoming: boolean }> {
    const result: Array<{ id: number; reason: string; other: TicketDTO; incoming: boolean }> = [];
    const ticket = ticketsById.value.get(ticketId);
    for (const link of ticket?.links ?? []) {
      const other = ticketsById.value.get(link.targetId);
      if (other) result.push({ id: link.id, reason: link.reason, other, incoming: false });
    }
    for (const other of tickets.value) {
      for (const link of other.links) {
        if (link.targetId === ticketId) result.push({ id: link.id, reason: link.reason, other, incoming: true });
      }
    }
    return result;
  }

  async function setWatching(ticketId: number, watch: boolean): Promise<void> {
    upsertTicket((await api.watchTicket(ticketId, watch)).ticket);
  }

  async function deleteTicket(ticketId: number): Promise<void> {
    await api.deleteTicket(ticketId);
    deletedLocally.add(ticketId);
    tickets.value = tickets.value.filter((ticket) => ticket.id !== ticketId);
  }

  /** Retire un ticket parti dans un autre projet (sans le considérer comme supprimé par un collègue). */
  function forgetTicket(ticketId: number): void {
    deletedLocally.add(ticketId);
    tickets.value = tickets.value.filter((ticket) => ticket.id !== ticketId);
  }

  /** Vrai si ce ticket a été supprimé par cet onglet (et non par un collègue). */
  function wasDeletedLocally(ticketId: number): boolean {
    return deletedLocally.has(ticketId);
  }

  // --- Commentaires et historique (chargés à l'ouverture d'un ticket) ---

  async function loadComments(ticketId: number): Promise<void> {
    comments.value[ticketId] = (await api.comments(ticketId)).comments;
  }

  async function loadHistory(ticketId: number): Promise<void> {
    history.value[ticketId] = (await api.history(ticketId)).history;
  }

  // --- Pièces jointes (chargées à l'ouverture d'un ticket) ---

  async function loadAttachments(ticketId: number): Promise<void> {
    attachments.value[ticketId] = (await api.attachments(ticketId)).attachments;
  }

  /** Envoie un fichier ; l'évènement temps réel confirme ensuite pour les collègues (l'application est idempotente). */
  async function addAttachment(ticketId: number, file: File, onProgress?: (ratio: number) => void): Promise<AttachmentDTO> {
    const attachment = await uploadAttachment(ticketId, file, onProgress);
    const list = attachments.value[ticketId];
    if (list) {
      upsertBy(list, attachment);
      patchLocal(ticketId, { attachmentCount: list.length });
    }
    return attachment;
  }

  async function addAttachmentLink(ticketId: number, input: { kind: 'url' | 'path'; target: string; name?: string }): Promise<AttachmentDTO> {
    const { attachment } = await api.addAttachmentLink(ticketId, input);
    const list = attachments.value[ticketId];
    if (list) {
      upsertBy(list, attachment);
      patchLocal(ticketId, { attachmentCount: list.length });
    }
    return attachment;
  }

  async function removeAttachment(attachment: AttachmentDTO): Promise<void> {
    await api.deleteAttachment(attachment.id);
    const list = attachments.value[attachment.ticketId];
    if (list) {
      const next = list.filter((entry) => entry.id !== attachment.id);
      attachments.value[attachment.ticketId] = next;
      patchLocal(attachment.ticketId, { attachmentCount: next.length });
    }
  }

  async function addComment(ticketId: number, body: string, parentId: number | null): Promise<void> {
    const { comment } = await api.addComment(ticketId, body, parentId);
    upsertComment(comment);
  }

  async function editComment(comment: CommentDTO, body: string): Promise<void> {
    upsertComment((await api.editComment(comment.id, body)).comment);
  }

  async function removeComment(comment: CommentDTO): Promise<void> {
    upsertComment((await api.deleteComment(comment.id)).comment);
  }

  // --- Configuration du projet ---

  async function updateProjectInfo(patch: { name?: string; key?: string; description?: string; archived?: boolean; settings?: Partial<ProjectSettingsDTO> }): Promise<void> {
    if (projectId.value === null) {
      return;
    }
    project.value = (await api.updateProject(projectId.value, patch)).project;
  }

  async function saveCategory(input: { name: string; color: string }, categoryId?: number): Promise<void> {
    if (projectId.value === null) {
      return;
    }
    const { category } = categoryId
      ? await api.updateCategory(projectId.value, categoryId, input)
      : await api.createCategory(projectId.value, input);
    applyEvent({ type: 'category.upserted', category }, { projectId: projectId.value, origin: clientId, actorId: null, at: '' });
  }

  async function deleteCategory(categoryId: number): Promise<void> {
    if (projectId.value === null) {
      return;
    }
    await api.deleteCategory(projectId.value, categoryId);
    applyEvent({ type: 'category.deleted', categoryId }, { projectId: projectId.value, origin: clientId, actorId: null, at: '' });
  }

  async function saveListItem(kind: ListKind, input: { name?: string; color?: string; icon?: string; position?: number }, itemId?: number): Promise<void> {
    if (projectId.value === null) {
      return;
    }
    const meta = { projectId: projectId.value, origin: clientId, actorId: null, at: '' };
    const item = itemId
      ? await api.updateListItem(projectId.value, kind, itemId, input)
      : await api.createListItem(projectId.value, kind, { name: input.name ?? '', color: input.color ?? '#64748b', icon: input.icon ?? 'pi pi-tag' });
    applyEvent(kind === 'priority' ? { type: 'priority.upserted', priority: item } : { type: 'component.upserted', component: item }, meta);
    if (input.position !== undefined) {
      // Les autres éléments ont été renumérotés côté serveur : leurs évènements arrivent aussi, on recharge l'ordre local.
      const list = kind === 'priority' ? rawPriorities.value : components.value;
      const others = list.filter((entry) => entry.id !== item.id);
      others.splice(input.position, 0, item);
      others.forEach((entry, index) => (entry.position = index));
    }
  }

  async function deleteListItem(kind: ListKind, itemId: number): Promise<void> {
    if (projectId.value === null) {
      return;
    }
    await api.deleteListItem(projectId.value, kind, itemId);
    const meta = { projectId: projectId.value, origin: clientId, actorId: null, at: '' };
    applyEvent(kind === 'priority' ? { type: 'priority.deleted', priorityId: itemId } : { type: 'component.deleted', componentId: itemId }, meta);
  }

  async function saveDelivery(input: DeliveryInput, deliveryId?: number): Promise<void> {
    if (projectId.value === null) {
      return;
    }
    const { delivery } = deliveryId
      ? await api.updateDelivery(projectId.value, deliveryId, input)
      : await api.createDelivery(projectId.value, input);
    applyEvent({ type: 'delivery.upserted', delivery }, { projectId: projectId.value, origin: clientId, actorId: null, at: '' });
  }

  async function deleteDelivery(deliveryId: number): Promise<void> {
    if (projectId.value === null) {
      return;
    }
    await api.deleteDelivery(projectId.value, deliveryId);
    applyEvent({ type: 'delivery.deleted', deliveryId }, { projectId: projectId.value, origin: clientId, actorId: null, at: '' });
  }

  return {
    // état
    projectId, project, settings, columns, visibleColumns, statusOrder, statusMeta, members, users, categories, priorities, rawPriorities, components, deliveries, tickets, permissions, presence, status, error, flashes, comments, history, attachments,
    unseenActivity, setActivityViewOpen,
    // index
    ticketsById, usersById, categoriesById, deliveriesById, prioritiesById, componentsById, priorityRank,
    // droits
    can, readOnly, archived,
    // cycle de vie
    load, reload, leave,
    // tickets
    createTicket, updateTicket, moveTicket, updatePart, deleteTicket, forgetTicket, wasDeletedLocally,
    setWatching, addSubtask, updateSubtask, deleteSubtask, addLink, deleteLink, linksOf, childrenOf, fieldOn,
    loadComments, loadHistory, loadAttachments, addAttachment, addAttachmentLink, removeAttachment, addComment, editComment, removeComment,
    // configuration
    updateProjectInfo, saveCategory, deleteCategory, saveListItem, deleteListItem, saveDelivery, deleteDelivery,
    // annuler / rétablir
    canUndo: undoStack.canUndo,
    canRedo: undoStack.canRedo,
    undoLabel: undoStack.undoLabel,
    redoLabel: undoStack.redoLabel,
    undo: undoStack.undo,
    redo: undoStack.redo,
  };
});
