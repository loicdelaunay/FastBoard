<script setup lang="ts">
import { computed } from 'vue';
import Button from 'primevue/button';
import { formatDateShort } from '@shared/dates';
import type { HomeBlock } from '@shared/homeLayout';
import { emptyTicketFilters, filtersToQuery } from '@shared/ticketFilters';
import HomeBlockFrame from '../HomeBlockFrame.vue';
import { useHomeEditor, useHomeSources } from '../homeContext';

/** Suivi d'un projet : son avancement, et celui de sa livraison en cours face au temps écoulé. */
const props = defineProps<{ block: HomeBlock }>();
const { projects } = useHomeSources();
const editor = useHomeEditor();
const { canEdit } = editor;
projects.ensure();

const projectId = computed(() => props.block.options.projectId ?? null);
const project = computed(() => (projectId.value === null ? null : (projects.data.value?.find((entry) => entry.id === projectId.value) ?? null)));
const delivery = computed(() => project.value?.currentDelivery ?? null);
/** Livraison en retard sur le temps : moins avancée que le temps écoulé. */
const behind = computed(() => Boolean(delivery.value && delivery.value.progress + 10 < delivery.value.timeElapsed));
const deliveryQuery = computed(() => (delivery.value ? filtersToQuery({ ...emptyTicketFilters(), deliveryIds: [delivery.value.id] }) : {}));
</script>

<template>
  <HomeBlockFrame :block="block" :fallback-title="project ? `${project.key} — ${project.name}` : undefined">
    <template #extra>
      <router-link v-if="project" :to="`/p/${project.id}`" class="more small" draggable="false">{{ $t('Ouvrir') }}</router-link>
    </template>
    <div v-if="projectId === null" class="state choose">
      <p class="hint muted small">{{ $t('Choisissez le projet à suivre dans les réglages du bloc.') }}</p>
      <Button v-if="canEdit" :label="$t('Choisir un projet')" icon="pi pi-cog" size="small" outlined @click="editor.configure(block.id)" />
    </div>
    <div v-else-if="!projects.data.value" class="state muted small">
      <template v-if="projects.failed.value"><i class="pi pi-exclamation-circle"></i> {{ $t('Ce bloc n’a pas pu être chargé.') }}</template>
      <template v-else><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</template>
    </div>
    <p v-else-if="!project" class="hint muted small"><i class="pi pi-eye-slash"></i> {{ $t('Ce projet n’existe plus, ou vous n’y avez plus accès.') }}</p>
    <div v-else class="tracking">
      <div class="metric">
        <div class="metric-head">
          <span class="muted small">{{ $t('Avancement du projet') }}</span>
          <strong class="big">{{ project.progress }} %</strong>
        </div>
        <span class="bar"><span :style="{ width: `${project.progress}%` }"></span></span>
        <span class="muted small">{{ $t('{done} sur {total} tickets terminés', { done: project.doneCount, total: project.ticketCount }) }}</span>
      </div>
      <router-link v-if="delivery" :to="{ name: 'project', params: { projectId: project.id }, query: deliveryQuery }" class="metric delivery" draggable="false">
        <div class="metric-head">
          <span class="truncate"><span class="dot" :style="{ background: delivery.color }"></span> {{ delivery.name }}</span>
          <strong>{{ delivery.progress }} %</strong>
        </div>
        <span class="bar timeline" :title="$t('Temps écoulé : {n} %', { n: delivery.timeElapsed })">
          <span :style="{ width: `${delivery.progress}%`, '--c': delivery.color }"></span>
          <i class="elapsed" :style="{ left: `${delivery.timeElapsed}%` }"></i>
        </span>
        <span class="muted small">
          {{ $t('{done} sur {total} terminés', { done: delivery.doneCount, total: delivery.ticketCount }) }} ·
          <span :class="{ late: behind }">{{ $t('{n} jour restant|{n} jours restants', { n: delivery.daysLeft }) }}</span>
          · {{ $t('fin le {date}', { date: formatDateShort(delivery.endDate) }) }}
        </span>
      </router-link>
      <p v-else class="hint muted small">{{ $t('Pas de livraison en cours aujourd’hui.') }}</p>
    </div>
  </HomeBlockFrame>
</template>

<style scoped src="../home.css"></style>
<style scoped>
.choose {
  flex-direction: column;
  align-items: flex-start;
}
.tracking {
  display: grid;
  gap: 0.9rem;
}
.metric {
  display: grid;
  gap: 0.35rem;
  color: var(--fb-text);
  text-decoration: none;
}
.metric-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.6rem;
  min-width: 0;
}
.big {
  font-size: 1.35rem;
}
.delivery {
  padding: 0.55rem 0.65rem;
  border: 1px solid var(--fb-border);
  border-radius: 10px;
}
.delivery:hover {
  border-color: var(--fb-accent);
}
.dot {
  display: inline-block;
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 999px;
  vertical-align: baseline;
}
.timeline {
  overflow: visible;
}
.elapsed {
  position: absolute;
  top: -0.2rem;
  bottom: -0.2rem;
  width: 2px;
  margin-left: -1px;
  background: var(--fb-text);
  opacity: 0.6;
}
</style>
