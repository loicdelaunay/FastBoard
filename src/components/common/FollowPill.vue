<script setup lang="ts">
/**
 * Bandeau « Vous suivez … » posé sur la note ou le tableau pendant qu'on suit quelqu'un : il rappelle que la vue ne nous
 * appartient plus, et permet d'arrêter (la première action dans la page arrête aussi).
 */
defineProps<{ name: string; color: string }>();
const emit = defineEmits<{ stop: [] }>();
</script>

<template>
  <div class="follow-pill" role="status" :style="{ '--follow': color }">
    <i class="pi pi-eye" aria-hidden="true"></i>
    <span class="who truncate">{{ $t('Vous suivez {name}', { name }) }}</span>
    <button type="button" class="stop" @click="emit('stop')">{{ $t('Arrêter') }}</button>
  </div>
</template>

<style scoped>
.follow-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  max-width: min(26rem, calc(100% - 1.5rem));
  padding: 0.3rem 0.35rem 0.3rem 0.75rem;
  border-radius: 999px;
  background: var(--follow);
  color: #fff;
  font-size: 0.82rem;
  font-weight: 600;
  box-shadow: 0 6px 18px rgb(0 0 0 / 22%);
}
.who {
  min-width: 0;
}
.stop {
  flex: none;
  padding: 0.2rem 0.65rem;
  border: 0;
  border-radius: 999px;
  background: rgb(255 255 255 / 92%);
  color: #1f2937;
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
}
.stop:hover,
.stop:focus-visible {
  background: #fff;
}
</style>
