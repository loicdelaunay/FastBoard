<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useTicketRoute } from '@/composables/useTicketRoute';
import { useProjectStore } from '@/stores/project';
import { renderMarkdown, renderMermaid } from '@/utils/markdown';
import { ticketKey } from '@/utils/tickets';

/** Affichage d'un texte Markdown (mentions, formules, diagrammes Mermaid), assaini. */
const props = defineProps<{ text: string }>();

const project = useProjectStore();
const router = useRouter();
const { openTicket } = useTicketRoute();
const root = ref<HTMLElement | null>(null);

const html = computed(() =>
  renderMarkdown(props.text, {
    userName: (id) => project.usersById.get(id)?.name,
    ticketLabel: (id) => {
      const ticket = project.ticketsById.get(id);
      return ticket ? { key: ticketKey(project.project, ticket), title: ticket.title } : undefined;
    },
  }),
);

async function drawDiagrams(): Promise<void> {
  await nextTick();
  if (root.value) await renderMermaid(root.value, document.documentElement.classList.contains('app-dark'));
}
onMounted(drawDiagrams);
watch(html, drawDiagrams);

/** Les mentions naviguent dans l'application au lieu de recharger la page. */
function onClick(event: MouseEvent): void {
  const target = (event.target as HTMLElement).closest<HTMLElement>('a.md-mention');
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  if (target.dataset.user) void router.push({ name: 'user', params: { id: target.dataset.user } });
  else if (target.dataset.ticket) openTicket(Number(target.dataset.ticket));
}
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- HTML assaini par DOMPurify dans renderMarkdown. -->
  <div ref="root" class="markdown" @click="onClick" v-html="html"></div>
</template>

<style scoped>
.markdown {
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.markdown :deep(> :first-child) {
  margin-top: 0;
}
.markdown :deep(> :last-child) {
  margin-bottom: 0;
}
.markdown :deep(p),
.markdown :deep(ul),
.markdown :deep(ol),
.markdown :deep(blockquote),
.markdown :deep(table),
.markdown :deep(pre) {
  margin: 0 0 0.75rem;
}
.markdown :deep(h1),
.markdown :deep(h2),
.markdown :deep(h3),
.markdown :deep(h4) {
  margin: 1rem 0 0.5rem;
  line-height: 1.3;
}
.markdown :deep(h1) {
  font-size: 1.35rem;
}
.markdown :deep(h2) {
  font-size: 1.15rem;
}
.markdown :deep(h3) {
  font-size: 1rem;
}
.markdown :deep(ul),
.markdown :deep(ol) {
  padding-left: 1.4rem;
}
.markdown :deep(li > input[type='checkbox']) {
  margin: 0 0.4rem 0 -1.2rem;
  vertical-align: middle;
}
.markdown :deep(li:has(> input[type='checkbox'])) {
  list-style: none;
}
.markdown :deep(a) {
  color: var(--fb-accent);
  text-decoration: underline;
}
.markdown :deep(blockquote) {
  padding: 0.25rem 0.9rem;
  border-left: 3px solid var(--fb-accent);
  background: var(--fb-panel-alt);
  color: var(--fb-muted);
}
.markdown :deep(code) {
  padding: 0.1rem 0.35rem;
  border-radius: 5px;
  background: var(--fb-panel-alt);
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 0.85em;
}
.markdown :deep(pre) {
  padding: 0.75rem 0.9rem;
  border-radius: 8px;
  background: var(--fb-panel-alt);
  overflow-x: auto;
}
.markdown :deep(pre code) {
  padding: 0;
  background: none;
}
.markdown :deep(table) {
  border-collapse: collapse;
  display: block;
  max-width: 100%;
  overflow-x: auto;
}
.markdown :deep(th),
.markdown :deep(td) {
  padding: 0.35rem 0.6rem;
  border: 1px solid var(--fb-border);
}
.markdown :deep(th) {
  background: var(--fb-panel-alt);
}
.markdown :deep(hr) {
  border: 0;
  border-top: 1px solid var(--fb-border);
  margin: 1rem 0;
}
.markdown :deep(img) {
  max-width: 100%;
  border-radius: 6px;
}
.markdown :deep(.md-math) {
  margin: 0 0 0.75rem;
  overflow-x: auto;
}
.markdown :deep(.md-mermaid) {
  margin: 0 0 0.75rem;
  overflow-x: auto;
  text-align: center;
}
.markdown :deep(.md-mermaid.rendered svg) {
  max-width: 100%;
  height: auto;
}
.markdown :deep(.md-mermaid:not(.rendered) .md-mermaid-source) {
  opacity: 0.6;
}
.markdown :deep(.md-mermaid.failed .md-mermaid-source) {
  border-left: 3px solid var(--fb-danger);
  opacity: 1;
}
.markdown :deep(.md-mention) {
  display: inline-block;
  padding: 0 0.4rem;
  border-radius: 999px;
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
  font-weight: 600;
  text-decoration: none;
}
.markdown :deep(.md-mention.ticket) {
  font-size: 0.9em;
}
.markdown :deep(.md-mention.gone) {
  opacity: 0.6;
  text-decoration: line-through;
}
</style>
