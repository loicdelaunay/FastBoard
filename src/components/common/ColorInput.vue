<script setup lang="ts">
const model = defineModel<string>({ required: true });
defineProps<{ label?: string; disabled?: boolean }>();

const PRESETS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316', '#64748b'];
</script>

<template>
  <div class="color-input">
    <label class="picker" :title="label ?? $t('Choisir une couleur')">
      <input v-model="model" type="color" :disabled="disabled" :aria-label="label ?? $t('Couleur')" />
      <span class="swatch" :style="{ background: model }"></span>
    </label>
    <div class="presets" role="group" :aria-label="$t('Couleurs proposées')">
      <button
        v-for="color in PRESETS"
        :key="color"
        type="button"
        class="preset"
        :class="{ active: model.toLowerCase() === color }"
        :style="{ background: color }"
        :disabled="disabled"
        :aria-label="$t('Couleur {color}', { color })"
        @click="model = color"
      ></button>
    </div>
  </div>
</template>

<style scoped>
.color-input {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
}
.picker {
  position: relative;
  display: inline-flex;
  width: 2rem;
  height: 2rem;
  cursor: pointer;
}
.picker input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
.swatch {
  width: 100%;
  height: 100%;
  border: 2px solid var(--fb-border);
  border-radius: 8px;
}
.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.preset {
  width: 1.1rem;
  height: 1.1rem;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 50%;
  cursor: pointer;
}
.preset.active {
  border-color: var(--fb-text);
}
@media (max-width: 600px) {
  .presets {
    display: none;
  }
}
</style>
