<script setup lang="ts">
import { computed } from 'vue';
import { formatDateShort } from '@shared/dates';
import type { HomeBlock } from '@shared/homeLayout';
import { emptyTicketFilters, filtersToQuery } from '@shared/ticketFilters';
import HomeBlockFrame from '../HomeBlockFrame.vue';
import { useHomeSources } from '../homeContext';

/** Livraisons en cours de mes projets, celles qui finissent le plus tôt d'abord : avancement face au temps écoulé. */
const props = defineProps<{ block: HomeBlock }>();
const { projects } = useHomeSources();
projects.ensure();

const entries = computed(() =>
  (projects.data.value ?? [])
    .filter((project) => !project.archived && project.currentDelivery)
    .map((project) => ({ project, delivery: project.currentDelivery! }))
    .sort((a, b) => a.delivery.endDate.localeCompare(b.delivery.endDate) || a.project.name.localeCompare(b.project.name)),
);
const shown = computed(() => entries.value.slice(0, props.block.options.limit ?? 8));
const queryOf = (deliveryId: number) => filtersToQuery({ ...emptyTicketFilters(), deliveryIds: [deliveryId] });
</script>

<template>
  <HomeBlockFrame :block="block" :badge="projects.data.value ? entries.length : null">
    <div v-if="!projects.data.value" class="state muted small">
      <template v-if="projects.failed.value"><i class="pi pi-exclamation-circle"></i> {{ $t('Ce bloc n’a pas pu être chargé.') }}</template>
      <template v-else><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</template>
    </div>
    <ul v-else-if="shown.length" class="rows">
      <li v-for="{ project, delivery } in shown" :key="delivery.id">
        <router-link :to="{ name: 'project', params: { projectId: project.id }, query: queryOf(delivery.id) }" class="row delivery" draggable="false">
          <span class="status" :style="{ '--s': delivery.color }"></span>
          <span class="row-text">
            <span class="line">
              <span class="truncate"><strong>{{ delivery.name }}</strong> <span class="muted small">{{ project.key }}</span></span>
              <span class="small">{{ delivery.progress }} %</span>
            </span>
            <span class="bar timeline" :title="$t('Temps écoulé : {n} %', { n: delivery.timeElapsed })">
              <span :style="{ width: `${delivery.progress}%`, '--c': delivery.color }"></span>
              <i class="elapsed" :style="{ left: `${delivery.timeElapsed}%` }"></i>
            </span>
            <span class="muted small truncate">
              {{ $t('{done} sur {total} terminés', { done: delivery.doneCount, total: delivery.ticketCount }) }} ·
              <span :class="{ late: delivery.progress + 10 < delivery.timeElapsed }">{{ $t('{n} jour restant|{n} jours restants', { n: delivery.daysLeft }) }}</span>
              · {{ formatDateShort(delivery.endDate) }}
            </span>
          </span>
        </router-link>
      </li>
    </ul>
    <p v-else class="hint muted small">{{ $t('Aucune livraison en cours dans vos projets.') }}</p>
  </HomeBlockFrame>
</template>

<style scoped src="../home.css"></style>
<style scoped>
.delivery {
  align-items: flex-start;
}
.delivery .status {
  margin-top: 0.35rem;
}
.row-text {
  gap: 0.25rem;
}
.line {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  min-width: 0;
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
