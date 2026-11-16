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
  /** Syntaxe propre à Obsidian (documentation). */
  obsidian?: boolean;
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
  const rendered = renderMarkdown(props.prepare ? props.prepare(props.text) : props.text, props.resolver ?? projectResolver, { obsidian: props.obsidian });
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
/* --- Syntaxe d'Obsidian --- */
.markdown .md-highlight,
.markdown mark {
  padding: 0 0.1em;
  border-radius: 3px;
  background: color-mix(in srgb, #facc15 38%, transparent);
  color: inherit;
}
.markdown .md-tag {
  display: inline-block;
  padding: 0 0.45em;
  border-radius: 999px;
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
  font-size: 0.85em;
  font-weight: 600;
}
.markdown .md-callout {
  --callout: #3b82f6;
  margin: 0 0 0.75rem;
  padding: 0.55rem 0.8rem;
  border-left: 3px solid var(--callout);
  border-radius: 6px;
  background: color-mix(in srgb, var(--callout) 11%, transparent);
}
.markdown .md-callout-title {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  color: color-mix(in srgb, var(--callout) 75%, var(--fb-text));
  font-weight: 700;
}
.markdown .md-callout-title::before {
  content: '\e924';
  font-family: primeicons;
  font-size: 0.9em;
  font-weight: normal;
}
.markdown details.md-callout > summary {
  cursor: pointer;
  list-style: none;
}
.markdown details.md-callout > summary::-webkit-details-marker {
  display: none;
}
.markdown details.md-callout > summary::after {
  content: '\e902';
  margin-left: auto;
  font-family: primeicons;
  font-size: 0.75em;
  transition: transform 0.15s;
}
.markdown details.md-callout[open] > summary::after {
  transform: rotate(180deg);
}
.markdown .md-callout-content {
  margin-top: 0.35rem;
}
.markdown .md-callout-content > :last-child {
  margin-bottom: 0;
}
.markdown .md-callout[data-callout='abstract'] { --callout: #06b6d4; }
.markdown .md-callout[data-callout='abstract'] .md-callout-title::before { content: '\ea13'; }
.markdown .md-callout[data-callout='todo'] .md-callout-title::before { content: '\e98c'; }
.markdown .md-callout[data-callout='note'] .md-callout-title::before { content: '\e942'; }
.markdown .md-callout[data-callout='tip'] { --callout: #14b8a6; }
.markdown .md-callout[data-callout='tip'] .md-callout-title::before { content: '\ea28'; }
.markdown .md-callout[data-callout='success'] { --callout: #22c55e; }
.markdown .md-callout[data-callout='success'] .md-callout-title::before { content: '\e90a'; }
.markdown .md-callout[data-callout='question'] { --callout: #eab308; }
.markdown .md-callout[data-callout='question'] .md-callout-title::before { content: '\e959'; }
.markdown .md-callout[data-callout='warning'] { --callout: #f59e0b; }
.markdown .md-callout[data-callout='warning'] .md-callout-title::before { content: '\e922'; }
.markdown .md-callout[data-callout='failure'],
.markdown .md-callout[data-callout='danger'],
.markdown .md-callout[data-callout='bug'] { --callout: #ef4444; }
.markdown .md-callout[data-callout='failure'] .md-callout-title::before { content: '\e90c'; }
.markdown .md-callout[data-callout='danger'] .md-callout-title::before { content: '\e9db'; }
.markdown .md-callout[data-callout='bug'] .md-callout-title::before { content: '\e989'; }
.markdown .md-callout[data-callout='example'] { --callout: #a855f7; }
.markdown .md-callout[data-callout='example'] .md-callout-title::before { content: '\e967'; }
.markdown .md-callout[data-callout='quote'] { --callout: #94a3b8; }
.markdown .md-callout[data-callout='quote'] .md-callout-title::before { content: '\e97f'; }
.markdown .md-fn-ref a {
  padding: 0 0.15em;
  font-size: 0.8em;
}
.markdown .md-footnotes {
  margin-top: 1.5rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--fb-border);
  color: var(--fb-muted);
  font-size: 0.9em;
}
.markdown .md-fn-back {
  margin-left: 0.2em;
  text-decoration: none;
}
.markdown .md-properties {
  display: grid;
  grid-template-columns: minmax(6rem, max-content) minmax(0, 1fr);
  gap: 0.25rem 1rem;
  margin: 0 0 1rem;
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--fb-border);
  border-radius: 8px;
  font-size: 0.9em;
}
.markdown .md-property {
  display: contents;
}
.markdown .md-property-key {
  color: var(--fb-muted);
  font-weight: 600;
}
.markdown .md-property-value {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.markdown .md-property-value > span + span::before {
  content: '·';
  margin-right: 0.3rem;
  color: var(--fb-muted);
}
.markdown .md-embed {
  display: block;
  margin: 0 0 0.75rem;
  padding: 0.5rem 0.8rem;
  border-left: 3px solid var(--fb-border);
  border-radius: 0 8px 8px 0;
  background: color-mix(in srgb, var(--fb-text) 3%, transparent);
}
.markdown .md-embed:empty::before {
  content: '…';
  color: var(--fb-muted);
}
.markdown .md-embed.broken {
  color: var(--fb-danger);
  font-size: 0.9em;
}
.markdown .md-embed-head {
  display: block;
  margin-bottom: 0.3rem;
  font-size: 0.8em;
  font-weight: 700;
}
.markdown .md-embed-body {
  display: block;
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
