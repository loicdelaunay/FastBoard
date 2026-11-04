<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import Button from 'primevue/button';
import { findQuote, type DocCommentDTO, type DocQuote } from '@shared/docComments';
import type { DocLinkNoteDTO, DocLinksDTO, DocLinkTicketDTO, DocNodeDTO } from '@shared/docs';
import type { UserSummaryDTO } from '@shared/types';
import { api } from '@/api';
import MarkdownView from '@/components/common/MarkdownView.vue';
import MentionTextarea from '@/components/common/MentionTextarea.vue';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { useDocLinks } from '@/composables/useDocLinks';
import { useAuthStore } from '@/stores/auth';
import { docResolver } from '@/utils/docRender';
import { formatRelative } from '@/utils/format';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Panneau d'une note : ses liens, ce qui la cite, et les commentaires posés sur ses passages. */
const props = defineProps<{
  nodeId: number;
  nodes: DocNodeDTO[];
  text: string;
  links: DocLinksDTO | null;
  comments: DocCommentDTO[];
  /** Membres de l'espace : les seuls qu'une mention peut prévenir. */
  members: UserSummaryDTO[];
  users: UserSummaryDTO[];
  /** Passage en train d'être commenté. */
  draft: DocQuote | null;
  focused: number | null;
  isOwner: boolean;
}>();
const tab = defineModel<'links' | 'comments'>('tab', { required: true });
const emit = defineEmits<{ close: []; open: [node: DocNodeDTO]; reveal: [comment: DocCommentDTO]; 'cancel-draft': []; 'update:focused': [commentId: number | null] }>();

const auth = useAuthStore();
const confirm = useConfirm();
const { openNode, openTicket } = useDocLinks(() => props.nodes, (node) => emit('open', node));
const resolver = computed(() => docResolver(props.users));
const userOf = (id: number | null) => props.users.find((user) => user.id === id);

// --- Liens ---
const groups = computed(() => {
  const links = props.links;
  return [
    { key: 'back', label: t('Rétroliens'), notes: links?.backlinks.notes ?? [], tickets: links?.backlinks.tickets ?? [], broken: [], empty: t('Rien ne cite cette note.') },
    { key: 'out', label: t('Liens de la note'), notes: links?.outgoing.notes ?? [], tickets: links?.outgoing.tickets ?? [], broken: links?.outgoing.broken ?? [], empty: t('Cette note ne cite rien.') },
  ];
});

function openTicketLink(ticket: DocLinkTicketDTO): void {
  void openTicket(ticket.id);
}
const noteHint = (note: DocLinkNoteDTO): string => (props.nodes.some((node) => node.id === note.id) ? note.path : `${note.spaceName} · ${note.path}`);

// --- Commentaires ---
interface Thread {
  root: DocCommentDTO;
  replies: DocCommentDTO[];
  position: number;
}

const threads = computed<Thread[]>(() =>
  props.comments
    .filter((comment) => comment.parentId === null)
    .map((root) => ({ root, replies: props.comments.filter((comment) => comment.parentId === root.id), position: findQuote(props.text, root, true)?.from ?? -1 }))
    .sort((a, b) => (a.position < 0 ? 1 : b.position < 0 ? -1 : a.position - b.position)),
);
const open = computed(() => threads.value.filter((thread) => !thread.root.resolvedAt));
const resolved = computed(() => threads.value.filter((thread) => thread.root.resolvedAt));
const showResolved = ref(false);

const body = ref('');
const replying = ref<number | null>(null);
const reply = ref('');
const busy = ref(false);
const composer = ref<InstanceType<typeof MentionTextarea> | null>(null);

watch(
  () => props.draft,
  (draft) => {
    if (!draft) return;
    body.value = '';
    void nextTick(() => composer.value?.focus());
  },
  { immediate: true },
);

watch(
  () => props.focused,
  (commentId) => {
    if (commentId === null) return;
    void nextTick(() => document.querySelector(`.thread[data-thread="${commentId}"]`)?.scrollIntoView({ block: 'nearest' }));
  },
);

async function submitDraft(): Promise<void> {
  if (!props.draft || !body.value.trim() || busy.value) return;
  busy.value = true;
  try {
    await api.docAddComment(props.nodeId, { ...props.draft, body: body.value });
    emit('cancel-draft');
  } catch (error) {
    notifyError(error, t('Commentaire non envoyé'));
  } finally {
    busy.value = false;
  }
}

async function submitReply(thread: Thread): Promise<void> {
  if (!reply.value.trim() || busy.value) return;
  busy.value = true;
  try {
    await api.docAddComment(props.nodeId, { body: reply.value, parentId: thread.root.id });
    reply.value = '';
    replying.value = null;
  } catch (error) {
    notifyError(error, t('Commentaire non envoyé'));
  } finally {
    busy.value = false;
  }
}

async function setResolved(thread: Thread, value: boolean): Promise<void> {
  try {
    await api.docResolveComment(thread.root.id, value);
  } catch (error) {
    notifyError(error);
  }
}

function askRemove(comment: DocCommentDTO): void {
  const remove = async (): Promise<void> => {
    try {
      await api.docDeleteComment(comment.id);
    } catch (error) {
      notifyError(error);
    }
  };
  if (comment.parentId !== null) {
    void remove();
    return;
  }
  confirm.require({
    header: t('Supprimer ce commentaire ?'),
    message: t('Ses réponses seront supprimées avec lui.'),
    icon: 'pi pi-trash',
    acceptLabel: t('Supprimer'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: remove,
  });
}

const canRemove = (comment: DocCommentDTO): boolean => props.isOwner || comment.userId === auth.user?.id;

function onComposerKey(event: KeyboardEvent, send: () => void): void {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    send();
  }
}

function choose(thread: Thread): void {
  emit('update:focused', thread.root.id);
  if (thread.position >= 0) emit('reveal', thread.root);
}

</script>

<template>
  <aside class="doc-side" :aria-label="$t('Liens et commentaires de la note')">
    <header class="tabs" role="tablist">
      <button type="button" role="tab" class="tab" :class="{ active: tab === 'links' }" :aria-selected="tab === 'links'" @click="tab = 'links'"><i class="pi pi-link"></i> {{ $t('Liens') }}</button>
      <button type="button" role="tab" class="tab" :class="{ active: tab === 'comments' }" :aria-selected="tab === 'comments'" @click="tab = 'comments'"><i class="pi pi-comments"></i> {{ $t('Commentaires') }}</button>
      <Button icon="pi pi-times" text rounded size="small" severity="secondary" class="close" :aria-label="$t('Fermer')" @click="emit('close')" />
    </header>

    <div v-if="tab === 'links'" class="content">
      <section v-for="group in groups" :key="group.key" class="group">
        <h4>{{ group.label }} <span class="muted">{{ group.notes.length + group.tickets.length }}</span></h4>
        <p v-if="!group.notes.length && !group.tickets.length && !group.broken.length" class="muted small">{{ group.empty }}</p>
        <button v-for="note in group.notes" :key="`n${note.id}`" type="button" class="entry" :title="note.path" @click="openNode(note.id)">
          <i class="pi pi-file"></i>
          <span class="names"><strong class="truncate">{{ note.title }}</strong><small class="muted truncate">{{ noteHint(note) }}</small></span>
        </button>
        <button v-for="ticket in group.tickets" :key="`t${ticket.id}`" type="button" class="entry" :data-ticket="ticket.id" @click="openTicketLink(ticket)">
          <i class="pi pi-ticket"></i>
          <span class="names"><strong class="truncate">{{ ticket.key }}</strong><small class="muted truncate">{{ ticket.title }}</small></span>
        </button>
        <p v-for="target in group.broken" :key="target" class="entry broken" :title="$t('Fichier introuvable')"><i class="pi pi-exclamation-triangle"></i><span class="truncate">{{ target }}</span></p>
      </section>
    </div>

    <div v-else class="content">
      <form v-if="draft" class="composer" @submit.prevent="submitDraft">
        <blockquote class="quote">{{ draft.quote }}</blockquote>
        <MentionTextarea ref="composer" v-model="body" :people="members" rows="3" fluid auto-resize :placeholder="$t('Votre commentaire… @ pour mentionner')" :aria-label="$t('Votre commentaire')" @keydown="onComposerKey($event, submitDraft)" />
        <div class="actions">
          <Button type="button" :label="$t('Annuler')" size="small" severity="secondary" text @click="emit('cancel-draft')" />
          <Button type="submit" :label="$t('Commenter')" icon="pi pi-send" size="small" :disabled="!body.trim()" :loading="busy" />
        </div>
      </form>

      <p v-if="!threads.length && !draft" class="muted small help">{{ $t('Sélectionnez un passage de la note, puis faites un clic droit pour le commenter.') }}</p>

      <template v-for="(list, index) in [open, showResolved ? resolved : []]" :key="index">
        <article v-for="thread in list" :key="thread.root.id" class="thread" :data-thread="thread.root.id" :class="{ focused: focused === thread.root.id, resolved: thread.root.resolvedAt }">
          <button type="button" class="quote" :disabled="thread.position < 0" @click="choose(thread)">{{ thread.root.quote }}</button>
          <p v-if="thread.position < 0" class="muted small gone"><i class="pi pi-info-circle"></i> {{ $t('Ce passage n’existe plus dans la note.') }}</p>
          <div v-for="comment in [thread.root, ...thread.replies]" :key="comment.id" class="comment">
            <header>
              <UserAvatar :user="userOf(comment.userId)" size="small" />
              <strong class="truncate">{{ userOf(comment.userId)?.name ?? $t('Ancien compte') }}</strong>
              <span class="muted small when">{{ formatRelative(comment.createdAt) }}</span>
              <Button v-if="canRemove(comment)" icon="pi pi-trash" text rounded size="small" severity="secondary" class="mini" :aria-label="$t('Supprimer')" @click="askRemove(comment)" />
            </header>
            <MarkdownView class="body" :text="comment.body" :resolver="resolver" :open-ticket-with="openTicket" />
          </div>
          <form v-if="replying === thread.root.id" class="composer" @submit.prevent="submitReply(thread)">
            <MentionTextarea v-model="reply" :people="members" rows="2" fluid auto-resize autofocus :placeholder="$t('Votre réponse… @ pour mentionner')" :aria-label="$t('Votre réponse')" @keydown="onComposerKey($event, () => submitReply(thread))" />
            <div class="actions">
              <Button type="button" :label="$t('Annuler')" size="small" severity="secondary" text @click="replying = null" />
              <Button type="submit" :label="$t('Répondre')" size="small" :disabled="!reply.trim()" :loading="busy" />
            </div>
          </form>
          <footer v-else class="thread-actions">
            <Button :label="$t('Répondre')" icon="pi pi-reply" size="small" text severity="secondary" @click="(replying = thread.root.id), (reply = '')" />
            <Button v-if="thread.root.resolvedAt" :label="$t('Rouvrir')" icon="pi pi-undo" size="small" text severity="secondary" @click="setResolved(thread, false)" />
            <Button v-else :label="$t('Résoudre')" icon="pi pi-check" size="small" text severity="secondary" @click="setResolved(thread, true)" />
          </footer>
        </article>
      </template>

      <Button v-if="resolved.length" :label="showResolved ? $t('Masquer les résolus') : $t('Voir les résolus ({n})', { n: resolved.length })" size="small" text severity="secondary" class="toggle" @click="showResolved = !showResolved" />
    </div>
  </aside>
</template>

<style scoped>
.doc-side {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-left: 1px solid var(--fb-border);
  background: var(--fb-panel);
}
.tabs {
  display: flex;
  align-items: center;
  gap: 0.1rem;
  padding: 0.2rem 0.4rem;
  border-bottom: 1px solid var(--fb-border);
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3rem 0.55rem;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--fb-muted);
  font: inherit;
  font-size: 0.84rem;
  cursor: pointer;
}
.tab.active {
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
  font-weight: 600;
}
.close {
  margin-left: auto;
}
.content {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.6rem;
  min-height: 0;
  padding: 0.6rem;
  overflow-y: auto;
}
.group h4 {
  margin: 0 0 0.3rem;
  font-size: 0.82rem;
}
.group p {
  margin: 0;
}
.entry {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  width: 100%;
  padding: 0.3rem 0.4rem;
  border: 0;
  border-radius: 6px;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 0.84rem;
  text-align: left;
  cursor: pointer;
}
button.entry:hover {
  background: var(--fb-panel-alt);
}
.entry > .pi {
  color: var(--fb-muted);
  font-size: 0.8rem;
}
.entry.broken {
  color: var(--fb-danger);
  cursor: default;
}
.entry.broken > .pi {
  color: inherit;
}
.names {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.help {
  margin: 0;
}
.composer {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.3rem;
}
.quote {
  display: block;
  width: 100%;
  margin: 0;
  padding: 0.15rem 0.5rem;
  border: 0;
  border-left: 3px solid #f59e0b;
  background: none;
  color: var(--fb-muted);
  font: inherit;
  font-size: 0.82rem;
  text-align: left;
  overflow-wrap: anywhere;
}
button.quote:not(:disabled) {
  cursor: pointer;
}
button.quote:not(:disabled):hover {
  color: var(--fb-text);
}
.thread {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.5rem;
  border: 1px solid var(--fb-border);
  border-radius: 8px;
}
.thread.focused {
  border-color: var(--fb-accent);
  box-shadow: 0 0 0 1px var(--fb-accent);
}
.thread.resolved {
  opacity: 0.7;
}
.gone {
  margin: 0;
}
.comment header {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 1.6rem;
  font-size: 0.82rem;
}
.when {
  flex-shrink: 0;
  margin-left: auto;
}
.mini {
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
}
.body {
  font-size: 0.86rem;
}
.thread-actions {
  display: flex;
  gap: 0.1rem;
}
.toggle {
  align-self: center;
}
</style>
