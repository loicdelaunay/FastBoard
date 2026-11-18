<script setup lang="ts">
import { computed, ref } from 'vue';
import { BOARD_COLORS, CHART_KINDS, CONNECTOR_ROUTES, FILL_STYLES, ICON_STROKES, SHAPE_KINDS, TEXT_SIZES, type BoardColor, type BoardElement, type ChartKind } from '@shared/boards';
import type { InstanceState } from './editor/templates';
import { COLOR_LABELS, SHAPE_LABELS, shapeIcon, type SelectionAction } from './editor/tools';

/** Barre de mise en forme au-dessus de la sélection : forme, couleur, remplissage, texte, liens, tableaux, ordre. */
const props = defineProps<{
  elements: BoardElement[];
  editable: boolean;
  /** La sélection est une copie de modèle : son nom et son état. */
  template?: { name: string; state: InstanceState } | null;
  /** Les modèles sont proposés (tableau d'un espace). */
  canTemplate?: boolean;
  /** La sélection peut former un groupe, ou contient des groupes à défaire. */
  canGroup?: boolean;
  canUngroup?: boolean;
}>();
const emit = defineEmits<{ patch: [patch: Record<string, unknown>]; action: [action: SelectionAction] }>();

const open = ref<'shape' | 'color' | 'chart' | null>(null);
const types = computed(() => new Set(props.elements.map((element) => element.type)));
const has = (...kinds: BoardElement['type'][]) => kinds.some((kind) => types.value.has(kind));
const first = computed(() => props.elements[0]);
const firstOf = <T extends BoardElement['type']>(type: T) => props.elements.find((element) => element.type === type) as Extract<BoardElement, { type: T }> | undefined;
const color = computed<BoardColor>(() => {
  const withColor = props.elements.find((element) => 'color' in element) as { color: BoardColor } | undefined;
  return withColor?.color ?? 'default';
});
const locked = computed(() => props.elements.some((element) => element.locked));
const single = computed(() => (props.elements.length === 1 ? first.value : undefined));
const exportable = computed(() => has('shape', 'sticky', 'mind', 'text', 'fast'));

const ROUTE_ICONS = { straight: 'pi pi-minus', elbow: 'pi pi-arrow-down-right', curve: 'pi pi-replay' } as const;
const ROUTE_LABELS = { straight: 'Droit', elbow: 'Coudé', curve: 'Courbe' } as const;
const FILL_LABELS = { solid: 'Plein', outline: 'Contour', none: 'Sans fond' } as const;
const CHART_LABELS: Record<ChartKind, string> = { bar: 'Barres', line: 'Courbes', pie: 'Camembert', doughnut: 'Anneau', radar: 'Radar' };
const TEMPLATE_STATES: Record<InstanceState, { label: string; hint: string }> = {
  current: { label: 'À jour', hint: 'Cette copie est identique au modèle.' },
  outdated: { label: 'Nouvelle version', hint: 'Le modèle a changé depuis cette copie.' },
  modified: { label: 'Modifiée', hint: 'Cette copie a été changée ; le modèle, lui, n’a pas bougé.' },
  missing: { label: 'Modèle supprimé', hint: 'Le modèle n’existe plus : détachez la copie pour la garder telle quelle.' },
  checking: { label: '…', hint: 'Comparaison avec le modèle…' },
};
/** Icônes intégrées (au trait) : l'épaisseur se règle. */
const strokable = computed(() => props.elements.some((element) => element.type === 'icon' && element.icon.startsWith('lucide:')));

function patch(value: Record<string, unknown>): void {
  emit('patch', value);
  open.value = null;
}

function toggle(menu: 'shape' | 'color' | 'chart'): void {
  open.value = open.value === menu ? null : menu;
}
</script>

<template>
  <div class="bar" role="toolbar" :aria-label="$t('Mise en forme')" @pointerdown.stop @dblclick.stop @wheel.stop>
    <template v-if="editable && !locked">
      <div v-if="has('shape')" class="group">
        <button v-tooltip.top="$t('Forme')" type="button" class="item" :aria-label="$t('Forme')" @click="toggle('shape')">
          <!-- eslint-disable-next-line vue/no-v-html -- icône SVG construite ici. -->
          <span class="shape-icon" v-html="shapeIcon(firstOf('shape')?.shape ?? 'rect')"></span>
          <i class="pi pi-angle-down caret"></i>
        </button>
        <div v-if="open === 'shape'" class="menu grid">
          <button v-for="kind in SHAPE_KINDS" :key="kind" v-tooltip.top="$t(SHAPE_LABELS[kind])" type="button" class="item" :aria-label="$t(SHAPE_LABELS[kind])" @click="patch({ shape: kind })">
            <!-- eslint-disable-next-line vue/no-v-html -- icône SVG construite ici. -->
            <span class="shape-icon" v-html="shapeIcon(kind)"></span>
          </button>
        </div>
      </div>

      <div v-if="has('shape', 'sticky', 'text', 'frame', 'mind', 'connector', 'path', 'table', 'icon')" class="group">
        <button v-tooltip.top="$t('Couleur')" type="button" class="item" :aria-label="$t('Couleur')" @click="toggle('color')">
          <span class="swatch" :class="`s-${color}`"></span>
          <i class="pi pi-angle-down caret"></i>
        </button>
        <div v-if="open === 'color'" class="menu row">
          <button v-for="value in BOARD_COLORS" :key="value" v-tooltip.top="$t(COLOR_LABELS[value])" type="button" class="swatch" :class="[`s-${value}`, { active: value === color }]" :aria-label="$t(COLOR_LABELS[value])" @click="patch({ color: value })"></button>
        </div>
      </div>

      <div v-if="strokable" class="group segmented">
        <button v-for="width in ICON_STROKES" :key="width" v-tooltip.top="$t('Épaisseur du trait')" type="button" class="item" :class="{ active: firstOf('icon')?.stroke === width }" :aria-label="$t('Épaisseur du trait')" @click="patch({ stroke: width })">
          <span class="stroke-icon" :style="{ height: `${Math.max(1, width)}px` }"></span>
        </button>
      </div>

      <div v-if="has('shape')" class="group segmented">
        <button v-for="fill in FILL_STYLES" :key="fill" v-tooltip.top="$t(FILL_LABELS[fill])" type="button" class="item" :class="{ active: firstOf('shape')?.fill === fill }" :aria-label="$t(FILL_LABELS[fill])" @click="patch({ fill })">
          <span class="fill-icon" :class="`f-${fill}`"></span>
        </button>
      </div>

      <div v-if="has('shape', 'text')" class="group segmented">
        <button
          v-for="size in TEXT_SIZES"
          :key="size"
          v-tooltip.top="$t('Taille du texte')"
          type="button"
          class="item text-size"
          :class="{ active: (firstOf('shape') ?? firstOf('text'))?.size === size }"
          :aria-label="$t('Taille du texte')"
          @click="patch({ size })"
        >
          {{ size.toUpperCase() }}
        </button>
      </div>

      <div v-if="has('text')" class="group segmented">
        <button v-for="align in ['left', 'center', 'right'] as const" :key="align" type="button" class="item" :class="{ active: firstOf('text')?.align === align }" :aria-label="$t('Alignement')" @click="patch({ align })">
          <i :class="`pi pi-align-${align}`"></i>
        </button>
      </div>

      <template v-if="has('connector')">
        <div class="group segmented">
          <button v-for="route in CONNECTOR_ROUTES" :key="route" v-tooltip.top="$t(ROUTE_LABELS[route])" type="button" class="item" :class="{ active: firstOf('connector')?.route === route }" :aria-label="$t(ROUTE_LABELS[route])" @click="patch({ route })">
            <i :class="ROUTE_ICONS[route]"></i>
          </button>
        </div>
        <div class="group segmented">
          <button v-tooltip.top="$t('Pointe au départ')" type="button" class="item" :class="{ active: firstOf('connector')?.arrowStart }" :aria-label="$t('Pointe au départ')" @click="patch({ arrowStart: !firstOf('connector')?.arrowStart })">
            <i class="pi pi-arrow-left"></i>
          </button>
          <button v-tooltip.top="$t('Pointillés')" type="button" class="item" :class="{ active: firstOf('connector')?.dashed }" :aria-label="$t('Pointillés')" @click="patch({ dashed: !firstOf('connector')?.dashed })">
            <i class="pi pi-ellipsis-h"></i>
          </button>
          <button v-tooltip.top="$t('Pointe à l’arrivée')" type="button" class="item" :class="{ active: firstOf('connector')?.arrowEnd }" :aria-label="$t('Pointe à l’arrivée')" @click="patch({ arrowEnd: !firstOf('connector')?.arrowEnd })">
            <i class="pi pi-arrow-right"></i>
          </button>
        </div>
      </template>

      <div v-if="single?.type === 'table'" class="group">
        <button v-tooltip.top="$t('Modifier les cellules')" type="button" class="item" :aria-label="$t('Modifier les cellules')" @click="emit('action', 'edit-table')"><i class="pi pi-pencil"></i></button>
        <button v-tooltip.top="$t('Ajouter une ligne')" type="button" class="item" :aria-label="$t('Ajouter une ligne')" @click="emit('action', 'add-row')"><i class="pi pi-bars"></i></button>
        <button v-tooltip.top="$t('Ajouter une colonne')" type="button" class="item" :aria-label="$t('Ajouter une colonne')" @click="emit('action', 'add-column')"><i class="pi pi-pause"></i></button>
        <button v-tooltip.top="$t('Créer un graphique')" type="button" class="item" :aria-label="$t('Créer un graphique')" @click="emit('action', 'chart-from-table')"><i class="pi pi-chart-bar"></i></button>
      </div>

      <div v-if="single?.type === 'chart'" class="group">
        <button v-tooltip.top="$t('Type de graphique')" type="button" class="item wide" :aria-label="$t('Type de graphique')" @click="toggle('chart')">
          {{ $t(CHART_LABELS[single.chart]) }} <i class="pi pi-angle-down caret"></i>
        </button>
        <div v-if="open === 'chart'" class="menu column">
          <button v-for="kind in CHART_KINDS" :key="kind" type="button" class="item wide" :class="{ active: single.chart === kind }" @click="patch({ chart: kind })">{{ $t(CHART_LABELS[kind]) }}</button>
        </div>
        <button v-tooltip.top="$t('Données du graphique')" type="button" class="item" :aria-label="$t('Données du graphique')" @click="emit('action', 'chart-data')"><i class="pi pi-table"></i></button>
      </div>

      <div class="group">
        <button v-tooltip.top="$t('Premier plan')" type="button" class="item" :aria-label="$t('Premier plan')" @click="emit('action', 'front')"><i class="pi pi-angle-double-up"></i></button>
        <button v-tooltip.top="$t('Arrière-plan')" type="button" class="item" :aria-label="$t('Arrière-plan')" @click="emit('action', 'back')"><i class="pi pi-angle-double-down"></i></button>
        <button v-tooltip.top="$t('Dupliquer (Ctrl D)')" type="button" class="item" :aria-label="$t('Dupliquer')" @click="emit('action', 'duplicate')"><i class="pi pi-clone"></i></button>
      </div>
    </template>

    <div v-if="template" class="group template" :class="template.state">
      <span v-tooltip.top="$t(TEMPLATE_STATES[template.state].hint)" class="template-name"><i class="pi pi-clone"></i> <span class="truncate">{{ template.name }}</span> · {{ $t(TEMPLATE_STATES[template.state].label) }}</span>
      <template v-if="editable">
        <button v-if="template.state === 'outdated' || template.state === 'modified'" v-tooltip.top="$t('Revenir au modèle à jour')" type="button" class="item" :aria-label="$t('Revenir au modèle à jour')" @click="emit('action', 'template-update')"><i class="pi pi-replay"></i></button>
        <button v-if="template.state === 'modified'" v-tooltip.top="$t('Enregistrer ces changements dans le modèle')" type="button" class="item" :aria-label="$t('Enregistrer ces changements dans le modèle')" @click="emit('action', 'template-apply')"><i class="pi pi-upload"></i></button>
        <button v-tooltip.top="$t('Détacher du modèle')" type="button" class="item" :aria-label="$t('Détacher du modèle')" @click="emit('action', 'template-detach')"><i class="pi pi-link"></i></button>
      </template>
      <button v-if="template.state !== 'missing'" v-tooltip.top="$t('Ouvrir le modèle')" type="button" class="item" :aria-label="$t('Ouvrir le modèle')" @click="emit('action', 'template-open')"><i class="pi pi-external-link"></i></button>
    </div>
    <div v-else-if="editable && canTemplate && !locked" class="group">
      <button v-tooltip.top="$t('Créer un modèle…')" type="button" class="item" :aria-label="$t('Créer un modèle…')" @click="emit('action', 'make-template')"><i class="pi pi-clone"></i><i class="pi pi-plus mini"></i></button>
    </div>

    <div class="group">
      <button v-if="exportable" v-tooltip.top="$t('Exporter en Mermaid')" type="button" class="item" :aria-label="$t('Exporter en Mermaid')" @click="emit('action', 'mermaid')"><i class="pi pi-share-alt"></i></button>
      <template v-if="editable">
        <button v-if="canGroup" v-tooltip.top="$t('Grouper (Ctrl G)')" type="button" class="item" :aria-label="$t('Grouper')" @click="emit('action', 'group')"><i class="pi pi-box"></i></button>
        <button v-if="canUngroup" v-tooltip.top="$t('Dégrouper (Ctrl Maj G)')" type="button" class="item" :aria-label="$t('Dégrouper')" @click="emit('action', 'ungroup')"><i class="pi pi-objects-column"></i></button>
        <button v-tooltip.top="locked ? $t('Déverrouiller') : $t('Verrouiller')" type="button" class="item" :aria-label="locked ? $t('Déverrouiller') : $t('Verrouiller')" @click="emit('action', locked ? 'unlock' : 'lock')">
          <i :class="locked ? 'pi pi-lock' : 'pi pi-lock-open'"></i>
        </button>
        <button v-if="!locked" v-tooltip.top="$t('Supprimer')" type="button" class="item danger" :aria-label="$t('Supprimer')" @click="emit('action', 'delete')"><i class="pi pi-trash"></i></button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.stroke-icon {
  display: block;
  width: 1rem;
  border-radius: 2px;
  background: currentColor;
}
.template {
  align-items: center;
}
.template-name {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  max-width: 14rem;
  padding: 0 0.5rem;
  border-radius: 999px;
  background: color-mix(in srgb, #a855f7 16%, transparent);
  color: #a855f7;
  font-size: 0.78rem;
  font-weight: 600;
  white-space: nowrap;
}
.template.outdated .template-name {
  background: color-mix(in srgb, #f59e0b 18%, transparent);
  color: #d97706;
}
.template.modified .template-name {
  background: color-mix(in srgb, #6366f1 16%, transparent);
  color: #6366f1;
}
.template.missing .template-name {
  background: var(--fb-panel-alt);
  color: var(--fb-muted);
}
.mini {
  margin-left: -0.2rem;
  font-size: 0.55rem;
}
.bar {
  position: absolute;
  z-index: 6;
  display: flex;
  flex-wrap: wrap;
  max-width: calc(100% - 96px);
  align-items: center;
  gap: 0.15rem;
  padding: 0.25rem;
  border: 1px solid var(--fb-border);
  border-radius: 10px;
  background: var(--fb-panel);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.16);
  transform: translateX(-50%);
  white-space: nowrap;
}
.group {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.1rem;
  padding: 0 0.2rem;
}
.group + .group {
  border-left: 1px solid var(--fb-border);
}
.segmented {
  padding: 0.1rem;
  margin: 0 0.15rem;
  border-radius: 8px;
  background: var(--fb-panel-alt);
}
.group.segmented + .group,
.group + .group.segmented {
  border-left: 0;
}
.item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.15rem;
  min-width: 1.9rem;
  height: 1.9rem;
  padding: 0 0.3rem;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--fb-text);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
.item:hover {
  background: color-mix(in srgb, var(--fb-text) 8%, transparent);
}
.item.active {
  background: var(--fb-panel);
  color: var(--fb-accent);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.12);
}
.item.wide {
  padding: 0 0.55rem;
}
.item.danger:hover {
  color: var(--fb-danger);
}
.text-size {
  font-size: 0.7rem;
  font-weight: 700;
}
.caret {
  font-size: 0.6rem;
  opacity: 0.7;
}
.shape-icon {
  display: grid;
  place-items: center;
}
.menu {
  position: absolute;
  top: calc(100% + 0.4rem);
  left: 0;
  z-index: 2;
  display: flex;
  gap: 0.2rem;
  padding: 0.3rem;
  border: 1px solid var(--fb-border);
  border-radius: 10px;
  background: var(--fb-panel);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.16);
}
.menu.grid {
  display: grid;
  grid-template-columns: repeat(4, 2rem);
}
.menu.column {
  flex-direction: column;
  align-items: stretch;
}
.swatch {
  display: inline-block;
  width: 1.15rem;
  height: 1.15rem;
  padding: 0;
  border: 2px solid var(--fb-panel);
  border-radius: 999px;
  background: var(--sw-fill);
  box-shadow: 0 0 0 1px var(--sw-stroke);
  cursor: pointer;
}
.menu .swatch {
  width: 1.5rem;
  height: 1.5rem;
}
.swatch.active {
  box-shadow: 0 0 0 2px var(--fb-accent);
}
.fill-icon {
  width: 1rem;
  height: 0.8rem;
  border: 1.5px solid currentColor;
  border-radius: 3px;
}
.fill-icon.f-solid {
  background: currentColor;
}
.fill-icon.f-none {
  border-style: dashed;
  opacity: 0.6;
}
.s-default {
  --sw-fill: var(--board-default-fill);
  --sw-stroke: var(--board-default-stroke);
}
.s-gray {
  --sw-fill: var(--board-gray-fill);
  --sw-stroke: var(--board-gray-stroke);
}
.s-red {
  --sw-fill: var(--board-red-fill);
  --sw-stroke: var(--board-red-stroke);
}
.s-orange {
  --sw-fill: var(--board-orange-fill);
  --sw-stroke: var(--board-orange-stroke);
}
.s-yellow {
  --sw-fill: var(--board-yellow-fill);
  --sw-stroke: var(--board-yellow-stroke);
}
.s-green {
  --sw-fill: var(--board-green-fill);
  --sw-stroke: var(--board-green-stroke);
}
.s-blue {
  --sw-fill: var(--board-blue-fill);
  --sw-stroke: var(--board-blue-stroke);
}
.s-purple {
  --sw-fill: var(--board-purple-fill);
  --sw-stroke: var(--board-purple-stroke);
}
.s-pink {
  --sw-fill: var(--board-pink-fill);
  --sw-stroke: var(--board-pink-stroke);
}
</style>
