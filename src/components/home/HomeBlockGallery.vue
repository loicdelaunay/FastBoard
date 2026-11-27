<script setup lang="ts">
import { computed } from 'vue';
import Dialog from 'primevue/dialog';
import { HOME_BLOCK_INFO, HOME_BLOCK_TYPES, type HomeBlockType } from '@shared/homeLayout';

/** Galerie des blocs à ajouter à l'Accueil : ceux d'origine, et les blocs de suivi. */
const props = defineProps<{ present: HomeBlockType[] }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ add: [type: HomeBlockType] }>();

const groups = computed(() => [
  { title: 'Blocs de suivi', hint: 'Un tableau de bord à votre mesure : ajoutez-en autant que vous voulez.', types: HOME_BLOCK_TYPES.filter((type) => HOME_BLOCK_INFO[type].tracking) },
  { title: 'Blocs de l’Accueil', hint: 'Ceux de l’Accueil d’origine.', types: HOME_BLOCK_TYPES.filter((type) => !HOME_BLOCK_INFO[type].tracking) },
]);

function add(type: HomeBlockType): void {
  emit('add', type);
  visible.value = false;
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="$t('Ajouter un bloc')" :style="{ width: 'min(46rem, calc(100vw - 2rem))' }" :draggable="false">
    <section v-for="group in groups" :key="group.title" class="group">
      <h3>{{ $t(group.title) }}</h3>
      <p class="muted small">{{ $t(group.hint) }}</p>
      <div class="tiles">
        <button v-for="type in group.types" :key="type" type="button" class="tile" @click="add(type)">
          <i :class="HOME_BLOCK_INFO[type].icon" class="tile-icon"></i>
          <span class="tile-text">
            <strong>{{ $t(HOME_BLOCK_INFO[type].label) }}</strong>
            <span class="muted small">{{ $t(HOME_BLOCK_INFO[type].description) }}</span>
            <span v-if="props.present.includes(type)" class="already small"><i class="pi pi-check"></i> {{ $t('Déjà sur votre accueil') }}</span>
          </span>
          <i class="pi pi-plus add" aria-hidden="true"></i>
        </button>
      </div>
    </section>
  </Dialog>
</template>

<style scoped>
.group + .group {
  margin-top: 1.1rem;
}
h3 {
  margin: 0;
  font-size: 0.95rem;
}
.group > p {
  margin: 0.15rem 0 0.6rem;
}
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
  gap: 0.55rem;
}
.tile {
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
  padding: 0.7rem 0.8rem;
  border: 1px solid var(--fb-border);
  border-radius: 12px;
  background: var(--fb-panel);
  color: var(--fb-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.tile:hover,
.tile:focus-visible {
  border-color: var(--fb-accent);
}
.tile-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 9px;
  background: color-mix(in srgb, var(--fb-accent) 12%, transparent);
  color: var(--fb-accent);
}
.tile-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}
.already {
  color: var(--fb-success, #16a34a);
}
.add {
  flex: none;
  margin-top: 0.3rem;
  color: var(--fb-muted);
}
.tile:hover .add {
  color: var(--fb-accent);
}
</style>
