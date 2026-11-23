<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import Button from 'primevue/button';
import ColorPicker from 'primevue/colorpicker';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import SelectButton from 'primevue/selectbutton';
import Tab from 'primevue/tab';
import TabList from 'primevue/tablist';
import TabPanel from 'primevue/tabpanel';
import TabPanels from 'primevue/tabpanels';
import Tabs from 'primevue/tabs';
import {
  APPEARANCE_LIMITS,
  EMPTY_THEME_FONTS,
  FONT_CHOICES,
  SURFACE_PALETTES,
  SURFACE_SWATCHES,
  THEME_COLORS,
  THEME_PRESETS,
  isCustomThemeId,
  isFontFamily,
  isHexColor,
  type CustomThemeDef,
  type ThemeColorKey,
  type ThemeFonts,
} from '@shared/themes';
import MarkdownView from '@/components/common/MarkdownView.vue';
import { applyTheme, currentThemeId, paintTheme } from '@/theme/themeManager';

import { t } from '@/i18n';
/**
 * Création ou modification d'un thème personnalisé, avec aperçu en direct sur toute l'interface (annuler revient
 * au thème actif) : bases (mode, style, couleur principale, surfaces), couleurs de l'interface et du rendu Markdown
 * réglées une à une, et polices propres au thème.
 */
const props = defineProps<{ theme: CustomThemeDef | null; isNew: boolean }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ save: [theme: CustomThemeDef] }>();

const blank = (): CustomThemeDef => ({ id: newThemeId(), label: '', mode: 'light', preset: 'aura', primary: '#6366f1', surface: 'slate', colors: {}, fonts: { ...EMPTY_THEME_FONTS } });
const draft = reactive<CustomThemeDef>(blank());
const saved = ref(false);
const tab = ref('base');

watch(
  visible,
  (open) => {
    if (!open) {
      // Fermé sans enregistrer : le thème actif revient.
      if (!saved.value) applyTheme(currentThemeId.value);
      return;
    }
    saved.value = false;
    tab.value = 'base';
    const source = props.theme ?? blank();
    Object.assign(draft, { ...source, colors: { ...source.colors }, fonts: { ...EMPTY_THEME_FONTS, ...source.fonts } });
    void nextTick(readDefaults);
  },
  { immediate: true },
);
watch(
  draft,
  () => {
    if (!visible.value || !isHexColor(draft.primary)) return;
    paintTheme(draft);
    void nextTick(readDefaults);
  },
  { deep: true },
);

const modes = computed(() => [
  { value: 'light', label: t('Clair'), icon: 'pi pi-sun' },
  { value: 'dark', label: t('Sombre'), icon: 'pi pi-moon' },
]);
const presets = THEME_PRESETS.map((preset) => ({ value: preset, label: preset[0]!.toUpperCase() + preset.slice(1) }));
const ACCENTS = ['#6366f1', '#3b82f6', '#0ea5e9', '#14b8a6', '#10b981', '#84cc16', '#eab308', '#f97316', '#ef4444', '#f43f5e', '#ec4899', '#a855f7'];

/** ColorPicker de PrimeVue travaille sans « # ». */
const primaryHex = computed({
  get: () => draft.primary.replace('#', ''),
  set: (value: string) => (draft.primary = `#${String(value).replace('#', '')}`),
});
const surfaceCustom = computed(() => isHexColor(draft.surface));
const surfaceHex = computed({
  get: () => (isHexColor(draft.surface) ? draft.surface.replace('#', '') : '64748b'),
  set: (value: string) => (draft.surface = `#${String(value).replace('#', '')}`),
});
const primaryText = ref('');
watch(() => draft.primary, (value) => (primaryText.value = value), { immediate: true });
function commitPrimaryText(): void {
  const value = primaryText.value.trim().startsWith('#') ? primaryText.value.trim() : `#${primaryText.value.trim()}`;
  if (isHexColor(value)) draft.primary = value.toLowerCase();
  else primaryText.value = draft.primary;
}

// --- Couleurs réglées une à une ---
const interfaceColors = THEME_COLORS.filter((entry) => entry.group === 'interface');
const markdownColors = THEME_COLORS.filter((entry) => entry.group === 'markdown');

/** Ce que vaut chaque couleur sans réglage, lu sur la page (le thème de base l'a calculée). */
const PROBES: Record<ThemeColorKey, string> = {
  background: 'var(--fb-bg)',
  panel: 'var(--fb-panel)',
  panelAlt: 'var(--fb-panel-alt)',
  border: 'var(--fb-border)',
  text: 'var(--fb-text)',
  muted: 'var(--fb-muted)',
  mdText: 'var(--md-text, var(--fb-text))',
  mdH1: 'var(--md-h1, var(--md-text, var(--fb-text)))',
  mdH2: 'var(--md-h2, var(--md-text, var(--fb-text)))',
  mdH3: 'var(--md-h3, var(--md-text, var(--fb-text)))',
  mdH4: 'var(--md-h4, var(--md-text, var(--fb-text)))',
  mdBold: 'var(--md-strong, var(--md-text, var(--fb-text)))',
  mdItalic: 'var(--md-em, var(--md-text, var(--fb-text)))',
  mdLink: 'var(--md-link, var(--fb-accent))',
  mdCode: 'var(--md-code, var(--fb-md-code))',
  mdCodeBg: 'var(--md-code-bg, var(--fb-md-code-bg))',
  mdPre: 'var(--md-pre, var(--md-text, var(--fb-text)))',
  mdPreBg: 'var(--md-pre-bg, var(--fb-panel-alt))',
  mdQuote: 'var(--md-quote, var(--fb-muted))',
  mdQuoteBar: 'var(--md-quote-bar, var(--fb-accent))',
  mdQuoteBg: 'var(--md-quote-bg, var(--fb-md-quote-bg))',
  mdHighlight: 'var(--md-highlight, #fde68a)',
  mdTableHead: 'var(--md-th-bg, var(--fb-md-th-bg))',
  mdTableBorder: 'var(--md-table-border, var(--fb-border))',
  mdRule: 'var(--md-hr, var(--fb-border))',
  mdMarker: 'var(--md-marker, var(--fb-md-marker))',
  mdTag: 'var(--md-tag, var(--fb-accent))',
};
const defaults = reactive<Record<string, string>>({});

function toHex(color: string): string | null {
  const match = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(color);
  return match ? `#${match.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, '0')).join('')}` : null;
}

function readDefaults(): void {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  document.body.appendChild(probe);
  for (const entry of THEME_COLORS) {
    if (draft.colors[entry.key]) continue;
    probe.style.color = PROBES[entry.key];
    defaults[entry.key] = toHex(getComputedStyle(probe).color) ?? '#888888';
  }
  probe.remove();
}

function colorOf(key: ThemeColorKey): string {
  return draft.colors[key] ?? defaults[key] ?? '#888888';
}

function setColor(key: ThemeColorKey, value: string): void {
  const hex = `#${String(value).replace('#', '')}`.toLowerCase();
  if (isHexColor(hex)) draft.colors = { ...draft.colors, [key]: hex };
}

function resetColor(key: ThemeColorKey): void {
  const next = { ...draft.colors };
  delete next[key];
  draft.colors = next;
}

function commitColorText(key: ThemeColorKey, event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim();
  if (!raw) resetColor(key);
  else setColor(key, raw);
  (event.target as HTMLInputElement).value = draft.colors[key] ?? '';
}

const customised = (keys: ReadonlyArray<{ key: ThemeColorKey }>) => keys.filter((entry) => draft.colors[entry.key]).length;

function resetGroup(keys: ReadonlyArray<{ key: ThemeColorKey }>): void {
  const next = { ...draft.colors };
  for (const { key } of keys) delete next[key];
  draft.colors = next;
}

// --- Polices du thème ---
type FontSlot = keyof ThemeFonts;
const OTHER = '__other__';
const DEFAULT = '__default__';
const FONT_SLOTS: Array<{ key: FontSlot; label: string }> = [
  { key: 'body', label: t('Texte') },
  { key: 'heading', label: t('Titres') },
  { key: 'mono', label: t('Code et identifiants') },
  { key: 'doc', label: t('Texte des notes') },
];
const typed = reactive<Record<FontSlot, string>>({ body: '', heading: '', mono: '', doc: '' });
/** Polices pour lesquelles « Autre police installée… » est choisi, avant même qu'un nom soit saisi. */
const others = reactive(new Set<FontSlot>());

function fontOptions(slot: FontSlot) {
  const kinds = slot === 'mono' ? ['mono'] : ['sans', 'serif'];
  return [
    { value: DEFAULT, label: t('Celle de mes réglages') },
    ...FONT_CHOICES.filter((choice) => kinds.includes(choice.kind)).map((choice) => ({ value: choice.value, label: choice.label })),
    { value: OTHER, label: t('Autre police installée…') },
  ];
}

function fontChoice(slot: FontSlot): string {
  const value = draft.fonts[slot];
  if (!value) return others.has(slot) ? OTHER : DEFAULT;
  return FONT_CHOICES.some((choice) => choice.value === value) ? value : OTHER;
}

function pickFont(slot: FontSlot, value: string): void {
  if (value === DEFAULT) {
    draft.fonts = { ...draft.fonts, [slot]: '' };
    typed[slot] = '';
    others.delete(slot);
  } else if (value === OTHER) {
    others.add(slot);
  } else {
    draft.fonts = { ...draft.fonts, [slot]: value };
    others.delete(slot);
  }
}

function commitTypedFont(slot: FontSlot): void {
  const name = typed[slot].trim().replace(/['"]/g, '');
  if (!name) return;
  const value = `'${name}', ${slot === 'mono' ? 'monospace' : 'system-ui, sans-serif'}`;
  if (isFontFamily(value)) draft.fonts = { ...draft.fonts, [slot]: value };
}

watch(
  visible,
  (open) => {
    if (!open) return;
    for (const { key } of FONT_SLOTS) {
      const value = draft.fonts[key];
      typed[key] = value && !FONT_CHOICES.some((choice) => choice.value === value) ? value.split(',')[0]!.replace(/['"]/g, '').trim() : '';
      if (typed[key]) others.add(key);
      else others.delete(key);
    }
  },
  { immediate: true },
);

/** Aperçu des couleurs des notes. */
const sample = computed(() =>
  [
    `# ${t('Titre 1')}`,
    `## ${t('Titre 2')}`,
    `### ${t('Titre 3')}`,
    `#### ${t('Titre 4')}`,
    t('Du texte avec du **gras**, de l’*italique*, un [lien](https://example.com), du `code` et ==un surlignage==. #étiquette'),
    '',
    `> ${t('Une citation, avec sa barre et son fond.')}`,
    '',
    `- ${t('Une puce')}`,
    `1. ${t('Un numéro')}`,
    '',
    `| ${t('Colonne')} | ${t('Valeur')} |`,
    '| --- | --- |',
    '| A | 42 |',
    '',
    '---',
    '',
    '```js',
    'const total = 42;',
    '```',
  ].join('\n'),
);

const valid = computed(() => draft.label.trim().length > 0 && isHexColor(draft.primary));

function newThemeId(): string {
  return `custom-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function save(): void {
  if (!valid.value) return;
  saved.value = true;
  emit('save', { ...draft, colors: { ...draft.colors }, fonts: { ...draft.fonts }, id: isCustomThemeId(draft.id) ? draft.id : newThemeId(), label: draft.label.trim() });
  visible.value = false;
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="isNew ? $t('Créer un thème') : $t('Modifier le thème')" :style="{ width: 'min(46rem, 96vw)' }" :content-style="{ paddingTop: '0' }">
    <form class="editor" @submit.prevent="save">
      <p class="muted small">{{ $t('Les couleurs s’appliquent en direct à toute l’interface pendant que vous les réglez.') }}</p>
      <div class="field">
        <label for="theme-name" class="label">{{ $t('Nom du thème') }}</label>
        <InputText id="theme-name" v-model="draft.label" :maxlength="APPEARANCE_LIMITS.labelMax" fluid autofocus :placeholder="$t('ex. Bureau, Présentation…')" />
      </div>

      <Tabs v-model:value="tab" class="tabs">
        <TabList>
          <Tab value="base"><i class="pi pi-sliders-h"></i> {{ $t('Bases') }}</Tab>
          <Tab value="interface">
            <i class="pi pi-desktop"></i> {{ $t('Interface') }}
            <span v-if="customised(interfaceColors)" class="count">{{ customised(interfaceColors) }}</span>
          </Tab>
          <Tab value="markdown">
            <i class="pi pi-file"></i> {{ $t('Notes (Markdown)') }}
            <span v-if="customised(markdownColors)" class="count">{{ customised(markdownColors) }}</span>
          </Tab>
          <Tab value="fonts"><i class="pi pi-pencil"></i> {{ $t('Polices') }}</Tab>
        </TabList>
        <TabPanels>
          <TabPanel value="base">
            <div class="panel">
              <div class="field">
                <span class="label">{{ $t('Base') }}</span>
                <SelectButton v-model="draft.mode" :options="modes" option-label="label" option-value="value" :allow-empty="false">
                  <template #option="{ option }"><i :class="option.icon"></i> {{ option.label }}</template>
                </SelectButton>
              </div>
              <div class="field">
                <span class="label">{{ $t('Style des composants') }}</span>
                <SelectButton v-model="draft.preset" :options="presets" option-label="label" option-value="value" :allow-empty="false" />
              </div>
              <div class="field">
                <span class="label">{{ $t('Couleur principale') }}</span>
                <div class="colors">
                  <button v-for="accent in ACCENTS" :key="accent" type="button" class="dot" :class="{ on: draft.primary.toLowerCase() === accent }" :style="{ background: accent }" :aria-label="accent" @click="draft.primary = accent"></button>
                  <ColorPicker v-model="primaryHex" format="hex" :aria-label="$t('Couleur personnalisée')" />
                  <InputText v-model="primaryText" size="small" class="hex" maxlength="7" :aria-label="$t('Code couleur')" @blur="commitPrimaryText" @keydown.enter.prevent="commitPrimaryText" />
                </div>
              </div>
              <div class="field">
                <span class="label">{{ $t('Surfaces (fonds et bordures)') }}</span>
                <div class="colors">
                  <button
                    v-for="surface in SURFACE_PALETTES"
                    :key="surface"
                    v-tooltip.top="surface"
                    type="button"
                    class="dot surface"
                    :class="{ on: draft.surface === surface }"
                    :style="{ background: `linear-gradient(135deg, ${SURFACE_SWATCHES[surface].light} 50%, ${SURFACE_SWATCHES[surface].dark} 50%)` }"
                    :aria-label="surface"
                    @click="draft.surface = surface"
                  ></button>
                  <span class="custom" :class="{ on: surfaceCustom }">
                    <ColorPicker v-model="surfaceHex" format="hex" :aria-label="$t('Teinte de surface personnalisée')" />
                    <span class="muted small">{{ $t('Teinte personnalisée') }}</span>
                  </span>
                </div>
              </div>
            </div>
          </TabPanel>

          <TabPanel v-for="group in [{ key: 'interface', entries: interfaceColors }, { key: 'markdown', entries: markdownColors }]" :key="group.key" :value="group.key">
            <div class="panel">
              <div class="group-head">
                <p class="muted small">{{ group.key === 'interface' ? $t('Sans réglage, une couleur suit les bases du thème.') : $t('Couleurs du texte des notes, des descriptions et des commentaires. Sans réglage, une couleur suit l’interface.') }}</p>
                <Button v-if="customised(group.entries)" :label="$t('Tout rétablir')" icon="pi pi-undo" size="small" text severity="secondary" @click="resetGroup(group.entries)" />
              </div>
              <div class="split" :class="{ single: group.key === 'interface' }">
                <ul class="color-list">
                  <li v-for="entry in group.entries" :key="entry.key" class="color-row" :class="{ set: draft.colors[entry.key] }">
                    <ColorPicker :model-value="colorOf(entry.key).replace('#', '')" format="hex" :aria-label="$t(entry.label)" @update:model-value="(value: string) => setColor(entry.key, value)" />
                    <span class="color-name">{{ $t(entry.label) }}</span>
                    <input
                      :key="draft.colors[entry.key] ?? 'default'"
                      class="p-inputtext p-inputtext-sm hex"
                      :value="draft.colors[entry.key] ?? ''"
                      :placeholder="$t('Par défaut')"
                      maxlength="7"
                      :aria-label="$t('Code couleur')"
                      @change="commitColorText(entry.key, $event)"
                    />
                    <Button v-tooltip.top="$t('Couleur par défaut')" icon="pi pi-undo" text rounded size="small" severity="secondary" :disabled="!draft.colors[entry.key]" :aria-label="$t('Couleur par défaut')" @click="resetColor(entry.key)" />
                  </li>
                </ul>
                <div v-if="group.key === 'markdown'" class="sample">
                  <MarkdownView :text="sample" obsidian />
                </div>
              </div>
            </div>
          </TabPanel>

          <TabPanel value="fonts">
            <div class="panel">
              <p class="muted small">{{ $t('Polices propres au thème : elles remplacent celles de vos réglages tant que le thème est utilisé.') }}</p>
              <div v-for="slot in FONT_SLOTS" :key="slot.key" class="font-row">
                <label :for="`theme-font-${slot.key}`" class="label">{{ slot.label }}</label>
                <div class="font-controls">
                  <Select :model-value="fontChoice(slot.key)" :input-id="`theme-font-${slot.key}`" :options="fontOptions(slot.key)" option-label="label" option-value="value" size="small" class="font-select" @update:model-value="(value: string) => pickFont(slot.key, value)">
                    <template #option="{ option }">
                      <span :style="{ fontFamily: option.value !== OTHER && option.value !== DEFAULT ? option.value : undefined }">{{ option.label }}</span>
                    </template>
                  </Select>
                  <InputText v-if="fontChoice(slot.key) === OTHER" v-model.trim="typed[slot.key]" size="small" :placeholder="$t('Nom de la police')" :aria-label="$t('Nom de la police')" @blur="commitTypedFont(slot.key)" @keydown.enter.prevent="commitTypedFont(slot.key)" />
                </div>
              </div>
            </div>
          </TabPanel>
        </TabPanels>
      </Tabs>

      <div class="actions">
        <Button type="button" :label="$t('Annuler')" severity="secondary" text @click="visible = false" />
        <Button type="submit" :label="$t('Enregistrer et utiliser')" icon="pi pi-check" :disabled="!valid" />
      </div>
    </form>
  </Dialog>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
.editor > p {
  margin: 0;
}
.tabs :deep(.p-tablist-tab-list) {
  background: transparent;
}
.tabs :deep(.p-tab) {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.6rem 0.85rem;
  font-size: 0.88rem;
}
.tabs :deep(.p-tabpanels) {
  padding: 0.9rem 0 0;
  background: transparent;
}
.count {
  min-width: 1.2rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
  font-size: 0.72rem;
  font-weight: 700;
  text-align: center;
}
.panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.label {
  font-weight: 600;
  font-size: 0.88rem;
}
.colors {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}
.dot {
  width: 1.6rem;
  height: 1.6rem;
  padding: 0;
  border: 2px solid var(--fb-border);
  border-radius: 50%;
  cursor: pointer;
}
.dot.on {
  outline: 2px solid var(--fb-text);
  outline-offset: 2px;
}
.hex {
  width: 6rem;
  font-family: var(--fb-font-mono, ui-monospace, monospace);
}
.custom {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.15rem 0.5rem 0.15rem 0.2rem;
  border-radius: 999px;
}
.custom.on {
  outline: 2px solid var(--fb-text);
}
.group-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.group-head p {
  flex: 1;
  margin: 0;
}
.split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}
.split.single {
  grid-template-columns: minmax(0, 1fr);
}
.color-list {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  max-height: 24rem;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
.color-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.15rem 0.25rem;
  border-radius: 6px;
}
.color-row.set {
  background: var(--fb-accent-soft);
}
.color-row :deep(.p-colorpicker-preview) {
  width: 1.5rem;
  height: 1.5rem;
}
.color-name {
  flex: 1;
  min-width: 0;
  font-size: 0.86rem;
}
.sample {
  position: sticky;
  top: 0;
  max-height: 24rem;
  overflow-y: auto;
  padding: 0.75rem 0.9rem;
  border: 1px solid var(--fb-border);
  border-radius: 8px;
  background: var(--fb-panel);
  font-family: var(--fb-font-doc, inherit);
  font-size: 0.9rem;
}
.font-row {
  display: grid;
  grid-template-columns: 9rem 1fr;
  align-items: center;
  gap: 0.75rem;
}
.font-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.font-select {
  min-width: 13rem;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
@media (max-width: 640px) {
  .split {
    grid-template-columns: minmax(0, 1fr);
  }
  .font-row {
    grid-template-columns: 1fr;
  }
}
</style>
