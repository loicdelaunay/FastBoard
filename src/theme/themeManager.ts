import { ref } from 'vue';
import { palette, updatePrimaryPalette, updateSurfacePalette, usePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';
import Lara from '@primeuix/themes/lara';
import Material from '@primeuix/themes/material';
import Nora from '@primeuix/themes/nora';
import { DEFAULT_FONTS, DEFAULT_THEME_ID, findTheme, isCustomThemeId, isHexColor, normalizeAppearance, type CustomThemeDef, type FontSettings, type ThemeMode, type ThemePresetName } from '@shared/themes';

const PRESETS = { aura: Aura, lara: Lara, material: Material, nora: Nora } as const;
const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] as const;

const STORAGE_THEME = 'fb.theme';
const STORAGE_MODE = 'fb.mode';
/** Définition du thème personnalisé actif, pour l'appliquer avant la connexion (pas de flash de couleurs). */
const STORAGE_CUSTOM = 'fb.theme.custom';
const STORAGE_FONTS = 'fb.fonts';

export const currentThemeId = ref<string>(DEFAULT_THEME_ID);
/** Thèmes personnalisés du compte connecté. */
export const customThemes = ref<CustomThemeDef[]>([]);

/** Preset PrimeVue actuellement chargé (le preset initial est Aura, cf. main.ts). */
let loadedPreset: ThemePresetName = 'aura';

/** Nuances d'une palette PrimeVue nommée (`indigo`), ou calculées depuis une couleur #RRGGBB. */
function shades(color: string): Record<string, string> {
  if (isHexColor(color)) return palette(color) as unknown as Record<string, string>;
  return Object.fromEntries(SHADES.map((shade) => [shade, `{${color}.${shade}}`]));
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

function cachedCustom(): CustomThemeDef | null {
  try {
    const raw = localStorage.getItem(STORAGE_CUSTOM);
    return raw ? (normalizeAppearance({ customThemes: [JSON.parse(raw)] }).customThemes[0] ?? null) : null;
  } catch {
    return null;
  }
}

interface ResolvedTheme {
  id: string;
  mode: ThemeMode;
  preset: ThemePresetName;
  primary: string;
  surface: string;
  custom: CustomThemeDef | null;
}

function resolve(id: string | null | undefined): ResolvedTheme {
  const builtin = findTheme(id);
  if (builtin) return { id: builtin.id, mode: builtin.mode, preset: builtin.preset, primary: builtin.primary, surface: builtin.surface, custom: null };
  if (isCustomThemeId(id)) {
    const custom = customThemes.value.find((theme) => theme.id === id) ?? (cachedCustom()?.id === id ? cachedCustom() : null);
    if (custom) return { ...custom, custom };
  }
  const fallback = findTheme(DEFAULT_THEME_ID)!;
  return { id: fallback.id, mode: fallback.mode, preset: fallback.preset, primary: fallback.primary, surface: fallback.surface, custom: null };
}

/** Change les couleurs et le mode sans rien mémoriser (sert aussi à l'aperçu d'un thème en cours d'édition). */
export function paintTheme(theme: Pick<ResolvedTheme, 'mode' | 'preset' | 'primary' | 'surface'>): void {
  document.documentElement.classList.toggle('app-dark', theme.mode === 'dark');
  document.documentElement.style.colorScheme = theme.mode;
  if (loadedPreset !== theme.preset) {
    usePreset(PRESETS[theme.preset]);
    loadedPreset = theme.preset;
  }
  updatePrimaryPalette(shades(theme.primary));
  updateSurfacePalette({ 0: '#ffffff', ...shades(theme.surface) });
}

/** Applique un thème prédéfini ou personnalisé (preset + couleurs + mode clair/sombre) sans rechargement. */
export function applyTheme(id: string | null | undefined): string {
  const theme = resolve(id);
  paintTheme(theme);
  currentThemeId.value = theme.id;
  safeStorage(() => {
    localStorage.setItem(STORAGE_THEME, theme.id);
    localStorage.setItem(STORAGE_MODE, theme.mode);
    if (theme.custom) localStorage.setItem(STORAGE_CUSTOM, JSON.stringify(theme.custom));
    else localStorage.removeItem(STORAGE_CUSTOM);
  });
  return theme.id;
}

// --- Polices ---------------------------------------------------------------------------------------------------------

export function cachedFonts(): FontSettings {
  try {
    return normalizeAppearance({ fonts: JSON.parse(localStorage.getItem(STORAGE_FONTS) ?? '{}') }).fonts;
  } catch {
    return { ...DEFAULT_FONTS };
  }
}

/** Polices de l'interface : variables CSS lues par la feuille de style globale (vide = police par défaut). */
export function applyFonts(fonts: FontSettings, persist = true): void {
  const style = document.documentElement.style;
  const set = (name: string, value: string) => (value ? style.setProperty(name, value) : style.removeProperty(name));
  set('--fb-font', fonts.body);
  set('--fb-font-heading', fonts.heading);
  set('--fb-font-mono', fonts.mono);
  set('--fb-font-size', fonts.size !== DEFAULT_FONTS.size ? `${fonts.size}px` : '');
  if (persist) safeStorage(() => localStorage.setItem(STORAGE_FONTS, JSON.stringify(fonts)));
}
