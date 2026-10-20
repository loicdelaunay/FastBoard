<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import Textarea from 'primevue/textarea';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { useProjectStore } from '@/stores/project';
import { activeMentionQuery, mentionToken, type MentionKind } from '@/utils/mentions';
import { matchesQuery } from '@/utils/search';
import { ticketKey } from '@/utils/tickets';

/**
 * Zone de texte avec mentions : taper `@` propose les membres du projet et ses tickets ;
 * ↑ ↓ pour choisir, Entrée ou Tab pour insérer, Échap pour fermer.
 */
defineOptions({ inheritAttrs: false });
const model = defineModel<string>({ required: true });
const emit = defineEmits<{ blur: [event: FocusEvent]; focus: [event: FocusEvent]; keydown: [event: KeyboardEvent] }>();

const project = useProjectStore();
const textarea = ref<{ $el: HTMLTextAreaElement } | null>(null);
const mention = ref<{ start: number; query: string } | null>(null);
const highlighted = ref(0);

interface Suggestion {
  kind: MentionKind;
  id: number;
  label: string;
  hint: string;
}

const suggestions = computed<Suggestion[]>(() => {
  if (!mention.value) return [];
  const query = mention.value.query;
  const users = project.users
    .filter((user) => user.isActive && (!query || matchesQuery(query, [user.name, user.email])))
    .slice(0, 5)
    .map((user): Suggestion => ({ kind: 'user', id: user.id, label: user.name, hint: user.email }));
  const tickets = project.tickets
    .filter((ticket) => query && matchesQuery(query, [ticketKey(project.project, ticket), ticket.title]))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5)
    .map((ticket): Suggestion => ({ kind: 'ticket', id: ticket.id, label: ticketKey(project.project, ticket), hint: ticket.title }));
  return [...users, ...tickets];
});

function element(): HTMLTextAreaElement | null {
  return textarea.value?.$el ?? null;
}

function refresh(): void {
  const el = element();
  if (!el) return;
  mention.value = activeMentionQuery(model.value, el.selectionStart ?? model.value.length);
  highlighted.value = 0;
}

function insert(suggestion: Suggestion): void {
  const el = element();
  if (!el || !mention.value) return;
  const caret = el.selectionStart ?? model.value.length;
  const token = `${mentionToken(suggestion.kind, suggestion.id, suggestion.label)} `;
  model.value = model.value.slice(0, mention.value.start) + token + model.value.slice(caret);
  const position = mention.value.start + token.length;
  mention.value = null;
  void nextTick(() => {
    el.focus();
    el.setSelectionRange(position, position);
  });
}

function onKeydown(event: KeyboardEvent): void {
  if (mention.value && suggestions.value.length) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      highlighted.value = (highlighted.value + step + suggestions.value.length) % suggestions.value.length;
      return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      insert(suggestions.value[highlighted.value]!);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      mention.value = null;
      return;
    }
  }
  emit('keydown', event);
}

function onBlur(event: FocusEvent): void {
  // Laisse le temps à un clic sur une suggestion d'être pris en compte.
  window.setTimeout(() => (mention.value = null), 150);
  emit('blur', event);
}

defineExpose({ focus: () => element()?.focus() });
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
    <ul v-if="mention && suggestions.length" class="suggestions" role="listbox" :aria-label="$t('Mentionner')">
      <li
        v-for="(suggestion, index) in suggestions"
        :key="`${suggestion.kind}-${suggestion.id}`"
        role="option"
        :aria-selected="index === highlighted"
        :class="{ active: index === highlighted }"
        @mousedown.prevent="insert(suggestion)"
        @mouseenter="highlighted = index"
      >
        <UserAvatar v-if="suggestion.kind === 'user'" :user="project.usersById.get(suggestion.id)" size="small" />
        <i v-else class="pi pi-ticket ticket-icon"></i>
        <strong class="truncate">{{ suggestion.label }}</strong>
        <span class="muted small truncate">{{ suggestion.hint }}</span>
      </li>
    </ul>
    <small v-if="mention && !suggestions.length && mention.query" class="no-match muted">{{ $t('Aucune personne ni aucun ticket ne correspond.') }}</small>
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
  max-height: 16rem;
  margin: 0;
  padding: 0.3rem;
  overflow-y: auto;
  list-style: none;
  border: 1px solid var(--fb-border);
  border-radius: 10px;
  background: var(--fb-panel);
  box-shadow: 0 12px 28px rgb(0 0 0 / 18%);
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
.ticket-icon {
  width: 1.5rem;
  text-align: center;
  color: var(--fb-accent);
}
.no-match {
  display: block;
  margin-top: 0.25rem;
}
</style>
