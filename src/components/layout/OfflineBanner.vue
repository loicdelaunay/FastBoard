<script setup lang="ts">
import { ref } from 'vue';
import Button from 'primevue/button';
import { connection, probe } from '@/offline/connection';
import { formatRelative } from '@/utils/format';

/**
 * Serveur injoignable : l'application continue en lecture seule avec ce qu'elle a gardé sur l'appareil. Le bandeau le
 * dit, donne l'âge des données montrées et réessaie à la demande (il le fait aussi seul, régulièrement) ; au retour du
 * serveur, il l'annonce un instant.
 */
const retrying = ref(false);

async function retry(): Promise<void> {
  retrying.value = true;
  try {
    await probe();
  } finally {
    retrying.value = false;
  }
}
</script>

<template>
  <div v-if="connection.offline" class="offline-banner" role="status" aria-live="polite">
    <i class="pi pi-cloud icon" aria-hidden="true"></i>
    <div class="body">
      <strong>{{ $t('Serveur injoignable : lecture seule') }}</strong>
      <span class="message">
        {{ $t('Vous consultez ce qui a été gardé sur cet appareil ; rien ne peut être modifié tant que le serveur ne répond pas.') }}
        <template v-if="connection.oldest"> {{ $t('Données les plus anciennes affichées : {when}.', { when: formatRelative(connection.oldest) }) }}</template>
      </span>
    </div>
    <Button :label="$t('Réessayer')" icon="pi pi-refresh" size="small" severity="secondary" outlined :loading="retrying" @click="retry" />
  </div>
  <div v-else-if="connection.back" class="offline-banner back" role="status" aria-live="polite">
    <i class="pi pi-check-circle icon" aria-hidden="true"></i>
    <div class="body">
      <strong>{{ $t('Le serveur répond de nouveau') }}</strong>
      <span class="message">{{ $t('Les modifications sont de nouveau possibles ; les pages se mettent à jour.') }}</span>
    </div>
  </div>
</template>

<style scoped>
.offline-banner {
  --tone: #f59e0b;
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid color-mix(in srgb, var(--tone) 45%, transparent);
  background: color-mix(in srgb, var(--tone) 16%, var(--fb-panel));
  color: var(--fb-text);
  font-size: 0.88rem;
  z-index: 30;
}
.offline-banner.back {
  --tone: #10b981;
}
.icon {
  color: var(--tone);
  font-size: 1.05rem;
}
.body {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  gap: 0.15rem 0.5rem;
  min-width: 12rem;
}
.message {
  color: var(--fb-muted);
}
</style>
