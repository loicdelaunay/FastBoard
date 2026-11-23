<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import { APP_VERSION } from '@shared/changelog';
import { useAppStore } from '@/stores/app';

/**
 * Prévient quand le navigateur exécute une autre version que le serveur. La version du serveur arrive au chargement, à
 * chaque reconnexion temps réel et au retour sur l'onglet (seul moyen de la revoir sur la page de connexion).
 *
 * Quatre cas, pour ne jamais proposer un rechargement qui ne servirait à rien :
 * - `reload` : onglet resté ouvert pendant une mise à jour ; recharger suffit ;
 * - `rebuild` : le serveur sert lui-même une interface d'une autre version (elle n'a pas été reconstruite) : c'est à
 *   corriger sur le serveur ;
 * - `cache` : le serveur sert la bonne interface, mais un rechargement vient d'être fait sans rien changer (cache du
 *   navigateur ou d'un proxy) ;
 * - `restart` : l'interface est plus récente que le serveur, qui n'a pas encore redémarré.
 */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const TRIED_KEY = 'fb.update.tried';
const DISMISSED_KEY = 'fb.update.dismissed';

const app = useAppStore();
const updating = ref(false);
let lastCheck = Date.now();

const read = (key: string): string => {
  try {
    return sessionStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
};
const write = (key: string, value: string): void => {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // Sans stockage, le choix vaut pour cette page.
  }
};

const serverVersion = computed(() => app.info.version);
/** Ce décalage précis (interface → serveur) : sert à se souvenir d'un essai ou d'un « Plus tard ». */
const gap = computed(() => `${APP_VERSION}>${serverVersion.value}`);
const dismissed = ref(read(DISMISSED_KEY));
const tried = ref(read(TRIED_KEY));
const mismatch = computed(() => serverVersion.value !== '' && serverVersion.value !== APP_VERSION);
const visible = computed(() => mismatch.value && dismissed.value !== gap.value);

/** Compare deux versions « x.y.z » : positif si `a` est plus récente. */
function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

const state = computed<'reload' | 'rebuild' | 'cache' | 'restart'>(() => {
  if (compareVersions(APP_VERSION, serverVersion.value) > 0) return 'restart';
  // Le serveur dit quelle interface il sert : si ce n'est pas la sienne, recharger redonnerait la même page.
  const served = app.info.interfaceVersion;
  if (typeof served === 'string' && served !== serverVersion.value) return 'rebuild';
  if (tried.value !== gap.value) return 'reload';
  // Rechargement déjà fait sans effet : un cache s'il sert la bonne interface, sinon (serveur muet) une reconstruction.
  return typeof served === 'string' ? 'cache' : 'rebuild';
});

function onVisibilityChange(): void {
  if (document.visibilityState !== 'visible' || Date.now() - lastCheck < CHECK_INTERVAL_MS) return;
  lastCheck = Date.now();
  void app.load();
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChange);
});
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisibilityChange));

function later(): void {
  dismissed.value = gap.value;
  write(DISMISSED_KEY, gap.value);
}

async function update(): Promise<void> {
  updating.value = true;
  // On note l'essai : si la page revient dans la même version, le message l'expliquera au lieu de reproposer.
  write(TRIED_KEY, gap.value);
  // La page est d'abord rafraîchie dans le cache du navigateur : le rechargement obtient ainsi la nouvelle version.
  await fetch(location.href, { cache: 'reload', credentials: 'same-origin' }).catch(() => undefined);
  location.reload();
}

/** Après une correction sur le serveur : on relit sa version, et on recharge si l'interface a changé. */
async function recheck(): Promise<void> {
  updating.value = true;
  try {
    await app.load();
    const served = app.info.interfaceVersion;
    if (mismatch.value && state.value !== 'restart' && (typeof served !== 'string' || served === serverVersion.value)) {
      write(TRIED_KEY, '');
      await update();
    }
  } finally {
    updating.value = false;
  }
}
</script>

<template>
  <Transition name="update-prompt">
    <div v-if="visible" class="update-prompt" :class="state" role="status">
      <i :class="state === 'reload' ? 'pi pi-sync' : 'pi pi-exclamation-triangle'" aria-hidden="true"></i>
      <div class="text">
        <template v-if="state === 'reload'">
          <strong>{{ $t('Mise à jour disponible') }}</strong>
          <span class="muted small">{{ $t('Votre navigateur utilise la version {client}, le serveur la version {server}.', { client: APP_VERSION, server: serverVersion }) }}</span>
        </template>
        <template v-else-if="state === 'rebuild'">
          <strong>{{ $t('Mise à jour incomplète sur le serveur') }}</strong>
          <span class="muted small">{{ $t('Le serveur est en version {server}, mais l’interface qu’il sert est restée en {client} : recharger la page n’y change rien. Sur le serveur, reconstruisez l’interface (npm run build) puis redémarrez-le.', { client: APP_VERSION, server: serverVersion }) }}</span>
        </template>
        <template v-else-if="state === 'cache'">
          <strong>{{ $t('La page reste en cache') }}</strong>
          <span class="muted small">{{ $t('Le serveur sert bien la version {server}, mais votre navigateur reçoit encore la {client}. Forcez le rechargement (Ctrl Maj R) ou videz le cache du navigateur ; derrière un proxy, videz aussi le sien.', { client: APP_VERSION, server: serverVersion }) }}</span>
        </template>
        <template v-else>
          <strong>{{ $t('Le serveur n’a pas redémarré') }}</strong>
          <span class="muted small">{{ $t('L’interface est en version {client}, mais le serveur est resté en {server} : redémarrez-le pour terminer la mise à jour.', { client: APP_VERSION, server: serverVersion }) }}</span>
        </template>
      </div>
      <Button :label="state === 'reload' ? $t('Plus tard') : $t('Ignorer')" size="small" severity="secondary" text :disabled="updating" @click="later" />
      <Button v-if="state === 'reload'" :label="$t('Mettre à jour')" icon="pi pi-refresh" size="small" :loading="updating" @click="update" />
      <Button v-else :label="$t('Vérifier à nouveau')" icon="pi pi-refresh" size="small" severity="secondary" outlined :loading="updating" @click="recheck" />
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
.update-prompt.rebuild > .pi,
.update-prompt.cache > .pi,
.update-prompt.restart > .pi {
  color: #d97706;
}
.update-prompt.rebuild,
.update-prompt.cache,
.update-prompt.restart {
  width: min(44rem, calc(100vw - 2rem));
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
