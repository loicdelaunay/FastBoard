<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import Dialog from 'primevue/dialog';
import Select from 'primevue/select';
import SelectButton from 'primevue/selectbutton';
import { DEFAULT_THEME_ID, THEMES, findTheme } from '@shared/themes';
import { t } from '@/i18n';
import { currentThemeId, customThemes } from '@/theme/themeManager';
import type { ExportFormat } from './editor/exportImage';

/**
 * Export du tableau, comme dans Whimsical : PNG, WebP, SVG ou PDF, de tout le tableau ou de la sélection, à l'échelle
 * choisie et avec ou sans fond ; ou en Mermaid (le texte du diagramme). À droite, l'aperçu de ce qui sera enregistré.
 *
 * L'image est dessinée dans le thème par défaut de l'application, pour être la même quel que soit le thème de chacun ; on
 * peut choisir un autre thème (prédéfini ou à soi), ou celui affiché à l'écran.
 */
const props = defineProps<{ selectionCount: number; busy: boolean; preview: { url: string; width: number; height: number } | null }>();
const emit = defineEmits<{
  /** `theme` : identifiant du thème du rendu, ou `null` pour celui de la page. */
  preview: [options: { transparent: boolean; selection: boolean; theme: string | null }];
  export: [options: { format: ExportFormat; scale: number; transparent: boolean; selection: boolean; theme: string | null }];
  copy: [options: { scale: number; transparent: boolean; selection: boolean; theme: string | null }];
  mermaid: [];
}>();
const visible = defineModel<boolean>('visible', { required: true });

const FORMAT_KEY = 'fb.boards.export';
const format = ref<ExportFormat>('png');
const scale = ref(2);
const transparent = ref(false);
const area = ref<'all' | 'selection'>('all');
/** Thème du rendu : `default` (celui de l'application), `current` (celui affiché), ou l'identifiant d'un thème. */
const theme = ref('default');

try {
  const saved = JSON.parse(localStorage.getItem(FORMAT_KEY) ?? 'null') as { format?: ExportFormat; scale?: number; transparent?: boolean; theme?: string } | null;
  if (typeof saved?.theme === 'string' && saved.theme) theme.value = saved.theme;
  if (saved?.format && ['png', 'webp', 'svg', 'pdf'].includes(saved.format)) format.value = saved.format;
  if (saved?.scale && [1, 2, 3, 4].includes(saved.scale)) scale.value = saved.scale;
  if (typeof saved?.transparent === 'boolean') transparent.value = saved.transparent;
} catch {
  // Réglages illisibles : ceux par défaut.
}

interface ThemeChoice {
  value: string;
  label: string;
  accent: string;
  background: string;
}
/** Thèmes proposés : celui par défaut et celui de l'écran d'abord, puis les prédéfinis et ceux du compte. */
const themeGroups = computed<Array<{ label: string; items: ThemeChoice[] }>>(() => {
  const base = findTheme(DEFAULT_THEME_ID)!;
  const builtin = (entry: (typeof THEMES)[number]): ThemeChoice => ({ value: entry.id, label: t(entry.label), accent: entry.preview.accent, background: entry.preview.background });
  const shown = findTheme(currentThemeId.value);
  const custom = customThemes.value.map((entry): ThemeChoice => ({ value: entry.id, label: entry.label, accent: entry.primary, background: entry.colors.background ?? (entry.mode === 'dark' ? '#0f172a' : '#ffffff') }));
  const onScreen = shown ? builtin(shown) : custom.find((entry) => entry.value === currentThemeId.value);
  return [
    {
      label: t('Recommandés'),
      items: [
        { ...builtin(base), value: 'default', label: t('Thème par défaut ({name})', { name: t(base.label) }) },
        { value: 'current', label: t('Thème affiché à l’écran'), accent: onScreen?.accent ?? base.preview.accent, background: onScreen?.background ?? base.preview.background },
      ],
    },
    { label: t('Clairs'), items: THEMES.filter((entry) => entry.mode === 'light' && entry.id !== DEFAULT_THEME_ID).map(builtin) },
    { label: t('Sombres'), items: THEMES.filter((entry) => entry.mode === 'dark').map(builtin) },
    ...(custom.length ? [{ label: t('Mes thèmes'), items: custom }] : []),
  ];
});
/** Un thème retenu qui n'existe plus (thème du compte supprimé) revient à celui par défaut. */
const themeChoice = computed(() => (themeGroups.value.some((group) => group.items.some((item) => item.value === theme.value)) ? theme.value : 'default'));
const themeItem = computed(() => themeGroups.value.flatMap((group) => group.items).find((item) => item.value === themeChoice.value));
/** Thème à poser sur le tableau pour le rendu ; `null` : celui de la page, tel qu'il est à l'écran. */
const renderTheme = computed(() => (themeChoice.value === 'current' ? null : themeChoice.value === 'default' ? DEFAULT_THEME_ID : themeChoice.value));

watch(visible, (open) => {
  if (open) area.value = props.selectionCount ? 'selection' : 'all';
});
// L'aperçu suit ce qui change l'image : le contenu, le thème et le fond (un PDF a toujours le sien).
watch(
  () => [visible.value, area.value, transparent.value && format.value !== 'pdf', renderTheme.value] as const,
  ([open, chosen, clear, themed]) => {
    if (open) emit('preview', { transparent: clear, selection: chosen === 'selection', theme: themed });
  },
  { flush: 'post' },
);

const formats = computed(() => [
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WebP' },
  { value: 'svg', label: 'SVG' },
  { value: 'pdf', label: 'PDF' },
]);
const areas = computed(() => [
  { value: 'all', label: t('Tout le tableau') },
  { value: 'selection', label: t('La sélection ({n})', { n: props.selectionCount }), disabled: !props.selectionCount },
]);
const scales = [1, 2, 3, 4].map((value) => ({ value, label: `${value}×` }));
/** Le PDF garde toujours un fond ; l'échelle ne compte que pour les images. */
const raster = computed(() => format.value !== 'svg');
const canBeTransparent = computed(() => format.value !== 'pdf');
const hint = computed(() =>
  format.value === 'svg'
    ? t('Image vectorielle fidèle à l’écran, à ouvrir dans un navigateur ou à intégrer dans une page web.')
    : format.value === 'pdf'
      ? t('Une page à la taille du dessin, en haute définition.')
      : format.value === 'webp'
        ? t('Image plus légère que le PNG, lue par tous les navigateurs récents.')
        : t('L’image la plus répandue, pour un document, un message ou une présentation.'),
);

/** Taille du fichier : en pixels pour une image, en points pour un PDF ; un SVG s'agrandit sans perte. */
const sizeText = computed(() => {
  const preview = props.preview;
  if (!preview) return '';
  if (format.value === 'svg') return t('{w} × {h} px, agrandissable sans perte', { w: preview.width, h: preview.height });
  if (format.value === 'pdf') return t('Une page de {w} × {h} mm', { w: Math.round(preview.width * 0.2646), h: Math.round(preview.height * 0.2646) });
  return t('{w} × {h} px', { w: preview.width * scale.value, h: preview.height * scale.value });
});

function remember(): void {
  try {
    localStorage.setItem(FORMAT_KEY, JSON.stringify({ format: format.value, scale: scale.value, transparent: transparent.value, theme: themeChoice.value }));
  } catch {
    // Stockage indisponible : les réglages valent pour cette page.
  }
}

function run(): void {
  remember();
  emit('export', { format: format.value, scale: scale.value, transparent: transparent.value && canBeTransparent.value, selection: area.value === 'selection', theme: renderTheme.value });
}

function copy(): void {
  remember();
  emit('copy', { scale: scale.value, transparent: transparent.value, selection: area.value === 'selection', theme: renderTheme.value });
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="$t('Exporter le tableau')" :style="{ width: 'min(60rem, calc(100vw - 2rem))' }">
    <div class="layout">
    <div class="form">
      <div class="row">
        <span class="label">{{ $t('Format') }}</span>
        <SelectButton v-model="format" :options="formats" option-label="label" option-value="value" :allow-empty="false" />
      </div>
      <p class="muted small hint">{{ hint }}</p>
      <div class="row">
        <span class="label">{{ $t('Contenu') }}</span>
        <SelectButton v-model="area" :options="areas" option-label="label" option-value="value" option-disabled="disabled" :allow-empty="false" />
      </div>
      <div class="row">
        <span class="label">{{ $t('Thème') }}</span>
        <Select
          :model-value="themeChoice"
          :options="themeGroups"
          option-label="label"
          option-value="value"
          option-group-label="label"
          option-group-children="items"
          class="theme-select"
          scroll-height="18rem"
          :aria-label="$t('Thème du rendu')"
          @update:model-value="theme = $event"
        >
          <template #value>
            <span v-if="themeItem" class="theme-option"><span class="theme-swatch" :style="{ '--sw-bg': themeItem.background, '--sw-accent': themeItem.accent }"></span>{{ themeItem.label }}</span>
          </template>
          <template #option="{ option }">
            <span class="theme-option"><span class="theme-swatch" :style="{ '--sw-bg': option.background, '--sw-accent': option.accent }"></span>{{ option.label }}</span>
          </template>
        </Select>
      </div>
      <p class="muted small hint">{{ $t('L’image est dessinée dans ce thème, quel que soit celui de votre écran.') }}</p>
      <div v-if="raster" class="row">
        <span class="label">{{ $t('Échelle') }}</span>
        <SelectButton v-model="scale" :options="scales" option-label="label" option-value="value" :allow-empty="false" />
      </div>
      <label v-if="canBeTransparent" class="check">
        <Checkbox v-model="transparent" binary />
        <span>{{ $t('Fond transparent') }}</span>
      </label>
    </div>
    <figure class="preview" :aria-label="$t('Aperçu')">
      <div class="preview-frame" :class="{ checker: transparent && canBeTransparent }">
        <img v-if="preview" :src="preview.url" :alt="$t('Aperçu de l’export')" />
        <span v-else class="muted small"><i class="pi pi-spin pi-spinner"></i> {{ $t('Aperçu…') }}</span>
      </div>
      <figcaption class="muted small">{{ sizeText }}</figcaption>
    </figure>
    </div>
    <template #footer>
      <Button :label="$t('Mermaid…')" icon="pi pi-share-alt" text severity="secondary" class="mermaid" @click="emit('mermaid')" />
      <Button :label="$t('Copier l’image')" icon="pi pi-copy" severity="secondary" outlined :disabled="busy" @click="copy" />
      <Button :label="$t('Télécharger')" icon="pi pi-download" :loading="busy" @click="run" />
    </template>
  </Dialog>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: minmax(0, 23rem) minmax(0, 1fr);
  gap: 1.25rem;
  align-items: start;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.preview {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-width: 0;
  margin: 0;
}
.preview-frame {
  display: grid;
  place-items: center;
  height: 20rem;
  padding: 0.5rem;
  overflow: hidden;
  border: 1px solid var(--fb-border);
  border-radius: 10px;
  background: var(--fb-panel-alt);
}
/* Damier : ce qui restera transparent. */
.preview-frame.checker {
  background-color: #fff;
  background-image: linear-gradient(45deg, #d9dee6 25%, transparent 25%, transparent 75%, #d9dee6 75%), linear-gradient(45deg, #d9dee6 25%, transparent 25%, transparent 75%, #d9dee6 75%);
  background-position:
    0 0,
    8px 8px;
  background-size: 16px 16px;
}
.preview-frame img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  box-shadow: 0 1px 6px rgb(0 0 0 / 0.18);
}
.preview figcaption {
  text-align: center;
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
}
.label {
  min-width: 5rem;
  font-weight: 600;
}
.hint {
  margin: -0.4rem 0 0 5.6rem;
}
.theme-select {
  flex: 1;
  min-width: 0;
}
.theme-option {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}
/* Pastille du thème : son fond, et sa couleur principale au centre. */
.theme-swatch {
  flex: none;
  width: 1.1rem;
  height: 1.1rem;
  border: 1px solid var(--fb-border);
  border-radius: 50%;
  background: radial-gradient(circle, var(--sw-accent) 0 45%, var(--sw-bg) 47%);
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}
.mermaid {
  margin-right: auto;
}
@media (max-width: 46rem) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .preview-frame {
    height: 13rem;
  }
  .hint {
    margin-left: 0;
  }
}
</style>
