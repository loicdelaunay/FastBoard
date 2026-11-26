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
  paintThemeColor();
}

let themeColorFrame = 0;
/** Couleur de la barre de titre de l'application installée (et de la barre du navigateur sur mobile) : le fond de la page. */
function paintThemeColor(): void {
  cancelAnimationFrame(themeColorFrame);
  // Les couleurs de PrimeVue arrivent par une feuille de style : on lit le fond une fois la page repeinte.
  themeColorFrame = requestAnimationFrame(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const color = getComputedStyle(document.body).backgroundColor;
    if (meta && color && color !== 'rgba(0, 0, 0, 0)') meta.content = color;
  });
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

// --- Un thème sur une partie de la page ------------------------------------------------------------------------------

/** Variables d'un thème à poser sur un élément : il s'y dessine à ses couleurs, sans changer le thème de la page. */
export interface ThemeScope {
  id: string;
  dark: boolean;
  vars: Record<string, string>;
}

interface PresetTokens {
  primitive: Record<string, Record<string, string> | undefined>;
  semantic: { colorScheme: Record<ThemeMode, { primary: { color: string }; content: { background: string; borderColor: string }; text: { color: string; mutedColor: string } }> };
}

/**
 * Couleurs et polices d'un thème (prédéfini ou personnalisé), résolues une à une d'après son preset PrimeVue : celles que
 * lisent l'interface (`--fb-*`) et PrimeVue (`--p-*`). Sert à dessiner un tableau blanc dans un autre thème que celui de
 * la page (export) ; la page, elle, reçoit ces couleurs de PrimeVue par `paintTheme`.
 */
export function themeScope(id: string | null | undefined): ThemeScope {
  const theme = resolve(id);
  const preset = PRESETS[theme.preset] as unknown as PresetTokens;
  const dark = theme.mode === 'dark';
  const scheme = preset.semantic.colorScheme[theme.mode];
  const named = (color: string): Record<string, string> => (isHexColor(color) ? (palette(color) as unknown as Record<string, string>) : (preset.primitive[color] ?? {}));
  const primary = named(theme.primary);
  const surface: Record<string, string> = { 0: '#ffffff', ...named(theme.surface) };
  /** `{surface.700}`, `{primary.500}`, `{slate.50}`… : la couleur que le jeton désigne. */
  const token = (value: string | undefined, depth = 0): string => {
    const match = /^\{([\w-]+)\.([\w-]+)\}$/.exec(value ?? '');
    if (!match || depth > 6) return value ?? '';
    const next = match[1] === 'primary' ? primary[match[2]!] : match[1] === 'surface' ? surface[match[2]!] : preset.primitive[match[1]!]?.[match[2]!];
    return next ? token(next, depth + 1) : '';
  };

  const accent = token(scheme.primary.color);
  const panel = token(scheme.content.background);
  const border = token(scheme.content.borderColor);
  const text = token(scheme.text.color);
  const muted = token(scheme.text.mutedColor);
  const vars: Record<string, string> = {
    '--p-primary-color': accent,
    '--p-content-background': panel,
    '--p-content-border-color': border,
    '--p-text-color': text,
    '--p-text-muted-color': muted,
    '--p-surface-0': surface[0]!,
    '--fb-bg': token(surface[dark ? '950' : '50']),
    '--fb-panel': panel,
    '--fb-panel-alt': token(surface[dark ? '800' : '100']),
    '--fb-border': border,
    '--fb-text': text,
    '--fb-muted': muted,
    '--fb-accent': accent,
    '--fb-accent-soft': `color-mix(in srgb, ${accent} 12%, transparent)`,
    '--fb-shadow': dark ? '0 1px 2px rgb(0 0 0 / 30%)' : '0 1px 2px rgb(15 23 42 / 6%), 0 1px 3px rgb(15 23 42 / 8%)',
    '--fb-shadow-lg': dark ? '0 8px 24px rgb(0 0 0 / 45%)' : '0 8px 24px rgb(15 23 42 / 14%)',
  };
  for (const shade of SHADES) {
    vars[`--p-primary-${shade}`] = token(primary[shade]);
    vars[`--p-surface-${shade}`] = token(surface[shade]);
  }
  // Couleurs réglées une à une par un thème personnalisé ; les autres reviennent à celles du thème (pas à celles de la page).
  for (const entry of THEME_COLORS) {
    const value = theme.custom?.colors[entry.key];
    for (const name of entry.vars) {
      if (value && isHexColor(value)) vars[name] = value;
      else if (!(name in vars)) vars[name] = 'initial';
    }
  }
  const fonts = { ...EMPTY_THEME_FONTS, ...theme.custom?.fonts };
  vars['--fb-font'] = fonts.body || userFonts.body || 'initial';
  vars['--fb-font-heading'] = fonts.heading || userFonts.heading || 'initial';
  vars['--fb-font-mono'] = fonts.mono || userFonts.mono || 'initial';
  for (const name of Object.keys(vars)) if (!vars[name]) delete vars[name];
  return { id: theme.id, dark, vars };
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

/**
 * Correcteur orthographique du navigateur (préférence du compte) : posé sur la page, il vaut pour toutes les zones
 * d'écriture qui ne le règlent pas elles-mêmes ; l'éditeur des notes et le tableau blanc le suivent aussi.
 */
export const spellcheck = ref(true);
export function applySpellcheck(enabled: boolean): void {
  spellcheck.value = enabled;
  document.documentElement.spellcheck = enabled;
}

/** `screen` : texte centré sur l'écran ; `column` : dans sa colonne ; `full` : toute la largeur, sans marges. */
export function applyReading(value: ReadingWidth, persist = true): void {
  readingWidth.value = value;
  document.documentElement.dataset.reading = value;
  if (persist) safeStorage(() => localStorage.setItem(STORAGE_READING, value));
}
