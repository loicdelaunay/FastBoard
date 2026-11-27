<script setup lang="ts">
import { computed } from 'vue';
import Button from 'primevue/button';
import { HOME_BLOCK_INFO, HOME_BLOCK_SIZES, type HomeBlock, type HomeBlockSize } from '@shared/homeLayout';
import { t } from '@/i18n';
import { useHomeEditor } from './homeContext';

/**
 * Cadre d'un bloc de l'Accueil : son titre, et en mode « Personnaliser » ses commandes (déplacer, largeur, réglages,
 * retirer). Le bloc se glisse-dépose aussi à la place d'un autre.
 */
const props = defineProps<{
  block: HomeBlock;
  /** Nombre montré à côté du titre. */
  badge?: number | null;
  /** Titre quand le bloc n'en a pas reçu (nom du projet suivi, du filtre…), avant celui du type. */
  fallbackTitle?: string;
}>();

const editor = useHomeEditor();
const { editing, dragging } = editor;
const info = computed(() => HOME_BLOCK_INFO[props.block.type]);
const title = computed(() => props.block.title || props.fallbackTitle || t(info.value.label));
const place = computed(() => editor.position(props.block.id));

const SIZE_LABELS: Record<HomeBlockSize, string> = { third: '⅓', half: '½', twoThirds: '⅔', full: '1' };
const SIZE_NAMES: Record<HomeBlockSize, string> = { third: 'Un tiers de la ligne', half: 'La moitié de la ligne', twoThirds: 'Deux tiers de la ligne', full: 'Toute la ligne' };

function onDragStart(event: DragEvent): void {
  dragging.value = props.block.id;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', props.block.id);
  }
}
function onDragOver(event: DragEvent): void {
  const id = dragging.value;
  if (!id) return;
  event.preventDefault();
  if (id !== props.block.id) editor.moveTo(id, props.block.id);
}
</script>

<template>
  <section
    class="home-block card"
    :class="[`size-${block.size}`, `height-${block.height}`, { editing, dragged: dragging === block.id }]"
    :draggable="editing"
    :aria-label="title"
    @dragstart="onDragStart"
    @dragover="onDragOver"
    @drop.prevent
    @dragend="dragging = null"
  >
    <div v-if="editing" class="edit-bar">
      <i v-tooltip.bottom="$t('Glisser pour déplacer')" class="pi pi-bars grip" aria-hidden="true"></i>
      <Button icon="pi pi-arrow-left" text rounded size="small" severity="secondary" :aria-label="$t('Déplacer avant')" :disabled="place.index === 0" @click="editor.move(block.id, -1)" />
      <Button icon="pi pi-arrow-right" text rounded size="small" severity="secondary" :aria-label="$t('Déplacer après')" :disabled="place.index >= place.total - 1" @click="editor.move(block.id, 1)" />
      <div class="sizes" role="group" :aria-label="$t('Largeur')">
        <button
          v-for="size in HOME_BLOCK_SIZES"
          :key="size"
          v-tooltip.bottom="$t(SIZE_NAMES[size])"
          type="button"
          class="size"
          :class="{ active: block.size === size }"
          :aria-pressed="block.size === size"
          :aria-label="$t(SIZE_NAMES[size])"
          @click="editor.update(block.id, { size })"
        >
          {{ SIZE_LABELS[size] }}
        </button>
      </div>
      <span class="grow"></span>
      <Button v-tooltip.bottom="$t('Réglages du bloc')" icon="pi pi-cog" text rounded size="small" severity="secondary" :aria-label="$t('Réglages du bloc')" @click="editor.configure(block.id)" />
      <Button v-tooltip.bottom="$t('Retirer le bloc')" icon="pi pi-trash" text rounded size="small" severity="danger" :aria-label="$t('Retirer le bloc')" @click="editor.remove(block.id)" />
    </div>
    <h2 class="card-title">
      <i :class="info.icon"></i>
      <span class="truncate">{{ title }}</span>
      <span v-if="badge !== undefined && badge !== null" class="count">{{ badge }}</span>
      <slot name="extra" />
    </h2>
    <slot />
  </section>
</template>

<style scoped>
.home-block {
  --rows-max: 26rem;
  grid-column: span 6;
  min-width: 0;
  padding: 0.9rem 1rem;
}
.height-compact {
  --rows-max: 13rem;
}
.height-tall {
  --rows-max: 44rem;
}
.size-third {
  grid-column: span 4;
}
.size-twoThirds {
  grid-column: span 8;
}
.size-full {
  grid-column: span 12;
}
.editing {
  outline: 1px dashed color-mix(in srgb, var(--fb-accent) 55%, transparent);
  outline-offset: 2px;
  cursor: grab;
}
.dragged {
  opacity: 0.45;
}
.edit-bar {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  margin: -0.4rem -0.5rem 0.5rem;
  padding: 0.15rem 0.3rem;
  border-radius: 8px;
  background: var(--fb-panel-alt);
  cursor: default;
}
.grip {
  padding: 0 0.4rem;
  color: var(--fb-muted);
  cursor: grab;
}
.sizes {
  display: inline-flex;
  margin-left: 0.3rem;
  padding: 0.1rem;
  border-radius: 7px;
  background: var(--fb-panel);
}
.size {
  min-width: 1.7rem;
  padding: 0.15rem 0.35rem;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--fb-muted);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
}
.size:hover {
  color: var(--fb-text);
}
.size.active {
  background: var(--fb-accent);
  color: var(--fb-accent-contrast, #fff);
}
.grow {
  flex: 1;
}
.card-title {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
  margin: 0 0 0.5rem;
  font-size: 0.95rem;
}
.card-title > i {
  flex: none;
  color: var(--fb-accent);
}
.count {
  flex: none;
  padding: 0 0.45rem;
  border-radius: 999px;
  background: var(--fb-panel-alt);
  color: var(--fb-muted);
  font-size: 0.75rem;
  font-weight: 700;
}
@media (max-width: 1100px) {
  .size-third {
    grid-column: span 6;
  }
  .size-twoThirds {
    grid-column: span 12;
  }
}
@media (max-width: 760px) {
  .home-block {
    grid-column: span 12;
  }
}
</style>
