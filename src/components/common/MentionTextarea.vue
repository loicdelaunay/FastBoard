<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import Textarea from 'primevue/textarea';
import type { UserSummaryDTO } from '@shared/types';
import CategoryChips from '@/components/common/CategoryChips.vue';
import MentionPickerDialog from '@/components/common/MentionPickerDialog.vue';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { useAppStore } from '@/stores/app';
import { useProjectStore } from '@/stores/project';
import { activeMentionQuery, mentionToken } from '@/utils/mentions';
import { mentionFilterInfo, mentionFilters, searchMentions, type MentionFilter, type MentionSources, type MentionSuggestion } from '@/utils/mentionSources';
import { matchesQuery } from '@/utils/search';
import { ticketKey } from '@/utils/tickets';

/**
 * Zone de texte avec mentions : taper `@` propose les personnes, les tickets, les notes, les tableaux blancs et les
 * versions étiquetées. Les pastilles du haut filtrent par type ; « Voir tout » ouvre une fenêtre qui en montre bien plus.
 * ↑ ↓ pour choisir, Entrée ou Tab pour insérer, Échap pour fermer.
 */
defineOptions({ inheritAttrs: false });
const model = defineModel<string>({ required: true });
/** Hors d'un projet : personnes proposées ; les tickets viennent alors de la recherche. */
const props = defineProps<{ people?: UserSummaryDTO[] }>();
const emit = defineEmits<{ blur: [event: FocusEvent]; focus: [event: FocusEvent]; keydown: [event: KeyboardEvent] }>();

const project = useProjectStore();
const app = useAppStore();
const peopleList = computed(() => props.people ?? project.users);
const textarea = ref<{ $el: HTMLTextAreaElement } | null>(null);
const mention = ref<{ start: number; query: string } | null>(null);
const highlighted = ref(0);
const filter = ref<MentionFilter>('all');
const results = ref<MentionSuggestion[]>([]);
const more = ref(false);

const sources = computed<MentionSources>(() => ({
  people: peopleList.value,
  // Dans un projet, ses tickets se cherchent sur place (les plus récents d'abord).
  tickets: props.people
    ? undefined
    : (query) =>
        project.tickets
          .filter((ticket) => !query || matchesQuery(query, [ticketKey(project.project, ticket), ticket.title]))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map((ticket) => ({ kind: 'ticket', group: 'ticket', id: ticket.id, label: ticketKey(project.project, ticket), hint: ticket.title })),
  docs: app.info.docs,
  boards: app.info.boards,
}));
const filters = computed(() => mentionFilters(sources.value));
/** Une ligne « Voir tout » suit la liste quand d'autres éléments correspondent. */
const rowCount = computed(() => results.value.length + (more.value ? 1 : 0));

// Les personnes et les tickets du projet sont sur place ; le reste vient du serveur, après une courte pause dans la frappe.
let token = 0;
let searchTimer: number | undefined;
watch(
  () => [mention.value?.query, filter.value, mention.value !== null] as const,
  ([query, , open]) => {
    window.clearTimeout(searchTimer);
    if (!open) {
      results.value = [];
      more.value = false;
      return;
    }
    const mine = ++token;
    searchTimer = window.setTimeout(
      async () => {
        const found = await searchMentions(query ?? '', filter.value, filter.value === 'all' ? 4 : 8, sources.value);
        if (mine !== token) return;
        results.value = found.items;
        more.value = found.more;
        highlighted.value = Math.min(highlighted.value, Math.max(0, rowCount.value - 1));
      },
      query ? 200 : 0,
    );
  },
);
// Chaque nouvelle mention repart de « Tout ».
watch(
  () => mention.value?.start,
  (start, previous) => {
    if (start !== previous) filter.value = 'all';
  },
);
watch(filter, () => (highlighted.value = 0));

function element(): HTMLTextAreaElement | null {
  return textarea.value?.$el ?? null;
}

function refresh(): void {
  const el = element();
  if (!el) return;
  mention.value = activeMentionQuery(el.value, el.selectionStart ?? el.value.length);
  highlighted.value = 0;
}

/** Remplace `@texte` (de `start` au curseur `caret`) par la mention. */
function insertAt(suggestion: MentionSuggestion, start: number, caret: number): void {
  const el = element();
  if (!el) return;
  const token = `${mentionToken(suggestion.kind, suggestion.id, suggestion.label, null, suggestion.suffix)} `;
  model.value = model.value.slice(0, start) + token + model.value.slice(caret);
  const position = start + token.length;
  mention.value = null;
  void nextTick(() => {
    el.focus();
    el.setSelectionRange(position, position);
  });
}

function insert(suggestion: MentionSuggestion): void {
  const el = element();
  if (!el || !mention.value) return;
  insertAt(suggestion, mention.value.start, el.selectionStart ?? model.value.length);
}

// --- « Voir tout » ---
const pickerOpen = ref(false);
const pending = ref<{ start: number; caret: number; query: string; filter: MentionFilter } | null>(null);

function openPicker(): void {
  const el = element();
  if (!el || !mention.value) return;
  pending.value = { start: mention.value.start, caret: el.selectionStart ?? model.value.length, query: mention.value.query, filter: filter.value };
  mention.value = null;
  pickerOpen.value = true;
}

function pickFromDialog(suggestion: MentionSuggestion): void {
  const target = pending.value;
  pending.value = null;
  // Le texte a pu changer entre-temps : on ne remplace que si la mention commencée est toujours là.
  if (target && model.value.slice(target.start, target.caret) === `@${target.query}`) insertAt(suggestion, target.start, target.caret);
  else {
    const el = element();
    const caret = el?.selectionStart ?? model.value.length;
    insertAt(suggestion, caret, caret);
  }
}

function choose(index: number): void {
  if (index >= results.value.length) openPicker();
  else insert(results.value[index]!);
}

function onKeydown(event: KeyboardEvent): void {
  if (mention.value && rowCount.value) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      highlighted.value = (highlighted.value + step + rowCount.value) % rowCount.value;
      return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      choose(highlighted.value);
      return;
    }
  }
  if (mention.value && event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    mention.value = null;
    return;
  }
  emit('keydown', event);
}

function onBlur(event: FocusEvent): void {
  // Laisse le temps à un clic sur une suggestion d'être pris en compte.
  window.setTimeout(() => {
    if (document.activeElement !== element()) mention.value = null;
  }, 150);
  emit('blur', event);
}

defineExpose({ focus: () => element()?.focus(), element });
</script>

<template>
  <div class="mention-box">
    <Textarea
      ref="textarea"
      v-model="model"
      v-bind="$attrs"
      @input="refresh"
      @click="refresh"
      @keyup.left="refresh"
      @keyup.right="refresh"
      @keydown="onKeydown"
      @focus="emit('focus', $event)"
      @blur="onBlur"
    />
    <div v-if="mention" class="suggestions" @mousedown.prevent>
      <CategoryChips v-model="filter" :filters="filters" />
      <ul v-if="rowCount" role="listbox" :aria-label="$t('Mentionner')">
        <li
          v-for="(suggestion, index) in results"
          :key="`${suggestion.kind}-${suggestion.id}-${suggestion.suffix ?? ''}`"
          role="option"
          :aria-selected="index === highlighted"
          :class="{ active: index === highlighted }"
          @click="insert(suggestion)"
          @mouseenter="highlighted = index"
        >
          <UserAvatar v-if="suggestion.kind === 'user'" :user="peopleList.find((user) => user.id === suggestion.id)" size="small" />
          <i v-else :class="mentionFilterInfo(suggestion.group).icon" class="mention-kind-icon" :style="{ '--chip-color': mentionFilterInfo(suggestion.group).color }"></i>
          <strong class="truncate">{{ suggestion.label }}</strong>
          <span class="muted small truncate">{{ suggestion.hint }}</span>
        </li>
        <li v-if="more" role="option" class="see-all" :aria-selected="highlighted === results.length" :class="{ active: highlighted === results.length }" @click="openPicker" @mouseenter="highlighted = results.length">
          <i class="pi pi-search-plus mention-kind-icon"></i>
          <strong>{{ $t('Voir tout…') }}</strong>
          <span class="muted small truncate">{{ $t('Chercher parmi tous les éléments') }}</span>
        </li>
      </ul>
      <p v-else class="no-match muted small">{{ mention.query ? $t('Rien ne correspond.') : $t('Tapez pour chercher.') }}</p>
    </div>
    <MentionPickerDialog v-model:visible="pickerOpen" :sources="sources" :query="pending?.query" :filter="pending?.filter" @pick="pickFromDialog" />
  </div>
</template>

<style scoped>
.mention-box {
  position: relative;
  width: 100%;
}
.mention-box :deep(textarea) {
  width: 100%;
}
.suggestions {
  position: absolute;
  z-index: 20;
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  padding: 0.35rem 0.3rem 0.3rem;
  border: 1px solid var(--fb-border);
  border-radius: 10px;
  background: var(--fb-panel);
  box-shadow: 0 12px 28px rgb(0 0 0 / 18%);
}
.suggestions ul {
  max-height: 16rem;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
.suggestions li {
  display: grid;
  grid-template-columns: auto minmax(0, max-content) minmax(0, 1fr);
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.5rem;
  border-radius: 7px;
  cursor: pointer;
}
.suggestions li.active {
  background: var(--fb-accent-soft);
}
.see-all {
  border-top: 1px solid var(--fb-border);
  --chip-color: var(--fb-accent);
}
.no-match {
  margin: 0.25rem 0.5rem 0.35rem;
}
</style>
