<script setup lang="ts">
import { computed } from 'vue';
import Chart from 'primevue/chart';
import { useChartColors } from '@/composables/useChartColors';

const props = withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    type: 'doughnut' | 'line' | 'bar';
    data: Record<string, unknown>;
    options?: Record<string, unknown>;
    height?: number;
    empty?: boolean;
  }>(),
  { subtitle: '', options: () => ({}), height: 240, empty: false },
);

const colors = useChartColors();

/** Options communes (couleurs du thème, pas de ratio fixe) fusionnées avec celles du graphique. */
const merged = computed(() => {
  const base = props.options as { plugins?: Record<string, unknown>; scales?: Record<string, unknown> };
  const themedScales: Record<string, unknown> = {};
  for (const [axis, config] of Object.entries(base.scales ?? {})) {
    const axisConfig = config as { ticks?: object; grid?: object };
    themedScales[axis] = {
      ...axisConfig,
      ticks: { color: colors.value.muted, ...axisConfig.ticks },
      grid: { color: colors.value.grid, ...axisConfig.grid },
      border: { color: colors.value.grid },
    };
  }
  return {
    maintainAspectRatio: false,
    responsive: true,
    color: colors.value.text,
    ...props.options,
    plugins: {
      ...base.plugins,
      legend: { labels: { color: colors.value.text, usePointStyle: true, boxWidth: 8 }, ...(base.plugins?.legend as object) },
    },
    scales: themedScales,
  };
});
</script>

<template>
  <section class="chart-card card">
    <header class="head">
      <h3 class="title">{{ title }}</h3>
      <span v-if="subtitle" class="muted small">{{ subtitle }}</span>
    </header>
    <div class="canvas" :style="{ height: `${height}px` }">
      <p v-if="empty" class="empty muted">{{ $t('Pas encore de données.') }}</p>
      <Chart v-else :type="type" :data="data" :options="merged" class="chart" />
    </div>
  </section>
</template>

<style scoped>
.chart-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 1.1rem;
  min-width: 0;
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}
.title {
  font-size: 0.95rem;
  font-weight: 700;
}
.canvas {
  position: relative;
}
.chart {
  height: 100%;
}
.empty {
  display: grid;
  place-items: center;
  height: 100%;
}
</style>
