<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import ToggleSwitch from 'primevue/toggleswitch';
import { DOC_LIMITS, normalizeImageFolder, type DocSpaceDTO } from '@shared/docs';
import { api } from '@/api';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Création d'un espace, ou modification de son nom, de sa description, du Markdown qu'il accepte et du dossier de ses images. */
const props = defineProps<{ space?: DocSpaceDTO | null }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ saved: [space: DocSpaceDTO] }>();

const name = ref('');
const description = ref('');
const obsidian = ref(true);
/** Vide : le dossier réglé dans l'administration. */
const imageFolder = ref('');
const saving = ref(false);

const imageFolderInvalid = computed(() => imageFolder.value.trim() !== '' && normalizeImageFolder(imageFolder.value) === null);

watch(visible, (open) => {
  if (!open) return;
  name.value = props.space?.name ?? '';
  description.value = props.space?.description ?? '';
  obsidian.value = props.space?.obsidian ?? true;
  imageFolder.value = props.space?.imageFolder ?? '';
});

async function submit(): Promise<void> {
  if (!name.value.trim() || imageFolderInvalid.value) return;
  saving.value = true;
  try {
    const input = { name: name.value.trim(), description: description.value.trim(), obsidian: obsidian.value, imageFolder: normalizeImageFolder(imageFolder.value) };
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
      <label class="toggle" for="doc-space-obsidian">
        <ToggleSwitch v-model="obsidian" input-id="doc-space-obsidian" />
        <span class="toggle-text">
          <strong>{{ $t('Support du Markdown Obsidian') }}</strong>
          <span class="muted small">{{ $t('Callouts, ==surlignage==, %%commentaires%%, #étiquettes, notes de bas de page, propriétés en tête de note et notes intégrées avec ![[…]].') }}</span>
        </span>
      </label>
      <div class="field">
        <label for="doc-space-images">{{ $t('Dossier des images collées') }}</label>
        <InputText
          id="doc-space-images"
          v-model="imageFolder"
          :maxlength="DOC_LIMITS.imageFolderMax"
          :placeholder="space?.defaultImageFolder ?? ''"
          :invalid="imageFolderInvalid"
          aria-describedby="doc-space-images-help"
          fluid
        />
        <small id="doc-space-images-help" :class="imageFolderInvalid ? 'error' : 'muted'">
          {{ imageFolderInvalid ? $t('Nom invalide : pas de point au début ou à la fin d’un dossier, ni de caractère : * ? < > | ou guillemet.') : $t('Les images collées ou glissées dans une note vont dans ce sous-dossier, à côté d’elle. Vide : le dossier réglé dans l’administration.') }}
        </small>
      </div>
      <div class="actions">
        <Button type="button" :label="$t('Annuler')" severity="secondary" text @click="visible = false" />
        <Button type="submit" :label="space ? $t('Enregistrer') : $t('Créer')" icon="pi pi-check" :disabled="!name.trim() || imageFolderInvalid" :loading="saving" />
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
.toggle {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  cursor: pointer;
}
.toggle-text {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.error {
  color: var(--fb-danger);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
