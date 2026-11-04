<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useTicketRoute } from '@/composables/useTicketRoute';
import { useProjectStore } from '@/stores/project';
import { renderMarkdown, renderMermaid, type MentionResolver } from '@/utils/markdown';
import { ticketKey } from '@/utils/tickets';

/** Affichage d'un texte Markdown (mentions, formules, diagrammes Mermaid), assaini. */
const props = defineProps<{
  text: string;
  /** Hors d'un projet : d'où viennent les noms des personnes et des tickets. */
  resolver?: MentionResolver;
  /** Transforme le texte avant le rendu, et le HTML après (liens internes de la documentation). */
  prepare?: (text: string) => string;
  finish?: (html: string) => string;
  openTicketWith?: (ticketId: number) => void;
}>();

const project = useProjectStore();
const router = useRouter();
const { openTicket } = useTicketRoute();
const root = ref<HTMLElement | null>(null);

const projectResolver: MentionResolver = {
  userName: (id) => project.usersById.get(id)?.name,
  ticketLabel: (id) => {
    const ticket = project.ticketsById.get(id);
    return ticket ? { key: ticketKey(project.project, ticket), title: ticket.title } : undefined;
  },
};

const html = computed(() => {
  const rendered = renderMarkdown(props.prepare ? props.prepare(props.text) : props.text, props.resolver ?? projectResolver);
  return props.finish ? props.finish(rendered) : rendered;
});

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
  else if (target.dataset.doc) void router.push({ name: 'doc-file', params: { nodeId: target.dataset.doc } });
  else if (target.dataset.ticket) (props.openTicketWith ?? openTicket)(Number(target.dataset.ticket));
}
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- HTML assaini par DOMPurify dans renderMarkdown. -->
  <div ref="root" class="markdown" @click="onClick" v-html="html"></div>
</template>

<style>
/* Sans portée : les blocs rendus de l’éditeur de documentation partagent ces styles. */
.markdown {
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.markdown > :first-child {
  margin-top: 0;
}
.markdown > :last-child {
  margin-bottom: 0;
}
.markdown p,
.markdown ul,
.markdown ol,
.markdown blockquote,
.markdown table,
.markdown pre {
  margin: 0 0 0.75rem;
}
.markdown h1,
.markdown h2,
.markdown h3,
.markdown h4 {
  margin: 1rem 0 0.5rem;
  line-height: 1.3;
}
.markdown h1 {
  font-size: 1.35rem;
}
.markdown h2 {
  font-size: 1.15rem;
}
.markdown h3 {
  font-size: 1rem;
}
.markdown ul,
.markdown ol {
  padding-left: 1.4rem;
}
.markdown li > input[type='checkbox'] {
  margin: 0 0.4rem 0 -1.2rem;
  vertical-align: middle;
}
.markdown li:has(> input[type='checkbox']) {
  list-style: none;
}
.markdown a {
  color: var(--fb-accent);
  text-decoration: underline;
}
.markdown blockquote {
  padding: 0.25rem 0.9rem;
  border-left: 3px solid var(--fb-accent);
  background: var(--fb-panel-alt);
  color: var(--fb-muted);
}
.markdown code {
  padding: 0.1rem 0.35rem;
  border-radius: 5px;
  background: var(--fb-panel-alt);
  font-family: var(--fb-font-mono, ui-monospace, 'Cascadia Mono', Consolas, monospace);
  font-size: 0.85em;
}
.markdown pre {
  padding: 0.75rem 0.9rem;
  border-radius: 8px;
  background: var(--fb-panel-alt);
  overflow-x: auto;
}
.markdown pre code {
  padding: 0;
  background: none;
}
.markdown table {
  border-collapse: collapse;
  display: block;
  max-width: 100%;
  overflow-x: auto;
}
.markdown th,
.markdown td {
  padding: 0.35rem 0.6rem;
  border: 1px solid var(--fb-border);
}
.markdown th {
  background: var(--fb-panel-alt);
}
.markdown hr {
  border: 0;
  border-top: 1px solid var(--fb-border);
  margin: 1rem 0;
}
.markdown img {
  max-width: 100%;
  border-radius: 6px;
}
.markdown .md-math {
  margin: 0 0 0.75rem;
  overflow-x: auto;
}
.markdown .md-mermaid {
  margin: 0 0 0.75rem;
  overflow-x: auto;
  text-align: center;
}
.markdown .md-mermaid.rendered svg {
  max-width: 100%;
  height: auto;
}
.markdown .md-mermaid:not(.rendered) .md-mermaid-source {
  opacity: 0.6;
}
.markdown .md-mermaid.failed .md-mermaid-source {
  border-left: 3px solid var(--fb-danger);
  opacity: 1;
}
.markdown .md-mention {
  display: inline-block;
  padding: 0 0.4rem;
  border-radius: 999px;
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
  font-weight: 600;
  text-decoration: none;
}
.markdown .md-mention.ticket {
  font-size: 0.9em;
}
.markdown .md-mention.gone {
  opacity: 0.6;
  text-decoration: line-through;
}
.doc-mark {
  border-radius: 2px;
  background: color-mix(in srgb, #f59e0b 28%, transparent);
  color: inherit;
  cursor: pointer;
}
.doc-mark.active {
  background: color-mix(in srgb, #f59e0b 55%, transparent);
}
</style>
