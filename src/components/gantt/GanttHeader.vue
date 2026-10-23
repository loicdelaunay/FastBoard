<script setup lang="ts">
import type { DayCell, HeaderSegment } from '@/composables/useGanttScale';

defineProps<{
  months: HeaderSegment[];
  weeks: HeaderSegment[];
  days: DayCell[];
  width: number;
  showWeeks: boolean;
}>();
</script>

<template>
  <div class="gantt-head" :style="{ width: `${width}px` }">
    <div class="line months">
      <span v-for="segment in months" :key="segment.key" class="cell month" :style="{ left: `${segment.left}px`, width: `${segment.width}px` }">{{ segment.label }}</span>
    </div>
    <div v-if="showWeeks" class="line weeks">
      <span v-for="segment in weeks" :key="segment.key" class="cell week" :style="{ left: `${segment.left}px`, width: `${segment.width}px` }" :title="segment.label ? undefined : $t('Semaine')">{{ segment.label }}</span>
    </div>
    <div v-if="days.length" class="line days">
      <span v-for="cell in days" :key="cell.key" class="cell day" :class="{ weekend: cell.weekend, today: cell.today }" :style="{ left: `${cell.left}px`, width: `${cell.width}px` }">{{ cell.label }}</span>
    </div>
  </div>
</template>

<style scoped>
/* Pas « .head » : la vue Gantt a déjà une classe « head » (flex) qui s'appliquerait à cette racine et alignerait les lignes côte à côte. */
.gantt-head {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: none;
}
.line {
  position: relative;
  height: 22px;
  border-bottom: 1px solid var(--fb-border);
}
.cell {
  position: absolute;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  padding: 0 0.4rem;
  border-left: 1px solid var(--fb-border);
  font-size: 0.72rem;
  white-space: nowrap;
  overflow: hidden;
  color: var(--fb-muted);
}
.month {
  font-weight: 700;
  color: var(--fb-text);
  text-transform: capitalize;
}
.week {
  justify-content: center;
  font-variant-numeric: tabular-nums;
}
.day {
  flex-direction: column;
  justify-content: center;
  padding: 0;
  line-height: 1.1;
  font-size: 0.65rem;
}
.day.weekend {
  background: color-mix(in srgb, var(--fb-muted) 10%, transparent);
}
.day.today {
  background: var(--fb-accent);
  color: var(--p-primary-contrast-color, #fff);
  font-weight: 700;
}
</style>
