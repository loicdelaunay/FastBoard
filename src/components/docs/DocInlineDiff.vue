<script setup lang="ts">
import { computed } from 'vue';
import { diffParts, hunkRows, type DiffSpan } from '@shared/docDiff';

/** Ce qui change dans un texte, en une colonne : lignes retirées et ajoutées, avec un peu de contexte. */
const props = defineProps<{ before: string; after: string }>();

interface Line {
  key: string;
  sign: '+' | '−' | '';
  spans: DiffSpan[];
}

const CONTEXT = 2;
const MAX_LINES = 400;

const lines = computed<Line[]>(() => {
  const list: Line[] = [];
  const parts = diffParts(props.before, props.after);
  parts.forEach((part, index) => {
    if (part.type === 'same') {
      const context = (offset: number): void => {
        const text = part.lines[offset]!;
        list.push({ key: `s${index}-${offset}`, sign: '', spans: text ? [{ text, changed: false }] : [] });
      };
      const size = part.lines.length;
      const head = index === 0 ? 0 : Math.min(CONTEXT, size);
      const tail = index === parts.length - 1 ? 0 : Math.min(CONTEXT, size - head);
      for (let offset = 0; offset < head; offset += 1) context(offset);
      for (let offset = size - tail; offset < size; offset += 1) context(offset);
      return;
    }
    const rows = hunkRows(part.hunk);
    rows.forEach((row, line) => row.left && list.push({ key: `l${index}-${line}`, sign: '−', spans: row.left }));
    rows.forEach((row, line) => row.right && list.push({ key: `r${index}-${line}`, sign: '+', spans: row.right }));
  });
  return list.slice(0, MAX_LINES);
});
</script>

<template>
  <div class="inline-diff">
    <div v-for="line in lines" :key="line.key" class="line" :class="{ add: line.sign === '+', del: line.sign === '−' }">
      <span class="sign">{{ line.sign }}</span>
      <span class="text"><span v-for="(span, index) in line.spans" :key="index" :class="{ word: span.changed }">{{ span.text }}</span></span>
    </div>
  </div>
</template>

<style scoped>
.inline-diff {
  max-height: 16rem;
  overflow: auto;
  border-radius: 6px;
  background: var(--fb-panel-alt);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 0.74rem;
  line-height: 1.4;
}
.line {
  display: grid;
  grid-template-columns: 1rem minmax(0, 1fr);
}
.line.add {
  --tone: #16a34a;
}
.line.del {
  --tone: var(--fb-danger);
}
.line.add,
.line.del {
  background: color-mix(in srgb, var(--tone) 13%, transparent);
}
.sign {
  color: var(--tone);
  font-weight: 700;
  text-align: center;
  user-select: none;
}
.text {
  min-height: 1.4em;
  padding-right: 0.3rem;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.word {
  border-radius: 2px;
  background: color-mix(in srgb, var(--tone) 36%, transparent);
}
</style>
