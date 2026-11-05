<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import Slider from 'primevue/slider';

const props = withDefaults(defineProps<{ modelValue: number; disabled?: boolean; delay?: number }>(), { delay: 500 });
const emit = defineEmits<{ commit: [value: number] }>();

const STEP = 5;
const KEY_STEPS: Record<string, number> = { ArrowRight: STEP, ArrowUp: STEP, ArrowLeft: -STEP, ArrowDown: -STEP };

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

/** Arrondi au palier le plus proche : le bout de la barre donne bien 100 %, qui termine une ligne. */
function onInput(value: number | number[]): void {
  const next = Math.round((Array.isArray(value) ? (value[0] ?? 0) : value) / STEP) * STEP;
  if (next === local.value) {
    return;
  }
  local.value = next;
  if (timer !== null) {
    window.clearTimeout(timer);
  }
  timer = window.setTimeout(() => {
    timer = null;
    emit('commit', next);
  }, props.delay);
}

/** La barre avance par 1 pour suivre la souris ; au clavier, on garde des paliers. */
function onKeydown(event: KeyboardEvent): void {
  const delta = KEY_STEPS[event.key];
  if (delta === undefined || props.disabled) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  onInput(Math.min(100, Math.max(0, local.value + delta)));
}

onBeforeUnmount(() => {
  if (timer !== null) {
    window.clearTimeout(timer);
    emit('commit', local.value);
  }
});
</script>

<template>
  <div class="progress-slider" @keydown.capture="onKeydown">
    <Slider :model-value="local" :min="0" :max="100" :step="1" :disabled="disabled" class="slider" :aria-label="$t('Avancement')" @update:model-value="onInput" />
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
