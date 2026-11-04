<script setup lang="ts">
import { ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import { DOC_LIMITS, type DocSpaceDTO } from '@shared/docs';
import { api } from '@/api';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Création d'un espace, ou modification de son nom et de sa description. */
const props = defineProps<{ space?: DocSpaceDTO | null }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ saved: [space: DocSpaceDTO] }>();

const name = ref('');
const description = ref('');
const saving = ref(false);

watch(visible, (open) => {
  if (!open) return;
  name.value = props.space?.name ?? '';
  description.value = props.space?.description ?? '';
});

async function submit(): Promise<void> {
  if (!name.value.trim()) return;
  saving.value = true;
  try {
    const input = { name: name.value.trim(), description: description.value.trim() };
    const { space } = props.space ? await api.docUpdateSpace(props.space.id, input) : await api.docCreateSpace(input);
    visible.value = false;
    emit('saved', space);
  } catch (error) {
    notifyError(error, t('Enregistrement impossible'));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="space ? $t('Modifier l’espace') : $t('Nouvel espace de documentation')" :style="{ width: 'min(30rem, calc(100vw - 2rem))' }">
    <form class="stack" @submit.prevent="submit">
      <div class="field">
        <label for="doc-space-name">{{ $t('Nom') }}</label>
        <InputText id="doc-space-name" v-model="name" :maxlength="DOC_LIMITS.nameMax" autofocus required fluid />
      </div>
      <div class="field">
        <label for="doc-space-description">{{ $t('Description') }}</label>
        <Textarea id="doc-space-description" v-model="description" :maxlength="DOC_LIMITS.descriptionMax" rows="3" auto-resize fluid />
      </div>
      <div class="actions">
        <Button type="button" :label="$t('Annuler')" severity="secondary" text @click="visible = false" />
        <Button type="submit" :label="space ? $t('Enregistrer') : $t('Créer')" icon="pi pi-check" :disabled="!name.trim()" :loading="saving" />
      </div>
    </form>
  </Dialog>
</template>

<style scoped>
.stack {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
