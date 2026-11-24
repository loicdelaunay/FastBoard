<script setup lang="ts">
import { computed, ref } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import type { AiSourceDTO } from '@shared/ai';
import { boardCitationRoute, docCitationRoute } from '@/utils/citations';

/** Éléments lus par l'assistant pour répondre, sous sa réponse : un clic ouvre chacun d'eux. */
const props = defineProps<{
  sources: AiSourceDTO[];
  navigate: (location: RouteLocationRaw) => void;
  openTicket: (ticketId: number, projectId?: number) => void;
}>();

const SHOWN = 6;
const ICONS: Record<AiSourceDTO['kind'], string> = { ticket: 'pi pi-ticket', doc: 'pi pi-file', board: 'pi pi-objects-column', project: 'pi pi-folder' };
const expanded = ref(false);
const visible = computed(() => (expanded.value ? props.sources : props.sources.slice(0, SHOWN)));

function open(source: AiSourceDTO): void {
  if (source.kind === 'ticket') props.openTicket(source.id, source.projectId);
  else if (source.kind === 'doc') props.navigate(docCitationRoute(source.id, null));
  else if (source.kind === 'board') props.navigate(boardCitationRoute(source.id, null));
  else props.navigate({ name: 'project', params: { projectId: source.id } });
}
</script>

<template>
  <div class="ai-sources">
    <span class="title muted"><i class="pi pi-bookmark"></i> {{ $t('Sources') }}</span>
    <div class="list">
      <button v-for="source in visible" :key="`${source.kind}${source.id}`" v-tooltip.top="source.detail" type="button" class="source" @click="open(source)">
        <i :class="ICONS[source.kind]"></i>
        <span class="label truncate">{{ source.label }}</span>
      </button>
      <button v-if="sources.length > SHOWN" type="button" class="more muted" @click="expanded = !expanded">
        {{ expanded ? $t('Moins') : $t('+{n} autres', { n: sources.length - SHOWN }) }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.ai-sources {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-top: 0.6rem;
  padding-top: 0.5rem;
  border-top: 1px dashed var(--fb-border);
}
.title {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.title i {
  font-size: 0.7rem;
}
.list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.source {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  max-width: 100%;
  padding: 0.15rem 0.5rem;
  border: 1px solid var(--fb-border);
  border-radius: 999px;
  background: var(--fb-panel);
  color: inherit;
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
.source:hover {
  border-color: var(--fb-accent);
  color: var(--fb-accent);
}
.source i {
  flex: none;
  color: var(--fb-accent);
  font-size: 0.75rem;
}
.label {
  min-width: 0;
}
.more {
  padding: 0.15rem 0.4rem;
  border: 0;
  background: none;
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
.more:hover {
  text-decoration: underline;
}
</style>
