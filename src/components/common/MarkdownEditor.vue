<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { pastedFileName } from '@shared/attachmentMarkdown';
import MentionTextarea from '@/components/common/MentionTextarea.vue';
import { claimFiles, droppedFiles, hasFiles } from '@/composables/useFileDrop';
import MarkdownImageDialog from './MarkdownImageDialog.vue';
import type { MarkdownImageSupport } from './markdownImages';

import { t } from '@/i18n';
/**
 * Éditeur Markdown : barre d'outils (gras, titres, listes, liens, tableau, code, formule, diagramme) et mentions @.
 * Avec `images`, il accepte aussi les images : bouton « Image », coller une capture, glisser-déposer un fichier.
 */
defineOptions({ inheritAttrs: false });
const props = defineProps<{ images?: MarkdownImageSupport }>();
const model = defineModel<string>({ required: true });
const emit = defineEmits<{ blur: [event: FocusEvent]; focus: [event: FocusEvent]; escape: [] }>();

const editor = ref<InstanceType<typeof MentionTextarea> | null>(null);
/** Le clic sur un bouton de la barre ne doit pas être pris pour une sortie du champ. */
const usingToolbar = ref(false);

type Action = { icon: string; label: string; shortcut?: string; run: () => void } | 'sep';

function area(): HTMLTextAreaElement | null {
  return editor.value?.element() ?? null;
}

/** Remplace la sélection par `before + sélection (ou texte par défaut) + after` et resélectionne le texte. */
function wrap(before: string, after = before, placeholder = ''): void {
  const el = area();
  if (!el) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const selected = model.value.slice(start, end) || placeholder;
  model.value = model.value.slice(0, start) + before + selected + after + model.value.slice(end);
  void nextTick(() => {
    el.focus();
    el.setSelectionRange(start + before.length, start + before.length + selected.length);
  });
}

/** Ajoute un préfixe au début de chaque ligne sélectionnée (listes, citations, titres). */
function prefixLines(prefix: string | ((index: number) => string)): void {
  const el = area();
  if (!el) return;
  const start = model.value.lastIndexOf('\n', el.selectionStart - 1) + 1;
  const endIndex = model.value.indexOf('\n', el.selectionEnd);
  const end = endIndex < 0 ? model.value.length : endIndex;
  const lines = model.value.slice(start, end).split('\n');
  const next = lines.map((line, index) => `${typeof prefix === 'string' ? prefix : prefix(index)}${line}`).join('\n');
  model.value = model.value.slice(0, start) + next + model.value.slice(end);
  void nextTick(() => {
    el.focus();
    el.setSelectionRange(start, start + next.length);
  });
}

/** Insère un bloc sur ses propres lignes. */
function block(text: string, selectFrom = 0, selectLength = 0): void {
  const el = area();
  if (!el) return;
  const start = el.selectionStart;
  const before = model.value.slice(0, start);
  const lead = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
  const insert = `${lead}${text}\n`;
  model.value = before + insert + model.value.slice(el.selectionEnd);
  void nextTick(() => {
    el.focus();
    const from = start + lead.length + selectFrom;
    el.setSelectionRange(from, from + selectLength);
  });
}

// --- Images : choisies, collées, glissées --------------------------------------------------------------------------------

const imageOpen = ref(false);
/** Sélection au moment d'ouvrir « Insérer une image » (le champ perd le focus pendant ce temps). */
let saved: { start: number; end: number } | null = null;
let sequence = 0;

/** Pose `text` sur ses propres lignes, à la sélection (`at`), à la fin (`'end'`) ou au curseur. */
function insertBlock(text: string, at: { start: number; end: number } | 'end' | null = null): void {
  const el = area();
  const start = at === 'end' ? model.value.length : at ? at.start : (el?.selectionStart ?? model.value.length);
  const end = at === 'end' ? model.value.length : at ? at.end : (el?.selectionEnd ?? start);
  const before = model.value.slice(0, start);
  const after = model.value.slice(end);
  const lead = before && !before.endsWith('\n') ? '\n' : '';
  const trail = after.startsWith('\n') ? '' : '\n';
  model.value = before + lead + text + trail + after;
  const caret = start + lead.length + text.length + trail.length;
  void nextTick(() => {
    el?.focus();
    el?.setSelectionRange(caret, caret);
  });
}

/** Envoie des fichiers : un repère « Envoi… » apparaît tout de suite à leur place, remplacé par l'image une fois jointe. */
function insertFiles(files: File[], at: { start: number; end: number } | 'end' | null = null): void {
  const support = props.images;
  if (!support || !files.length) return;
  const now = new Date();
  const named = files.map((file, index) => {
    const name = pastedFileName(file.name, now, index, files.length);
    return name === file.name ? file : new File([file], name, { type: file.type });
  });
  const tokens = named.map((file) => `![${t('Envoi de {name}…', { name: file.name.replace(/[[\]\\]/g, '') })}](envoi:${Date.now().toString(36)}${(sequence += 1)})`);
  insertBlock(tokens.join('\n'), at);
  named.forEach((file, index) => support.upload(file, tokens[index]!));
}

function openImages(): void {
  const el = area();
  saved = el ? { start: el.selectionStart, end: el.selectionEnd } : null;
  imageOpen.value = true;
}
// Fenêtre refermée sans choix : on reprend la saisie là où elle en était.
watch(imageOpen, (open) => {
  if (!open) void nextTick(() => area()?.focus());
});

function onPaste(event: ClipboardEvent): void {
  const files = Array.from(event.clipboardData?.files ?? []);
  if (!props.images || !files.length) return;
  event.preventDefault();
  claimFiles(event);
  insertFiles(files);
}

const dropping = ref(false);
function onDragOver(event: DragEvent): void {
  if (!props.images || !hasFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  dropping.value = true;
}
function onDragLeave(event: DragEvent): void {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) dropping.value = false;
}
function onDrop(event: DragEvent): void {
  dropping.value = false;
  if (!props.images || !hasFiles(event)) return;
  event.preventDefault();
  claimFiles(event);
  insertFiles(droppedFiles(event));
}

const actions = computed<Action[]>(() => [
  { icon: 'fb-glyph-bold', label: t('Gras'), shortcut: 'Ctrl+B', run: () => wrap('**', '**', t('texte')) },
  { icon: 'fb-glyph-italic', label: t('Italique'), shortcut: 'Ctrl+I', run: () => wrap('_', '_', t('texte')) },
  { icon: 'pi pi-minus', label: t('Barré'), run: () => wrap('~~', '~~', t('texte')) },
  { icon: 'pi pi-hashtag', label: t('Titre'), run: () => prefixLines('## ') },
  'sep',
  { icon: 'pi pi-list', label: t('Liste à puces'), run: () => prefixLines('- ') },
  { icon: 'pi pi-sort-numeric-down', label: t('Liste numérotée'), run: () => prefixLines((index) => `${index + 1}. `) },
  { icon: 'pi pi-check-square', label: t('Liste de tâches'), run: () => prefixLines('- [ ] ') },
  { icon: 'pi pi-comment', label: t('Citation'), run: () => prefixLines('> ') },
  'sep',
  { icon: 'pi pi-link', label: t('Lien'), shortcut: 'Ctrl+K', run: () => wrap('[', '](https://)', t('texte du lien')) },
  { icon: 'pi pi-code', label: t('Code'), run: () => wrap('`', '`', 'code') },
  { icon: 'pi pi-book', label: t('Bloc de code'), run: () => block('```\n\n```', 4, 0) },
  { icon: 'pi pi-table', label: t('Tableau'), run: () => block(`| ${t('Colonne')} 1 | ${t('Colonne')} 2 |\n| --- | --- |\n| | |`, 2, t('Colonne').length + 2) },
  'sep',
  { icon: 'pi pi-calculator', label: t('Formule (LaTeX)'), run: () => wrap('$', '$', 'E = mc^2') },
  { icon: 'pi pi-sitemap', label: t('Diagramme Mermaid'), run: () => block('```mermaid\nflowchart LR\n  A[Début] --> B{Choix}\n  B -->|Oui| C[Fin]\n```', 11, 0) },
  { icon: 'pi pi-at', label: t('Mentionner'), run: () => wrap('@', '', '') },
  ...(props.images ? (['sep', { icon: 'pi pi-image', label: t('Image'), run: openImages }] as Action[]) : []),
]);

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    emit('escape');
    return;
  }
  if (!(event.ctrlKey || event.metaKey)) return;
  const key = event.key.toLowerCase();
  if (key === 'b' || key === 'i' || key === 'k') {
    event.preventDefault();
    const action = actions.value.find((entry) => entry !== 'sep' && entry.shortcut === `Ctrl+${key.toUpperCase()}`);
    if (action && action !== 'sep') action.run();
  }
}

function onBlur(event: FocusEvent): void {
  // La fenêtre « Insérer une image » prend le focus : ce n'est pas une sortie du champ.
  if (usingToolbar.value || imageOpen.value) return;
  emit('blur', event);
}

defineExpose({ focus: () => editor.value?.focus(), insertFiles });
</script>

<template>
  <div class="md-editor" :class="{ dropping }" :data-image-drop="images ? '' : undefined" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
    <div class="toolbar" role="toolbar" :aria-label="$t('Mise en forme')" @mousedown="usingToolbar = true" @mouseup="usingToolbar = false" @mouseleave="usingToolbar = false">
      <template v-for="(action, index) in actions" :key="index">
        <span v-if="action === 'sep'" class="sep" aria-hidden="true"></span>
        <button
          v-else
          v-tooltip.top="action.shortcut ? `${action.label} (${action.shortcut})` : action.label"
          type="button"
          class="tool"
          :aria-label="action.label"
          @mousedown.prevent
          @click="action.run()"
        >
          <i :class="action.icon"></i>
        </button>
      </template>
      <span class="hint muted">{{ $t('Markdown') }}</span>
    </div>
    <MentionTextarea ref="editor" v-model="model" v-bind="$attrs" class="area" @keydown="onKeydown" @focus="emit('focus', $event)" @blur="onBlur" @paste="onPaste" />
    <MarkdownImageDialog
      v-if="images"
      v-model:visible="imageOpen"
      :choices="imageOpen ? images.choices() : []"
      :empty-text="images.emptyText"
      @pick="(markdown) => insertBlock(markdown, saved)"
      @upload="(files) => insertFiles(files, saved)"
    />
  </div>
</template>

<style scoped>
.md-editor {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--fb-border);
  border-radius: 8px;
  background: var(--fb-panel);
}
.md-editor:focus-within {
  border-color: var(--fb-accent);
}
.md-editor.dropping {
  border-color: var(--fb-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--fb-accent) 25%, transparent);
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.1rem;
  padding: 0.25rem 0.35rem;
  border-bottom: 1px solid var(--fb-border);
}
.tool {
  display: grid;
  place-items: center;
  width: 1.85rem;
  height: 1.85rem;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--fb-muted);
  cursor: pointer;
}
.tool:hover,
.tool:focus-visible {
  background: var(--fb-panel-alt);
  color: var(--fb-text);
  outline: none;
}
.tool i {
  font-size: 0.85rem;
}
.sep {
  width: 1px;
  height: 1.2rem;
  margin: 0 0.25rem;
  background: var(--fb-border);
}
.hint {
  margin-left: auto;
  font-size: 0.7rem;
}
.area :deep(textarea) {
  border: 0;
  border-radius: 0 0 8px 8px;
  box-shadow: none;
  font-family: var(--fb-font-mono, ui-monospace, 'Cascadia Mono', Consolas, monospace);
  font-size: 0.85rem;
}
</style>
