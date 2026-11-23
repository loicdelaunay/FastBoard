<script setup lang="ts">
import { computed } from 'vue';
import { BOARD_COLORS, type BoardColor, type MockupKind, type ShapeKind } from '@shared/boards';
import { t } from '@/i18n';
import BoardPalette from './BoardPalette.vue';
import { COLOR_LABELS, MOCKUP_ICONS, MODE_TOOLS, MODES, shapeIcon, type BoardMode, type BoardTool, type QuickPick } from './editor/tools';

/** Barre latérale du tableau : le mode (diagramme, post-it, carte mentale, dessin), puis ses outils et leurs réglages. */
const props = defineProps<{ editable: boolean }>();
const emit = defineEmits<{ import: []; fast: []; quick: [tab: 'all' | 'icons']; pick: [pick: QuickPick] }>();
const mode = defineModel<BoardMode>('mode', { required: true });
const tool = defineModel<BoardTool>('tool', { required: true });
const shape = defineModel<ShapeKind>('shape', { required: true });
const mockup = defineModel<MockupKind>('mockup', { required: true });
const stickyColor = defineModel<BoardColor>('stickyColor', { required: true });
const penColor = defineModel<BoardColor>('penColor', { required: true });

const tools = computed(() => MODE_TOOLS[mode.value].filter((entry) => props.editable || !entry.edit));
const modes = computed(() => (props.editable ? MODES : []));

function choose(next: BoardTool): void {
  tool.value = next;
  if (next === 'fast') emit('fast');
}

const tip = (label: string, key?: string): string => (key ? `${t(label)} (${key.toUpperCase()})` : t(label));
</script>

<template>
  <div class="toolbar" @pointerdown.stop @dblclick.stop>
    <div v-if="modes.length" class="modes" role="radiogroup" :aria-label="$t('Mode')">
      <button
        v-for="entry in modes"
        :key="entry.mode"
        v-tooltip.right="$t(entry.label)"
        type="button"
        role="radio"
        class="mode"
        :class="{ active: mode === entry.mode }"
        :aria-checked="mode === entry.mode"
        :aria-label="$t(entry.label)"
        @click="mode = entry.mode"
      >
        <i :class="entry.icon"></i>
      </button>
    </div>
    <div class="tools" role="toolbar" :aria-label="$t('Outils')">
      <div v-for="entry in tools" :key="entry.tool" class="tool-wrap">
        <button v-tooltip.right="tip(entry.label, entry.key)" type="button" class="tool" :class="{ active: tool === entry.tool }" :aria-pressed="tool === entry.tool" :aria-label="$t(entry.label)" @click="choose(entry.tool)">
          <!-- eslint-disable-next-line vue/no-v-html -- icône SVG construite ici, sans texte saisi. -->
          <span v-if="entry.icon === 'shape'" class="shape-icon" v-html="shapeIcon(shape)"></span>
          <i v-else-if="entry.icon === 'mockup'" :class="MOCKUP_ICONS[mockup]"></i>
          <i v-else :class="entry.icon"></i>
        </button>
        <div v-if="tool === entry.tool && entry.tool === 'sticky'" class="flyout colors">
          <button v-for="color in BOARD_COLORS.filter((value) => value !== 'default')" :key="color" v-tooltip.top="$t(COLOR_LABELS[color])" type="button" class="swatch sticky" :class="[`s-${color}`, { active: stickyColor === color }]" :aria-label="$t(COLOR_LABELS[color])" @click="stickyColor = color"></button>
        </div>
        <div v-if="tool === entry.tool && (entry.tool === 'pen' || entry.tool === 'highlighter')" class="flyout colors">
          <button v-for="color in BOARD_COLORS" :key="color" v-tooltip.top="$t(COLOR_LABELS[color])" type="button" class="swatch" :class="[`s-${color}`, { active: penColor === color }]" :aria-label="$t(COLOR_LABELS[color])" @click="penColor = color"></button>
        </div>
      </div>
    </div>
    <!-- Palette de l'outil ouvert : chaque forme ou composant avec son visuel, et une recherche -->
    <BoardPalette v-if="editable && (tool === 'shape' || tool === 'mockup')" v-model:shape="shape" v-model:mockup="mockup" :block="tool" @pick="emit('pick', $event)" />
    <div v-if="editable" class="tools extra">
      <button v-tooltip.right="$t('Ajouter un élément (/)')" type="button" class="tool" :aria-label="$t('Ajouter un élément')" @click="emit('quick', 'all')">
        <i class="pi pi-plus-circle"></i>
      </button>
      <button v-tooltip.right="$t('Icônes')" type="button" class="tool" :aria-label="$t('Icônes')" @click="emit('quick', 'icons')">
        <i class="pi pi-face-smile"></i>
      </button>
      <button v-if="mode === 'diagram' || mode === 'mind'" v-tooltip.right="$t('Importer du Mermaid…')" type="button" class="tool" :aria-label="$t('Importer du Mermaid…')" @click="emit('import')">
        <i class="pi pi-file-import"></i>
      </button>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  position: absolute;
  top: 50%;
  left: 0.75rem;
  z-index: 4;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  transform: translateY(-50%);
}
.modes,
.tools {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.3rem;
  border: 1px solid var(--fb-border);
  border-radius: 12px;
  background: var(--fb-panel);
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.12);
}
.modes {
  background: var(--fb-panel-alt);
}
.mode,
.tool {
  display: grid;
  place-items: center;
  width: 2.3rem;
  height: 2.3rem;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: none;
  color: var(--fb-text);
  font-size: 1rem;
  cursor: pointer;
}
.mode:hover,
.tool:hover {
  background: color-mix(in srgb, var(--fb-text) 8%, transparent);
}
.mode.active {
  background: var(--fb-panel);
  color: var(--fb-accent);
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.12);
}
.tool.active {
  background: var(--fb-accent);
  color: #fff;
}
.tool-wrap {
  position: relative;
}
.shape-icon {
  display: grid;
  place-items: center;
}
.flyout {
  position: absolute;
  top: 50%;
  left: calc(100% + 0.6rem);
  display: flex;
  gap: 0.2rem;
  padding: 0.3rem;
  border: 1px solid var(--fb-border);
  border-radius: 10px;
  background: var(--fb-panel);
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.14);
  transform: translateY(-50%);
}
.flyout-item {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: none;
  color: var(--fb-text);
  cursor: pointer;
}
.flyout-item:hover {
  background: var(--fb-panel-alt);
}
.flyout-item.active {
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
}
.swatch {
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 999px;
  background: var(--sw);
  cursor: pointer;
}
.swatch.sticky {
  border-radius: 5px;
  background: var(--sw-sticky);
}
.swatch.active {
  border-color: var(--fb-accent);
  box-shadow: 0 0 0 2px var(--fb-panel) inset;
}
.s-default {
  --sw: var(--board-default-stroke);
  --sw-sticky: var(--board-default-sticky);
}
.s-gray {
  --sw: var(--board-gray-stroke);
  --sw-sticky: var(--board-gray-sticky);
}
.s-red {
  --sw: var(--board-red-stroke);
  --sw-sticky: var(--board-red-sticky);
}
.s-orange {
  --sw: var(--board-orange-stroke);
  --sw-sticky: var(--board-orange-sticky);
}
.s-yellow {
  --sw: var(--board-yellow-stroke);
  --sw-sticky: var(--board-yellow-sticky);
}
.s-green {
  --sw: var(--board-green-stroke);
  --sw-sticky: var(--board-green-sticky);
}
.s-blue {
  --sw: var(--board-blue-stroke);
  --sw-sticky: var(--board-blue-sticky);
}
.s-purple {
  --sw: var(--board-purple-stroke);
  --sw-sticky: var(--board-purple-sticky);
}
.s-pink {
  --sw: var(--board-pink-stroke);
  --sw-sticky: var(--board-pink-sticky);
}
</style>
