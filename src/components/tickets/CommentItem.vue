<script setup lang="ts">
import { computed, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import Button from 'primevue/button';
import Textarea from 'primevue/textarea';
import type { CommentDTO } from '@shared/types';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/project';
import { formatDateTime, formatRelative } from '@/utils/format';
import { notifyError } from '@/utils/notify';
import CommentComposer from './CommentComposer.vue';

import { t } from '@/i18n';
const MAX_INDENT = 3;

const props = defineProps<{
  comment: CommentDTO;
  childrenByParent: Map<number, CommentDTO[]>;
  depth: number;
}>();

const auth = useAuthStore();
const project = useProjectStore();
const confirm = useConfirm();

const replying = ref(false);
const editing = ref(false);
const draft = ref('');
const saving = ref(false);

const author = computed(() => (props.comment.userId ? project.usersById.get(props.comment.userId) : undefined));
const replies = computed(() => props.childrenByParent.get(props.comment.id) ?? []);
const visibleReplies = computed(() => replies.value.filter((reply) => !isEmptyDeleted(reply)));
const isMine = computed(() => props.comment.userId === auth.user?.id);
const canReply = computed(() => project.can('comment.create') && !project.archived && !props.comment.deleted);
const canEdit = computed(() => isMine.value && project.can('comment.create') && !project.archived && !props.comment.deleted);
const canDelete = computed(() => (isMine.value || project.can('comment.moderate')) && !project.archived && !props.comment.deleted);

function isEmptyDeleted(comment: CommentDTO): boolean {
  return comment.deleted && !(props.childrenByParent.get(comment.id) ?? []).some((child) => !isEmptyDeleted(child));
}

function startEdit(): void {
  draft.value = props.comment.body;
  editing.value = true;
}

async function saveEdit(): Promise<void> {
  const body = draft.value.trim();
  if (!body || body === props.comment.body) {
    editing.value = false;
    return;
  }
  saving.value = true;
  try {
    await project.editComment(props.comment, body);
    editing.value = false;
  } catch (error) {
    notifyError(error);
  } finally {
    saving.value = false;
  }
}

function askDelete(): void {
  confirm.require({
    header: t('Supprimer ce message ?'),
    message: replies.value.length ? t('Les réponses seront conservées sous la mention « message supprimé ».') : t('Cette action est définitive.'),
    icon: 'pi pi-trash',
    acceptLabel: t('Supprimer'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      try {
        await project.removeComment(props.comment);
      } catch (error) {
        notifyError(error);
      }
    },
  });
}
</script>

<template>
  <li class="comment" :class="{ deleted: comment.deleted }">
    <UserAvatar :user="author" />
    <div class="main">
      <div class="meta">
        <strong>{{ author?.name ?? $t('Utilisateur supprimé') }}</strong>
        <time :datetime="comment.createdAt" :title="formatDateTime(comment.createdAt)" class="muted small">{{ formatRelative(comment.createdAt) }}</time>
        <span v-if="comment.updatedAt && !comment.deleted" class="muted small" :title="formatDateTime(comment.updatedAt)">{{ $t('(modifié)') }}</span>
      </div>

      <p v-if="comment.deleted" class="body muted"><em>{{ $t('Message supprimé') }}</em></p>
      <div v-else-if="editing" class="edit">
        <Textarea v-model="draft" auto-resize rows="2" maxlength="5000" fluid autofocus @keydown.ctrl.enter="saveEdit" @keydown.esc="editing = false" />
        <div class="row">
          <Button :label="$t('Enregistrer')" size="small" :loading="saving" @click="saveEdit" />
          <Button :label="$t('Annuler')" size="small" severity="secondary" text @click="editing = false" />
        </div>
      </div>
      <p v-else class="body">{{ comment.body }}</p>

      <div v-if="!editing && (canReply || canEdit || canDelete)" class="actions">
        <button v-if="canReply" type="button" class="link" @click="replying = !replying"><i class="pi pi-reply"></i> {{ $t('Répondre') }}</button>
        <button v-if="canEdit" type="button" class="link" @click="startEdit"><i class="pi pi-pencil"></i> {{ $t('Modifier') }}</button>
        <button v-if="canDelete" type="button" class="link danger" @click="askDelete"><i class="pi pi-trash"></i> {{ $t('Supprimer') }}</button>
      </div>

      <CommentComposer
        v-if="replying"
        class="reply-box"
        :ticket-id="comment.ticketId"
        :parent-id="comment.id"
        :placeholder="$t('Répondre à {name}…', { name: author?.name ?? $t('ce message') })"
        autofocus
        @sent="replying = false"
        @cancel="replying = false"
      />

      <ul v-if="visibleReplies.length" class="replies" :class="{ flat: depth >= MAX_INDENT }">
        <CommentItem v-for="reply in visibleReplies" :key="reply.id" :comment="reply" :children-by-parent="childrenByParent" :depth="depth + 1" />
      </ul>
    </div>
  </li>
</template>

<style scoped>
.comment {
  display: flex;
  gap: 0.7rem;
  list-style: none;
}
.main {
  flex: 1;
  min-width: 0;
}
.meta {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.15rem 0.5rem;
}
.body {
  margin: 0.15rem 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.actions {
  display: flex;
  gap: 0.9rem;
  margin-top: 0.25rem;
}
.link {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0;
  border: 0;
  background: none;
  color: var(--fb-muted);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}
.link:hover {
  color: var(--fb-accent);
}
.link.danger:hover {
  color: var(--fb-danger);
}
.edit {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-top: 0.3rem;
}
.reply-box {
  margin-top: 0.6rem;
}
.replies {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  margin: 0.9rem 0 0;
  padding: 0 0 0 0.9rem;
  border-left: 2px solid var(--fb-border);
}
.replies.flat {
  padding-left: 0;
  border-left: 0;
}
</style>
