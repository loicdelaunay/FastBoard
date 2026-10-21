<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import { LIMITS } from '@shared/constants';
import { useProjectStore } from '@/stores/project';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Ajout d'un lien web ou d'un chemin vers un fichier (ou dossier) du poste ou du réseau. */
const props = defineProps<{ ticketId: number; kind: 'url' | 'path' | null }>();
const emit = defineEmits<{ close: [] }>();

const project = useProjectStore();
const target = ref('');
const name = ref('');
const saving = ref(false);

watch(
  () => props.kind,
  () => {
    target.value = '';
    name.value = '';
  },
);

const visible = computed({
  get: () => props.kind !== null,
  set: (value: boolean) => !value && emit('close'),
});

async function save(): Promise<void> {
  if (!props.kind || !target.value.trim()) return;
  saving.value = true;
  try {
    await project.addAttachmentLink(props.ticketId, { kind: props.kind, target: target.value.trim(), name: name.value.trim() || undefined });
    emit('close');
  } catch (error) {
    notifyError(error, t('Lien non ajouté'));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="kind === 'path' ? $t('Lien vers un fichier ou un dossier') : $t('Lien web')" :style="{ width: 'min(32rem, 94vw)' }">
    <form class="stack" @submit.prevent="save">
      <div class="field">
        <label for="link-target">{{ kind === 'path' ? $t('Chemin') : $t('Adresse') }}</label>
        <InputText
          id="link-target"
          v-model="target"
          :maxlength="LIMITS.linkTargetMax"
          :placeholder="kind === 'path' ? $t('ex. C:\\Projets\\maquette.fig ou \\\\serveur\\partage\\dossier') : 'https://…'"
          fluid
          autofocus
        />
        <small v-if="kind === 'path'" class="muted">{{ $t('Un clic ouvre le fichier sur le poste où tourne FastBoard ; sinon le chemin est copié pour être collé dans l’explorateur.') }}</small>
      </div>
      <div class="field">
        <label for="link-name">{{ $t('Nom affiché (facultatif)') }}</label>
        <InputText id="link-name" v-model="name" :maxlength="LIMITS.attachmentNameMax" fluid />
      </div>
      <div class="actions">
        <Button type="button" :label="$t('Annuler')" severity="secondary" text @click="emit('close')" />
        <Button type="submit" :label="$t('Ajouter')" icon="pi pi-check" :loading="saving" :disabled="!target.trim()" />
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
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
