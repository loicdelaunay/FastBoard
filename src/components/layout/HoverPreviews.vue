<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ProgressBar from 'primevue/progressbar';
import { formatDateShort } from '@shared/dates';
import type { CommentDTO, TicketPreviewDTO, UserSummaryDTO } from '@shared/types';
import { api } from '@/api';
import RichText from '@/components/common/RichText.vue';
import UserAvatar from '@/components/common/UserAvatar.vue';
import UserAvatarGroup from '@/components/common/UserAvatarGroup.vue';
import { useProjectStore } from '@/stores/project';
import { formatRelative } from '@/utils/format';

/**
 * Aperçus au survol, pour toute l'application : un élément porte `data-ticket` (mention d'un ticket) ou `data-comments-of`
 * (nombre de commentaires), sans avoir à connaître ce composant.
 */
const SHOW_DELAY = 250;
const HIDE_DELAY = 200;
const CACHE_MS = 30_000;
const COMMENTS_SHOWN = 5;

type Content = { kind: 'ticket'; preview: TicketPreviewDTO } | { kind: 'comments'; comments: CommentDTO[] };

const project = useProjectStore();
const route = useRoute();
const router = useRouter();

const content = ref<Content | null>(null);
const panel = ref<HTMLElement | null>(null);
const position = ref({ left: 0, top: 0 });
let anchor: HTMLElement | null = null;
let showTimer: number | undefined;
let hideTimer: number | undefined;
let request = 0;

const cache = new Map<string, { at: number; content: Content }>();

async function fetchContent(element: HTMLElement): Promise<Content> {
  const key = element.dataset.ticket ? `t${element.dataset.ticket}` : `c${element.dataset.commentsOf}`;
  const known = cache.get(key);
  if (known && Date.now() - known.at < CACHE_MS) return known.content;
  const value: Content = element.dataset.ticket
    ? { kind: 'ticket', preview: (await api.ticketPreview(Number(element.dataset.ticket))).preview }
    : { kind: 'comments', comments: (await api.comments(Number(element.dataset.commentsOf))).comments };
  cache.set(key, { at: Date.now(), content: value });
  return value;
}

/** Sous l'élément survolé, au-dessus s'il n'y a pas la place, sans sortir de la fenêtre. */
function place(): void {
  if (!anchor || !panel.value) return;
  const rect = anchor.getBoundingClientRect();
  const { offsetWidth: width, offsetHeight: height } = panel.value;
  const below = rect.bottom + 6;
  const top = below + height > window.innerHeight - 8 && rect.top - height - 6 > 8 ? rect.top - height - 6 : below;
  position.value = { left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top: Math.max(8, top) };
}

async function show(element: HTMLElement): Promise<void> {
  const current = ++request;
  try {
    const value = await fetchContent(element);
    if (current !== request || anchor !== element || !element.isConnected) return;
    content.value = value;
    await nextTick();
    place();
  } catch {
    // Ticket inaccessible ou supprimé : rien à montrer.
    if (current === request) hide();
  }
}

function hide(): void {
  window.clearTimeout(showTimer);
  window.clearTimeout(hideTimer);
  request += 1;
  anchor = null;
  content.value = null;
}

const scheduleHide = (): void => {
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(hide, HIDE_DELAY);
};

function onOver(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  if (panel.value?.contains(target)) {
    window.clearTimeout(hideTimer);
    return;
  }
  const element = target.closest?.<HTMLElement>('[data-ticket], [data-comments-of]');
  if (!element) {
    if (anchor) {
      window.clearTimeout(showTimer);
      scheduleHide();
    }
    return;
  }
  window.clearTimeout(hideTimer);
  if (element === anchor) return;
  window.clearTimeout(showTimer);
  anchor = element;
  content.value = null;
  showTimer = window.setTimeout(() => void show(element), SHOW_DELAY);
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') hide();
}

onMounted(() => {
  document.addEventListener('mouseover', onOver);
  document.addEventListener('keydown', onKey);
  window.addEventListener('scroll', hide, { capture: true, passive: true });
});
onBeforeUnmount(() => {
  hide();
  document.removeEventListener('mouseover', onOver);
  document.removeEventListener('keydown', onKey);
  window.removeEventListener('scroll', hide, { capture: true });
});
watch(() => route.fullPath, hide);

const ticket = computed(() => (content.value?.kind === 'ticket' ? content.value.preview : null));
const allComments = computed(() => (content.value?.kind === 'comments' ? content.value.comments.filter((comment) => !comment.deleted) : []));
const comments = computed(() => allComments.value.slice(-COMMENTS_SHOWN));
const hiddenCount = computed(() => allComments.value.length - comments.value.length);
const userOf = (id: number | null): UserSummaryDTO | undefined => (id === null ? undefined : project.usersById.get(id));

function openTicket(): void {
  if (ticket.value) void router.push({ name: 'project', params: { projectId: ticket.value.projectId }, query: { ticket: String(ticket.value.id) } });
  hide();
}
</script>

<template>
  <Teleport to="body">
    <div v-if="content" ref="panel" class="hover-preview" role="tooltip" :style="{ left: `${position.left}px`, top: `${position.top}px` }">
      <template v-if="ticket">
        <button type="button" class="ticket-head" @click="openTicket">
          <span class="key">{{ ticket.key }}</span>
          <span class="status" :style="{ '--status': ticket.statusColor }">{{ ticket.statusLabel }}</span>
          <span class="muted small truncate project">{{ ticket.projectName }}</span>
        </button>
        <strong class="title">{{ ticket.title }}</strong>
        <p v-if="ticket.excerpt" class="muted small excerpt">{{ ticket.excerpt }}</p>
        <p class="facts muted small">
          <span v-if="ticket.priority"><i class="pi pi-flag" :style="{ color: ticket.priority.color }"></i> {{ ticket.priority.name }}</span>
          <span v-if="ticket.delivery"><i class="pi pi-truck"></i> {{ ticket.delivery }}</span>
          <span v-if="ticket.endDate"><i class="pi pi-calendar"></i> {{ formatDateShort(ticket.endDate) }}</span>
          <span v-if="ticket.commentCount"><i class="pi pi-comment"></i> {{ ticket.commentCount }}</span>
        </p>
        <div class="progress">
          <ProgressBar :value="ticket.progress" :show-value="false" class="bar" />
          <span class="small">{{ ticket.progress }}%</span>
          <UserAvatarGroup v-if="ticket.assignees.length" :users="ticket.assignees" :max="4" />
        </div>
      </template>

      <template v-else>
        <h4 class="comments-title">{{ $t('{n} commentaire|{n} commentaires', { n: allComments.length }) }}</h4>
        <p v-if="hiddenCount" class="muted small more">{{ $t('{n} plus ancien non affiché|{n} plus anciens non affichés', { n: hiddenCount }) }}</p>
        <ul class="comments">
          <li v-for="comment in comments" :key="comment.id">
            <header>
              <UserAvatar :user="userOf(comment.userId)" size="small" />
              <strong class="truncate">{{ userOf(comment.userId)?.name ?? $t('Ancien compte') }}</strong>
              <span class="muted small when">{{ formatRelative(comment.createdAt) }}</span>
            </header>
            <RichText class="body" :text="comment.body" />
          </li>
        </ul>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.hover-preview {
  position: fixed;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  width: min(24rem, calc(100vw - 1rem));
  max-height: min(24rem, calc(100vh - 1rem));
  padding: 0.65rem 0.75rem;
  overflow-y: auto;
  border: 1px solid var(--fb-border);
  border-radius: 10px;
  background: var(--fb-panel);
  box-shadow: var(--fb-shadow-lg);
  font-size: 0.88rem;
}
.ticket-head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.key {
  color: var(--fb-accent);
  font-weight: 700;
}
.status {
  flex-shrink: 0;
  padding: 0 0.45rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--status) 18%, transparent);
  color: var(--status);
  font-size: 0.76rem;
  font-weight: 600;
}
.project {
  min-width: 0;
}
.title {
  overflow-wrap: anywhere;
}
.excerpt,
.facts,
.more,
.comments-title {
  margin: 0;
}
.excerpt {
  overflow-wrap: anywhere;
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.15rem 0.75rem;
}
.progress {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.bar {
  flex: 1;
  height: 0.4rem;
}
.comments-title {
  font-size: 0.82rem;
}
.comments {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.comments header {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.82rem;
}
.when {
  flex-shrink: 0;
  margin-left: auto;
}
.body {
  display: block;
  margin-top: 0.1rem;
}
</style>
