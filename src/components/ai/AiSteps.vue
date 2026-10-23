<script setup lang="ts">
import { computed, ref } from 'vue';
import type { AiStep } from '@/stores/ai';

/** Réflexion de l'assistant (outils utilisés, raisonnement du modèle) : repliée, la dernière étape sert de titre. */
const props = defineProps<{ steps: AiStep[]; running: boolean }>();

const expanded = ref(false);
const last = computed(() => props.steps.at(-1));
/** Titre replié : la dernière étape (le début du raisonnement quand c'en est un). */
const current = computed(() => (last.value?.kind === 'thought' && last.value.text ? last.value.text.split('\n')[0]!.slice(0, 140) : last.value?.label));
const failed = computed(() => props.steps.filter((step) => step.status === 'failed').length);

function icon(step: AiStep): string {
  if (step.status === 'running') return 'pi pi-spin pi-spinner';
  if (step.status === 'failed') return 'pi pi-exclamation-circle';
  if (step.kind === 'thought') return 'pi pi-lightbulb';
  return step.write ? 'pi pi-pencil' : 'pi pi-check';
}
</script>

<template>
  <div v-if="steps.length" class="reasoning" :class="{ open: expanded }">
    <button type="button" class="toggle" :aria-expanded="expanded" @click="expanded = !expanded">
      <i :class="running && last?.status !== 'failed' ? 'pi pi-spin pi-spinner' : 'pi pi-sparkles'" class="lead"></i>
      <span class="truncate current">{{ current }}</span>
      <span class="count">{{ $t('{n} étape|{n} étapes', { n: steps.length }) }}<template v-if="failed"> · {{ $t('{n} échec|{n} échecs', { n: failed }) }}</template></span>
      <i :class="expanded ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" class="chevron"></i>
    </button>
    <ol v-if="expanded" class="steps">
      <li v-for="step in steps" :key="step.id" :class="[step.status, step.kind ?? 'tool', { write: step.write }]">
        <div class="line">
          <i :class="icon(step)"></i>
          <span>{{ step.label }}</span>
        </div>
        <p v-if="step.detail" class="detail">{{ step.detail }}</p>
        <p v-if="step.text" class="thought">{{ step.text }}</p>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.reasoning {
  border-radius: 10px;
  background: var(--fb-panel-alt);
  font-size: 0.78rem;
  color: var(--fb-muted);
}
.toggle {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  width: 100%;
  padding: 0.4rem 0.6rem;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.toggle:hover {
  color: var(--fb-text);
}
.lead {
  color: #a95cff;
}
.current {
  flex: 1;
  min-width: 0;
  font-weight: 600;
}
.count {
  white-space: nowrap;
  opacity: 0.8;
}
.chevron {
  font-size: 0.7rem;
}
.steps {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin: 0;
  padding: 0 0.6rem 0.5rem 0.7rem;
  list-style: none;
  border-top: 1px solid var(--fb-border);
  padding-top: 0.45rem;
}
.line {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}
.steps li.done .line i {
  color: #16a34a;
}
.steps li.done.write .line i,
.steps li.thought .line i {
  color: #a95cff;
}
.steps li.failed {
  color: var(--fb-danger);
}
.detail,
.thought {
  margin: 0.15rem 0 0 1.35rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.thought {
  max-height: 12rem;
  overflow-y: auto;
  padding: 0.35rem 0.5rem;
  border-left: 2px solid color-mix(in srgb, #a95cff 50%, transparent);
  font-style: italic;
}
</style>
