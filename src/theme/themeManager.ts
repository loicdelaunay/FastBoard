import { ref } from 'vue';
import { palette, updatePrimaryPalette, updateSurfacePalette, usePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';
import Lara from '@primeuix/themes/lara';
import Material from '@primeuix/themes/material';
import Nora from '@primeuix/themes/nora';
import {
  DEFAULT_FONTS,
  DEFAULT_THEME_ID,
  EMPTY_THEME_FONTS,
  READING_WIDTHS,
  THEME_COLORS,
  findTheme,
  isCustomThemeId,
  isHexColor,
  normalizeAppearance,
  type CustomThemeDef,
  type FontSettings,
  type ReadingWidth,
  type ThemeColors,
  type ThemeFonts,
  type ThemeMode,
  type ThemePresetName,
} from '@shared/themes';

const PRESETS = { aura: Aura, lara: Lara, material: Material, nora: Nora } as const;
const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] as const;

const STORAGE_THEME = 'fb.theme';
const STORAGE_MODE = 'fb.mode';
/** Définition du thème personnalisé actif, pour l'appliquer avant la connexion (pas de flash de couleurs). */
const STORAGE_CUSTOM = 'fb.theme.custom';
const STORAGE_FONTS = 'fb.fonts';
const STORAGE_READING = 'fb.reading';

export const currentThemeId = ref<string>(DEFAULT_THEME_ID);
/** Thèmes personnalisés du compte connecté. */
export const customThemes = ref<CustomThemeDef[]>([]);
/** Le thème affiché est sombre (aperçus des tableaux blancs dessinés en sombre). */
export const darkMode = ref(false);

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

/** Variables CSS posées par les couleurs réglées du thème actif, à retirer au changement de thème. */
let paintedColors: string[] = [];

/** Couleurs réglées une à une : elles remplacent les variables de l'interface et du rendu Markdown. */
function paintColors(colors: ThemeColors): void {
  const style = document.documentElement.style;
  for (const name of paintedColors) style.removeProperty(name);
  paintedColors = [];
  for (const entry of THEME_COLORS) {
    const value = colors[entry.key];
    if (!value || !isHexColor(value)) continue;
    for (const name of entry.vars) {
      style.setProperty(name, value);
      paintedColors.push(name);
    }
  }
}

/** Change les couleurs et le mode sans rien mémoriser (sert aussi à l'aperçu d'un thème en cours d'édition). */
export function paintTheme(theme: Pick<ResolvedTheme, 'mode' | 'preset' | 'primary' | 'surface'> & { colors?: ThemeColors; fonts?: ThemeFonts }): void {
  paintColors(theme.colors ?? {});
  themeFonts = { ...EMPTY_THEME_FONTS, ...theme.fonts };
  paintFonts();
  document.documentElement.classList.toggle('app-dark', theme.mode === 'dark');
  document.documentElement.style.colorScheme = theme.mode;
  darkMode.value = theme.mode === 'dark';
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

/** Polices choisies dans « Polices », et celles du thème actif qui les remplacent. */
let userFonts: FontSettings = { ...DEFAULT_FONTS };
let themeFonts: ThemeFonts = { ...EMPTY_THEME_FONTS };

/** Variables CSS des polices, lues par la feuille de style globale (vide = police par défaut). */
function paintFonts(): void {
  const style = document.documentElement.style;
  const set = (name: string, value: string) => (value ? style.setProperty(name, value) : style.removeProperty(name));
  set('--fb-font', themeFonts.body || userFonts.body);
  set('--fb-font-heading', themeFonts.heading || userFonts.heading);
  set('--fb-font-mono', themeFonts.mono || userFonts.mono);
  set('--fb-font-doc', themeFonts.doc || userFonts.doc);
  set('--fb-font-size', userFonts.size !== DEFAULT_FONTS.size ? `${userFonts.size}px` : '');
  set('--fb-doc-size', userFonts.docSize ? `${userFonts.docSize}px` : '');
}

/** Polices de l'interface et des notes (celles d'un thème personnalisé l'emportent). */
export function applyFonts(fonts: FontSettings, persist = true): void {
  userFonts = { ...DEFAULT_FONTS, ...fonts };
  paintFonts();
  if (persist) safeStorage(() => localStorage.setItem(STORAGE_FONTS, JSON.stringify(userFonts)));
}

// --- Largeur du texte des notes --------------------------------------------------------------------------------------

export function cachedReading(): ReadingWidth {
  try {
    const value = localStorage.getItem(STORAGE_READING);
    return (READING_WIDTHS as readonly string[]).includes(value ?? '') ? (value as ReadingWidth) : 'screen';
  } catch {
    return 'screen';
  }
}

export const readingWidth = ref<ReadingWidth>('screen');

/** `screen` : texte centré sur l'écran ; `column` : dans sa colonne ; `full` : toute la largeur, sans marges. */
export function applyReading(value: ReadingWidth, persist = true): void {
  readingWidth.value = value;
  document.documentElement.dataset.reading = value;
  if (persist) safeStorage(() => localStorage.setItem(STORAGE_READING, value));
}
