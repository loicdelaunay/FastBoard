<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import { useProjectStore } from '@/stores/project';
import { useUiStore } from '@/stores/ui';
import { notify, notifyError } from '@/utils/notify';
import { ticketKey } from '@/utils/tickets';
import TicketFieldsGrid, { type TicketFieldValues } from './TicketFieldsGrid.vue';

import { t } from '@/i18n';
const ui = useUiStore();
const project = useProjectStore();

const visible = computed({
  get: () => ui.createDefaults !== null,
  set: (value: boolean) => {
    if (!value) {
      ui.closeCreate();
    }
  },
});

const title = ref('');
const description = ref('');
const values = reactive<TicketFieldValues>({
  status: 'backlog',
  categoryId: null,
  deliveryId: null,
  startDate: null,
  endDate: null,
  assigneeIds: [],
});
const saving = ref(false);
const titleInput = ref<{ $el: HTMLInputElement } | null>(null);

watch(
  () => ui.createDefaults,
  (defaults) => {
    if (!defaults) {
      return;
    }
    title.value = defaults.title ?? '';
    description.value = '';
    Object.assign(values, {
      status: defaults.status ?? 'backlog',
      categoryId: defaults.categoryId ?? null,
      deliveryId: defaults.deliveryId ?? null,
      startDate: defaults.startDate ?? null,
      endDate: defaults.endDate ?? null,
      assigneeIds: [...(defaults.assigneeIds ?? [])],
    });
  },
);

function focusTitle(): void {
  void nextTick(() => titleInput.value?.$el.focus());
}

function onChange(patch: Partial<TicketFieldValues>): void {
  Object.assign(values, patch);
}

async function submit(another: boolean): Promise<void> {
  const trimmed = title.value.trim();
  if (!trimmed) {
    return;
  }
  saving.value = true;
  try {
    const ticket = await project.createTicket({
      title: trimmed,
      description: description.value,
      status: values.status,
      categoryId: values.categoryId,
      deliveryId: values.deliveryId,
      startDate: values.startDate,
      endDate: values.endDate,
      assigneeIds: values.assigneeIds,
    });
    notify('success', t('{value} créé', { value: ticketKey(project.project, ticket) }), ticket.title);
    if (another) {
      title.value = '';
      description.value = '';
      focusTitle();
    } else {
      ui.closeCreate();
    }
  } catch (error) {
    notifyError(error, t('Création impossible'));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="$t('Nouveau ticket')" :style="{ width: 'min(46rem, 96vw)' }" class="ticket-create" @show="focusTitle">
    <form class="form" @submit.prevent="submit(false)">
      <div class="field">
        <label for="new-title">{{ $t('Titre') }}</label>
        <InputText id="new-title" ref="titleInput" v-model="title" maxlength="200" :placeholder="$t('Que faut-il faire ?')" />
      </div>
      <div class="field">
        <label for="new-description">{{ $t('Description') }}</label>
        <Textarea id="new-description" v-model="description" rows="3" auto-resize maxlength="20000" />
      </div>
      <TicketFieldsGrid :values="values" @change="onChange" />

      <div class="actions">
        <Button type="button" :label="$t('Annuler')" severity="secondary" text @click="visible = false" />
        <Button type="button" :label="$t('Créer et en ajouter un autre')" severity="secondary" outlined :disabled="!title.trim()" :loading="saving" @click="submit(true)" />
        <Button type="submit" :label="$t('Créer le ticket')" icon="pi pi-plus" :disabled="!title.trim()" :loading="saving" />
      </div>
    </form>
  </Dialog>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
</style>
