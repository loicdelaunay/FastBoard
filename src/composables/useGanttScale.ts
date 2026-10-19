import { computed, type Ref } from 'vue';
import { daysInMonth, isoWeekNumber, isoWeekday, monthName, parseDayParts, toDayNumber, todayISO, weekdayInitial } from '@shared/dates';

import { t } from '@/i18n';
export type GanttZoom = 'day' | 'week' | 'month';

export const ZOOM_LEVELS: Array<{ value: GanttZoom; label: string; pxPerDay: number }> = [
  { value: 'day', label: t('Jour'), pxPerDay: 34 },
  { value: 'week', label: t('Semaine'), pxPerDay: 14 },
  { value: 'month', label: t('Mois'), pxPerDay: 5 },
];

export interface HeaderSegment {
  key: string;
  label: string;
  left: number;
  width: number;
}

export interface DayCell extends HeaderSegment {
  day: number;
  weekend: boolean;
  today: boolean;
}

/** Échelle de temps de la frise : jours ↔ pixels, et segments des trois lignes d'en-tête (mois, semaines ISO, jours). */
export function useGanttScale(bounds: Ref<{ start: number; end: number } | null>, zoom: Ref<GanttZoom>) {
  const today = toDayNumber(todayISO());
  const pxPerDay = computed(() => ZOOM_LEVELS.find((level) => level.value === zoom.value)!.pxPerDay);

  /** Plage affichée : bornes des éléments + marge, étendue au lundi précédent / dimanche suivant. */
  const range = computed(() => {
    const base = bounds.value ?? { start: today - 14, end: today + 45 };
    const start = Math.min(base.start, today) - 10;
    const end = Math.max(base.end, today) + 21;
    const firstMonday = start - (isoWeekday(start) - 1);
    const lastSunday = end + (7 - isoWeekday(end));
    return { start: firstMonday, end: lastSunday };
  });

  const totalDays = computed(() => range.value.end - range.value.start + 1);
  const totalWidth = computed(() => totalDays.value * pxPerDay.value);

  const xOf = (day: number): number => (day - range.value.start) * pxPerDay.value;
  const dayAt = (x: number): number => range.value.start + Math.floor(x / pxPerDay.value);
  const todayX = computed(() => xOf(today) + pxPerDay.value / 2);

  const months = computed<HeaderSegment[]>(() => {
    const segments: HeaderSegment[] = [];
    let day = range.value.start;
    while (day <= range.value.end) {
      const { year, month, date } = parseDayParts(day);
      const remaining = daysInMonth(year, month) - date + 1;
      const length = Math.min(remaining, range.value.end - day + 1);
      const width = length * pxPerDay.value;
      const label = `${monthName(month, width < 110)} ${width >= 70 || month === 0 ? year : ''}`.trim();
      segments.push({ key: `${year}-${month}`, label: width < 28 ? '' : label, left: xOf(day), width });
      day += length;
    }
    return segments;
  });

  const weeks = computed<HeaderSegment[]>(() => {
    const segments: HeaderSegment[] = [];
    for (let day = range.value.start; day <= range.value.end; day += 7) {
      const number = isoWeekNumber(day);
      const width = 7 * pxPerDay.value;
      segments.push({ key: `w${day}`, label: width >= 70 ? `S${number}` : width >= 30 ? String(number) : '', left: xOf(day), width });
    }
    return segments;
  });

  const days = computed<DayCell[]>(() => {
    if (zoom.value !== 'day') {
      return [];
    }
    const cells: DayCell[] = [];
    for (let day = range.value.start; day <= range.value.end; day++) {
      cells.push({
        key: `d${day}`,
        day,
        label: `${weekdayInitial(day)} ${parseDayParts(day).date}`,
        left: xOf(day),
        width: pxPerDay.value,
        weekend: isoWeekday(day) >= 6,
        today: day === today,
      });
    }
    return cells;
  });

  /** Bandes grisées des week-ends (affichées quand un jour fait au moins 10 px). */
  const weekends = computed<Array<{ key: number; left: number; width: number }>>(() => {
    if (pxPerDay.value < 10) {
      return [];
    }
    const bands: Array<{ key: number; left: number; width: number }> = [];
    for (let day = range.value.start; day <= range.value.end; day++) {
      if (isoWeekday(day) === 6) {
        bands.push({ key: day, left: xOf(day), width: 2 * pxPerDay.value });
      }
    }
    return bands;
  });

  return { zoom, pxPerDay, range, totalDays, totalWidth, xOf, dayAt, todayX, today, months, weeks, days, weekends };
}
