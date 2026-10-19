<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import Slider from 'primevue/slider';

const props = withDefaults(defineProps<{ modelValue: number; disabled?: boolean; delay?: number }>(), { delay: 500 });
const emit = defineEmits<{ commit: [value: number] }>();

const local = ref(props.modelValue);
let timer: number | null = null;

// Les mises à jour distantes s'affichent sauf pendant une saisie en cours.
watch(
  () => props.modelValue,
  (value) => {
    if (timer === null) {
      local.value = value;
    }
  },
);

function onInput(value: number | number[]): void {
  const next = Array.isArray(value) ? (value[0] ?? 0) : value;
  local.value = next;
  if (timer !== null) {
    window.clearTimeout(timer);
  }
  timer = window.setTimeout(() => {
    timer = null;
    emit('commit', next);
  }, props.delay);
}

onBeforeUnmount(() => {
  if (timer !== null) {
    window.clearTimeout(timer);
    emit('commit', local.value);
  }
});
</script>

<template>
  <div class="progress-slider">
    <Slider :model-value="local" :min="0" :max="100" :step="5" :disabled="disabled" class="slider" :aria-label="$t('Avancement')" @update:model-value="onInput" />
    <span class="percent">{{ local }}%</span>
  </div>
</template>

<style scoped>
.progress-slider {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}
.slider {
  flex: 1;
  min-width: 5rem;
}
.percent {
  min-width: 2.6em;
  text-align: right;
  font-size: 0.85rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
</style>
