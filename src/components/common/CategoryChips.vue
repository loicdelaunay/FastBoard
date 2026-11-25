<script setup lang="ts" generic="K extends string">
/**
 * Pastilles de catégories (Tout, Personnes, Tickets, Documents…), chacune avec son icône et sa couleur : filtres des
 * mentions `@` et de la recherche Ctrl + K. Un clic ne prend pas le focus : on continue d'écrire là où l'on était.
 */
defineProps<{ filters: ReadonlyArray<{ key: K; label: string; icon: string; color: string }> }>();
const model = defineModel<K>({ required: true });
</script>

<template>
  <div class="mention-filters" role="tablist" :aria-label="$t('Type d’élément')">
    <button
      v-for="entry in filters"
      :key="entry.key"
      type="button"
      role="tab"
      class="mention-filter"
      :class="{ active: model === entry.key }"
      :aria-selected="model === entry.key"
      :style="{ '--chip-color': entry.color }"
      tabindex="-1"
      @mousedown.prevent
      @click="model = entry.key"
    >
      <i :class="entry.icon"></i>{{ $t(entry.label) }}
    </button>
  </div>
</template>
