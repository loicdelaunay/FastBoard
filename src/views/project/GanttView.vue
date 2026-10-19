<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Button from 'primevue/button';
import SelectButton from 'primevue/selectbutton';
import Select from 'primevue/select';
import { addDays, fromDayNumber } from '@shared/dates';
import GanttHeader from '@/components/gantt/GanttHeader.vue';
import GanttRow from '@/components/gantt/GanttRow.vue';
import TicketFilterBar from '@/components/project/TicketFilterBar.vue';
import { useGanttRows, type GanttGroupBy } from '@/composables/useGanttRows';
import { useGanttScale, ZOOM_LEVELS, type GanttZoom } from '@/composables/useGanttScale';
import { useTicketFilters } from '@/composables/useTicketFilters';
import { useTicketRoute } from '@/composables/useTicketRoute';
import { useProjectStore } from '@/stores/project';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
const project = useProjectStore();
const { filtered } = useTicketFilters();
const { openTicket } = useTicketRoute();

const zoom = ref<GanttZoom>('week');
const groupBy = ref<GanttGroupBy>('delivery');
const scroller = ref<HTMLElement | null>(null);
const viewportWidth = ref(window.innerWidth);

const leftWidth = computed(() => (viewportWidth.value < 720 ? 170 : 300));
const editable = computed(() => project.can('ticket.edit') && !project.archived);

const { rows, bounds, toggle, expandAll, collapseAll } = useGanttRows(filtered, groupBy);
const scale = useGanttScale(bounds, zoom);

const groupOptions = [
  { label: t('Par livraison'), value: 'delivery' },
  { label: t('Par personne'), value: 'assignee' },
  { label: t('Liste simple'), value: 'none' },
];

const headerHeight = computed(() => (zoom.value === 'day' ? 66 : 44));
const bodyHeight = computed(() => rows.value.length * 36);
const hasGroups = computed(() => groupBy.value !== 'none');

function scrollToToday(smooth = false): void {
  const element = scroller.value;
  if (!element) {
    return;
  }
  const visibleTime = element.clientWidth - leftWidth.value;
  element.scrollTo({ left: Math.max(0, scale.todayX.value - visibleTime / 2), behavior: smooth ? 'smooth' : 'auto' });
}

function onResize(): void {
  viewportWidth.value = window.innerWidth;
}

onMounted(() => {
  window.addEventListener('resize', onResize);
  void nextTick(() => scrollToToday());
});
onBeforeUnmount(() => window.removeEventListener('resize', onResize));

// Conserve le jour affiché au centre quand on change de zoom.
watch(zoom, async (_next, previous) => {
  const element = scroller.value;
  if (!element) {
    return;
  }
  const previousPx = ZOOM_LEVELS.find((level) => level.value === previous)!.pxPerDay;
  const centerDay = scale.range.value.start + (element.scrollLeft + (element.clientWidth - leftWidth.value) / 2) / previousPx;
  await nextTick();
  element.scrollLeft = Math.max(0, (centerDay - scale.range.value.start) * scale.pxPerDay.value - (element.clientWidth - leftWidth.value) / 2);
});

async function reschedule(ticketId: number, startDate: string, endDate: string): Promise<void> {
  try {
    await project.updateTicket(ticketId, { startDate, endDate }, { label: t('Planning du ticket') });
  } catch (error) {
    notifyError(error, t('Planification impossible'));
  }
}

function plan(ticketId: number, dayOffset: number): void {
  const start = fromDayNumber(scale.range.value.start + dayOffset);
  void reschedule(ticketId, start, addDays(start, 2));
}

const empty = computed(() => filtered.value.length === 0);
</script>

<template>
  <div class="gantt-view">
    <div class="bar">
      <TicketFilterBar :total="project.tickets.length" :shown="filtered.length" />
      <div class="tools">
        <Select v-model="groupBy" :options="groupOptions" option-label="label" option-value="value" class="group-select" :aria-label="$t('Regroupement')" />
        <SelectButton v-model="zoom" :options="ZOOM_LEVELS" option-label="label" option-value="value" :allow-empty="false" :aria-label="$t('Échelle de temps')" />
        <Button :label="$t('Aujourd\'hui')" icon="pi pi-calendar-clock" severity="secondary" outlined size="small" @click="scrollToToday(true)" />
        <template v-if="hasGroups">
          <Button v-tooltip.bottom="$t('Tout déplier')" icon="pi pi-angle-double-down" text rounded severity="secondary" size="small" :aria-label="$t('Tout déplier')" @click="expandAll" />
          <Button v-tooltip.bottom="$t('Tout replier')" icon="pi pi-angle-double-up" text rounded severity="secondary" size="small" :aria-label="$t('Tout replier')" @click="collapseAll" />
        </template>
      </div>
    </div>

    <div v-if="empty" class="empty muted">
      <i class="pi pi-calendar"></i>
      <p>{{ $t('Aucun ticket à afficher. Modifiez les filtres ou créez un ticket.') }}</p>
    </div>

    <div v-else ref="scroller" class="scroller">
      <div class="canvas" :style="{ width: `${leftWidth + scale.totalWidth.value}px` }">
        <div class="head" :style="{ height: `${headerHeight}px` }">
          <div class="head-left" :style="{ width: `${leftWidth}px` }">
            <span class="head-title">{{ hasGroups ? (groupBy === 'delivery' ? $t('Livraisons et tickets') : $t('Personnes et tickets')) : 'Tickets' }}</span>
          </div>
          <GanttHeader :months="scale.months.value" :weeks="scale.weeks.value" :days="scale.days.value" :width="scale.totalWidth.value" :show-weeks="true" />
        </div>

        <div class="body" :style="{ height: `${bodyHeight}px` }">
          <div class="grid-layer" :style="{ left: `${leftWidth}px`, width: `${scale.totalWidth.value}px` }" aria-hidden="true">
            <span v-for="band in scale.weekends.value" :key="band.key" class="weekend" :style="{ left: `${band.left}px`, width: `${band.width}px` }"></span>
            <span v-for="week in scale.weeks.value" :key="week.key" class="week-line" :style="{ left: `${week.left}px` }"></span>
            <span class="today-line" :style="{ left: `${scale.todayX.value}px` }"></span>
          </div>

          <GanttRow
            v-for="row in rows"
            :key="row.id"
            :row="row"
            :left-width="leftWidth"
            :total-width="scale.totalWidth.value"
            :px-per-day="scale.pxPerDay.value"
            :range-start="scale.range.value.start"
            :today="fromDayNumber(scale.today)"
            :editable="editable"
            @toggle="toggle"
            @open="openTicket"
            @reschedule="reschedule"
            @plan="plan"
          />
        </div>
      </div>
    </div>

    <footer class="legend muted small">
      <span><i class="swatch solid"></i> {{ $t('Avancement') }}</span>
      <span><i class="swatch dashed"></i> {{ $t('Dates héritées de la livraison') }}</span>
      <span><i class="swatch late"></i> {{ $t('En retard') }}</span>
      <span v-if="editable"><i class="pi pi-arrows-h"></i> {{ $t('Glissez une barre ou ses bords pour replanifier · flèches du clavier : ±1 jour') }}</span>
    </footer>
  </div>
</template>

<style scoped>
.gantt-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
}
.bar > :first-child {
  flex: 1;
  min-width: 0;
}
.tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.group-select {
  width: 11rem;
}
.scroller {
  flex: 1;
  min-height: 0;
  margin: 0 1rem;
  overflow: auto;
  border: 1px solid var(--fb-border);
  border-radius: var(--fb-radius) var(--fb-radius) 0 0;
  background: var(--fb-panel);
}
.canvas {
  position: relative;
  min-height: 100%;
}
.head {
  position: sticky;
  top: 0;
  z-index: 8;
  display: flex;
  background: var(--fb-panel);
  border-bottom: 1px solid var(--fb-border);
}
.head-left {
  position: sticky;
  left: 0;
  z-index: 9;
  flex: none;
  display: flex;
  align-items: flex-end;
  padding: 0 0.75rem 0.45rem;
  border-right: 1px solid var(--fb-border);
  background: var(--fb-panel);
}
.head-title {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--fb-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.body {
  position: relative;
}
.grid-layer {
  position: absolute;
  top: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 0;
}
.weekend {
  position: absolute;
  top: 0;
  bottom: 0;
  background: color-mix(in srgb, var(--fb-muted) 8%, transparent);
}
.week-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: color-mix(in srgb, var(--fb-border) 70%, transparent);
}
.today-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: var(--fb-accent);
  z-index: 3;
}
.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}
.empty i {
  font-size: 2rem;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 1.25rem;
  margin: 0 1rem 0.75rem;
  padding: 0.55rem 0.9rem;
  border: 1px solid var(--fb-border);
  border-top: 0;
  border-radius: 0 0 var(--fb-radius) var(--fb-radius);
  background: var(--fb-panel);
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.swatch {
  display: inline-block;
  width: 1.2rem;
  height: 0.7rem;
  border: 1px solid var(--fb-accent);
  border-radius: 3px;
}
.swatch.solid {
  background: linear-gradient(90deg, color-mix(in srgb, var(--fb-accent) 55%, transparent) 55%, color-mix(in srgb, var(--fb-accent) 15%, transparent) 55%);
}
.swatch.dashed {
  border-style: dashed;
}
.swatch.late {
  border-color: var(--fb-danger);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--fb-danger) 55%, transparent);
}
</style>
