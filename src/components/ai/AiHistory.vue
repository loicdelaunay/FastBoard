<script setup lang="ts">
import { onMounted } from 'vue';
import Button from 'primevue/button';
import { useAiStore } from '@/stores/ai';
import { formatRelative } from '@/utils/format';

/** Les 50 dernières conversations de la personne avec l'assistant. */
const emit = defineEmits<{ opened: [] }>();
const ai = useAiStore();

onMounted(() => void ai.loadConversations());

async function open(id: string): Promise<void> {
  await ai.openConversation(id);
  emit('opened');
}
</script>

<template>
  <div class="history">
    <p class="title">{{ $t('Conversations récentes') }}</p>
    <p v-if="ai.historyLoading && !ai.conversations.length" class="muted small empty"><i class="pi pi-spin pi-spinner"></i></p>
    <p v-else-if="!ai.conversations.length" class="muted small empty">{{ $t('Aucune conversation enregistrée.') }}</p>
    <ul class="list">
      <li v-for="conversation in ai.conversations" :key="conversation.id" class="item" :class="{ current: conversation.id === ai.conversationId }">
        <button type="button" class="open" @click="open(conversation.id)">
          <span class="truncate name">{{ conversation.title }}</span>
          <span class="muted small">{{ formatRelative(conversation.updatedAt) }} · {{ $t('{n} question|{n} questions', { n: conversation.messageCount }) }}</span>
        </button>
        <Button v-tooltip.left="$t('Supprimer')" icon="pi pi-trash" text rounded size="small" severity="secondary" class="delete" :aria-label="$t('Supprimer')" @click="ai.deleteConversation(conversation.id)" />
      </li>
    </ul>
    <p v-if="ai.conversations.length" class="muted small note">{{ $t('Les 50 dernières conversations sont gardées.') }}</p>
  </div>
</template>

<style scoped>
.history {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-height: 0;
}
.title {
  margin: 0 0.25rem;
  font-size: 0.7rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--fb-muted);
}
.empty {
  margin: 0.5rem 0.25rem;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.item {
  display: flex;
  align-items: center;
  border-radius: 8px;
}
.item:hover,
.item.current {
  background: var(--fb-panel-alt);
}
.item.current .name {
  color: #a95cff;
}
.open {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  padding: 0.4rem 0.5rem;
  border: 0;
  background: transparent;
  color: var(--fb-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.name {
  font-size: 0.85rem;
  font-weight: 600;
}
.delete {
  opacity: 0;
}
.item:hover .delete,
.delete:focus-visible {
  opacity: 1;
}
.note {
  margin: 0.3rem 0.25rem 0;
}
</style>
