<script setup lang="ts">
import { computed } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import type { FavoriteSpaceDTO } from '@shared/home';
import type { HomeBlock } from '@shared/homeLayout';
import HomeBlockFrame from '../HomeBlockFrame.vue';
import { useHomeSources } from '../homeContext';

/** Espaces de documentation, de tableaux blancs et projets favoris. */
defineProps<{ block: HomeBlock }>();
const { home } = useHomeSources();
const favorites = computed(() => home.value?.favorites ?? []);

const ICONS: Record<FavoriteSpaceDTO['kind'], string> = { docs: 'pi pi-book', boards: 'pi pi-objects-column', project: 'pi pi-th-large' };
const spaceRoute = (space: FavoriteSpaceDTO): RouteLocationRaw =>
  space.kind === 'docs' ? { name: 'doc-space', params: { spaceId: space.id } } : space.kind === 'boards' ? { name: 'board-space', params: { spaceId: space.id } } : `/p/${space.id}`;
</script>

<template>
  <HomeBlockFrame :block="block">
    <div v-if="favorites.length" class="spaces">
      <router-link v-for="space in favorites" :key="`${space.kind}:${space.id}`" :to="spaceRoute(space)" class="space" :class="`kind-${space.kind}`" :title="space.description || space.name" draggable="false">
        <i :class="ICONS[space.kind]" class="space-icon"></i>
        <span class="space-text">
          <strong class="truncate">{{ space.name }}</strong>
          <span class="muted small">{{ space.kind === 'docs' ? $t('Documentation') : space.kind === 'boards' ? $t('Tableaux blancs') : space.key }}</span>
        </span>
      </router-link>
    </div>
    <p v-else class="hint muted small">{{ $t('Ajoutez un espace ou un projet aux favoris avec l’étoile de sa carte (ou son clic droit) : il apparaîtra ici.') }}</p>
  </HomeBlockFrame>
</template>

<style scoped src="../home.css"></style>
<style scoped>
.spaces {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
  gap: 0.6rem;
  max-height: var(--rows-max, 26rem);
  overflow: auto;
}
.space {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-width: 0;
  padding: 0.65rem 0.8rem;
  border: 1px solid var(--fb-border);
  border-radius: 12px;
  background: var(--fb-panel);
  color: var(--fb-text);
  text-decoration: none;
  transition: border-color 0.12s;
}
.space:hover {
  border-color: var(--fb-accent);
}
.space-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 2.1rem;
  height: 2.1rem;
  border-radius: 10px;
  background: color-mix(in srgb, var(--k) 14%, transparent);
  color: var(--k);
}
.kind-docs {
  --k: var(--fb-module-docs);
}
.kind-boards {
  --k: var(--fb-module-boards);
}
.kind-project {
  --k: var(--fb-module-projects);
}
.space-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
</style>
