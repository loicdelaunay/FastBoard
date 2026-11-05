<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState, Transaction } from '@codemirror/state';
import { drawSelection, EditorView, keymap, lineNumbers } from '@codemirror/view';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import { composeMerge, defaultPick, diffParts, hunkRows, mergedText, pickedText, type DiffHunk, type DiffKind, type DiffPick, type DiffRow, type DiffSide, type DiffSpan } from '@shared/docDiff';
import { mergeBlocks, mergeResult, setBlocks, type MergeBlock } from './editor/mergeResult';

import { t } from '@/i18n';

export interface MergeSnapshot {
  doc: string;
  blocks: MergeBlock[];
  /** Texte final. */
  text: string;
  /** Blocs encore à choisir. */
  pending: number;
  /** La personne a choisi ou écrit quelque chose. */
  dirty: boolean;
}

/**
 * Comparateur : A et B côte à côte avec leurs blocs ajoutés, retirés ou changés, et dessous le résultat, qui se compose
 * en cochant ce qu'on garde de chaque bloc et reste modifiable. Sans `readonly`, il publie son état à chaque changement.
 */
const props = defineProps<{
  left: { label: string; text: string };
  right: { label: string; text: string };
  /** Version d'où A et B sont partis : on sait alors qui a changé quoi, et seuls les vrais conflits restent à choisir. */
  base?: string | null;
  /** Côté gardé d'office sur tous les blocs. */
  prefer?: DiffSide;
  readonly?: boolean;
  /** État laissé la fois précédente. */
  saved?: MergeSnapshot | null;
}>();
const emit = defineEmits<{ change: [snapshot: MergeSnapshot] }>();

const parts = diffParts(props.left.text, props.right.text, props.base ?? null);
const hunks = parts.flatMap((part) => (part.type === 'hunk' ? [part.hunk] : []));

function startingState(): { doc: string; blocks: MergeBlock[] } {
  const picks = hunks.map((hunk) => defaultPick(hunk, props.prefer ?? null));
  const { doc, ranges } = composeMerge(parts, picks);
  return { doc, blocks: picks.map((pick, index) => ({ ...pick, ...ranges[index]! })) };
}

const start = props.saved ?? startingState();
const blocks = shallowRef<MergeBlock[]>(start.blocks);
const pending = computed(() => (props.readonly ? 0 : blocks.value.filter((block) => !block.decided).length));
const counts = computed(() => hunks.reduce<Record<DiffKind, number>>((total, hunk) => ({ ...total, [hunk.kind]: total[hunk.kind] + 1 }), { added: 0, removed: 0, changed: 0 }));
const current = ref(Math.max(0, start.blocks.findIndex((block) => !block.decided)));

// --- Lignes affichées : ce qui est identique se replie, à part quelques lignes autour des blocs ---
const CONTEXT = 3;

type Row =
  | { key: string; type: 'fold'; part: number; count: number }
  | { key: string; type: 'head'; hunk: DiffHunk }
  | ({ key: string; type: 'line'; kind: DiffKind | 'same' } & DiffRow);

const expanded = ref(new Set<number>());
const detailed = new Map(hunks.map((hunk) => [hunk.index, hunkRows(hunk)]));

function sameRow(part: Extract<(typeof parts)[number], { type: 'same' }>, offset: number): Row {
  const line = part.lines[offset]!;
  const spans: DiffSpan[] = line ? [{ text: line, changed: false }] : [];
  return { key: `s${part.leftStart + offset}`, type: 'line', kind: 'same', leftLine: part.leftStart + offset + 1, rightLine: part.rightStart + offset + 1, left: spans, right: spans };
}

const rows = computed<Row[]>(() => {
  const list: Row[] = [];
  parts.forEach((part, index) => {
    if (part.type === 'hunk') {
      list.push({ key: `h${part.hunk.index}`, type: 'head', hunk: part.hunk });
      detailed.get(part.hunk.index)!.forEach((row, line) => list.push({ ...row, key: `h${part.hunk.index}-${line}`, type: 'line', kind: part.hunk.kind }));
      return;
    }
    const size = part.lines.length;
    const head = index === 0 ? 0 : CONTEXT;
    const tail = index === parts.length - 1 ? 0 : CONTEXT;
    if (expanded.value.has(index) || size <= head + tail + 1) {
      for (let offset = 0; offset < size; offset += 1) list.push(sameRow(part, offset));
      return;
    }
    for (let offset = 0; offset < head; offset += 1) list.push(sameRow(part, offset));
    list.push({ key: `f${index}`, type: 'fold', part: index, count: size - head - tail });
    for (let offset = size - tail; offset < size; offset += 1) list.push(sameRow(part, offset));
  });
  return list;
});

function expand(part: number): void {
  expanded.value = new Set([...expanded.value, part]);
}

const SIGNS: Record<DiffKind, string> = { added: '+', removed: '−', changed: '~' };

/** Teinte d'un côté de la ligne ; rien en face : case hachurée. */
function tone(row: Extract<Row, { type: 'line' }>, side: DiffSide): string {
  if (row[side] === null) return 'none';
  if (row.kind === 'same') return 'same';
  return row.kind === 'changed' ? 'mod' : row.kind === 'added' ? 'add' : 'del';
}

function sign(row: Extract<Row, { type: 'line' }>, side: DiffSide): string {
  return row.kind === 'same' || row[side] === null ? '' : SIGNS[row.kind];
}

function hunkStatus(hunk: DiffHunk): string {
  const block = blocks.value[hunk.index];
  if (props.readonly) return '';
  if (block && !block.decided) return t('À choisir');
  if (hunk.origin === 'left') return t('Changé dans A');
  if (hunk.origin === 'right') return t('Changé dans B');
  return '';
}

// --- Résultat ---
const host = ref<HTMLElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
const columns = ref<HTMLElement | null>(null);
let view: EditorView | null = null;
let dirty = props.saved?.dirty ?? false;

function publish(): void {
  if (!view) return;
  const list = view.state.field(mergeBlocks);
  blocks.value = list;
  const doc = view.state.doc.toString();
  emit('change', { doc, blocks: list, text: mergedText(doc), pending: list.filter((block) => !block.decided).length, dirty });
}

function setPick(index: number, pick: DiffPick): void {
  if (!view) return;
  const { state } = view;
  const list = state.field(mergeBlocks);
  const block = list[index]!;
  const text = pickedText(hunks[index]!, pick);
  const shift = text.length - (block.to - block.from);
  const next = list.map((entry, position) => {
    if (position === index) return { ...pick, from: block.from, to: block.from + text.length };
    return position < index ? entry : { ...entry, from: entry.from + shift, to: entry.to + shift };
  });
  // Hors de l'annulation : Ctrl+Z défait ce qui a été écrit, la case se décoche d'elle-même.
  view.dispatch({ changes: { from: block.from, to: block.to, insert: text }, effects: setBlocks.of(next), annotations: Transaction.addToHistory.of(false) });
}

function toggle(index: number, side: DiffSide, value: boolean): void {
  const block = blocks.value[index];
  if (!block) return;
  current.value = index;
  setPick(index, { left: block.left, right: block.right, decided: true, [side]: value });
}

function takeAll(side: DiffSide): void {
  for (const hunk of hunks) setPick(hunk.index, { left: side === 'left', right: side === 'right', decided: true });
}

function reset(): void {
  if (!view) return;
  const { doc, blocks: fresh } = startingState();
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc }, effects: setBlocks.of(fresh), annotations: Transaction.addToHistory.of(false) });
  dirty = false;
  publish();
}

// --- Navigation ---
function show(index: number): void {
  current.value = index;
  const element = scroller.value?.querySelector<HTMLElement>(`[data-hunk="${index}"]`);
  if (element) scroller.value?.scrollTo({ top: element.offsetTop - (columns.value?.offsetHeight ?? 0), behavior: 'smooth' });
  const block = blocks.value[index];
  if (view && block) view.dispatch({ effects: EditorView.scrollIntoView(Math.min(block.from, view.state.doc.length), { y: 'center' }) });
}

function step(delta: number): void {
  if (hunks.length) show((current.value + delta + hunks.length) % hunks.length);
}

function onResultClick(event: MouseEvent): void {
  const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-merge-block]');
  if (chip) show(Number(chip.dataset.mergeBlock));
}

const FONT_MONO = 'ui-monospace, SFMono-Regular, Consolas, monospace';

onMounted(() => {
  if (!props.readonly && host.value) {
    view = new EditorView({
      parent: host.value,
      state: EditorState.create({
        doc: start.doc,
        extensions: [
          mergeResult(start.blocks, (index) => t('Bloc {n} à choisir', { n: index + 1 })),
          lineNumbers(),
          history(),
          drawSelection(),
          markdown(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': t('Résultat') }),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged && !update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(setBlocks)))) return;
            dirty = true;
            publish();
          }),
          EditorView.theme({
            '&': { height: '100%', fontSize: '0.82rem', backgroundColor: 'transparent', color: 'var(--fb-text)' },
            '&.cm-focused': { outline: 'none' },
            '.cm-scroller': { fontFamily: FONT_MONO, lineHeight: '1.5' },
            '.cm-gutters': { backgroundColor: 'transparent', borderRight: '1px solid var(--fb-border)', color: 'var(--fb-muted)' },
            '.cm-cursor': { borderLeftColor: 'var(--fb-text)' },
            '.cm-merge-left': { backgroundColor: 'color-mix(in srgb, #3b82f6 12%, transparent)' },
            '.cm-merge-right': { backgroundColor: 'color-mix(in srgb, #a855f7 12%, transparent)' },
            '.cm-merge-both': { backgroundColor: 'color-mix(in srgb, #14b8a6 12%, transparent)' },
            '.cm-merge-pending': {
              display: 'block',
              width: '100%',
              padding: '0.1rem 0.5rem',
              border: '1px dashed #d97706',
              borderRadius: '4px',
              background: 'color-mix(in srgb, #d97706 12%, transparent)',
              color: '#d97706',
              font: 'inherit',
              fontWeight: '600',
              textAlign: 'left',
              cursor: 'pointer',
            },
          }),
        ],
      }),
    });
    publish();
  }
  const first = pending.value ? current.value : -1;
  if (first >= 0) void nextTick(() => show(first));
});

onBeforeUnmount(() => {
  view?.destroy();
  view = null;
});
</script>

<template>
  <div class="merge" :class="{ readonly }">
    <div v-if="hunks.length" class="bar">
      <Button v-tooltip.bottom="$t('Bloc précédent')" icon="pi pi-chevron-up" text rounded size="small" severity="secondary" :aria-label="$t('Bloc précédent')" @click="step(-1)" />
      <span class="small position">{{ $t('Bloc {n} sur {total}', { n: current + 1, total: hunks.length }) }}</span>
      <Button v-tooltip.bottom="$t('Bloc suivant')" icon="pi pi-chevron-down" text rounded size="small" severity="secondary" :aria-label="$t('Bloc suivant')" @click="step(1)" />
      <span v-tooltip.bottom="$t('Ajouté dans B')" class="stat add">+{{ counts.added }}</span>
      <span v-tooltip.bottom="$t('Retiré dans B')" class="stat del">−{{ counts.removed }}</span>
      <span v-tooltip.bottom="$t('Modifié')" class="stat mod">~{{ counts.changed }}</span>
      <span v-if="pending" class="small waiting"><i class="pi pi-exclamation-circle"></i> {{ $t('{n} bloc à choisir|{n} blocs à choisir', { n: pending }) }}</span>
      <span class="spacer"></span>
      <template v-if="!readonly">
        <Button v-tooltip.bottom="$t('Prendre tous les blocs de A')" :label="$t('Tout A')" text size="small" severity="secondary" @click="takeAll('left')" />
        <Button v-tooltip.bottom="$t('Prendre tous les blocs de B')" :label="$t('Tout B')" text size="small" severity="secondary" @click="takeAll('right')" />
        <Button :label="$t('Réinitialiser')" icon="pi pi-undo" text size="small" severity="secondary" @click="reset" />
      </template>
    </div>

    <div v-if="!hunks.length" class="identical muted"><i class="pi pi-check-circle"></i> {{ $t('Aucune différence entre ces deux versions.') }}</div>
    <div v-else ref="scroller" class="diff" :aria-label="$t('Comparaison')">
      <div ref="columns" class="columns">
        <span class="column"><b class="letter a">A</b> <span class="truncate">{{ left.label }}</span></span>
        <span class="column"><b class="letter b">B</b> <span class="truncate">{{ right.label }}</span></span>
      </div>
      <template v-for="row in rows" :key="row.key">
        <button v-if="row.type === 'fold'" type="button" class="fold" @click="expand(row.part)"><i class="pi pi-arrows-v"></i> {{ $t('{n} ligne identique|{n} lignes identiques', { n: row.count }) }}</button>

        <div v-else-if="row.type === 'head'" class="hunk" :class="[row.hunk.kind, { current: row.hunk.index === current, waiting: !readonly && !blocks[row.hunk.index]?.decided }]" :data-hunk="row.hunk.index" @click="current = row.hunk.index">
          <label v-if="!readonly" class="pick a">
            <Checkbox :model-value="blocks[row.hunk.index]?.left" binary size="small" :aria-label="$t('Garder le bloc {n} de A', { n: row.hunk.index + 1 })" @update:model-value="toggle(row.hunk.index, 'left', $event)" />
            <span>{{ $t('Garder A') }}</span>
          </label>
          <span class="hunk-title">
            <b class="glyph">{{ SIGNS[row.hunk.kind] }}</b> {{ $t('Bloc {n}', { n: row.hunk.index + 1 }) }}<template v-if="hunkStatus(row.hunk)"> · {{ hunkStatus(row.hunk) }}</template>
          </span>
          <label v-if="!readonly" class="pick b">
            <span>{{ $t('Garder B') }}</span>
            <Checkbox :model-value="blocks[row.hunk.index]?.right" binary size="small" :aria-label="$t('Garder le bloc {n} de B', { n: row.hunk.index + 1 })" @update:model-value="toggle(row.hunk.index, 'right', $event)" />
          </label>
        </div>

        <div v-else class="row" :class="{ same: row.kind === 'same' }">
          <template v-for="side in (['left', 'right'] as const)" :key="side">
            <span class="no" :class="[tone(row, side), side]">{{ side === 'left' ? row.leftLine : row.rightLine }}</span>
            <span class="sign" :class="[tone(row, side), side]">{{ sign(row, side) }}</span>
            <span class="text" :class="[tone(row, side), side]"><span v-for="(span, index) in row[side] ?? []" :key="index" :class="{ word: span.changed }">{{ span.text }}</span></span>
          </template>
        </div>
      </template>
    </div>

    <section v-if="!readonly" class="result">
      <header class="result-head">
        <strong>{{ $t('Résultat') }}</strong>
        <span class="muted small">{{ $t('modifiable') }}</span>
      </header>
      <div ref="host" class="host" @click="onResultClick"></div>
    </section>
  </div>
</template>

<style scoped>
.merge {
  --merge-a: #3b82f6;
  --merge-b: #a855f7;
  --merge-add: #16a34a;
  --merge-del: var(--fb-danger);
  --merge-mod: #d97706;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  height: 100%;
  min-height: 0;
}
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.15rem 0.5rem;
}
.position {
  white-space: nowrap;
}
.stat {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 0.8rem;
  font-weight: 700;
}
.stat.add {
  margin-left: 0.5rem;
  color: var(--merge-add);
}
.stat.del {
  color: var(--merge-del);
}
.stat.mod {
  color: var(--merge-mod);
}
.waiting {
  color: var(--merge-mod);
  font-weight: 600;
}
.spacer {
  flex: 1;
}
.identical {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: 6rem;
}
.diff {
  position: relative;
  flex: 3 1 0;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--fb-border);
  border-radius: 8px;
  background: var(--fb-panel);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 0.8rem;
  line-height: 1.45;
}
.readonly .diff {
  flex: 1 1 0;
}
.columns {
  position: sticky;
  top: 0;
  z-index: 2;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  border-bottom: 1px solid var(--fb-border);
  background: var(--fb-panel-alt);
  font-family: var(--fb-font, inherit);
}
.column {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
  padding: 0.25rem 0.6rem;
  font-size: 0.78rem;
  font-weight: 600;
}
.letter {
  display: inline-grid;
  place-items: center;
  width: 1.15rem;
  height: 1.15rem;
  flex-shrink: 0;
  border-radius: 4px;
  color: #fff;
  font-size: 0.68rem;
}
.letter.a {
  background: var(--merge-a);
}
.letter.b {
  background: var(--merge-b);
}
.fold {
  display: block;
  width: 100%;
  padding: 0.1rem;
  border: 0;
  border-top: 1px dashed var(--fb-border);
  border-bottom: 1px dashed var(--fb-border);
  background: var(--fb-panel-alt);
  color: var(--fb-muted);
  font: inherit;
  font-size: 0.72rem;
  cursor: pointer;
}
.fold:hover {
  color: var(--fb-text);
}
.fold .pi {
  font-size: 0.65rem;
}
.hunk {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 0.5rem;
  padding: 0.1rem 0.5rem;
  border-top: 1px solid var(--fb-border);
  background: var(--fb-panel-alt);
  font-size: 0.74rem;
}
.hunk.current {
  box-shadow: inset 3px 0 0 var(--fb-accent);
}
.hunk.waiting {
  background: color-mix(in srgb, var(--merge-mod) 14%, var(--fb-panel));
}
.readonly .hunk {
  grid-template-columns: 1fr;
}
.hunk-title {
  white-space: nowrap;
}
.glyph {
  margin-right: 0.15rem;
}
.hunk.added .glyph {
  color: var(--merge-add);
}
.hunk.removed .glyph {
  color: var(--merge-del);
}
.hunk.changed .glyph {
  color: var(--merge-mod);
}
.pick {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
  font-weight: 600;
  cursor: pointer;
}
.pick.b {
  justify-content: flex-end;
}
.row {
  display: grid;
  grid-template-columns: 2.6rem 1rem minmax(0, 1fr) 2.6rem 1rem minmax(0, 1fr);
}
.no {
  padding-right: 0.3rem;
  color: var(--fb-muted);
  font-size: 0.7rem;
  line-height: 1.65;
  text-align: right;
  user-select: none;
}
.sign {
  font-weight: 700;
  text-align: center;
  user-select: none;
}
.text {
  min-width: 0;
  min-height: 1.45em;
  padding-right: 0.4rem;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.no.right {
  border-left: 1px solid var(--fb-border);
}
.add {
  --tone: var(--merge-add);
}
.del {
  --tone: var(--merge-del);
}
.mod {
  --tone: var(--merge-mod);
}
.row .add,
.row .del,
.row .mod {
  background: color-mix(in srgb, var(--tone) 13%, transparent);
}
.row .sign.add,
.row .sign.del,
.row .sign.mod {
  color: var(--tone);
}
.row .none {
  background: repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in srgb, var(--fb-muted) 16%, transparent) 4px 5px);
}
.word {
  border-radius: 2px;
  background: color-mix(in srgb, var(--tone) 36%, transparent);
}
.result {
  display: flex;
  flex: 2 1 0;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--fb-border);
  border-radius: 8px;
  background: var(--fb-panel);
  overflow: hidden;
}
.result-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.25rem 0.6rem;
  border-bottom: 1px solid var(--fb-border);
  background: var(--fb-panel-alt);
  font-size: 0.78rem;
}
.host {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.host :deep(.cm-editor) {
  height: 100%;
}
@media (max-width: 700px) {
  .columns {
    display: none;
  }
  .row {
    grid-template-columns: 2.2rem 0.9rem minmax(0, 1fr);
  }
  .row.same .right,
  .row .none {
    display: none;
  }
  .no.right {
    border-left: 0;
  }
  .hunk-title {
    white-space: normal;
  }
}
</style>
