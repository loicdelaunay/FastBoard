<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import { APP_VERSION } from '@shared/changelog';
import { useAppStore } from '@/stores/app';

/**
 * Propose de recharger l'application quand le navigateur exécute une autre version que le serveur : page gardée en
 * cache, ou onglet resté ouvert pendant une mise à jour. La version du serveur arrive au chargement, à chaque
 * reconnexion temps réel et au retour sur l'onglet (seul moyen de la revoir sur la page de connexion).
 */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

const app = useAppStore();
const dismissed = ref('');
const updating = ref(false);
let lastCheck = Date.now();

const serverVersion = computed(() => app.info.version);
const visible = computed(() => serverVersion.value !== '' && serverVersion.value !== APP_VERSION && serverVersion.value !== dismissed.value);

function onVisibilityChange(): void {
  if (document.visibilityState !== 'visible' || Date.now() - lastCheck < CHECK_INTERVAL_MS) return;
  lastCheck = Date.now();
  void app.load();
}

onMounted(() => document.addEventListener('visibilitychange', onVisibilityChange));
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisibilityChange));

async function update(): Promise<void> {
  updating.value = true;
  // La page est d'abord rafraîchie dans le cache du navigateur : le rechargement obtient ainsi la nouvelle version.
  await fetch(location.href, { cache: 'reload', credentials: 'same-origin' }).catch(() => undefined);
  location.reload();
}
</script>

<template>
  <Transition name="update-prompt">
    <div v-if="visible" class="update-prompt" role="status">
      <i class="pi pi-sync" aria-hidden="true"></i>
      <div class="text">
        <strong>{{ $t('Mise à jour disponible') }}</strong>
        <span class="muted small">{{ $t('Votre navigateur utilise la version {client}, le serveur la version {server}.', { client: APP_VERSION, server: serverVersion }) }}</span>
      </div>
      <Button :label="$t('Plus tard')" size="small" severity="secondary" text :disabled="updating" @click="dismissed = serverVersion" />
      <Button :label="$t('Mettre à jour')" icon="pi pi-refresh" size="small" :loading="updating" @click="update" />
    </div>
  </Transition>
</template>

<style scoped>
.update-prompt {
  position: fixed;
  left: 50%;
  bottom: 1rem;
  /* Au-dessus des fenêtres et des notifications : la page n'est peut-être plus à jour. */
  z-index: 1300;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem 0.75rem;
  width: max-content;
  max-width: calc(100vw - 2rem);
  padding: 0.65rem 0.75rem 0.65rem 1rem;
  border: 1px solid var(--fb-border);
  border-radius: 12px;
  background: var(--fb-panel);
  box-shadow: var(--fb-shadow-lg);
  transform: translateX(-50%);
}
.update-prompt > .pi {
  color: var(--fb-accent);
  font-size: 1.1rem;
}
.text {
  display: flex;
  flex: 1 1 14rem;
  flex-direction: column;
  min-width: 0;
}
.update-prompt-enter-active,
.update-prompt-leave-active {
  transition: opacity 0.2s ease, translate 0.2s ease;
}
.update-prompt-enter-from,
.update-prompt-leave-to {
  opacity: 0;
  translate: 0 0.75rem;
}
@media (prefers-reduced-motion: reduce) {
  .update-prompt-enter-active,
  .update-prompt-leave-active {
    transition: none;
  }
}
</style>
