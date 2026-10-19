<script setup lang="ts">
import { computed, ref } from 'vue';
import { addDays, diffDays, formatDateShort } from '@shared/dates';

const props = defineProps<{
  startIso: string;
  endIso: string;
  left: number;
  width: number;
  pxPerDay: number;
  color: string;
  progress: number;
  label: string;
  inherited: boolean;
  overdue: boolean;
  editable: boolean;
}>();
const emit = defineEmits<{ commit: [deltaStart: number, deltaEnd: number]; open: [] }>();

type Mode = 'move' | 'start' | 'end';
const drag = ref<{ mode: Mode; originX: number; delta: number; moved: boolean } | null>(null);

const days = computed(() => Math.max(1, Math.round(props.width / props.pxPerDay)));

/** Décalages (en jours) appliqués au début et à la fin pendant le glisser. */
const offsets = computed(() => {
  const delta = drag.value?.delta ?? 0;
  switch (drag.value?.mode) {
    case 'move':
      return { start: delta, end: delta };
    case 'start':
      return { start: delta, end: 0 };
    case 'end':
      return { start: 0, end: delta };
    default:
      return { start: 0, end: 0 };
  }
});

const style = computed(() => ({
  left: `${props.left + offsets.value.start * props.pxPerDay}px`,
  width: `${Math.max(props.pxPerDay, props.width + (offsets.value.end - offsets.value.start) * props.pxPerDay)}px`,
  '--bar': props.color,
}));

const tooltip = computed(() => {
  if (!drag.value?.moved) {
    return '';
  }
  const start = addDays(props.startIso, offsets.value.start);
  const end = addDays(props.endIso, offsets.value.end);
  return `${formatDateShort(start, true)} → ${formatDateShort(end, true)} · ${diffDays(start, end) + 1} j`;
});

function onDown(event: PointerEvent, mode: Mode): void {
  if (!props.editable || event.button !== 0) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  try {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  } catch {
    /* pointeur déjà relâché : le glisser reste utilisable sans capture */
  }
  drag.value = { mode, originX: event.clientX, delta: 0, moved: false };
}

function onMove(event: PointerEvent): void {
  const current = drag.value;
  if (!current) {
    return;
  }
  const dx = event.clientX - current.originX;
  let delta = Math.round(dx / props.pxPerDay);
  // Une barre garde au moins un jour.
  if (current.mode === 'start') {
    delta = Math.min(delta, days.value - 1);
  } else if (current.mode === 'end') {
    delta = Math.max(delta, -(days.value - 1));
  }
  current.delta = delta;
  current.moved = current.moved || Math.abs(dx) > 3;
}

function onUp(): void {
  const current = drag.value;
  if (!current) {
    return;
  }
  const result = { start: offsets.value.start, end: offsets.value.end };
  drag.value = null;
  if (!current.moved) {
    emit('open');
  } else if (result.start !== 0 || result.end !== 0) {
    emit('commit', result.start, result.end);
  }
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    emit('open');
    return;
  }
  if (!props.editable || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) {
    return;
  }
  event.preventDefault();
  const step = event.key === 'ArrowLeft' ? -1 : 1;
  if (event.altKey) {
    emit('commit', 0, step);
  } else {
    emit('commit', step, step);
  }
}
</script>

<template>
  <div
    class="bar"
    :class="{ editable, dragging: drag?.moved, inherited, overdue }"
    :style="style"
    tabindex="0"
    role="button"
    :aria-label="$t('{label}, du {value} au {value2}', { label, value: formatDateShort(startIso, true), value2: formatDateShort(endIso, true) })"
    @pointerdown="onDown($event, 'move')"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="drag = null"
    @keydown="onKey"
  >
    <span class="fill" :style="{ width: `${progress}%` }"></span>
    <span class="label truncate">{{ label }}</span>
    <template v-if="editable">
      <span class="handle handle-start" @pointerdown="onDown($event, 'start')"></span>
      <span class="handle handle-end" @pointerdown="onDown($event, 'end')"></span>
    </template>
    <span v-if="tooltip" class="tooltip">{{ tooltip }}</span>
  </div>
</template>

<style scoped>
.bar {
  position: absolute;
  top: 6px;
  height: 24px;
  display: flex;
  align-items: center;
  border: 1px solid var(--bar);
  border-radius: 6px;
  background: color-mix(in srgb, var(--bar) 22%, var(--fb-panel));
  overflow: visible;
  touch-action: none;
  user-select: none;
  cursor: pointer;
  z-index: 2;
}
.bar.editable {
  cursor: grab;
}
.bar.dragging {
  cursor: grabbing;
  box-shadow: 0 4px 14px rgb(0 0 0 / 25%);
  z-index: 6;
}
.bar:focus-visible {
  outline: 2px solid var(--fb-accent);
  outline-offset: 2px;
}
.bar.inherited {
  border-style: dashed;
  background: color-mix(in srgb, var(--bar) 12%, var(--fb-panel));
}
.bar.overdue {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--fb-danger) 55%, transparent);
}
.fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 5px 0 0 5px;
  background: color-mix(in srgb, var(--bar) 55%, transparent);
  pointer-events: none;
}
.label {
  position: relative;
  padding: 0 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--fb-text);
  pointer-events: none;
}
.handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 8px;
  cursor: ew-resize;
  z-index: 3;
}
.handle-start {
  left: -3px;
}
.handle-end {
  right: -3px;
}
.tooltip {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  padding: 0.2rem 0.5rem;
  border-radius: 6px;
  background: var(--fb-text);
  color: var(--fb-bg);
  font-size: 0.72rem;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
}
</style>
