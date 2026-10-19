import { ref } from 'vue';
import { updatePrimaryPalette, updateSurfacePalette, usePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';
import Lara from '@primeuix/themes/lara';
import Material from '@primeuix/themes/material';
import Nora from '@primeuix/themes/nora';
import { DEFAULT_THEME_ID, findTheme, type ThemeDef, type ThemePresetName } from '@shared/themes';

const PRESETS = { aura: Aura, lara: Lara, material: Material, nora: Nora } as const;
const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] as const;

const STORAGE_THEME = 'fb.theme';
const STORAGE_MODE = 'fb.mode';

export const currentThemeId = ref<string>(DEFAULT_THEME_ID);

/** Preset PrimeVue actuellement chargé (le preset initial est Aura, cf. main.ts). */
let loadedPreset: ThemePresetName = 'aura';

function palette(name: string): Record<string, string> {
  return Object.fromEntries(SHADES.map((shade) => [shade, `{${name}.${shade}}`]));
}

function safeStorage(action: () => void): void {
  try {
    action();
  } catch {
    /* stockage indisponible (navigation privée…) : le thème reste appliqué pour la session */
  }
}

export function cachedThemeId(): string | null {
  try {
    return localStorage.getItem(STORAGE_THEME);
  } catch {
    return null;
  }
}

/** Applique un thème (preset + couleurs + mode clair/sombre) sans rechargement. */
export function applyTheme(id: string | null | undefined): ThemeDef {
  const theme = findTheme(id) ?? findTheme(DEFAULT_THEME_ID)!;

  document.documentElement.classList.toggle('app-dark', theme.mode === 'dark');
  document.documentElement.style.colorScheme = theme.mode;

  if (loadedPreset !== theme.preset) {
    usePreset(PRESETS[theme.preset]);
    loadedPreset = theme.preset;
  }
  updatePrimaryPalette(palette(theme.primary));
  updateSurfacePalette({ 0: '#ffffff', ...palette(theme.surface) });

  currentThemeId.value = theme.id;
  safeStorage(() => {
    localStorage.setItem(STORAGE_THEME, theme.id);
    localStorage.setItem(STORAGE_MODE, theme.mode);
  });
  return theme;
}
