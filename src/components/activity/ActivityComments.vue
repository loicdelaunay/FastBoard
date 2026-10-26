<script setup lang="ts">
import { computed, ref } from 'vue';
import Button from 'primevue/button';
import type { ActivityCommentDTO, ActivityDTO } from '@shared/types';
import MentionTextarea from '@/components/common/MentionTextarea.vue';
import RichText from '@/components/common/RichText.vue';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/project';
import { formatDateTime, formatRelative } from '@/utils/format';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Discussion sur un évènement du journal d'activité, avec mentions @ (les personnes mentionnées sont notifiées). */
const props = defineProps<{ activity: ActivityDTO; composing: boolean }>();
const emit = defineEmits<{ comment: [comment: ActivityCommentDTO]; close: [] }>();

const auth = useAuthStore();
const project = useProjectStore();

const canComment = computed(() => project.can('comment.create') && !project.archived);
const canModerate = computed(() => project.can('comment.moderate'));
const comments = computed(() => props.activity.comments ?? []);
const COLLAPSED = 3;
const showAll = ref(false);
const visible = computed(() => (showAll.value || comments.value.length <= COLLAPSED ? comments.value : comments.value.slice(-COLLAPSED)));

const draft = ref('');
const sending = ref(false);
const editingId = ref<number | null>(null);
const editDraft = ref('');

async function run(action: () => Promise<{ comment: ActivityCommentDTO }>, summary: string): Promise<boolean> {
  try {
    emit('comment', (await action()).comment);
    return true;
  } catch (error) {
    notifyError(error, summary);
    return false;
  }
}

async function send(): Promise<void> {
  const body = draft.value.trim();
  if (!body || sending.value) return;
  sending.value = true;
  if (await run(() => api.addActivityComment(props.activity.id, body), t('Message non envoyé'))) {
    draft.value = '';
    emit('close');
  }
  sending.value = false;
}

function startEdit(comment: ActivityCommentDTO): void {
  editingId.value = comment.id;
  editDraft.value = comment.body;
}

async function saveEdit(comment: ActivityCommentDTO): Promise<void> {
  const body = editDraft.value.trim();
  if (!body || body === comment.body) {
    editingId.value = null;
    return;
  }
  if (await run(() => api.editActivityComment(comment.id, body), t('Modification refusée'))) editingId.value = null;
}

function remove(comment: ActivityCommentDTO): void {
  void run(() => api.deleteActivityComment(comment.id), t('Suppression impossible'));
}

const userOf = (comment: ActivityCommentDTO) => (comment.userId ? project.usersById.get(comment.userId) : undefined);
const isMine = (comment: ActivityCommentDTO) => comment.userId !== null && comment.userId === auth.user?.id;
</script>

<template>
  <div v-if="comments.length || composing" class="activity-comments">
    <button v-if="comments.length > COLLAPSED && !showAll" type="button" class="more" @click="showAll = true">{{ $t('Voir les {n} commentaires', { n: comments.length }) }}</button>
    <ul v-if="visible.length" class="list">
      <li v-for="comment in visible" :key="comment.id" class="comment">
        <UserAvatar :user="userOf(comment)" size="small" />
        <div class="content">
          <p class="head">
            <strong>{{ userOf(comment)?.name ?? $t('Un ancien membre') }}</strong>
            <time class="muted small" :datetime="comment.createdAt" :title="formatDateTime(comment.createdAt)">{{ formatRelative(comment.createdAt) }}</time>
            <span v-if="!comment.deleted && comment.updatedAt !== comment.createdAt" class="muted small">· {{ $t('modifié') }}</span>
          </p>
          <p v-if="comment.deleted" class="text muted"><em>{{ $t('Message supprimé') }}</em></p>
          <template v-else-if="editingId === comment.id">
            <MentionTextarea v-model="editDraft" auto-resize rows="2" maxlength="2000" fluid autofocus :aria-label="$t('Votre message')" @keydown.ctrl.enter.prevent="saveEdit(comment)" @keydown.esc="editingId = null" />
            <div class="row actions">
              <Button :label="$t('Enregistrer')" size="small" :disabled="!editDraft.trim()" @click="saveEdit(comment)" />
              <Button :label="$t('Annuler')" size="small" text severity="secondary" @click="editingId = null" />
            </div>
          </template>
          <p v-else class="text"><RichText :text="comment.body" /></p>
        </div>
        <span v-if="!comment.deleted && editingId !== comment.id" class="tools">
          <Button v-if="isMine(comment) && canComment" v-tooltip.top="$t('Modifier')" icon="pi pi-pencil" text rounded size="small" severity="secondary" :aria-label="$t('Modifier')" @click="startEdit(comment)" />
          <Button v-if="isMine(comment) || canModerate" v-tooltip.top="$t('Supprimer')" icon="pi pi-trash" text rounded size="small" severity="secondary" :aria-label="$t('Supprimer')" @click="remove(comment)" />
        </span>
      </li>
    </ul>
    <form v-if="composing && canComment" class="composer" @submit.prevent="send">
      <UserAvatar :user="auth.user" size="small" />
      <div class="box">
        <MentionTextarea
          v-model="draft"
          rows="1"
          auto-resize
          maxlength="2000"
          fluid
          autofocus
          :placeholder="$t('Commenter cette activité… (@ pour mentionner)')"
          :aria-label="$t('Votre message')"
          @keydown.ctrl.enter.prevent="send"
          @keydown.meta.enter.prevent="send"
          @keydown.esc="emit('close')"
        />
        <div class="row actions">
          <Button type="submit" :label="$t('Envoyer')" icon="pi pi-send" size="small" :disabled="!draft.trim()" :loading="sending" />
          <Button type="button" :label="$t('Annuler')" size="small" text severity="secondary" @click="emit('close')" />
          <span class="muted small hint">{{ $t('Ctrl + Entrée pour envoyer') }}</span>
        </div>
      </div>
    </form>
  </div>
</template>

<style scoped>
.activity-comments {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin-top: 0.55rem;
  padding: 0.5rem 0.6rem;
  border-radius: 8px;
  background: var(--fb-panel-alt);
}
.more {
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: none;
  color: var(--fb-accent);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.comment {
  display: flex;
  gap: 0.55rem;
}
.content {
  flex: 1;
  min-width: 0;
}
.head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.4rem;
  margin: 0;
  font-size: 0.82rem;
}
.text {
  margin: 0.1rem 0 0;
  font-size: 0.88rem;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.tools {
  display: flex;
  opacity: 0;
  transition: opacity 0.15s;
}
.comment:hover .tools,
.tools:focus-within {
  opacity: 1;
}
.composer {
  display: flex;
  gap: 0.55rem;
}
.box {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}
.actions {
  gap: 0.3rem;
}
.hint {
  margin-left: auto;
}
@media (max-width: 600px) {
  .hint {
    display: none;
  }
}
</style>
