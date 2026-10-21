<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import DatePicker from 'primevue/datepicker';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import { STATUS_META, TICKET_STATUSES, type TicketStatus } from '@shared/constants';
import { api } from '@/api';
import { useProjectStore } from '@/stores/project';
import { useProjectsStore } from '@/stores/projects';
import { useUiStore } from '@/stores/ui';
import { dateToIso, isoToDate } from '@/utils/dates';
import { notify, notifyError } from '@/utils/notify';
import { ticketKey } from '@/utils/tickets';

import { t } from '@/i18n';
/** Édition rapide depuis le menu contextuel d'un ticket : titre, dates ou déplacement vers un autre projet. */
const ui = useUiStore();
const project = useProjectStore();
const projects = useProjectsStore();

const ticket = computed(() => (ui.quickEdit ? project.ticketsById.get(ui.quickEdit.ticketId) : undefined));
const mode = computed(() => ui.quickEdit?.mode ?? null);
const visible = computed({
  get: () => ui.quickEdit !== null && ticket.value !== undefined,
  set: (value: boolean) => !value && (ui.quickEdit = null),
});

const title = ref('');
const start = ref<Date | null>(null);
const end = ref<Date | null>(null);
const targetProject = ref<number | null>(null);
const targetStatus = ref<TicketStatus>('backlog');
const saving = ref(false);

watch(
  () => ui.quickEdit,
  (request) => {
    const current = ticket.value;
    if (!request || !current) return;
    title.value = current.title;
    start.value = isoToDate(current.startDate);
    end.value = isoToDate(current.endDate);
    targetProject.value = null;
    targetStatus.value = current.status;
    if (request.mode === 'transfer' && !projects.loaded) void projects.fetch().catch(() => undefined);
  },
);

const otherProjects = computed(() => projects.projects.filter((entry) => entry.id !== project.projectId && !entry.archived));
const statusOptions = TICKET_STATUSES.map((status) => ({ value: status, label: t(STATUS_META[status].label) }));
const header = computed(() => {
  const key = ticket.value ? ticketKey(project.project, ticket.value) : '';
  return mode.value === 'title' ? t('Renommer {key}', { key }) : mode.value === 'dates' ? t('Dates de {key}', { key }) : t('Déplacer {key} vers un autre projet', { key });
});

async function save(): Promise<void> {
  const current = ticket.value;
  if (!current) return;
  saving.value = true;
  try {
    if (mode.value === 'title') {
      const next = title.value.trim();
      if (next && next !== current.title) await project.updateTicket(current.id, { title: next }, { label: t('Titre du ticket') });
    } else if (mode.value === 'dates') {
      await project.updateTicket(current.id, { startDate: dateToIso(start.value), endDate: dateToIso(end.value) }, { label: t('Dates du ticket') });
    } else if (mode.value === 'transfer' && targetProject.value !== null) {
      const destination = targetProject.value;
      const { key } = await api.transferTicket(current.id, destination, targetStatus.value);
      project.forgetTicket(current.id);
      const name = otherProjects.value.find((entry) => entry.id === destination)?.name ?? '';
      notify('success', t('Ticket déplacé'), t('Il est maintenant {key} dans « {name} ».', { key, name }));
    }
    ui.quickEdit = null;
  } catch (error) {
    notifyError(error, t('Modification refusée'));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="header" :style="{ width: 'min(30rem, 94vw)' }">
    <form v-if="ticket" class="stack" @submit.prevent="save">
      <InputText v-if="mode === 'title'" v-model="title" maxlength="200" fluid autofocus :aria-label="$t('Titre du ticket')" />

      <div v-else-if="mode === 'dates'" class="dates">
        <label class="field">
          <span>{{ $t('Début') }}</span>
          <DatePicker v-model="start" date-format="dd/mm/yy" show-icon show-button-bar show-week :max-date="end ?? undefined" icon-display="input" />
        </label>
        <label class="field">
          <span>{{ $t('Fin') }}</span>
          <DatePicker v-model="end" date-format="dd/mm/yy" show-icon show-button-bar show-week :min-date="start ?? undefined" icon-display="input" />
        </label>
      </div>

      <template v-else>
        <label class="field">
          <span>{{ $t('Projet de destination') }}</span>
          <Select v-model="targetProject" :options="otherProjects" option-label="name" option-value="id" filter :placeholder="$t('Choisir un projet')" fluid :loading="!projects.loaded" />
        </label>
        <label class="field">
          <span>{{ $t('Colonne') }}</span>
          <Select v-model="targetStatus" :options="statusOptions" option-label="label" option-value="value" fluid />
        </label>
        <small class="muted">{{ $t('Le ticket reçoit un nouveau numéro. Catégorie, priorité, composants et livraison sont repris s’ils existent sous le même nom ; les assignés qui ne sont pas membres du projet et les dépendances sont retirés.') }}</small>
      </template>

      <div class="actions">
        <Button type="button" :label="$t('Annuler')" severity="secondary" text @click="ui.quickEdit = null" />
        <Button type="submit" :label="mode === 'transfer' ? $t('Déplacer') : $t('Enregistrer')" icon="pi pi-check" :loading="saving" :disabled="(mode === 'title' && !title.trim()) || (mode === 'transfer' && targetProject === null)" />
      </div>
    </form>
  </Dialog>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.dates {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
