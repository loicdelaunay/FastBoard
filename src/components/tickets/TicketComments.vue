<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import type { CommentDTO } from '@shared/types';
import { useProjectStore } from '@/stores/project';
import { notifyError } from '@/utils/notify';
import CommentComposer from './CommentComposer.vue';
import CommentItem from './CommentItem.vue';

import { t } from '@/i18n';
const props = defineProps<{ ticketId: number }>();
const project = useProjectStore();

async function load(): Promise<void> {
  try {
    await project.loadComments(props.ticketId);
  } catch (error) {
    notifyError(error, t('Commentaires indisponibles'));
  }
}
onMounted(load);
watch(() => props.ticketId, load);

const all = computed<CommentDTO[]>(() => project.comments[props.ticketId] ?? []);
const childrenByParent = computed(() => {
  const map = new Map<number, CommentDTO[]>();
  for (const comment of all.value) {
    if (comment.parentId !== null) {
      const list = map.get(comment.parentId) ?? [];
      list.push(comment);
      map.set(comment.parentId, list);
    }
  }
  return map;
});

function hasLiveContent(comment: CommentDTO): boolean {
  return !comment.deleted || (childrenByParent.value.get(comment.id) ?? []).some(hasLiveContent);
}

const roots = computed(() => all.value.filter((comment) => comment.parentId === null && hasLiveContent(comment)));
const canComment = computed(() => project.can('comment.create') && !project.archived);
</script>

<template>
  <div class="comments">
    <ul v-if="roots.length" class="thread">
      <CommentItem v-for="comment in roots" :key="comment.id" :comment="comment" :children-by-parent="childrenByParent" :depth="0" />
    </ul>
    <p v-else-if="project.comments[ticketId]" class="empty muted">{{ $t('Aucun commentaire pour l\'instant. Lancez la discussion !') }}</p>
    <p v-else class="empty muted"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</p>

    <CommentComposer v-if="canComment" :ticket-id="ticketId" />
    <p v-else class="muted small">{{ $t('Vous ne pouvez pas commenter ce ticket.') }}</p>
  </div>
</template>

<style scoped>
.comments {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.thread {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  margin: 0;
  padding: 0;
}
.empty {
  padding: 0.5rem 0;
  text-align: center;
}
</style>
