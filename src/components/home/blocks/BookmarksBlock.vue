<script setup lang="ts">
import { computed } from 'vue';
import { docParent, docTitle } from '@shared/docs';
import type { HomeBlock } from '@shared/homeLayout';
import HomeBlockFrame from '../HomeBlockFrame.vue';
import { useHomeSources } from '../homeContext';

/** Notes et images mises en favori. */
const props = defineProps<{ block: HomeBlock }>();
const { home } = useHomeSources();
const shown = computed(() => (home.value?.bookmarks ?? []).slice(0, props.block.options.limit ?? 12));
</script>

<template>
  <HomeBlockFrame :block="block">
    <ul v-if="shown.length" class="rows">
      <li v-for="entry in shown" :key="entry.nodeId">
        <router-link :to="{ name: 'doc-file', params: { nodeId: entry.nodeId } }" class="row" draggable="false">
          <i :class="entry.kind === 'image' ? 'pi pi-image' : 'pi pi-file'" class="row-icon" data-kind="note"></i>
          <span class="row-text">
            <span class="truncate">{{ docTitle(entry.path) }}</span>
            <span class="muted small truncate">{{ entry.spaceName }}<template v-if="docParent(entry.path)"> · {{ docParent(entry.path) }}</template></span>
          </span>
        </router-link>
      </li>
    </ul>
    <p v-else class="hint muted small">{{ $t('Mettez une note en favori (étoile de la note, ou clic droit dans l’arbre) pour la retrouver ici.') }}</p>
  </HomeBlockFrame>
</template>

<style scoped src="../home.css"></style>
