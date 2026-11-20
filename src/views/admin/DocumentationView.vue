<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import ToggleSwitch from 'primevue/toggleswitch';
import { DOC_LIMITS, normalizeImageFolder } from '@shared/docs';
import { api } from '@/api';
import { useAppStore } from '@/stores/app';
import { formatBytes } from '@/utils/files';
import { notify, notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/**
 * Active la documentation sur le site : l'onglet « Documentations » apparaît alors à côté de « Projets ». Règle aussi le
 * dossier où vont les images collées dans les notes, pour les espaces qui n'ont pas le leur.
 */
const app = useAppStore();
const state = ref<Awaited<ReturnType<typeof api.adminDocs>> | null>(null);
const saving = ref(false);
const imageFolder = ref('');
const savingFolder = ref(false);

const folderValue = computed(() => normalizeImageFolder(imageFolder.value));
const folderChanged = computed(() => !!state.value && folderValue.value !== null && folderValue.value !== state.value.imageFolder);

async function load(): Promise<void> {
  try {
    state.value = await api.adminDocs();
    imageFolder.value = state.value.imageFolder;
  } catch (error) {
    notifyError(error, t('Réglages de la documentation indisponibles'));
  }
}
onMounted(load);

async function toggle(enabled: boolean): Promise<void> {
  saving.value = true;
  try {
    const result = await api.adminSaveDocs({ enabled });
    app.set(result.app);
    notify('success', enabled ? t('Documentation activée') : t('Documentation désactivée'));
    await load();
  } catch (error) {
    notifyError(error, t('Enregistrement impossible'));
  } finally {
    saving.value = false;
  }
}

async function saveFolder(): Promise<void> {
  if (!folderChanged.value) return;
  savingFolder.value = true;
  try {
    await api.adminSaveDocs({ imageFolder: folderValue.value! });
    notify('success', t('Dossier des images enregistré'));
    await load();
  } catch (error) {
    notifyError(error, t('Enregistrement impossible'));
  } finally {
    savingFolder.value = false;
  }
}
</script>

<template>
  <div class="page">
    <header class="head">
      <h1 class="page-title">{{ $t('Documentation') }}</h1>
      <p class="muted">{{ $t('Des espaces partagés de fichiers Markdown, à rédiger à plusieurs en temps réel, façon coffre Obsidian sur le serveur.') }}</p>
    </header>

    <section v-if="state" class="card block">
      <label class="row master">
        <ToggleSwitch :model-value="state.enabled" :disabled="saving" :aria-label="$t('Activer la documentation')" @update:model-value="toggle" />
        <strong>{{ $t('Activer la documentation') }}</strong>
      </label>
      <p class="muted small">{{ state.enabled ? $t('L’onglet « Documentations » est visible par tout le monde, à droite de « Projets ».') : $t('Une fois activée, l’onglet « Documentations » apparaît à droite de « Projets ». La désactiver masque l’onglet sans toucher aux fichiers.') }}</p>
      <dl class="stats">
        <div><dt class="muted small">{{ $t('Espaces') }}</dt><dd>{{ state.spaces }}</dd></div>
        <div><dt class="muted small">{{ $t('Fichiers') }}</dt><dd>{{ state.files }}</dd></div>
        <div><dt class="muted small">{{ $t('Taille') }}</dt><dd>{{ formatBytes(state.bytes) }}</dd></div>
        <div><dt class="muted small">{{ $t('Historique') }}</dt><dd>{{ $t('{n} jours', { n: state.retentionDays }) }}</dd></div>
      </dl>
      <p class="muted small">{{ $t('Les fichiers sont rangés dans le dossier docs, à côté de la base, et inclus dans les sauvegardes.') }}</p>
    </section>

    <section v-if="state" class="card block spaced">
      <h2 class="block-title"><i class="pi pi-images"></i> {{ $t('Images collées') }}</h2>
      <form class="folder" @submit.prevent="saveFolder">
        <div class="field">
          <label for="admin-doc-images">{{ $t('Dossier des images par défaut') }}</label>
          <div class="folder-row">
            <InputText id="admin-doc-images" v-model="imageFolder" :maxlength="DOC_LIMITS.imageFolderMax" :placeholder="state.defaultImageFolder" :invalid="folderValue === null" aria-describedby="admin-doc-images-help" />
            <Button type="submit" :label="$t('Enregistrer')" icon="pi pi-check" :disabled="!folderChanged" :loading="savingFolder" />
            <Button
              v-if="state.imageFolder !== state.defaultImageFolder || imageFolder !== state.defaultImageFolder"
              type="button"
              :label="$t('Valeur par défaut')"
              icon="pi pi-undo"
              severity="secondary"
              text
              @click="imageFolder = state.defaultImageFolder"
            />
          </div>
          <small id="admin-doc-images-help" :class="folderValue === null ? 'error' : 'muted'">
            {{
              folderValue === null
                ? $t('Nom invalide : pas de point au début ou à la fin d’un dossier, ni de caractère : * ? < > | ou guillemet.')
                : $t('Une image collée ou glissée dans une note va dans ce sous-dossier, à côté de la note (« {folder} » par défaut). Chaque espace peut choisir le sien dans ses réglages ; les images déjà rangées ne bougent pas.', { folder: state.defaultImageFolder })
            }}
          </small>
        </div>
      </form>
    </section>
  </div>
</template>

<style scoped>
.head {
  margin-bottom: 1rem;
}
.head p {
  margin: 0.25rem 0 0;
}
.block {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1.1rem 1.25rem;
}
.block p {
  margin: 0;
}
.spaced {
  margin-top: 1rem;
}
.master {
  gap: 0.6rem;
  cursor: pointer;
}
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
  gap: 1rem;
  margin: 0;
}
.stats dd {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
}
.block-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-size: 1rem;
}
.folder-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.folder-row :deep(.p-inputtext) {
  flex: 1 1 14rem;
  max-width: 24rem;
}
.error {
  color: var(--fb-danger);
}
</style>
