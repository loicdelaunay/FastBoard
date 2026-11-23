<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { parseNoteSearch } from '@shared/noteSearch';
import { explainSearch, searchTips } from './explain';
import { FIND_LIMIT, type FindOptions, type FindResult } from './find';

import { t } from '@/i18n';
/**
 * Barre de recherche d'une note (Ctrl F), à la manière de VS Code et d'Obsidian : options dans le champ (casse, mot
 * entier, expression régulière), compteur « 3 sur 12 », précédent et suivant, remplacement en écriture (Ctrl H), et la
 * syntaxe de recherche d'Obsidian (aide « ? », et « Expliquer la recherche »).
 */
const props = defineProps<{
  result: FindResult;
  canReplace: boolean;
  /** En lecture, la recherche contient du Markdown, qui ne se trouve que dans le source. */
  markdownHint?: boolean;
  /** On peut passer en « Lecture et écriture » pour chercher dans le Markdown. */
  canSwitch?: boolean;
}>();
const options = defineModel<FindOptions>({ required: true });
const replaceOpen = defineModel<boolean>('replaceOpen', { default: false });
const emit = defineEmits<{ next: []; previous: []; close: []; replace: []; replaceAll: []; source: [] }>();

const EXPLAIN_KEY = 'fb.docs.findExplain';
const helpOpen = ref(false);
const explain = ref((() => {
  try {
    return localStorage.getItem(EXPLAIN_KEY) === '1';
  } catch {
    return false;
  }
})());
watch(explain, (value) => {
  try {
    localStorage.setItem(EXPLAIN_KEY, value ? '1' : '0');
  } catch {
    // Stockage indisponible : le choix vaut pour cette page seulement.
  }
});
const tips = searchTips();
const parsed = computed(() => parseNoteSearch(options.value.search, options.value));
const explanation = computed(() => (parsed.value.node ? t('Cherche {what}.', { what: explainSearch(parsed.value.node) }) : ''));

/** Exemple de l'aide : il s'ajoute à la recherche, curseur à la fin. */
function useTip(example: string): void {
  const current = options.value.search.trim();
  set('search', current ? `${current} ${example}` : example);
  void focus('search', false);
}

const searchInput = ref<HTMLInputElement | null>(null);
const replaceInput = ref<HTMLInputElement | null>(null);

const set = <K extends keyof FindOptions>(key: K, value: FindOptions[K]): void => {
  options.value = { ...options.value, [key]: value };
};

const label = computed(() => {
  if (!options.value.search) return '';
  if (props.result.invalid) return t('Expression invalide');
  if (!props.result.total) return t('Aucun résultat');
  const total = props.result.total >= FIND_LIMIT ? `${FIND_LIMIT}+` : String(props.result.total);
  return props.result.current < 0 ? t('{n} résultats', { n: total }) : t('{current} sur {total}', { current: props.result.current + 1, total });
});
const empty = computed(() => !!options.value.search && (props.result.invalid || !props.result.total));

function onSearchKey(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    if (event.shiftKey) emit('previous');
    else emit('next');
  } else if (event.altKey && !event.ctrlKey && !event.metaKey) {
    const key = event.code;
    if (key === 'KeyC') set('caseSensitive', !options.value.caseSensitive);
    else if (key === 'KeyW') set('wholeWord', !options.value.wholeWord);
    else if (key === 'KeyR') set('regexp', !options.value.regexp);
    else return;
    event.preventDefault();
  }
}

function onReplaceKey(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) emit('replaceAll');
    else emit('replace');
  }
}

/** Met le curseur dans la recherche (texte sélectionné), ou dans le remplacement. */
async function focus(target: 'search' | 'replace' = 'search', select = true): Promise<void> {
  await nextTick();
  const input = target === 'replace' ? replaceInput.value : searchInput.value;
  input?.focus();
  if (select) input?.select();
}

function contains(element: Element | null): boolean {
  return !!element && !!searchInput.value?.closest('.find-bar')?.contains(element);
}

defineExpose({ focus, contains });
</script>

<template>
  <div class="find-bar" role="search" :aria-label="$t('Rechercher dans la note')" @keydown.esc.prevent="emit('close')">
    <button
      v-if="canReplace"
      v-tooltip.bottom="replaceOpen ? $t('Masquer le remplacement') : $t('Remplacer (Ctrl H)')"
      type="button"
      class="expand"
      :aria-expanded="replaceOpen"
      :aria-label="$t('Remplacer')"
      @click="replaceOpen = !replaceOpen"
    >
      <i :class="replaceOpen ? 'pi pi-chevron-down' : 'pi pi-chevron-right'"></i>
    </button>
    <div class="rows">
      <div class="row">
        <div class="find-field" :class="{ empty, invalid: result.invalid }">
          <input
            ref="searchInput"
            :value="options.search"
            type="text"
            spellcheck="false"
            autocomplete="off"
            :placeholder="$t('Rechercher')"
            :aria-label="$t('Rechercher')"
            @input="set('search', ($event.target as HTMLInputElement).value)"
            @keydown="onSearchKey"
          />
          <button v-tooltip.bottom="$t('Respecter la casse (Alt C)')" type="button" class="option" :class="{ on: options.caseSensitive }" :aria-pressed="options.caseSensitive" :aria-label="$t('Respecter la casse')" @click="set('caseSensitive', !options.caseSensitive)">Aa</button>
          <button v-tooltip.bottom="$t('Mot entier (Alt W)')" type="button" class="option word" :class="{ on: options.wholeWord }" :aria-pressed="options.wholeWord" :aria-label="$t('Mot entier')" @click="set('wholeWord', !options.wholeWord)">ab</button>
          <button v-tooltip.bottom="$t('Expression régulière (Alt R)')" type="button" class="option" :class="{ on: options.regexp }" :aria-pressed="options.regexp" :aria-label="$t('Expression régulière')" @click="set('regexp', !options.regexp)">.*</button>
        </div>
        <span class="count" :class="{ empty }" aria-live="polite">{{ label }}</span>
        <button v-tooltip.bottom="$t('Précédent (Maj Entrée)')" type="button" class="icon" :disabled="!result.total" :aria-label="$t('Résultat précédent')" @click="emit('previous')"><i class="pi pi-arrow-up"></i></button>
        <button v-tooltip.bottom="$t('Suivant (Entrée)')" type="button" class="icon" :disabled="!result.total" :aria-label="$t('Résultat suivant')" @click="emit('next')"><i class="pi pi-arrow-down"></i></button>
        <button v-tooltip.bottom="$t('Options de recherche')" type="button" class="icon" :class="{ on: helpOpen }" :aria-expanded="helpOpen" :aria-label="$t('Options de recherche')" @click="helpOpen = !helpOpen"><i class="pi pi-question-circle"></i></button>
        <button v-tooltip.bottom="$t('Fermer (Échap)')" type="button" class="icon" :aria-label="$t('Fermer la recherche')" @click="emit('close')"><i class="pi pi-times"></i></button>
      </div>
      <p v-if="parsed.error && options.search" class="note error">{{ $t(parsed.error) }}</p>
      <p v-else-if="explain && explanation" class="note muted">{{ explanation }}</p>
      <p v-if="markdownHint" class="note hint">
        <i class="pi pi-info-circle"></i>
        <span>{{ $t('En lecture, on cherche dans le texte affiché : la syntaxe Markdown se trouve dans le source.') }}</span>
        <button v-if="canSwitch" type="button" class="link" @click="emit('source')">{{ $t('Chercher dans le Markdown') }}</button>
      </p>
      <div v-if="helpOpen" class="help">
        <label class="explain">
          <input v-model="explain" type="checkbox" />
          <span>{{ $t('Expliquer la recherche') }}</span>
        </label>
        <p class="muted small">{{ $t('Comme dans Obsidian, la recherche comprend ces options (clic pour les ajouter) :') }}</p>
        <ul class="tips">
          <li v-for="tip in tips" :key="tip.example">
            <button type="button" class="tip" @click="useTip(tip.example)"><code>{{ tip.example }}</code></button>
            <span class="muted small">{{ tip.text }}</span>
          </li>
        </ul>
      </div>
      <div v-if="canReplace && replaceOpen" class="row">
        <div class="find-field">
          <input
            ref="replaceInput"
            :value="options.replace"
            type="text"
            spellcheck="false"
            autocomplete="off"
            :placeholder="$t('Remplacer par')"
            :aria-label="$t('Remplacer par')"
            @input="set('replace', ($event.target as HTMLInputElement).value)"
            @keydown="onReplaceKey"
          />
        </div>
        <button v-tooltip.bottom="$t('Remplacer (Entrée)')" type="button" class="text" :disabled="!result.total" @click="emit('replace')">{{ $t('Remplacer') }}</button>
        <button v-tooltip.bottom="$t('Tout remplacer (Ctrl Entrée)')" type="button" class="text" :disabled="!result.total" @click="emit('replaceAll')">{{ $t('Tout') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.find-bar {
  display: flex;
  align-items: flex-start;
  gap: 0.2rem;
  padding: 0.3rem;
  border: 1px solid var(--fb-border);
  border-radius: 8px;
  background: var(--fb-panel);
  box-shadow: var(--fb-shadow-lg);
  font-size: 0.85rem;
}
.rows {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.row {
  display: flex;
  align-items: center;
  gap: 0.15rem;
}
.find-field {
  display: flex;
  align-items: center;
  width: min(17rem, 52vw);
  height: 1.9rem;
  padding: 0 0.2rem 0 0.5rem;
  border: 1px solid var(--fb-border);
  border-radius: 6px;
  background: var(--fb-bg);
}
.find-field:focus-within {
  border-color: var(--fb-accent);
  box-shadow: 0 0 0 2px var(--fb-accent-soft);
}
.find-field.empty {
  border-color: color-mix(in srgb, var(--fb-danger) 70%, transparent);
}
.find-field input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: none;
  color: var(--fb-text);
  font: inherit;
}
.option,
.icon,
.expand,
.text {
  display: grid;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 5px;
  background: none;
  color: var(--fb-muted);
  font: inherit;
  cursor: pointer;
}
.option {
  width: 1.55rem;
  height: 1.4rem;
  font-family: var(--fb-font-mono, ui-monospace, Consolas, monospace);
  font-size: 0.75rem;
  font-weight: 600;
}
.option.word {
  text-decoration: underline;
  text-underline-offset: 2px;
}
.option:hover,
.icon:hover:not(:disabled),
.expand:hover,
.text:hover:not(:disabled) {
  background: var(--fb-panel-alt);
  color: var(--fb-text);
}
.option.on {
  border-color: var(--fb-accent);
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
}
.icon {
  width: 1.75rem;
  height: 1.75rem;
  font-size: 0.8rem;
}
.expand {
  width: 1.1rem;
  height: 1.9rem;
  font-size: 0.7rem;
}
.text {
  height: 1.75rem;
  padding: 0 0.5rem;
  white-space: nowrap;
}
.icon:disabled,
.text:disabled {
  opacity: 0.4;
  cursor: default;
}
.icon.on {
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
}
.note {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  max-width: 30rem;
  margin: 0;
  padding: 0.1rem 0.35rem;
  font-size: 0.78rem;
}
.note.error {
  color: var(--fb-danger);
}
.note.hint {
  display: block;
  color: var(--fb-muted);
}
.note.hint .pi {
  margin-right: 0.3rem;
  font-size: 0.75rem;
}
.note.hint .link {
  margin-left: 0.3rem;
}
.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--fb-accent);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
.help {
  max-width: 30rem;
  margin-top: 0.15rem;
  padding: 0.45rem 0.4rem 0.2rem;
  border-top: 1px solid var(--fb-border);
}
.help p {
  margin: 0.35rem 0;
}
.explain {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
}
.tips {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.25rem 0.6rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.tips li {
  display: contents;
}
.tip {
  justify-self: start;
  padding: 0.05rem 0.35rem;
  border: 1px solid var(--fb-border);
  border-radius: 5px;
  background: var(--fb-bg);
  color: var(--fb-text);
  font: inherit;
  cursor: pointer;
}
.tip:hover {
  border-color: var(--fb-accent);
}
.tip code {
  font-family: var(--fb-font-mono, ui-monospace, Consolas, monospace);
  font-size: 0.78rem;
}
.tips .small {
  align-self: center;
}
.count {
  min-width: 5.5rem;
  padding: 0 0.35rem;
  color: var(--fb-muted);
  font-size: 0.78rem;
  white-space: nowrap;
}
.count.empty {
  color: var(--fb-danger);
}
</style>
