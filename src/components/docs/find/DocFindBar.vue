<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { FIND_LIMIT, type FindOptions, type FindResult } from './find';

import { t } from '@/i18n';
/**
 * Barre de recherche d'une note (Ctrl F), à la manière de VS Code : options dans le champ (casse, mot entier, expression
 * régulière), compteur « 3 sur 12 », précédent et suivant, et en écriture le remplacement (Ctrl H).
 */
const props = defineProps<{ result: FindResult; canReplace: boolean }>();
const options = defineModel<FindOptions>({ required: true });
const replaceOpen = defineModel<boolean>('replaceOpen', { default: false });
const emit = defineEmits<{ next: []; previous: []; close: []; replace: []; replaceAll: [] }>();

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
async function focus(target: 'search' | 'replace' = 'search'): Promise<void> {
  await nextTick();
  const input = target === 'replace' ? replaceInput.value : searchInput.value;
  input?.focus();
  input?.select();
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
        <button v-tooltip.bottom="$t('Fermer (Échap)')" type="button" class="icon" :aria-label="$t('Fermer la recherche')" @click="emit('close')"><i class="pi pi-times"></i></button>
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
