<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import { shapePath } from '@shared/boardGeometry';
import { MOCKUP_GROUPS, MOCKUP_LABELS, MOCKUP_SPECS, mockupSvg } from '@shared/boardMockup';
import { MOCKUP_KINDS, SHAPE_KINDS, type BoardColor, type MockupElement, type MockupKind, type ShapeKind } from '@shared/boards';
import { t } from '@/i18n';
import { iconColor, iconCssColor, iconFill, iconLibrary, libraryMarkup, loadIconLibrary } from './editor/icons';
import { MOCKUP_ICONS, SHAPE_LABELS, type BoardTool, type QuickPick } from './editor/tools';

/**
 * Palette de l'outil ouvert (formes, composants de maquette) : une colonne où chaque élément se voit tel qu'il sera
 * posé, avec une recherche en tête. La recherche filtre le bloc ouvert et propose, en petit, ce qui correspond
 * ailleurs (autres blocs, icônes).
 */
const props = defineProps<{ block: 'shape' | 'mockup' }>();
const emit = defineEmits<{ pick: [pick: QuickPick] }>();
const shape = defineModel<ShapeKind>('shape', { required: true });
const mockup = defineModel<MockupKind>('mockup', { required: true });

const query = ref('');
watch(
  () => props.block,
  () => (query.value = ''),
);

const fold = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
const words = computed(() => fold(query.value).split(/\s+/).filter(Boolean));
const matches = (...texts: string[]): boolean => {
  const haystack = fold(texts.join(' '));
  return words.value.every((word) => haystack.includes(word));
};

// --- Visuels -----------------------------------------------------------------------------------------------------------

/** Une forme, à la taille d'une vignette. */
function shapeVisual(kind: ShapeKind): { viewBox: string; d: string } {
  const [w, h] = kind === 'ellipse' || kind === 'diamond' || kind === 'triangle' || kind === 'hexagon' ? [78, 58] : [96, 54];
  return { viewBox: `-4 -4 ${w + 8} ${h + 8}`, d: shapePath(kind, w, h) };
}

const ACCENTED: MockupKind[] = ['button', 'badge', 'alert', 'checkbox', 'radio', 'toggle', 'slider', 'progress', 'tabs', 'link'];
/**
 * Taille (et parfois texte) d'un composant dans sa vignette : plus petite que celle où il sera posé, pour qu'il reste
 * lisible une fois réduit.
 */
const THUMBS: Record<MockupKind, { w: number; h: number; text?: string }> = {
  browser: { w: 200, h: 120 },
  mobile: { w: 64, h: 120, text: '' },
  modal: { w: 230, h: 136 },
  card: { w: 130, h: 136 },
  navbar: { w: 220, h: 44, text: 'Marque\nAccueil\nContact' },
  tabs: { w: 200, h: 36 },
  breadcrumb: { w: 190, h: 24 },
  pagination: { w: 174, h: 30, text: '4' },
  link: { w: 60, h: 24 },
  heading: { w: 76, h: 40, text: 'Titre' },
  paragraph: { w: 180, h: 66 },
  list: { w: 170, h: 84, text: 'Premier élément\nDeuxième élément\nTroisième élément' },
  badge: { w: 80, h: 24 },
  alert: { w: 200, h: 44, text: 'Information' },
  divider: { w: 170, h: 16 },
  button: { w: 120, h: 40 },
  input: { w: 180, h: 40 },
  search: { w: 180, h: 40 },
  select: { w: 180, h: 40 },
  checkbox: { w: 130, h: 24 },
  radio: { w: 76, h: 24 },
  toggle: { w: 104, h: 28 },
  slider: { w: 180, h: 24 },
  image: { w: 130, h: 88 },
  video: { w: 150, h: 88 },
  avatar: { w: 56, h: 56 },
  progress: { w: 180, h: 12 },
  rating: { w: 140, h: 26 },
};
/** Un composant de maquette tel qu'il sera posé, à la taille de sa vignette. */
function mockupVisual(kind: MockupKind): { viewBox: string; markup: string } {
  const spec = { ...MOCKUP_SPECS[kind], ...THUMBS[kind] };
  const color: BoardColor = ACCENTED.includes(kind) ? 'blue' : 'default';
  const element: MockupElement = {
    id: 'visual',
    type: 'mockup',
    z: 0,
    x: 0,
    y: 0,
    w: spec.w,
    h: spec.h,
    kind,
    text: /[a-zà-ÿ]/i.test(spec.text) ? t(spec.text) : spec.text,
    color,
    variant: 'primary',
    checked: spec.checked ?? false,
    value: spec.value ?? 50,
    size: 'm',
  };
  const markup = mockupSvg(element, {
    ink: 'var(--board-default-text)',
    muted: 'var(--board-gray-stroke)',
    line: 'var(--board-gray-stroke)',
    surface: 'var(--board-default-fill)',
    soft: 'var(--board-gray-fill)',
    accent: `var(--board-${color}-stroke)`,
    accentSoft: `var(--board-${color}-fill)`,
    onAccent: '#ffffff',
  });
  // Un petit composant (lien, bouton radio) n'est pas grossi pour remplir la vignette : il y est centré.
  const width = Math.max(spec.w + 12, 150);
  const height = Math.max(spec.h + 12, 88);
  return { viewBox: `${-(width - spec.w) / 2} ${-(height - spec.h) / 2} ${width} ${height}`, markup };
}
const mockupVisuals = computed(() => new Map(MOCKUP_KINDS.map((kind) => [kind, mockupVisual(kind)])));

// --- Contenu du bloc ouvert ------------------------------------------------------------------------------------------

const shapes = computed(() => SHAPE_KINDS.filter((kind) => matches(t(SHAPE_LABELS[kind]), 'forme shape', kind)));
const mockupGroups = computed(() =>
  MOCKUP_GROUPS.map((group) => ({ label: group.label, kinds: group.kinds.filter((kind) => matches(t(MOCKUP_LABELS[kind]), t(group.label), 'maquette mockup', kind)) })).filter((group) => group.kinds.length),
);
const blockEmpty = computed(() => (props.block === 'shape' ? !shapes.value.length : !mockupGroups.value.length));

/** Autres éléments du tableau, proposés avec les formes et dans les résultats d'ailleurs. */
const BLOCKS: Array<{ tool: BoardTool; label: string; words: string }> = [
  { tool: 'text', label: 'Texte', words: 'text titre' },
  { tool: 'sticky', label: 'Post-it', words: 'sticky note' },
  { tool: 'frame', label: 'Section', words: 'frame cadre zone' },
  { tool: 'table', label: 'Tableau', words: 'table grille donnees' },
  { tool: 'chart', label: 'Graphique', words: 'chart barres courbe' },
];
const blocks = computed(() => BLOCKS.filter((entry) => matches(t(entry.label), entry.words)));

// --- Ailleurs : ce que la recherche trouve hors du bloc ouvert ---------------------------------------------------------

watch(query, (value) => {
  if (value.trim().length >= 2) void loadIconLibrary();
});
const searching = computed(() => words.value.length > 0);
const otherShapes = computed(() => (searching.value && props.block !== 'shape' ? shapes.value : []));
const otherMockups = computed(() => (searching.value && props.block !== 'mockup' ? MOCKUP_KINDS.filter((kind) => matches(t(MOCKUP_LABELS[kind]), 'maquette mockup', kind)) : []));
const otherBlocks = computed(() => (searching.value && props.block !== 'shape' ? blocks.value : []));
const icons = computed(() => (query.value.trim().length >= 2 ? (iconLibrary.value?.searchLibraryIcons(query.value, 14) ?? []) : []));
const elsewhere = computed(() => otherShapes.value.length + otherMockups.value.length + otherBlocks.value.length + icons.value.length > 0);

const place = (pick: QuickPick): void => emit('pick', pick);
</script>

<template>
  <aside class="palette" :aria-label="block === 'shape' ? $t('Formes') : $t('Composants de maquette')">
    <IconField class="search">
      <InputIcon class="pi pi-search" />
      <InputText v-model="query" size="small" fluid :placeholder="block === 'shape' ? $t('Chercher une forme…') : $t('Chercher un composant…')" :aria-label="$t('Chercher dans la palette')" @keydown.esc.stop="query = ''" />
    </IconField>

    <div class="scroll">
      <template v-if="block === 'shape'">
        <section v-if="shapes.length" class="group">
          <h5>{{ $t('Formes') }}</h5>
          <div class="cards">
            <button v-for="kind in shapes" :key="kind" type="button" class="card" :class="{ active: shape === kind }" :aria-pressed="shape === kind" @click="shape = kind">
              <svg class="visual" :viewBox="shapeVisual(kind).viewBox" aria-hidden="true"><path :d="shapeVisual(kind).d" class="shape-visual" /></svg>
              <span class="name truncate">{{ $t(SHAPE_LABELS[kind]) }}</span>
            </button>
          </div>
        </section>
        <section v-if="blocks.length" class="group">
          <h5>{{ $t('Autres éléments') }}</h5>
          <div class="cards">
            <button v-for="entry in blocks" :key="entry.tool" type="button" class="card" @click="place({ kind: 'element', tool: entry.tool })">
              <svg class="visual" viewBox="0 0 96 54" aria-hidden="true">
                <text v-if="entry.tool === 'text'" x="48" y="36" text-anchor="middle" class="block-text">Aa</text>
                <rect v-else-if="entry.tool === 'sticky'" x="27" y="6" width="42" height="42" rx="3" class="block-sticky" />
                <g v-else-if="entry.tool === 'frame'">
                  <rect x="8" y="14" width="80" height="36" rx="6" class="block-frame" />
                  <rect x="10" y="4" width="30" height="5" rx="2.5" class="block-ink" />
                </g>
                <g v-else-if="entry.tool === 'table'">
                  <rect x="10" y="8" width="76" height="38" rx="3" class="block-line" />
                  <rect x="10" y="8" width="76" height="12" rx="3" class="block-head" />
                  <path d="M10,20 H86 M10,33 H86 M35,8 V46 M61,8 V46" class="block-line" />
                </g>
                <g v-else>
                  <path d="M12,46 H84" class="block-line" />
                  <rect x="20" y="26" width="11" height="20" rx="2" class="block-bar" />
                  <rect x="36" y="12" width="11" height="34" rx="2" class="block-bar" />
                  <rect x="52" y="32" width="11" height="14" rx="2" class="block-bar" />
                  <rect x="68" y="20" width="11" height="26" rx="2" class="block-bar" />
                </g>
              </svg>
              <span class="name truncate">{{ $t(entry.label) }}</span>
            </button>
          </div>
        </section>
      </template>

      <template v-else>
        <section v-for="group in mockupGroups" :key="group.label" class="group">
          <h5>{{ $t(group.label) }}</h5>
          <div class="cards">
            <button v-for="kind in group.kinds" :key="kind" type="button" class="card" :class="{ active: mockup === kind }" :aria-pressed="mockup === kind" @click="mockup = kind">
              <!-- eslint-disable-next-line vue/no-v-html -- dessin construit par mockupSvg, textes échappés. -->
              <svg class="visual" :viewBox="mockupVisuals.get(kind)!.viewBox" aria-hidden="true" v-html="mockupVisuals.get(kind)!.markup"></svg>
              <span class="name truncate">{{ $t(MOCKUP_LABELS[kind]) }}</span>
            </button>
          </div>
        </section>
      </template>

      <p v-if="blockEmpty && !(block === 'shape' && blocks.length)" class="muted small empty">{{ block === 'shape' ? $t('Aucune forme ne correspond.') : $t('Aucun composant ne correspond.') }}</p>

      <!-- Ailleurs : en petit, ce que la recherche trouve dans les autres blocs et les icônes -->
      <section v-if="elsewhere" class="group elsewhere">
        <h5>{{ $t('Ailleurs') }}</h5>
        <div class="rows">
          <button v-for="kind in otherShapes" :key="`s${kind}`" type="button" class="row" @click="place({ kind: 'element', tool: 'shape', shape: kind })">
            <svg class="mini" :viewBox="shapeVisual(kind).viewBox" aria-hidden="true"><path :d="shapeVisual(kind).d" class="shape-visual" /></svg>
            <span class="truncate">{{ $t(SHAPE_LABELS[kind]) }}</span>
            <span class="muted hint">{{ $t('Forme') }}</span>
          </button>
          <button v-for="kind in otherMockups" :key="`m${kind}`" type="button" class="row" @click="place({ kind: 'element', tool: 'mockup', mockup: kind })">
            <i :class="MOCKUP_ICONS[kind]" class="mini-icon"></i>
            <span class="truncate">{{ $t(MOCKUP_LABELS[kind]) }}</span>
            <span class="muted hint">{{ $t('Maquette') }}</span>
          </button>
          <button v-for="entry in otherBlocks" :key="`b${entry.tool}`" type="button" class="row" @click="place({ kind: 'element', tool: entry.tool })">
            <i class="pi pi-plus mini-icon"></i>
            <span class="truncate">{{ $t(entry.label) }}</span>
            <span class="muted hint">{{ $t('Élément') }}</span>
          </button>
        </div>
        <div v-if="icons.length" class="icons" :style="{ color: iconCssColor(iconColor) }">
          <button v-for="icon in icons" :key="icon.id" v-tooltip.top="icon.name" type="button" class="icon" :aria-label="icon.name" @click="place({ kind: 'icon', icon: icon.id, color: iconColor, fill: iconFill })">
            <!-- eslint-disable-next-line vue/no-v-html -- icône de la bibliothèque intégrée (attributs échappés). -->
            <svg viewBox="0 0 24 24" :fill="iconFill ? 'currentColor' : 'none'" :fill-opacity="iconFill === 'tint' ? 0.22 : undefined" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" v-html="libraryMarkup(icon.id)"></svg>
          </button>
        </div>
      </section>
    </div>
    <footer class="foot muted">{{ block === 'shape' ? $t('Choisissez une forme, puis cliquez sur le tableau.') : $t('Choisissez un composant, puis cliquez sur le tableau.') }}</footer>
  </aside>
</template>

<style scoped>
.palette {
  position: absolute;
  top: 50%;
  left: calc(100% + 0.6rem);
  z-index: 5;
  display: flex;
  flex-direction: column;
  width: 18.5rem;
  max-height: min(42rem, calc(100vh - 9rem));
  overflow: hidden;
  border: 1px solid var(--fb-border);
  border-radius: 12px;
  background: var(--fb-panel);
  box-shadow: 0 10px 28px rgb(0 0 0 / 0.16);
  transform: translateY(-50%);
}
.search {
  flex: none;
  margin: 0.55rem 0.55rem 0.35rem;
}
.scroll {
  flex: 1;
  min-height: 0;
  padding: 0 0.45rem 0.45rem;
  overflow-y: auto;
}
.group h5 {
  margin: 0.5rem 0.2rem 0.3rem;
  color: var(--fb-muted);
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.35rem;
}
.card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.2rem;
  min-width: 0;
  padding: 0.35rem 0.35rem 0.3rem;
  border: 1px solid var(--fb-border);
  border-radius: 9px;
  background: var(--board-canvas);
  color: var(--fb-text);
  font: inherit;
  cursor: pointer;
}
.card:hover {
  border-color: var(--fb-accent);
}
.card.active {
  border-color: var(--fb-accent);
  box-shadow: 0 0 0 2px var(--fb-accent-soft);
}
.visual {
  width: 100%;
  height: 4.1rem;
  font-family: var(--fb-font, system-ui, sans-serif);
  pointer-events: none;
}
.name {
  font-size: 0.72rem;
  text-align: center;
}
.card.active .name {
  color: var(--fb-accent);
  font-weight: 600;
}
.shape-visual {
  fill: var(--board-blue-fill);
  stroke: var(--board-blue-stroke);
  stroke-width: 2;
}
.block-text {
  fill: var(--board-default-text);
  font-size: 26px;
  font-weight: 700;
}
.block-sticky {
  fill: var(--board-yellow-sticky);
}
.block-frame {
  fill: var(--board-gray-fill);
  stroke: var(--board-gray-stroke);
  stroke-dasharray: 4 3;
}
.block-ink {
  fill: var(--board-default-text);
}
.block-line {
  fill: none;
  stroke: var(--board-gray-stroke);
}
.block-head {
  fill: var(--board-blue-fill);
  stroke: var(--board-gray-stroke);
}
.block-bar {
  fill: #6366f1;
  fill-opacity: 0.7;
}
.empty {
  margin: 0.8rem 0.3rem 0.3rem;
  text-align: center;
}
.elsewhere {
  margin-top: 0.5rem;
  border-top: 1px solid var(--fb-border);
}
.rows {
  display: flex;
  flex-direction: column;
}
.row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.22rem 0.3rem;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--fb-text);
  font: inherit;
  font-size: 0.78rem;
  text-align: left;
  cursor: pointer;
}
.row:hover,
.icon:hover {
  background: var(--fb-panel-alt);
}
.row .truncate {
  flex: 1;
  min-width: 0;
}
.mini {
  width: 1.5rem;
  height: 1rem;
  flex: none;
}
.mini-icon {
  width: 1.5rem;
  flex: none;
  color: var(--fb-muted);
  font-size: 0.8rem;
  text-align: center;
}
.hint {
  font-size: 0.68rem;
}
.icons {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.1rem;
  margin-top: 0.25rem;
}
.icon {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  padding: 0.3rem;
  border: 0;
  border-radius: 6px;
  background: none;
  color: inherit;
  cursor: pointer;
}
.icon svg {
  width: 100%;
  height: 100%;
}
.foot {
  flex: none;
  padding: 0.35rem 0.6rem;
  border-top: 1px solid var(--fb-border);
  font-size: 0.7rem;
}
</style>
