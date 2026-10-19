<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import { suggestProjectKey } from '@shared/projectKey';
import { useProjectsStore } from '@/stores/projects';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ created: [projectId: number] }>();

const store = useProjectsStore();
const name = ref('');
const key = ref('');
const keyTouched = ref(false);
const description = ref('');
const saving = ref(false);

watch(visible, (open) => {
  if (open) {
    name.value = key.value = description.value = '';
    keyTouched.value = false;
  }
});

watch(name, (value) => {
  if (!keyTouched.value) {
    key.value = suggestProjectKey(value);
  }
});

const keyValid = computed(() => /^[A-Za-z0-9]{2,8}$/.test(key.value));
const canSubmit = computed(() => name.value.trim() !== '' && keyValid.value);

async function submit(): Promise<void> {
  saving.value = true;
  try {
    const project = await store.create({ name: name.value.trim(), key: key.value.toUpperCase(), description: description.value.trim() });
    visible.value = false;
    emit('created', project.id);
  } catch (error) {
    notifyError(error, t('Création impossible'));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="$t('Nouveau projet')" :style="{ width: 'min(30rem, 96vw)' }">
    <form class="stack" @submit.prevent="submit">
      <div class="field">
        <label for="project-name">{{ $t('Nom du projet') }}</label>
        <InputText id="project-name" v-model="name" maxlength="100" autofocus :placeholder="$t('Refonte du site vitrine')" />
      </div>
      <div class="field">
        <label for="project-key">{{ $t('Clé (préfixe des tickets)') }}</label>
        <InputText
          id="project-key"
          v-model="key"
          maxlength="8"
          :placeholder="$t('RS')"
          :invalid="key !== '' && !keyValid"
          @input="keyTouched = true"
        />
        <small class="muted">{{ $t("2 à 8 lettres ou chiffres — vos tickets s'appelleront {key}-1, {key}-2…", { key: key.toUpperCase() || 'RS' }) }}</small>
      </div>
      <div class="field">
        <label for="project-description">{{ $t('Description') }}</label>
        <Textarea id="project-description" v-model="description" rows="3" auto-resize maxlength="2000" />
      </div>
      <div class="actions">
        <Button type="button" :label="$t('Annuler')" severity="secondary" text @click="visible = false" />
        <Button type="submit" :label="$t('Créer le projet')" icon="pi pi-plus" :disabled="!canSubmit" :loading="saving" />
      </div>
    </form>
  </Dialog>
</template>

<style scoped>
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
</style>
