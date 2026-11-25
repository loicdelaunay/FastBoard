<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import InputText from 'primevue/inputtext';
import Popover from 'primevue/popover';
import { t } from '@/i18n';
import { codeLanguageOptions, type CodeLanguageOption } from '@/utils/codeHighlight';
import { matchesQuery } from '@/utils/search';

/**
 * Choix du langage d'un bloc de code, sous sa pastille : recherche dans les noms (et leurs alias : `py`, `sh`…),
 * ↑ ↓ puis Entrée, ou un clic. « Texte brut » retire le langage.
 */
const popover = ref<InstanceType<typeof Popover> | null>(null);
const input = ref<{ $el: HTMLInputElement } | null>(null);
const list = ref<HTMLElement | null>(null);
const query = ref('');
const current = ref('');
const highlighted = ref(0);
let onPick: ((value: string) => void) | null = null;

const all = codeLanguageOptions();
const plain: CodeLanguageOption = { value: '', label: t('Texte brut'), aliases: ['text', 'txt', 'plain'] };
/** Nom ou alias exact d'abord (`sh` → Shell), puis ceux qui commencent par la recherche, puis ceux qui la contiennent. */
function rank(option: CodeLanguageOption, text: string): number {
  const names = [option.label, ...option.aliases].map((name) => name.toLowerCase());
  if (names.includes(text)) return 0;
  if (names.some((name) => name.startsWith(text))) return 1;
  return 2;
}
const options = computed(() => {
  const text = query.value.trim().toLowerCase();
  const found = [plain, ...all].filter((option) => !text || matchesQuery(text, [option.label, ...option.aliases]));
  return text ? found.map((option, index) => ({ option, index, rank: rank(option, text) })).sort((a, b) => a.rank - b.rank || a.index - b.index).map((entry) => entry.option) : found;
});

/** Ouvre la liste sous `target` ; \`pick\` reçoit le nom à écrire après la clôture (vide : texte brut). */
function open(event: Event, target: HTMLElement, language: string, pick: (value: string) => void): void {
  onPick = pick;
  current.value = language;
  query.value = '';
  const index = options.value.findIndex((option) => option.value === language || option.aliases.includes(language));
  highlighted.value = Math.max(0, index);
  popover.value?.show(event, target);
}

function focusSearch(): void {
  void nextTick(() => {
    input.value?.$el.focus();
    list.value?.querySelector('.option.active')?.scrollIntoView({ block: 'nearest' });
  });
}

function choose(option: CodeLanguageOption | undefined): void {
  if (!option) return;
  popover.value?.hide();
  if (option.value !== current.value) onPick?.(option.value);
}

function onKeydown(event: KeyboardEvent): void {
  const count = options.value.length;
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && count) {
    event.preventDefault();
    highlighted.value = (highlighted.value + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
    void nextTick(() => list.value?.querySelector('.option.active')?.scrollIntoView({ block: 'nearest' }));
  } else if (event.key === 'Enter') {
    event.preventDefault();
    choose(options.value[highlighted.value]);
  } else if (event.key === 'Escape') {
    popover.value?.hide();
  }
}

function onInput(): void {
  highlighted.value = 0;
}

defineExpose({ open });
</script>

<template>
  <Popover ref="popover" class="code-language-picker" @show="focusSearch">
    <div class="picker" @keydown="onKeydown">
      <InputText ref="input" v-model="query" size="small" :placeholder="$t('Rechercher un langage…')" :aria-label="$t('Langage du bloc de code')" fluid @input="onInput" />
      <ul ref="list" class="options" role="listbox" :aria-label="$t('Langages')">
        <li
          v-for="(option, index) in options"
          :key="option.value || 'plain'"
          role="option"
          class="option"
          :class="{ active: index === highlighted, current: option.value === current }"
          :aria-selected="index === highlighted"
          @mouseenter="highlighted = index"
          @click="choose(option)"
        >
          <span class="truncate">{{ option.label }}</span>
          <i v-if="option.value === current" class="pi pi-check"></i>
        </li>
        <li v-if="!options.length" class="muted small empty">{{ $t('Aucun langage ne correspond.') }}</li>
      </ul>
    </div>
  </Popover>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  width: 14rem;
}
.options {
  max-height: 15rem;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
.option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.3rem 0.5rem;
  border-radius: 6px;
  font-size: 0.85rem;
  cursor: pointer;
}
.option.active {
  background: var(--fb-accent-soft);
}
.option.current {
  font-weight: 600;
}
.option .pi {
  color: var(--fb-accent);
  font-size: 0.75rem;
}
.empty {
  padding: 0.4rem 0.5rem;
}
</style>
