<script setup lang="ts">
import ToggleSwitch from 'primevue/toggleswitch';

/**
 * Interrupteur « Recherche sémantique (RAG) » d'un projet ou d'un espace : son contenu est indexé pour l'assistant IA.
 * `what` : ce qui est indexé (« les tickets de ce projet »…).
 */
defineProps<{ what: string; disabled?: boolean; inputId: string }>();
const enabled = defineModel<boolean>({ required: true });
</script>

<template>
  <label class="rag-toggle" :for="inputId">
    <ToggleSwitch v-model="enabled" :input-id="inputId" :disabled="disabled" />
    <span class="text">
      <strong><i class="pi pi-sparkles"></i> {{ $t('Recherche sémantique (RAG) pour l’assistant IA') }}</strong>
      <span class="muted small">{{ $t('Indexe {what} pour que l’assistant les retrouve par le sens, même formulés autrement. Seules les personnes qui y ont accès en voient les passages. Désactivé par défaut.', { what }) }}</span>
    </span>
  </label>
</template>

<style scoped>
.rag-toggle {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  cursor: pointer;
}
.text {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.text strong {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.text .pi {
  color: var(--fb-accent);
  font-size: 0.85rem;
}
</style>
