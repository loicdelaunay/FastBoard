<script setup lang="ts">
import { ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import { BOARD_LIMITS, type BoardSpaceDTO } from '@shared/boards';
import { api } from '@/api';
import { t } from '@/i18n';
import { notifyError } from '@/utils/notify';

/** Création ou réglages d'un espace de tableaux blancs. */
const props = defineProps<{ space?: BoardSpaceDTO | null }>();
const emit = defineEmits<{ saved: [space: BoardSpaceDTO] }>();
const visible = defineModel<boolean>('visible', { required: true });

const name = ref('');
const description = ref('');
const busy = ref(false);

watch(visible, (value) => {
  if (!value) return;
  name.value = props.space?.name ?? '';
  description.value = props.space?.description ?? '';
});

async function save(): Promise<void> {
  if (!name.value.trim()) return;
  busy.value = true;
  try {
    const input = { name: name.value.trim(), description: description.value.trim() };
    const { space } = props.space ? await api.boardUpdateSpace(props.space.id, input) : await api.boardCreateSpace(input);
    visible.value = false;
    emit('saved', space);
  } catch (error) {
    notifyError(error, props.space ? t('Espace non modifié') : t('Espace non créé'));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="space ? $t('Modifier l’espace') : $t('Nouvel espace de tableaux')" :style="{ width: 'min(30rem, calc(100vw - 2rem))' }">
    <form class="form" @submit.prevent="save">
      <label class="field">
        <span>{{ $t('Nom') }}</span>
        <InputText v-model="name" :maxlength="BOARD_LIMITS.nameMax" autofocus fluid :placeholder="$t('Ateliers produit, Architecture…')" />
      </label>
      <label class="field">
        <span>{{ $t('Description') }}</span>
        <Textarea v-model="description" :maxlength="BOARD_LIMITS.descriptionMax" rows="3" auto-resize fluid />
      </label>
    </form>
    <template #footer>
      <Button :label="$t('Annuler')" severity="secondary" text @click="visible = false" />
      <Button :label="space ? $t('Enregistrer') : $t('Créer')" icon="pi pi-check" :loading="busy" :disabled="!name.trim()" @click="save" />
    </template>
  </Dialog>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-weight: 600;
  font-size: 0.9rem;
}
</style>
