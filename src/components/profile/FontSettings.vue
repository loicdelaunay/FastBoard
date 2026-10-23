<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import Slider from 'primevue/slider';
import { APPEARANCE_LIMITS, DEFAULT_FONTS, FONT_CHOICES, isFontFamily, type FontSettings } from '@shared/themes';
import { useAuthStore } from '@/stores/auth';
import { applyFonts } from '@/theme/themeManager';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Polices de l'interface (texte, titres, code) et taille du texte, enregistrées sur le compte. */
const auth = useAuthStore();
const fonts = reactive<FontSettings>({ ...(auth.user?.appearance.fonts ?? DEFAULT_FONTS) });
/** Police saisie à la main (installée sur le poste) pour chaque usage. */
const typed = reactive({ body: '', heading: '', mono: '' });
const OTHER = '__other__';
/** Police par défaut (Select ne marque pas une option de valeur vide comme choisie). */
const DEFAULT = '__default__';

type Slot = 'body' | 'heading' | 'mono';
const SLOTS: Array<{ key: Slot; label: string; sample: string }> = [
  { key: 'body', label: t('Texte'), sample: t('Le rapide renard brun saute par-dessus le chien paresseux.') },
  { key: 'heading', label: t('Titres'), sample: t('Réglages du projet') },
  { key: 'mono', label: t('Code et identifiants'), sample: 'APP-12 · const total = 42;' },
];

function options(slot: Slot) {
  const kinds = slot === 'mono' ? ['mono'] : ['sans', 'serif'];
  return [
    { value: DEFAULT, label: slot === 'heading' ? t('Comme le texte') : t('Par défaut') },
    ...FONT_CHOICES.filter((choice) => kinds.includes(choice.kind)).map((choice) => ({ value: choice.value, label: choice.label })),
    { value: OTHER, label: t('Autre police installée…') },
  ];
}

/** Valeur du menu : une police proposée, ou « autre » pour une police saisie. */
const choice = reactive<Record<Slot, string>>({ body: DEFAULT, heading: DEFAULT, mono: DEFAULT });
for (const slot of ['body', 'heading', 'mono'] as Slot[]) {
  const known = FONT_CHOICES.some((entry) => entry.value === fonts[slot]);
  choice[slot] = !fonts[slot] ? DEFAULT : known ? fonts[slot] : OTHER;
  if (!known && fonts[slot]) typed[slot] = fonts[slot].split(',')[0]!.replace(/['"]/g, '').trim();
}

function pick(slot: Slot, value: string): void {
  choice[slot] = value;
  if (value === DEFAULT) fonts[slot] = '';
  else if (value !== OTHER) fonts[slot] = value;
  else if (typed[slot]) commitTyped(slot);
}

/** Police saisie : mise entre guillemets, avec une police de secours. */
function commitTyped(slot: Slot): void {
  const name = typed[slot].trim().replace(/['"]/g, '');
  if (!name) return;
  const fallback = slot === 'mono' ? 'monospace' : 'system-ui, sans-serif';
  const value = `'${name}', ${fallback}`;
  if (isFontFamily(value)) fonts[slot] = value;
}

const saving = ref(false);
let timer: number | null = null;
watch(
  fonts,
  () => {
    applyFonts({ ...fonts });
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => void save(), 700);
  },
  { deep: true },
);
onBeforeUnmount(() => {
  if (timer) {
    window.clearTimeout(timer);
    void save();
  }
});

async function save(): Promise<void> {
  timer = null;
  const current = auth.user?.appearance;
  if (!current || JSON.stringify(current.fonts) === JSON.stringify(fonts)) return;
  saving.value = true;
  try {
    await auth.updateProfile({ appearance: { customThemes: current.customThemes, fonts: { ...fonts } } });
  } catch (error) {
    notifyError(error, t('Polices non enregistrées'));
  } finally {
    saving.value = false;
  }
}

/** Police de l'aperçu (le code reste à chasse fixe par défaut). */
function sampleFont(slot: Slot): string | undefined {
  if (fonts[slot]) return fonts[slot];
  if (slot === 'mono') return "ui-monospace, 'Cascadia Mono', Consolas, monospace";
  return slot === 'heading' && fonts.body ? fonts.body : undefined;
}

function reset(): void {
  Object.assign(fonts, DEFAULT_FONTS);
  Object.assign(choice, { body: DEFAULT, heading: DEFAULT, mono: DEFAULT });
  Object.assign(typed, { body: '', heading: '', mono: '' });
}

const isDefault = computed(() => JSON.stringify({ ...fonts }) === JSON.stringify(DEFAULT_FONTS));
</script>

<template>
  <section class="fonts">
    <div class="head">
      <h4 class="title"><i class="pi pi-pencil"></i> {{ $t('Polices') }}</h4>
      <i v-if="saving" class="pi pi-spin pi-spinner muted"></i>
      <Button v-if="!isDefault" :label="$t('Rétablir')" icon="pi pi-undo" size="small" text severity="secondary" @click="reset" />
    </div>
    <p class="muted small">{{ $t('Polices installées sur votre poste ; une police absente est remplacée par celle du système.') }}</p>
    <div v-for="slot in SLOTS" :key="slot.key" class="row-font">
      <label :for="`font-${slot.key}`" class="label">{{ slot.label }}</label>
      <div class="controls">
        <Select :model-value="choice[slot.key]" :input-id="`font-${slot.key}`" :options="options(slot.key)" option-label="label" option-value="value" size="small" class="select" @update:model-value="(value: string) => pick(slot.key, value)">
          <template #option="{ option }">
            <span :style="{ fontFamily: option.value !== OTHER && option.value !== DEFAULT ? option.value : undefined }">{{ option.label }}</span>
          </template>
        </Select>
        <InputText v-if="choice[slot.key] === OTHER" v-model="typed[slot.key]" size="small" :maxlength="APPEARANCE_LIMITS.fontMax - 30" :placeholder="$t('Nom de la police')" :aria-label="$t('Nom de la police')" @blur="commitTyped(slot.key)" @keydown.enter.prevent="commitTyped(slot.key)" />
      </div>
      <p class="sample" :style="{ fontFamily: sampleFont(slot.key), fontWeight: slot.key === 'heading' ? 700 : undefined }">{{ slot.sample }}</p>
    </div>
    <div class="row-font">
      <label class="label">{{ $t('Taille du texte') }}</label>
      <div class="controls size">
        <Slider v-model="fonts.size" :min="APPEARANCE_LIMITS.sizeMin" :max="APPEARANCE_LIMITS.sizeMax" :step="1" class="slider" :aria-label="$t('Taille du texte')" />
        <span class="value">{{ fonts.size }} px</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.fonts {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin-bottom: 1.25rem;
}
.head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.title {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--fb-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.fonts > p {
  margin: -0.3rem 0 0;
}
.row-font {
  display: grid;
  grid-template-columns: 9rem 1fr;
  align-items: center;
  gap: 0.3rem 0.75rem;
}
.label {
  font-weight: 600;
  font-size: 0.85rem;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.select {
  min-width: 12rem;
}
.sample {
  grid-column: 2;
  margin: 0;
  color: var(--fb-muted);
  font-size: 0.9rem;
}
.size {
  align-items: center;
  gap: 0.9rem;
}
.slider {
  flex: 1;
  max-width: 16rem;
}
.value {
  font-variant-numeric: tabular-nums;
  font-size: 0.85rem;
}
@media (max-width: 600px) {
  .row-font {
    grid-template-columns: 1fr;
  }
  .sample {
    grid-column: 1;
  }
}
</style>
