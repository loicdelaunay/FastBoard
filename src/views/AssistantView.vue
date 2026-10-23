<script setup lang="ts">
import { onMounted } from 'vue';
import { useRoute } from 'vue-router';
import AiPanel from '@/components/ai/AiPanel.vue';
import { useAiStore } from '@/stores/ai';

/** Assistant IA en pleine page (ouvert depuis le panneau, par exemple dans un second onglet). */
const ai = useAiStore();
const route = useRoute();

onMounted(() => {
  ai.toggle(false);
  const id = typeof route.query.c === 'string' ? route.query.c : null;
  if (id && id !== ai.conversationId) void ai.openConversation(id);
});
</script>

<template>
  <div class="assistant-page">
    <AiPanel mode="page" />
  </div>
</template>

<style scoped>
.assistant-page {
  flex: 1;
  min-height: 0;
  display: flex;
}
</style>
