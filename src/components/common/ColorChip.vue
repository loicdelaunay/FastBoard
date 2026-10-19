<script setup lang="ts">
/** Pastille colorée avec libellé : catégories et livraisons. */
defineProps<{ label: string; color: string; icon?: string; muted?: boolean }>();
</script>

<template>
  <span class="color-chip" :class="{ muted }" :style="{ '--chip': color }">
    <i v-if="icon" :class="icon"></i>
    <span class="truncate">{{ label }}</span>
  </span>
</template>

<style scoped>
.color-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  max-width: 100%;
  padding: 0.1rem 0.55rem;
  border-radius: 6px;
  background: color-mix(in srgb, var(--chip) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--chip) 35%, transparent);
  color: color-mix(in srgb, var(--chip) 65%, var(--fb-text));
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1.5;
}
.color-chip i {
  font-size: 0.7rem;
}
.muted {
  opacity: 0.7;
}
</style>
