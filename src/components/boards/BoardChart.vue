<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Chart as ChartInstance, ChartConfiguration } from 'chart.js';
import type { ChartElement } from '@shared/boards';
import { t } from '@/i18n';
import { BOARD_REPAINT } from './editor/paint';

/** Graphique Chart.js d'un tableau blanc : première colonne = étiquettes, colonnes suivantes = séries. */
const props = defineProps<{ element: ChartElement; rows: string[][] }>();

const canvas = ref<HTMLCanvasElement | null>(null);
const failed = ref(false);
let chart: ChartInstance | null = null;
let kind = '';
/** Chart.js une fois chargé : les dessins suivants se font tout de suite (voir `repaint`). */
let ChartClass: typeof ChartInstance | null = null;

const PALETTE = ['#6366f1', '#22c55e', '#f97316', '#ec4899', '#06b6d4', '#eab308', '#a855f7', '#ef4444'];

/** Nombre écrit à la française ou à l'anglaise (« 1 234,5 » comme « 1234.5 »). */
const toNumber = (value: string | undefined): number => {
  const number = Number((value ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(number) ? number : 0;
};

function config(): ChartConfiguration {
  // Lues sur le graphique lui-même : le tableau peut être dessiné dans un autre thème que la page (export).
  const style = getComputedStyle(canvas.value ?? document.documentElement);
  const text = style.getPropertyValue('--fb-text').trim() || '#334155';
  const grid = style.getPropertyValue('--fb-border').trim() || '#e2e8f0';
  const header = props.rows[0] ?? [];
  const body = props.rows.slice(1);
  const labels = body.map((row) => row[0] ?? '');
  const round = props.element.chart === 'pie' || props.element.chart === 'doughnut';
  const datasets = header.slice(1).map((name, position) => {
    const color = PALETTE[position % PALETTE.length]!;
    return {
      label: name || t('Série {n}', { n: position + 1 }),
      data: body.map((row) => toNumber(row[position + 1])),
      backgroundColor: round ? labels.map((_label, index) => PALETTE[index % PALETTE.length]!) : `${color}cc`,
      borderColor: round ? 'transparent' : color,
      borderWidth: props.element.chart === 'line' || props.element.chart === 'radar' ? 2 : 0,
      tension: 0.3,
      fill: props.element.chart === 'radar',
    };
  });
  return {
    type: props.element.chart,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      devicePixelRatio: Math.max(2, window.devicePixelRatio || 1),
      plugins: {
        title: { display: Boolean(props.element.title), text: props.element.title, color: text, font: { size: 14, weight: 'bold' } },
        legend: { display: datasets.length > 1 || round, labels: { color: text, boxWidth: 12 } },
      },
      scales: round
        ? {}
        : props.element.chart === 'radar'
          ? { r: { grid: { color: grid }, angleLines: { color: grid }, pointLabels: { color: text }, ticks: { color: text, backdropColor: 'transparent' } } }
          : { x: { ticks: { color: text }, grid: { color: grid } }, y: { ticks: { color: text }, grid: { color: grid }, beginAtZero: true } },
    },
  } as ChartConfiguration;
}

async function draw(): Promise<void> {
  if (!canvas.value) return;
  try {
    ChartClass ??= (await import('chart.js/auto')).Chart;
    const Chart = ChartClass;
    if (!canvas.value) return;
    if (chart && kind === props.element.chart) {
      const next = config();
      chart.data = next.data;
      chart.options = next.options ?? {};
      chart.update('none');
      return;
    }
    chart?.destroy();
    kind = props.element.chart;
    chart = new Chart(canvas.value, config());
  } catch {
    failed.value = true;
  }
}

// Thème clair ou sombre : les textes et la grille changent de couleur.
let themeObserver: MutationObserver | null = null;
onMounted(() => {
  void draw();
  themeObserver = new MutationObserver(() => {
    kind = '';
    void draw();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
});
watch(() => [props.element.chart, props.element.title, JSON.stringify(props.rows)], () => void draw());
// Couleurs du tableau changées le temps d'une capture : le graphique suit dans l'instant, sans attendre le prochain rendu.
const repaint = inject(BOARD_REPAINT, null);
if (repaint) watch(repaint, () => void draw(), { flush: 'sync' });
onBeforeUnmount(() => {
  themeObserver?.disconnect();
  chart?.destroy();
});
</script>

<template>
  <div class="board-chart">
    <canvas v-show="!failed" ref="canvas"></canvas>
    <p v-if="failed" class="muted small">{{ $t('Graphique indisponible') }}</p>
  </div>
</template>

<style scoped>
.board-chart {
  position: relative;
  width: 100%;
  height: 100%;
  padding: 8px;
  border: 1px solid var(--fb-border);
  border-radius: 10px;
  background: var(--board-default-fill);
}
canvas {
  width: 100% !important;
  height: 100% !important;
}
</style>
