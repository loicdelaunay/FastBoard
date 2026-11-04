<script setup lang="ts">
import { onMounted, ref } from 'vue';
import ToggleSwitch from 'primevue/toggleswitch';
import { api } from '@/api';
import { useAppStore } from '@/stores/app';
import { formatBytes } from '@/utils/files';
import { notify, notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Active la documentation sur le site : l'onglet « Documentations » apparaît alors à côté de « Projets ». */
const app = useAppStore();
const state = ref<{ enabled: boolean; spaces: number; files: number; bytes: number; retentionDays: number } | null>(null);
const saving = ref(false);

async function load(): Promise<void> {
  try {
    state.value = await api.adminDocs();
  } catch (error) {
    notifyError(error, t('Réglages de la documentation indisponibles'));
  }
}
onMounted(load);

async function toggle(enabled: boolean): Promise<void> {
  saving.value = true;
  try {
    const result = await api.adminSaveDocs(enabled);
    app.set(result.app);
    notify('success', enabled ? t('Documentation activée') : t('Documentation désactivée'));
    await load();
  } catch (error) {
    notifyError(error, t('Enregistrement impossible'));
  } finally {
    saving.value = false;
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
</style>
