<script setup lang="ts">
import { ref, watch } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import { api } from '@/api';
import { useAppStore } from '@/stores/app';
import { fitThumbnail } from '@/utils/image';
import { notify, notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Personnalisation : nom affiché de l'application et logo (en-tête, page de connexion, onglet du navigateur). */
const app = useAppStore();
const name = ref(app.name);
const saving = ref(false);
const uploading = ref(false);
const input = ref<HTMLInputElement | null>(null);

watch(() => app.name, (value) => (name.value = value));

async function saveName(): Promise<void> {
  const next = name.value.trim();
  if (!next || next === app.name) return;
  saving.value = true;
  try {
    app.set(await api.adminSetAppName(next));
    notify('success', t('Nom enregistré'));
  } catch (error) {
    notifyError(error, t('Nom non enregistré'));
  } finally {
    saving.value = false;
  }
}

async function onPick(event: Event): Promise<void> {
  const element = event.target as HTMLInputElement;
  const file = element.files?.[0];
  element.value = '';
  if (!file) return;
  uploading.value = true;
  try {
    app.set(await api.adminSetAppLogo(await fitThumbnail(file, 256)));
    notify('success', t('Logo mis à jour'));
  } catch (error) {
    notifyError(error, t('Logo non enregistré'));
  } finally {
    uploading.value = false;
  }
}

async function removeLogo(): Promise<void> {
  try {
    app.set(await api.adminRemoveAppLogo());
  } catch (error) {
    notifyError(error);
  }
}
</script>

<template>
  <div class="page branding">
    <header>
      <h1 class="page-title">{{ $t('Personnalisation') }}</h1>
      <p class="muted">{{ $t('Nom et logo affichés dans l’en-tête, sur la page de connexion et dans l’onglet du navigateur, pour tous les utilisateurs.') }}</p>
    </header>

    <section class="card block">
      <h2 class="block-title">{{ $t('Nom de l’application') }}</h2>
      <form class="row" @submit.prevent="saveName">
        <InputText v-model="name" maxlength="40" class="grow" :aria-label="$t('Nom de l’application')" />
        <Button type="submit" :label="$t('Enregistrer')" icon="pi pi-check" :loading="saving" :disabled="!name.trim() || name.trim() === app.name" />
      </form>
    </section>

    <section class="card block">
      <h2 class="block-title">{{ $t('Logo') }}</h2>
      <div class="logo-row">
        <div class="preview"><img :src="app.logoUrl" alt="" /></div>
        <div class="stack">
          <p class="muted small">{{ $t('PNG, JPEG ou WebP. L’image est réduite à 256 px sans être recadrée ; un fond transparent rend mieux sur les thèmes sombres.') }}</p>
          <div class="row">
            <Button :label="$t('Choisir une image')" icon="pi pi-upload" :loading="uploading" @click="input?.click()" />
            <Button v-if="app.info.logoVersion" :label="$t('Logo par défaut')" icon="pi pi-undo" severity="secondary" text @click="removeLogo" />
          </div>
          <input ref="input" type="file" accept="image/png,image/jpeg,image/webp" class="file" @change="onPick" />
        </div>
      </div>
    </section>

    <section class="card block preview-header">
      <h2 class="block-title">{{ $t('Aperçu') }}</h2>
      <div class="mock">
        <img :src="app.logoUrl" alt="" width="28" height="28" />
        <strong>{{ name.trim() || app.name }}</strong>
        <span class="chip">v{{ app.info.version }}</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.branding {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
header p {
  margin: 0.25rem 0 0;
}
.block {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 1.2rem;
}
.block-title {
  margin: 0;
  font-size: 1rem;
}
.logo-row {
  display: flex;
  align-items: center;
  gap: 1.25rem;
}
.preview {
  display: grid;
  place-items: center;
  flex: none;
  width: 5.5rem;
  height: 5.5rem;
  border: 1px dashed var(--fb-border);
  border-radius: 14px;
  background: var(--fb-panel-alt);
}
.preview img {
  width: 4rem;
  height: 4rem;
  object-fit: contain;
}
.stack p {
  margin: 0;
}
.file {
  display: none;
}
.mock {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.6rem 0.9rem;
  border: 1px solid var(--fb-border);
  border-radius: 10px;
  background: var(--fb-panel);
  font-size: 1.1rem;
}
.mock img {
  object-fit: contain;
}
.chip {
  padding: 0 0.4rem;
  border-radius: 999px;
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
  font-size: 0.65rem;
  font-weight: 700;
}
</style>
