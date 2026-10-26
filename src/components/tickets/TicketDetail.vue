<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Tab from 'primevue/tab';
import TabList from 'primevue/tablist';
import TabPanel from 'primevue/tabpanel';
import TabPanels from 'primevue/tabpanels';
import Tabs from 'primevue/tabs';
import type { TicketDTO } from '@shared/types';
import type { TicketInput } from '@/api';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { useFileDrop } from '@/composables/useFileDrop';
import { useTicketActions } from '@/composables/useTicketActions';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/project';
import { formatDateTime } from '@/utils/format';
import { notifyError } from '@/utils/notify';
import TicketAttachments from './TicketAttachments.vue';
import TicketComments from './TicketComments.vue';
import TicketFieldsGrid, { type TicketFieldValues } from './TicketFieldsGrid.vue';
import TicketHistory from './TicketHistory.vue';
import StaleBar from './StaleBar.vue';
import TicketDescription from './TicketDescription.vue';
import TicketLinks from './TicketLinks.vue';
import TicketParts from './TicketParts.vue';
import TicketSubtasks from './TicketSubtasks.vue';
import TicketChildren from './TicketChildren.vue';
import TicketCustomFields from './TicketCustomFields.vue';
import { useTicketRoute } from '@/composables/useTicketRoute';
import { ticketKey } from '@/utils/tickets';

import { t } from '@/i18n';
const props = defineProps<{ ticket: TicketDTO }>();
const emit = defineEmits<{ deleted: [] }>();

const project = useProjectStore();
const { confirmDelete } = useTicketActions();

const title = ref(props.ticket.title);
const titleFocused = ref(false);
const tab = ref<'comments' | 'history'>(project.fieldOn('comments') ? 'comments' : 'history');

const root = ref<HTMLElement | null>(null);
const attachments = ref<InstanceType<typeof TicketAttachments> | null>(null);
const canAttach = computed(() => project.can('attachment.create') && !project.archived && project.fieldOn('attachments'));
// Déposer des fichiers n'importe où dans le ticket les joint ; coller une capture d'écran aussi.
const { dragging } = useFileDrop(root, (files) => attachments.value?.addFiles(files), () => canAttach.value);

function onPaste(event: ClipboardEvent): void {
  const files = Array.from(event.clipboardData?.files ?? []);
  if (!canAttach.value || files.length === 0) {
    return;
  }
  event.preventDefault();
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  // Les captures collées s'appellent toutes « image.png » : on les date pour les distinguer.
  attachments.value?.addFiles(
    files.map((file, index) =>
      /^image\.(png|jpe?g|gif|webp)$/i.test(file.name)
        ? new File([file], `capture-${stamp}${files.length > 1 ? `-${index + 1}` : ''}.${file.name.split('.').pop()}`, { type: file.type })
        : file,
    ),
  );
}

// Les modifications d'un collègue s'affichent, sauf dans le champ en cours de saisie.
watch(() => props.ticket.title, (value) => !titleFocused.value && (title.value = value));
watch(() => props.ticket.id, () => {
  title.value = props.ticket.title;
});

const editable = computed(() => project.can('ticket.edit') && !project.archived);
const canDelete = computed(() => project.can('ticket.delete') && !project.archived);
const auth = useAuthStore();
const watching = computed(() => auth.user !== null && props.ticket.watcherIds.includes(auth.user.id));
const watchers = computed(() => props.ticket.watcherIds.flatMap((id) => project.usersById.get(id) ?? []));
const watchBusy = ref(false);
const watchHover = ref(false);

async function toggleWatch(): Promise<void> {
  watchBusy.value = true;
  watchHover.value = false;
  try {
    await project.setWatching(props.ticket.id, !watching.value);
  } catch (error) {
    notifyError(error);
  } finally {
    watchBusy.value = false;
  }
}

const creator = computed(() => (props.ticket.createdBy ? project.usersById.get(props.ticket.createdBy) : undefined));

// Sous-ticket : lien vers le ticket parent.
const { openTicket } = useTicketRoute();
const parent = computed(() => (props.ticket.parentId ? project.ticketsById.get(props.ticket.parentId) : undefined));

async function detachFromParent(): Promise<void> {
  await save({ parentId: null }, t('Détachement d’un sous-ticket'));
}

const values = computed<TicketFieldValues>(() => ({
  status: props.ticket.status,
  categoryId: props.ticket.categoryId,
  priorityId: props.ticket.priorityId,
  componentIds: props.ticket.componentIds,
  deliveryId: props.ticket.deliveryId,
  startDate: props.ticket.startDate,
  endDate: props.ticket.endDate,
  assigneeIds: props.ticket.assignees.map((assignee) => assignee.userId),
}));

async function save(patch: TicketInput, label?: string): Promise<void> {
  try {
    await project.updateTicket(props.ticket.id, patch, { label });
  } catch (error) {
    notifyError(error, t('Modification refusée'));
  }
}

async function commitTitle(): Promise<void> {
  titleFocused.value = false;
  const next = title.value.trim();
  if (!next) {
    title.value = props.ticket.title;
    return;
  }
  if (next !== props.ticket.title) {
    await save({ title: next }, t('Titre du ticket'));
  }
}

function onFieldChange(patch: Partial<TicketFieldValues>): void {
  void save(patch);
}

function askDelete(): void {
  confirmDelete(props.ticket, () => emit('deleted'));
}
</script>

<template>
  <div ref="root" class="detail" @paste="onPaste">
    <div v-if="dragging" class="drop-overlay" aria-hidden="true"><i class="pi pi-cloud-upload"></i>{{ $t('Déposez vos fichiers pour les joindre à ce ticket') }}</div>
    <p v-if="parent" class="parent-link">
      <i class="pi pi-sitemap"></i>
      <span>{{ $t('Sous-ticket de') }}</span>
      <button type="button" class="parent-open" @click="openTicket(parent.id)"><strong>{{ ticketKey(project.project, parent) }}</strong> — {{ parent.title }}</button>
      <button v-if="editable" type="button" class="parent-detach" @click="detachFromParent">{{ $t('Détacher') }}</button>
    </p>
    <InputText
      v-model="title"
      class="title-input"
      :readonly="!editable"
      maxlength="200"
      :aria-label="$t('Titre du ticket')"
      @focus="titleFocused = true"
      @blur="commitTitle"
      @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
      @keydown.esc="title = ticket.title"
    />

    <div class="columns">
    <div class="main">
      <TicketDescription v-if="project.fieldOn('description')" :ticket-id="ticket.id" :value="ticket.description" :editable="editable" @save="(value) => save({ description: value }, $t('Description du ticket'))" />

      <TicketAttachments v-if="project.fieldOn('attachments')" ref="attachments" :ticket="ticket" :dragging="dragging" />

      <TicketParts v-if="project.fieldOn('assignees') || project.fieldOn('progress')" :ticket="ticket" />

      <TicketSubtasks v-if="project.fieldOn('subtasks')" :ticket="ticket" />

      <TicketChildren v-if="ticket.parentId === null && project.fieldOn('children')" :ticket="ticket" />

      <TicketLinks v-if="project.fieldOn('links')" :ticket="ticket" />

      <Tabs v-model:value="tab" class="tabs">
        <TabList>
          <Tab v-if="project.fieldOn('comments')" value="comments"><i class="pi pi-comments"></i> {{ $t('Commentaires') }}<span v-if="ticket.commentCount" class="count">{{ ticket.commentCount }}</span></Tab>
          <Tab value="history"><i class="pi pi-history"></i> {{ $t('Historique') }}</Tab>
        </TabList>
        <TabPanels>
          <TabPanel v-if="project.fieldOn('comments')" value="comments"><TicketComments :ticket-id="ticket.id" /></TabPanel>
          <TabPanel value="history"><TicketHistory :ticket-id="ticket.id" /></TabPanel>
        </TabPanels>
      </Tabs>
    </div>

    <aside class="side">
      <div class="watch">
        <!-- Le bouton annonce l'action : « Suivre » ; une fois abonné, « Suivi ✓ », et « Ne plus suivre » au survol. -->
        <Button
          :label="watching ? (watchHover ? $t('Ne plus suivre') : $t('Suivi')) : $t('Suivre')"
          :icon="watching ? (watchHover ? 'pi pi-bell-slash' : 'pi pi-check') : 'pi pi-bell'"
          :severity="watching && watchHover ? 'danger' : watching ? 'success' : undefined"
          :outlined="watching"
          size="small"
          class="watch-button"
          :loading="watchBusy"
          :aria-pressed="watching"
          v-tooltip.top="watching ? $t('Vous recevez une notification à chaque changement. Cliquez pour ne plus suivre.') : $t('Recevoir une notification à chaque changement de ce ticket')"
          @mouseenter="watchHover = true"
          @mouseleave="watchHover = false"
          @focus="watchHover = true"
          @blur="watchHover = false"
          @click="toggleWatch"
        />
        <span v-if="watchers.length" class="muted small" :title="watchers.map((user) => user.name).join(', ')">{{ $t('{n} abonné|{n} abonnés', { n: watchers.length }) }}</span>
      </div>
      <StaleBar :ticket="ticket" />
      <TicketFieldsGrid :values="values" :disabled="!editable" :initial-delivery-id="ticket.initialDeliveryId" @change="onFieldChange" />
      <TicketCustomFields :ticket="ticket" :disabled="!editable" />

      <dl class="meta">
        <div v-if="creator || ticket.createdBy === null">
          <dt>{{ $t('Créé par') }}</dt>
          <dd class="row"><UserAvatar v-if="creator" :user="creator" size="small" /> {{ creator?.name ?? $t('Utilisateur supprimé') }}</dd>
        </div>
        <div>
          <dt>{{ $t('Créé le') }}</dt>
          <dd>{{ formatDateTime(ticket.createdAt) }}</dd>
        </div>
        <div>
          <dt>{{ $t('Modifié le') }}</dt>
          <dd>{{ formatDateTime(ticket.updatedAt) }}</dd>
        </div>
        <div v-if="ticket.completedAt">
          <dt>{{ $t('Terminé le') }}</dt>
          <dd>{{ formatDateTime(ticket.completedAt) }}</dd>
        </div>
      </dl>

      <Button v-if="canDelete" :label="$t('Supprimer le ticket')" icon="pi pi-trash" severity="danger" text size="small" @click="askDelete" />
    </aside>
    </div>
  </div>
</template>

<style scoped>
.detail {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.drop-overlay {
  position: absolute;
  inset: -0.25rem;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  border: 2px dashed var(--fb-accent);
  border-radius: var(--fb-radius);
  background: color-mix(in srgb, var(--fb-accent-soft) 88%, transparent);
  color: var(--fb-accent);
  font-size: 1.05rem;
  font-weight: 700;
  pointer-events: none;
}
.drop-overlay i {
  font-size: 1.6rem;
}
.columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 19rem;
  gap: 1.5rem;
  align-items: start;
}
.main {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  min-width: 0;
}
.parent-link {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0 -0.2rem 0.7rem;
  color: var(--fb-muted);
  font-size: 0.85rem;
}
.parent-open,
.parent-detach {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  cursor: pointer;
}
.parent-open {
  color: var(--fb-accent);
  text-align: left;
}
.parent-open:hover,
.parent-detach:hover {
  text-decoration: underline;
}
.parent-detach {
  color: var(--fb-muted);
  font-size: 0.78rem;
}
.title-input {
  width: 100%;
  font-size: 1.25rem;
  font-weight: 700;
  padding: 0.55rem 0.7rem;
  border-color: transparent;
  background: transparent;
}
.title-input:hover:not(:read-only),
.title-input:focus {
  border-color: var(--fb-border);
  background: var(--fb-panel);
}
.watch {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.side {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid var(--fb-border);
  border-radius: var(--fb-radius);
  background: var(--fb-panel);
}
.meta {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0;
  padding-top: 0.75rem;
  border-top: 1px solid var(--fb-border);
  font-size: 0.82rem;
}
.meta div {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
}
.meta dt {
  color: var(--fb-muted);
}
.meta dd {
  margin: 0;
  text-align: right;
}
.count {
  margin-left: 0.4rem;
  padding: 0 0.4rem;
  border-radius: 999px;
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
  font-size: 0.72rem;
  font-weight: 700;
}
.tabs :deep(.p-tabpanels) {
  padding-inline: 0;
}
@media (max-width: 900px) {
  .columns {
    grid-template-columns: minmax(0, 1fr);
  }
  .side {
    order: -1;
  }
}
</style>
