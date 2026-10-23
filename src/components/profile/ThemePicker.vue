<script setup lang="ts">
import { computed, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import { APPEARANCE_LIMITS, DEFAULT_FONTS, SURFACE_SWATCHES, THEMES, findTheme, isHexColor, type CustomThemeDef, type ThemeDef } from '@shared/themes';
import { useAuthStore } from '@/stores/auth';
import { currentThemeId, customThemes } from '@/theme/themeManager';
import { notifyError } from '@/utils/notify';
import ThemeEditorDialog from './ThemeEditorDialog.vue';

import { t } from '@/i18n';
defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ select: [themeId: string] }>();

const auth = useAuthStore();
const confirm = useConfirm();
const editing = ref<CustomThemeDef | null>(null);
const editorOpen = ref(false);

/** Aperçu d'un thème personnalisé : couleur principale et fond calculé d'après la surface. */
function customStyle(theme: CustomThemeDef): Record<string, string> {
  const dark = theme.mode === 'dark';
  const background = isHexColor(theme.surface) ? `color-mix(in srgb, ${theme.surface} ${dark ? 18 : 6}%, ${dark ? '#000' : '#fff'})` : SURFACE_SWATCHES[theme.surface as keyof typeof SURFACE_SWATCHES]?.[dark ? 'dark' : 'light'] ?? '#fff';
  return { '--sw-bg': background, '--sw-fg': dark ? '#e5e7eb' : '#111827', '--sw-accent': theme.primary };
}

const newId = () => `custom-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

/** Nouveau thème : part du thème actuel. */
function create(): void {
  const current = findTheme(currentThemeId.value);
  const custom = customThemes.value.find((theme) => theme.id === currentThemeId.value);
  editing.value = custom
    ? { ...custom, id: newId(), label: t('{name} (copie)', { name: custom.label }) }
    : current
      ? { id: newId(), label: '', mode: current.mode, preset: current.preset, primary: current.preview.accent, surface: current.surface }
      : null;
  editorOpen.value = true;
}

function edit(theme: CustomThemeDef): void {
  editing.value = { ...theme };
  editorOpen.value = true;
}

function appearance(themes: CustomThemeDef[]) {
  return { customThemes: themes, fonts: auth.user?.appearance.fonts ?? { ...DEFAULT_FONTS } };
}

async function save(theme: CustomThemeDef): Promise<void> {
  const exists = customThemes.value.some((entry) => entry.id === theme.id);
  const themes = exists ? customThemes.value.map((entry) => (entry.id === theme.id ? theme : entry)) : [...customThemes.value, theme];
  try {
    await auth.updateProfile({ appearance: appearance(themes), theme: theme.id });
  } catch (error) {
    notifyError(error, t('Thème non enregistré'));
  }
}

function remove(theme: CustomThemeDef): void {
  confirm.require({
    header: t('Supprimer le thème'),
    message: t('Supprimer le thème « {name} » ?', { name: theme.label }),
    icon: 'pi pi-trash',
    acceptProps: { label: t('Supprimer'), severity: 'danger' },
    rejectProps: { label: t('Annuler'), severity: 'secondary', text: true },
    accept: async () => {
      try {
        await auth.updateProfile({ appearance: appearance(customThemes.value.filter((entry) => entry.id !== theme.id)) });
      } catch (error) {
        notifyError(error);
      }
    },
  });
}

const groups = computed(() => [
  { key: 'light', title: t('Thèmes clairs'), icon: 'pi pi-sun', themes: THEMES.filter((theme) => theme.mode === 'light') },
  { key: 'dark', title: t('Thèmes sombres'), icon: 'pi pi-moon', themes: THEMES.filter((theme) => theme.mode === 'dark') },
]);

function swatchStyle(theme: ThemeDef): Record<string, string> {
  return { '--sw-bg': theme.preview.background, '--sw-fg': theme.preview.text, '--sw-accent': theme.preview.accent };
}
</script>

<template>
  <div class="theme-picker">
    <section>
      <h4 class="group-title"><i class="pi pi-palette"></i> {{ $t('Mes thèmes') }}</h4>
      <div class="grid" role="radiogroup" :aria-label="$t('Mes thèmes')">
        <div v-for="theme in customThemes" :key="theme.id" class="custom-wrap">
          <button type="button" role="radio" class="theme-card" :class="{ selected: currentThemeId === theme.id }" :aria-checked="currentThemeId === theme.id" :disabled="disabled" @click="emit('select', theme.id)">
            <span class="swatch" :style="customStyle(theme)">
              <span class="bar"></span>
              <span class="lines"><i></i><i></i></span>
              <span class="chip"></span>
            </span>
            <span class="name">{{ theme.label }}</span>
            <i v-if="currentThemeId === theme.id" class="pi pi-check-circle check" :style="customStyle(theme)"></i>
          </button>
          <span class="tools">
            <button v-tooltip.top="$t('Modifier')" type="button" class="tool" :aria-label="$t('Modifier')" @click="edit(theme)"><i class="pi pi-pencil"></i></button>
            <button v-tooltip.top="$t('Supprimer')" type="button" class="tool" :aria-label="$t('Supprimer')" @click="remove(theme)"><i class="pi pi-trash"></i></button>
          </span>
        </div>
        <button v-if="customThemes.length < APPEARANCE_LIMITS.themes" type="button" class="theme-card create" :disabled="disabled" @click="create">
          <i class="pi pi-plus"></i>
          <span class="name">{{ $t('Créer un thème') }}</span>
        </button>
      </div>
    </section>
    <section v-for="group in groups" :key="group.key">
      <h4 class="group-title"><i :class="group.icon"></i> {{ group.title }}</h4>
      <div class="grid" role="radiogroup" :aria-label="group.title">
        <button
          v-for="theme in group.themes"
          :key="theme.id"
          type="button"
          role="radio"
          class="theme-card"
          :class="{ selected: currentThemeId === theme.id }"
          :aria-checked="currentThemeId === theme.id"
          :disabled="disabled"
          @click="emit('select', theme.id)"
        >
          <span class="swatch" :style="swatchStyle(theme)">
            <span class="bar"></span>
            <span class="lines"><i></i><i></i></span>
            <span class="chip"></span>
          </span>
          <span class="name">{{ $t(theme.label) }}</span>
          <i v-if="currentThemeId === theme.id" class="pi pi-check-circle check"></i>
        </button>
      </div>
    </section>
    <ThemeEditorDialog v-model:visible="editorOpen" :theme="editing" :is-new="!customThemes.some((entry) => entry.id === editing?.id)" @save="save" />
  </div>
</template>

<style scoped>
.theme-picker {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.group-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.6rem;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--fb-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
  gap: 0.6rem;
}
.theme-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.45rem;
  border: 2px solid var(--fb-border);
  border-radius: 12px;
  background: var(--fb-panel);
  color: var(--fb-text);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, transform 0.15s;
}
.theme-card:hover:not(:disabled) {
  border-color: var(--fb-accent);
  transform: translateY(-1px);
}
.theme-card:focus-visible {
  outline: 2px solid var(--fb-accent);
  outline-offset: 2px;
}
.theme-card.selected {
  border-color: var(--fb-accent);
  box-shadow: 0 0 0 3px var(--fb-accent-soft);
}
.swatch {
  position: relative;
  display: block;
  height: 3.6rem;
  padding: 0.45rem;
  border-radius: 8px;
  background: var(--sw-bg);
  border: 1px solid color-mix(in srgb, var(--sw-fg) 14%, transparent);
  overflow: hidden;
}
.bar {
  display: block;
  width: 55%;
  height: 0.4rem;
  border-radius: 4px;
  background: var(--sw-accent);
}
.lines {
  display: block;
  margin-top: 0.4rem;
}
.lines i {
  display: block;
  height: 0.25rem;
  margin-bottom: 0.25rem;
  border-radius: 3px;
  background: color-mix(in srgb, var(--sw-fg) 35%, transparent);
}
.lines i:last-child {
  width: 70%;
}
.chip {
  position: absolute;
  right: 0.45rem;
  bottom: 0.45rem;
  width: 1.1rem;
  height: 0.7rem;
  border-radius: 4px;
  background: var(--sw-accent);
}
.name {
  padding: 0 0.15rem 0.1rem;
  font-size: 0.8rem;
  font-weight: 600;
}
.custom-wrap {
  position: relative;
}
.custom-wrap .theme-card {
  width: 100%;
}
.tools {
  position: absolute;
  top: 0.75rem;
  left: 0.75rem;
  display: none;
  gap: 0.2rem;
}
.custom-wrap:hover .tools,
.custom-wrap:focus-within .tools {
  display: flex;
}
.tool {
  display: grid;
  place-items: center;
  width: 1.5rem;
  height: 1.5rem;
  border: 0;
  border-radius: 6px;
  background: rgb(0 0 0 / 55%);
  color: #fff;
  font-size: 0.7rem;
  cursor: pointer;
}
.create {
  align-items: center;
  justify-content: center;
  min-height: 5.6rem;
  border-style: dashed;
  color: var(--fb-muted);
}
.create i {
  font-size: 1.1rem;
}
.check {
  position: absolute;
  top: 0.8rem;
  right: 0.85rem;
  color: var(--sw-accent);
  font-size: 1rem;
  background: var(--sw-bg);
  border-radius: 50%;
}
</style>
