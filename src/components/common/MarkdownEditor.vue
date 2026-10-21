<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import MentionTextarea from '@/components/common/MentionTextarea.vue';

import { t } from '@/i18n';
/** Éditeur Markdown : barre d'outils (gras, titres, listes, liens, tableau, code, formule, diagramme) et mentions @. */
defineOptions({ inheritAttrs: false });
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

const actions = computed<Action[]>(() => [
  { icon: 'pi pi-bold', label: t('Gras'), shortcut: 'Ctrl+B', run: () => wrap('**', '**', t('texte')) },
  { icon: 'pi pi-italic', label: t('Italique'), shortcut: 'Ctrl+I', run: () => wrap('_', '_', t('texte')) },
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
  if (usingToolbar.value) return;
  emit('blur', event);
}

defineExpose({ focus: () => editor.value?.focus() });
</script>

<template>
  <div class="md-editor">
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
    <MentionTextarea ref="editor" v-model="model" v-bind="$attrs" class="area" @keydown="onKeydown" @focus="emit('focus', $event)" @blur="onBlur" />
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
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 0.85rem;
}
</style>
