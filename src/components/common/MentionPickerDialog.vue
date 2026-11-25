<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import Dialog from 'primevue/dialog';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import CategoryChips from '@/components/common/CategoryChips.vue';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { mentionFilterInfo, mentionFilters, searchMentions, type MentionFilter, type MentionGroup, type MentionSources, type MentionSuggestion } from '@/utils/mentionSources';

/**
 * « Voir tout » des mentions `@` : quand la petite liste ne suffit pas, cette fenêtre cherche dans chaque type (filtres
 * Tout, Personnes, Tickets, Documents…) et en montre bien plus ; ↑ ↓ puis Entrée, ou un clic, choisit l'élément.
 */
const props = defineProps<{ sources: MentionSources; query?: string; filter?: MentionFilter }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ pick: [suggestion: MentionSuggestion] }>();

const LIMIT = 40;
const query = ref('');
const filter = ref<MentionFilter>('all');
const items = ref<MentionSuggestion[]>([]);
const more = ref(false);
const loading = ref(false);
const highlighted = ref(0);
const list = ref<HTMLElement | null>(null);
const filters = computed(() => mentionFilters(props.sources));

/** Résultats rangés par type, chacun sous son titre. */
const sections = computed(() => {
  const groups: Array<{ group: MentionGroup; items: Array<{ suggestion: MentionSuggestion; index: number }> }> = [];
  items.value.forEach((suggestion, index) => {
    const last = groups.at(-1);
    if (last?.group === suggestion.group) last.items.push({ suggestion, index });
    else groups.push({ group: suggestion.group, items: [{ suggestion, index }] });
  });
  return groups;
});

let token = 0;
let timer: number | undefined;
function run(delay = 150): void {
  window.clearTimeout(timer);
  const mine = ++token;
  loading.value = true;
  timer = window.setTimeout(async () => {
    const result = await searchMentions(query.value.trim(), filter.value, LIMIT, props.sources, true);
    if (mine !== token) return;
    items.value = result.items;
    more.value = result.more;
    highlighted.value = 0;
    loading.value = false;
  }, delay);
}

watch(visible, (open) => {
  if (!open) return;
  query.value = props.query ?? '';
  filter.value = props.filter ?? 'all';
  items.value = [];
  run(0);
});
watch([query, filter], () => visible.value && run());

function pick(suggestion: MentionSuggestion): void {
  emit('pick', suggestion);
  visible.value = false;
}

function onKeydown(event: KeyboardEvent): void {
  const count = items.value.length;
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && count) {
    event.preventDefault();
    highlighted.value = (highlighted.value + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
    void nextTick(() => list.value?.querySelector('.row.active')?.scrollIntoView({ block: 'nearest' }));
  } else if (event.key === 'Enter' && items.value[highlighted.value]) {
    event.preventDefault();
    pick(items.value[highlighted.value]!);
  }
}

const personOf = (id: number) => props.sources.people.find((user) => user.id === id);
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="$t('Mentionner')" :style="{ width: 'min(36rem, 96vw)' }" :draggable="false" class="mention-picker">
    <div class="picker" @keydown="onKeydown">
      <IconField>
        <InputIcon :class="loading ? 'pi pi-spin pi-spinner' : 'pi pi-search'" />
        <InputText v-model="query" autofocus :placeholder="$t('Rechercher une personne, un ticket, une note…')" :aria-label="$t('Rechercher')" fluid />
      </IconField>
      <CategoryChips v-model="filter" :filters="filters" />
      <div ref="list" class="results" role="listbox" :aria-label="$t('Résultats')">
        <section v-for="section in sections" :key="section.group">
          <header class="section-head" :style="{ '--chip-color': mentionFilterInfo(section.group).color }">
            <i :class="mentionFilterInfo(section.group).icon"></i>
            <span>{{ $t(mentionFilterInfo(section.group).label) }}</span>
            <span class="muted count">{{ section.items.length }}</span>
          </header>
          <div
            v-for="{ suggestion, index } in section.items"
            :key="`${suggestion.kind}-${suggestion.id}-${suggestion.suffix ?? ''}`"
            class="row"
            :class="{ active: index === highlighted }"
            role="option"
            :aria-selected="index === highlighted"
            @click="pick(suggestion)"
            @mouseenter="highlighted = index"
          >
            <UserAvatar v-if="suggestion.kind === 'user'" :user="personOf(suggestion.id)" size="small" />
            <i v-else :class="mentionFilterInfo(suggestion.group).icon" class="mention-kind-icon" :style="{ '--chip-color': mentionFilterInfo(suggestion.group).color }"></i>
            <strong class="truncate">{{ suggestion.label }}</strong>
            <span class="muted small truncate">{{ suggestion.hint }}</span>
          </div>
        </section>
        <p v-if="!loading && !items.length" class="muted empty">{{ query ? $t('Rien ne correspond.') : $t('Tapez pour chercher.') }}</p>
        <p v-if="more" class="muted small more">{{ $t('D’autres éléments correspondent : précisez la recherche.') }}</p>
      </div>
    </div>
  </Dialog>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.results {
  height: min(26rem, 60vh);
  overflow-y: auto;
  margin: 0 -0.25rem;
  padding: 0 0.25rem;
}
.section-head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.45rem 0.35rem 0.25rem;
  background: var(--fb-panel);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.section-head .pi {
  color: var(--chip-color);
}
.count {
  font-weight: 500;
}
.row {
  display: grid;
  grid-template-columns: auto minmax(0, max-content) minmax(0, 1fr);
  align-items: center;
  gap: 0.55rem;
  padding: 0.4rem 0.5rem;
  border-radius: 8px;
  cursor: pointer;
}
.row.active {
  background: var(--fb-accent-soft);
}
.empty {
  margin: 2rem 0;
  text-align: center;
}
.more {
  margin: 0.6rem 0.35rem;
}
</style>
