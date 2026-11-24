<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import { useRouter } from 'vue-router';
import { useAppStore } from '@/stores/app';
import { useAuthStore } from '@/stores/auth';

/**
 * Ouverte sans réseau (application installée, hors connexion) : la session ne peut pas être vérifiée. Plutôt que la
 * page de connexion, on le dit, et on réessaie dès que le réseau revient.
 */
const auth = useAuthStore();
const app = useAppStore();
const router = useRouter();
const retrying = ref(false);
let timer = 0;

async function retry(): Promise<void> {
  if (retrying.value) return;
  retrying.value = true;
  try {
    await Promise.all([auth.init(), app.load()]);
    // Le réseau est revenu : la page demandée est rouverte (connexion si la session a expiré entre-temps). C'est
    // l'adresse affichée qui compte : sans réseau, l'ouverture d'une page a pu échouer avant que le routeur ne la retienne.
    if (!auth.offline) await router.replace({ path: `${location.pathname}${location.search}${location.hash}`, force: true });
  } finally {
    retrying.value = false;
  }
}

onMounted(() => {
  window.addEventListener('online', retry);
  timer = window.setInterval(() => navigator.onLine && void retry(), 15_000);
});
onBeforeUnmount(() => {
  window.removeEventListener('online', retry);
  window.clearInterval(timer);
});
</script>

<template>
  <div class="offline" role="status">
    <div class="card">
      <img :src="app.logoUrl" alt="" class="logo" />
      <h1>{{ $t('Hors ligne') }}</h1>
      <p class="muted">{{ $t('{name} n’arrive pas à joindre le serveur. Il réessaie dès que la connexion revient ; rien n’est perdu.', { name: app.name }) }}</p>
      <Button :label="$t('Réessayer')" icon="pi pi-refresh" :loading="retrying" @click="retry" />
    </div>
  </div>
</template>

<style scoped>
.offline {
  display: grid;
  place-items: center;
  min-height: 100vh;
  padding: 1rem;
  background: var(--fb-bg);
}
.card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  max-width: 26rem;
  padding: 2rem 1.75rem;
  border: 1px solid var(--fb-border);
  border-radius: 14px;
  background: var(--fb-panel);
  text-align: center;
}
.logo {
  width: 3.25rem;
  height: 3.25rem;
  border-radius: 12px;
}
h1 {
  margin: 0.25rem 0 0;
  font-size: 1.3rem;
}
p {
  margin: 0 0 0.5rem;
}
</style>
