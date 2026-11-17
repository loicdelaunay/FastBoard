<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { BoardColor } from '@shared/boards';

/** Tableau posé sur un tableau blanc : en lecture, une grille ; en écriture (double-clic), des cellules éditables. */
const props = defineProps<{ rows: string[][]; color: BoardColor; editing: boolean }>();
const emit = defineEmits<{ change: [rows: string[][]]; done: [] }>();

const box = ref<HTMLDivElement | null>(null);

function cell(row: number, column: number): HTMLElement | null {
  return box.value?.querySelector<HTMLElement>(`[data-cell="${row}:${column}"]`) ?? null;
}

function focusCell(row: number, column: number): void {
  const element = cell(row, column);
  if (!element) return;
  element.focus();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
}

watch(
  () => props.editing,
  async (editing) => {
    if (!editing) return;
    await nextTick();
    focusCell(0, 0);
  },
);

function save(row: number, column: number, event: FocusEvent): void {
  const text = ((event.target as HTMLElement).innerText ?? '').replace(/\n+$/, '').replace(/\n/g, ' ');
  if (props.rows[row]?.[column] === text) return;
  emit(
    'change',
    props.rows.map((cells, rowIndex) => (rowIndex === row ? cells.map((value, columnIndex) => (columnIndex === column ? text : value)) : [...cells])),
  );
}

function onKey(row: number, column: number, event: KeyboardEvent): void {
  event.stopPropagation();
  const columns = props.rows[0]?.length ?? 1;
  if (event.key === 'Escape') {
    event.preventDefault();
    (event.target as HTMLElement).blur();
    emit('done');
    return;
  }
  if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
    event.preventDefault();
    const index = row * columns + column + (event.key === 'Tab' ? (event.shiftKey ? -1 : 1) : columns);
    const next = Math.max(0, Math.min(index, props.rows.length * columns - 1));
    (event.target as HTMLElement).blur();
    void nextTick(() => focusCell(Math.floor(next / columns), next % columns));
  }
}
</script>

<template>
  <div ref="box" class="board-table" :class="[`t-${color}`, { editing }]">
    <table>
      <tbody>
        <tr v-for="(cells, rowIndex) in rows" :key="rowIndex" :class="{ head: rowIndex === 0 }">
          <td
            v-for="(value, columnIndex) in cells"
            :key="columnIndex"
            :data-cell="`${rowIndex}:${columnIndex}`"
            :contenteditable="editing ? 'plaintext-only' : 'false'"
            @blur="editing && save(rowIndex, columnIndex, $event)"
            @keydown="editing && onKey(rowIndex, columnIndex, $event)"
          >{{ value }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.board-table {
  width: 100%;
  height: 100%;
  overflow: hidden;
  border: 1px solid var(--t-stroke);
  border-radius: 8px;
  background: var(--board-default-fill);
  color: var(--board-default-text);
  font-size: 13px;
}
.board-table.editing {
  overflow: auto;
  box-shadow: 0 0 0 2px var(--board-select);
  user-select: text;
}
table {
  width: 100%;
  height: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
td {
  overflow: hidden;
  padding: 6px 8px;
  border: 1px solid color-mix(in srgb, var(--t-stroke) 45%, transparent);
  outline: none;
  text-overflow: ellipsis;
  vertical-align: middle;
  white-space: nowrap;
}
.editing td {
  white-space: normal;
  overflow-wrap: anywhere;
  cursor: text;
}
.editing td:focus {
  box-shadow: inset 0 0 0 2px var(--board-select);
}
tr.head td {
  background: var(--t-fill);
  color: var(--t-text);
  font-weight: 700;
}
.t-default {
  --t-fill: var(--board-gray-fill);
  --t-stroke: var(--board-default-stroke);
  --t-text: var(--board-default-text);
}
.t-gray {
  --t-fill: var(--board-gray-fill);
  --t-stroke: var(--board-gray-stroke);
  --t-text: var(--board-gray-text);
}
.t-red {
  --t-fill: var(--board-red-fill);
  --t-stroke: var(--board-red-stroke);
  --t-text: var(--board-red-text);
}
.t-orange {
  --t-fill: var(--board-orange-fill);
  --t-stroke: var(--board-orange-stroke);
  --t-text: var(--board-orange-text);
}
.t-yellow {
  --t-fill: var(--board-yellow-fill);
  --t-stroke: var(--board-yellow-stroke);
  --t-text: var(--board-yellow-text);
}
.t-green {
  --t-fill: var(--board-green-fill);
  --t-stroke: var(--board-green-stroke);
  --t-text: var(--board-green-text);
}
.t-blue {
  --t-fill: var(--board-blue-fill);
  --t-stroke: var(--board-blue-stroke);
  --t-text: var(--board-blue-text);
}
.t-purple {
  --t-fill: var(--board-purple-fill);
  --t-stroke: var(--board-purple-stroke);
  --t-text: var(--board-purple-text);
}
.t-pink {
  --t-fill: var(--board-pink-fill);
  --t-stroke: var(--board-pink-stroke);
  --t-text: var(--board-pink-text);
}
</style>
