<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    value: number;
    label?: boolean;
    height?: number;
    /** Valeur de comparaison (ex. avancement théorique) affichée comme un repère. */
    marker?: number | null;
  }>(),
  { label: true, height: 6, marker: null },
);

const percent = computed(() => Math.min(100, Math.max(0, Math.round(props.value))));
</script>

<template>
  <div class="meter" :class="{ done: percent === 100 }" role="progressbar" :aria-valuenow="percent" aria-valuemin="0" aria-valuemax="100">
    <div class="track" :style="{ height: `${height}px` }">
      <div class="fill" :style="{ width: `${percent}%` }"></div>
      <div v-if="marker !== null" class="marker" :style="{ left: `${Math.min(100, Math.max(0, marker))}%` }"></div>
    </div>
    <span v-if="label" class="value">{{ percent }}%</span>
  </div>
</template>

<style scoped>
.meter {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}
.track {
  position: relative;
  flex: 1;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fb-muted) 22%, transparent);
  overflow: visible;
}
.fill {
  height: 100%;
  border-radius: 999px;
  background: var(--fb-accent);
  transition: width 0.35s ease;
}
.done .fill {
  background: #22c55e;
}
.marker {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 2px;
  margin-left: -1px;
  border-radius: 2px;
  background: var(--fb-text);
  opacity: 0.55;
}
.value {
  flex: none;
  min-width: 2.4em;
  text-align: right;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--fb-muted);
  font-variant-numeric: tabular-nums;
}
</style>
