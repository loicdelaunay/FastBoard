<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useTicketRoute } from '@/composables/useTicketRoute';
import { useProjectStore } from '@/stores/project';
import { mountBoardEmbeds } from '@/utils/boardEmbed';
import { highlightCodeBlocks } from '@/utils/codeHighlight';
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
  if (!root.value) return;
  void highlightCodeBlocks(root.value);
  mountBoardEmbeds(root.value);
  await renderMermaid(root.value, document.documentElement.classList.contains('app-dark'));
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
  color: var(--md-text, currentColor);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.markdown h1 {
  color: var(--md-h1, currentColor);
}
.markdown h2 {
  color: var(--md-h2, currentColor);
}
.markdown h3 {
  color: var(--md-h3, currentColor);
}
.markdown :is(h4, h5, h6) {
  color: var(--md-h4, currentColor);
}
.markdown strong {
  color: var(--md-strong, currentColor);
}
.markdown em {
  color: var(--md-em, currentColor);
}
.markdown li::marker {
  color: var(--md-marker, var(--fb-md-marker));
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
  accent-color: var(--md-marker, var(--fb-md-marker));
}
.markdown input[type='checkbox'][data-readonly] {
  pointer-events: none;
}
.markdown li:has(> input[type='checkbox']:checked) {
  color: var(--fb-muted);
}
.markdown li:has(> input[type='checkbox']) {
  list-style: none;
}
.markdown a {
  color: var(--md-link, var(--fb-accent));
  text-decoration: underline;
}
.markdown blockquote {
  padding: 0.25rem 0.9rem;
  border-left: 3px solid var(--md-quote-bar, var(--fb-accent));
  background: var(--md-quote-bg, var(--fb-md-quote-bg));
  color: var(--md-quote, var(--fb-muted));
}
.markdown code {
  padding: 0.1rem 0.35rem;
  border-radius: 5px;
  background: var(--md-code-bg, var(--fb-md-code-bg));
  color: var(--md-code, var(--fb-md-code));
  font-family: var(--fb-font-mono, ui-monospace, 'Cascadia Mono', Consolas, monospace);
  font-size: 0.85em;
}
.markdown kbd {
  padding: 0.05em 0.35em;
  border: 1px solid var(--fb-border);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--fb-panel-alt);
  font-family: var(--fb-font-mono, ui-monospace, 'Cascadia Mono', Consolas, monospace);
  font-size: 0.85em;
}
/* Coloration syntaxique des blocs de code (classes de @lezer/highlight), aux couleurs du thème comme l'éditeur. */
.markdown pre code :is(.tok-keyword, .tok-operatorKeyword, .tok-modifier, .tok-controlKeyword) {
  color: var(--fb-hl-keyword);
}
.markdown pre code :is(.tok-string, .tok-string2, .tok-character, .tok-regexp, .tok-inserted) {
  color: var(--fb-hl-string);
}
.markdown pre code :is(.tok-number, .tok-bool, .tok-atom, .tok-literal) {
  color: var(--fb-hl-number);
}
.markdown pre code :is(.tok-typeName, .tok-className, .tok-namespace, .tok-macroName, .tok-tagName) {
  color: var(--fb-hl-type);
}
.markdown pre code :is(.tok-propertyName, .tok-attributeName, .tok-definition, .tok-labelName) {
  color: var(--fb-hl-property);
}
.markdown pre code :is(.tok-comment, .tok-meta, .tok-punctuation) {
  color: var(--fb-muted);
}
.markdown pre code .tok-comment {
  font-style: italic;
}
.markdown pre code :is(.tok-deleted, .tok-invalid) {
  color: var(--fb-danger);
}
.markdown pre code .tok-heading,
.markdown pre code .tok-strong {
  font-weight: 700;
}
.markdown pre code .tok-emphasis {
  font-style: italic;
}
.markdown pre code .tok-link,
.markdown pre code .tok-url {
  text-decoration: underline;
}
.markdown pre {
  padding: 0.75rem 0.9rem;
  border-radius: 8px;
  background: var(--md-pre-bg, var(--fb-panel-alt));
  color: var(--md-pre, currentColor);
  overflow-x: auto;
}
.markdown pre code {
  padding: 0;
  background: none;
  color: inherit;
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
  border: 1px solid var(--md-table-border, var(--fb-border));
}
.markdown th {
  background: var(--md-th-bg, var(--fb-md-th-bg));
}
.markdown hr {
  border: 0;
  border-top: 1px solid var(--md-hr, var(--fb-border));
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
  /* Une mention est un lien : elle prend la couleur des liens du thème. */
  background: color-mix(in srgb, var(--md-link, var(--fb-accent)) 12%, transparent);
  color: var(--md-link, var(--fb-accent));
  font-weight: 600;
  text-decoration: none;
}
/* Texte entre crochets ([REQ-012]) : couleur des liens, crochets discrets, comme en « Lecture et écriture ». */
.markdown .md-ref {
  color: var(--md-link, var(--fb-accent));
}
.markdown .md-ref-mark {
  color: var(--fb-muted);
}
.markdown .md-mention.ticket {
  font-size: 0.9em;
}
/* Tableau blanc cité seul sur sa ligne : son aperçu. */
.markdown .md-board {
  display: flex;
  flex-direction: column;
  max-width: 100%;
  margin: 0.6rem 0;
  overflow: hidden;
  border: 1px solid var(--fb-border);
  border-radius: 10px;
  background: var(--board-canvas);
  color: inherit;
  text-decoration: none;
}
.markdown .md-board:hover {
  border-color: var(--fb-accent);
}
.markdown .md-board-head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.45rem 0.75rem;
  border-bottom: 1px solid var(--fb-border);
  background: var(--fb-panel);
  font-weight: 600;
}
.markdown .md-board-head .pi {
  color: #a855f7;
}
.markdown .md-board-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.markdown .md-board .md-board-open {
  color: var(--fb-muted);
  font-size: 0.8rem;
}
.markdown .md-board-preview {
  display: block;
  width: 100%;
  max-height: 30rem;
  margin: 0;
  padding: 0.75rem;
  border-radius: 0;
  object-fit: contain;
}
/* Affiché en image : l'image seule, sans cadre ni titre. */
.markdown .md-board.md-board-image {
  border: 0;
  border-radius: 8px;
  background: none;
}
.markdown .md-board-image .md-board-preview {
  max-height: none;
  padding: 0;
  border-radius: 8px;
}
/* Intégré : l'en-tête ouvre le tableau, le cadre se parcourt. */
.markdown .md-board-embed .md-board-head {
  color: inherit;
  text-decoration: none;
}
.markdown .md-board-embed .md-board-head:hover .md-board-title {
  color: var(--fb-accent);
}
.markdown .md-board-head .md-board-tools {
  display: inline-flex;
}
.markdown .md-board-head .fb-board-zoom .pi {
  color: inherit;
}
.markdown .md-board-embed .fb-board-view img {
  max-height: none;
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
  background: var(--md-highlight, color-mix(in srgb, #facc15 38%, transparent));
  color: inherit;
}
/* Surlignage coloré par sa bille emoji, comme dans Obsidian : ==🟢 Validé==. */
.markdown .md-highlight[data-color='red'] {
  background: color-mix(in srgb, #ef4444 30%, transparent);
}
.markdown .md-highlight[data-color='orange'] {
  background: color-mix(in srgb, #f97316 32%, transparent);
}
.markdown .md-highlight[data-color='green'] {
  background: color-mix(in srgb, #22c55e 30%, transparent);
}
.markdown .md-highlight[data-color='blue'] {
  background: color-mix(in srgb, #3b82f6 28%, transparent);
}
.markdown .md-highlight[data-color='purple'] {
  background: color-mix(in srgb, #a855f7 28%, transparent);
}
.markdown .md-highlight[data-color='brown'] {
  background: color-mix(in srgb, #a16207 30%, transparent);
}
.markdown .md-highlight[data-color='black'] {
  background: color-mix(in srgb, #6b7280 35%, transparent);
}
.markdown .md-highlight[data-color='white'] {
  background: color-mix(in srgb, #cbd5e1 45%, transparent);
}
.markdown .md-tag {
  display: inline-block;
  padding: 0 0.45em;
  border-radius: 999px;
  background: color-mix(in srgb, var(--md-tag, var(--fb-accent)) 14%, transparent);
  color: var(--md-tag, var(--fb-accent));
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
