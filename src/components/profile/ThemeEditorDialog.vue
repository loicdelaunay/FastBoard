<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import Button from 'primevue/button';
import ColorPicker from 'primevue/colorpicker';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import SelectButton from 'primevue/selectbutton';
import { APPEARANCE_LIMITS, SURFACE_PALETTES, SURFACE_SWATCHES, THEME_PRESETS, isCustomThemeId, isHexColor, type CustomThemeDef } from '@shared/themes';
import { applyTheme, currentThemeId, paintTheme } from '@/theme/themeManager';

import { t } from '@/i18n';
/**
 * Création ou modification d'un thème personnalisé, avec aperçu en direct sur toute l'interface (annuler revient
 * au thème actif).
 */
const props = defineProps<{ theme: CustomThemeDef | null; isNew: boolean }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ save: [theme: CustomThemeDef] }>();

const draft = reactive<CustomThemeDef>({ id: '', label: '', mode: 'light', preset: 'aura', primary: '#6366f1', surface: 'slate' });
const saved = ref(false);

watch(visible, (open) => {
  if (!open) {
    // Fermé sans enregistrer : le thème actif revient.
    if (!saved.value) applyTheme(currentThemeId.value);
    return;
  }
  saved.value = false;
  Object.assign(draft, props.theme ?? { id: newThemeId(), label: '', mode: 'light', preset: 'aura', primary: '#6366f1', surface: 'slate' });
}, { immediate: true });
watch(draft, () => visible.value && isHexColor(draft.primary) && paintTheme(draft), { deep: true });

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

const valid = computed(() => draft.label.trim().length > 0 && isHexColor(draft.primary));

function newThemeId(): string {
  return `custom-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function save(): void {
  if (!valid.value) return;
  saved.value = true;
  emit('save', { ...draft, id: isCustomThemeId(draft.id) ? draft.id : newThemeId(), label: draft.label.trim() });
  visible.value = false;
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="isNew ? $t('Créer un thème') : $t('Modifier le thème')" :style="{ width: 'min(30rem, 96vw)' }">
    <form class="editor" @submit.prevent="save">
      <p class="muted small">{{ $t('Les couleurs s’appliquent en direct à toute l’interface pendant que vous les réglez.') }}</p>
      <div class="field">
        <label for="theme-name" class="label">{{ $t('Nom du thème') }}</label>
        <InputText id="theme-name" v-model="draft.label" :maxlength="APPEARANCE_LIMITS.labelMax" fluid autofocus :placeholder="$t('ex. Bureau, Présentation…')" />
      </div>
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
  gap: 1rem;
}
.editor > p {
  margin: 0;
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
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
