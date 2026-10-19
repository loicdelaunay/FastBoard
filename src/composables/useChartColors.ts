import { nextTick, ref, watch } from 'vue';
import { currentThemeId } from '@/theme/themeManager';

export interface ChartColors {
  text: string;
  muted: string;
  grid: string;
  accent: string;
  panel: string;
}

function read(): ChartColors {
  const style = getComputedStyle(document.documentElement);
  const value = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;
  return {
    text: value('--p-text-color', '#334155'),
    muted: value('--p-text-muted-color', '#64748b'),
    grid: value('--p-content-border-color', '#e2e8f0'),
    accent: value('--p-primary-color', '#6366f1'),
    panel: value('--p-content-background', '#ffffff'),
  };
}

const colors = ref<ChartColors>(read());

// Les variables CSS du thème sont relues à chaque changement de thème pour que les graphiques suivent.
watch(currentThemeId, () => {
  void nextTick(() => window.setTimeout(() => (colors.value = read()), 30));
});

/** Couleurs du thème courant, utilisables dans Chart.js (qui ne comprend pas `var(--…)`). */
export function useChartColors() {
  return colors;
}
