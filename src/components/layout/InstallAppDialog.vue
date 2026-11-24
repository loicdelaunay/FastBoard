<script setup lang="ts">
import { computed } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import { pwa } from '@/pwa/install';
import { useAppStore } from '@/stores/app';

/** Installer l'application à la main, quand le navigateur ne propose pas d'invite : Safari sur iPhone, iPad ou Mac. */
const visible = defineModel<boolean>('visible', { required: true });
const app = useAppStore();
const ios = computed(() => pwa.manual === 'ios');
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="$t('Installer {name}', { name: app.name })" :style="{ width: 'min(28rem, calc(100vw - 2rem))' }">
    <div class="install">
      <img :src="app.logoUrl" alt="" class="logo" />
      <p class="muted">{{ $t('Une fois installée, l’application s’ouvre dans sa propre fenêtre, depuis l’écran d’accueil ou le Dock, comme une application.') }}</p>
      <ol v-if="ios" class="steps">
        <li>{{ $t('Dans Safari, touchez le bouton Partager') }} <i class="pi pi-upload" aria-hidden="true"></i></li>
        <li>{{ $t('Choisissez « Sur l’écran d’accueil »') }} <i class="pi pi-plus-circle" aria-hidden="true"></i></li>
        <li>{{ $t('Touchez « Ajouter »') }}</li>
      </ol>
      <ol v-else class="steps">
        <li>{{ $t('Dans la barre des menus de Safari, ouvrez « Fichier »') }}</li>
        <li>{{ $t('Choisissez « Ajouter au Dock… »') }}</li>
        <li>{{ $t('Cliquez sur « Ajouter »') }}</li>
      </ol>
    </div>
    <template #footer>
      <Button :label="$t('Compris')" @click="visible = false" />
    </template>
  </Dialog>
</template>

<style scoped>
.install {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  text-align: center;
}
.logo {
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 12px;
}
.steps {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 100%;
  margin: 0;
  padding: 0.75rem 1rem 0.75rem 2rem;
  border-radius: 10px;
  background: var(--fb-panel-alt);
  text-align: left;
}
.steps .pi {
  margin-left: 0.25rem;
  color: var(--fb-accent);
}
</style>
