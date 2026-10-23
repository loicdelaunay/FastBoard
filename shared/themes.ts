/**
 * Catalogue des thèmes. Chaque thème est soit « clair », soit « sombre » ;
 * l'utilisateur en choisit un et ce choix est mémorisé sur son compte.
 */

export type ThemeMode = 'light' | 'dark';
export type ThemePresetName = 'aura' | 'lara' | 'material' | 'nora';

export interface ThemeDef {
  id: string;
  label: string;
  mode: ThemeMode;
  preset: ThemePresetName;
  /** Nom de la palette PrimeVue utilisée comme couleur principale. */
  primary: string;
  /** Nom de la palette PrimeVue utilisée pour les surfaces (fonds, bordures…). */
  surface: string;
  /** Couleurs d'aperçu dans le sélecteur. */
  preview: { accent: string; background: string; text: string };
}

const LIGHT_PREVIEW = { background: '#f8fafc', text: '#0f172a' };
const DARK_PREVIEW = { background: '#0f172a', text: '#e2e8f0' };

export const THEMES: readonly ThemeDef[] = [
  { id: 'aura-indigo-light', label: 'Indigo', mode: 'light', preset: 'aura', primary: 'indigo', surface: 'slate', preview: { accent: '#6366f1', ...LIGHT_PREVIEW } },
  { id: 'aura-emerald-light', label: 'Émeraude', mode: 'light', preset: 'aura', primary: 'emerald', surface: 'zinc', preview: { accent: '#10b981', background: '#fafafa', text: '#18181b' } },
  { id: 'aura-rose-light', label: 'Rose', mode: 'light', preset: 'aura', primary: 'rose', surface: 'stone', preview: { accent: '#f43f5e', background: '#fafaf9', text: '#1c1917' } },
  { id: 'aura-orange-light', label: 'Orange', mode: 'light', preset: 'aura', primary: 'orange', surface: 'neutral', preview: { accent: '#f97316', background: '#fafafa', text: '#171717' } },
  { id: 'lara-blue-light', label: 'Lara bleu', mode: 'light', preset: 'lara', primary: 'blue', surface: 'slate', preview: { accent: '#3b82f6', ...LIGHT_PREVIEW } },
  { id: 'nora-violet-light', label: 'Nora violet', mode: 'light', preset: 'nora', primary: 'violet', surface: 'gray', preview: { accent: '#8b5cf6', background: '#f9fafb', text: '#111827' } },
  { id: 'material-teal-light', label: 'Material sarcelle', mode: 'light', preset: 'material', primary: 'teal', surface: 'slate', preview: { accent: '#14b8a6', ...LIGHT_PREVIEW } },

  { id: 'aura-indigo-dark', label: 'Indigo nuit', mode: 'dark', preset: 'aura', primary: 'indigo', surface: 'slate', preview: { accent: '#818cf8', ...DARK_PREVIEW } },
  { id: 'aura-emerald-dark', label: 'Émeraude nuit', mode: 'dark', preset: 'aura', primary: 'emerald', surface: 'zinc', preview: { accent: '#34d399', background: '#09090b', text: '#e4e4e7' } },
  { id: 'aura-rose-dark', label: 'Rose nuit', mode: 'dark', preset: 'aura', primary: 'rose', surface: 'stone', preview: { accent: '#fb7185', background: '#0c0a09', text: '#e7e5e4' } },
  { id: 'aura-sky-dark', label: 'Ciel nuit', mode: 'dark', preset: 'aura', primary: 'sky', surface: 'slate', preview: { accent: '#38bdf8', background: '#020617', text: '#e2e8f0' } },
  { id: 'aura-obsidian-dark', label: 'Obsidienne', mode: 'dark', preset: 'aura', primary: 'amber', surface: 'neutral', preview: { accent: '#fbbf24', background: '#0a0a0a', text: '#e5e5e5' } },
  { id: 'lara-blue-dark', label: 'Lara bleu nuit', mode: 'dark', preset: 'lara', primary: 'blue', surface: 'slate', preview: { accent: '#60a5fa', ...DARK_PREVIEW } },
  { id: 'nora-violet-dark', label: 'Nora violet nuit', mode: 'dark', preset: 'nora', primary: 'violet', surface: 'gray', preview: { accent: '#a78bfa', background: '#030712', text: '#e5e7eb' } },
];

export const DEFAULT_THEME_ID = 'aura-indigo-light';

export function findTheme(id: string | null | undefined): ThemeDef | undefined {
  return THEMES.find((theme) => theme.id === id);
}

export function isThemeId(id: unknown): id is string {
  return typeof id === 'string' && THEMES.some((theme) => theme.id === id);
}

// --- Thèmes et polices personnalisés (enregistrés sur le compte) ------------------------------------------------------

export const THEME_PRESETS: readonly ThemePresetName[] = ['aura', 'lara', 'material', 'nora'];
/** Palettes PrimeVue proposées pour les surfaces (ou une couleur #RRGGBB). */
export const SURFACE_PALETTES = ['slate', 'gray', 'zinc', 'neutral', 'stone'] as const;
/** Teintes claire (50) et sombre (950) des palettes de surface, pour les aperçus. */
export const SURFACE_SWATCHES: Record<(typeof SURFACE_PALETTES)[number], { light: string; dark: string }> = {
  slate: { light: '#f8fafc', dark: '#020617' },
  gray: { light: '#f9fafb', dark: '#030712' },
  zinc: { light: '#fafafa', dark: '#09090b' },
  neutral: { light: '#fafafa', dark: '#0a0a0a' },
  stone: { light: '#fafaf9', dark: '#0c0a09' },
};

export interface CustomThemeDef {
  /** `custom-…` */
  id: string;
  label: string;
  mode: ThemeMode;
  preset: ThemePresetName;
  /** Couleur principale #RRGGBB (les nuances sont calculées). */
  primary: string;
  /** Palette de surface (`slate`…) ou couleur #RRGGBB. */
  surface: string;
}

/** Polices de l'interface : pile CSS (`''` = police par défaut) et taille de base en pixels. */
export interface FontSettings {
  body: string;
  heading: string;
  mono: string;
  size: number;
}

export interface AppearanceDTO {
  customThemes: CustomThemeDef[];
  fonts: FontSettings;
}

export const APPEARANCE_LIMITS = { themes: 20, labelMax: 40, fontMax: 200, sizeMin: 12, sizeMax: 20 };
export const DEFAULT_FONTS: FontSettings = { body: '', heading: '', mono: '', size: 15 };

/** Polices proposées (celles du système ; « Autre » permet de saisir une police installée sur le poste). */
export const FONT_CHOICES: ReadonlyArray<{ value: string; label: string; kind: 'sans' | 'serif' | 'mono' }> = [
  { value: "'Segoe UI', system-ui, sans-serif", label: 'Segoe UI', kind: 'sans' },
  { value: "Inter, 'Segoe UI', system-ui, sans-serif", label: 'Inter', kind: 'sans' },
  { value: "Roboto, 'Segoe UI', system-ui, sans-serif", label: 'Roboto', kind: 'sans' },
  { value: "Arial, 'Helvetica Neue', Helvetica, sans-serif", label: 'Arial', kind: 'sans' },
  { value: 'Verdana, Geneva, sans-serif', label: 'Verdana', kind: 'sans' },
  { value: "Tahoma, 'Segoe UI', sans-serif", label: 'Tahoma', kind: 'sans' },
  { value: "'Trebuchet MS', 'Segoe UI', sans-serif", label: 'Trebuchet MS', kind: 'sans' },
  { value: "Calibri, Carlito, 'Segoe UI', sans-serif", label: 'Calibri', kind: 'sans' },
  { value: "Georgia, 'Times New Roman', serif", label: 'Georgia', kind: 'serif' },
  { value: "'Palatino Linotype', Palatino, 'Book Antiqua', serif", label: 'Palatino', kind: 'serif' },
  { value: "'Times New Roman', Times, serif", label: 'Times New Roman', kind: 'serif' },
  { value: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace", label: 'Cascadia Code', kind: 'mono' },
  { value: "Consolas, 'Courier New', monospace", label: 'Consolas', kind: 'mono' },
  { value: "'JetBrains Mono', 'Fira Code', Consolas, monospace", label: 'JetBrains Mono', kind: 'mono' },
  { value: "'Courier New', Courier, monospace", label: 'Courier New', kind: 'mono' },
];

export const isHexColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
/** Pile de polices sûre : noms, espaces, virgules, guillemets et tirets seulement. */
export const isFontFamily = (value: unknown): value is string => typeof value === 'string' && value.length <= APPEARANCE_LIMITS.fontMax && /^[\p{L}\p{N} ,'"._-]*$/u.test(value);

export function isCustomThemeId(id: unknown): id is string {
  return typeof id === 'string' && /^custom-[a-z0-9]{4,24}$/.test(id);
}

export function normalizeAppearance(raw: unknown): AppearanceDTO {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const customThemes: CustomThemeDef[] = [];
  for (const entry of Array.isArray(source.customThemes) ? source.customThemes : []) {
    const theme = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    if (!isCustomThemeId(theme.id) || seen.has(theme.id) || !isHexColor(theme.primary)) continue;
    const surface = typeof theme.surface === 'string' && ((SURFACE_PALETTES as readonly string[]).includes(theme.surface) || isHexColor(theme.surface)) ? theme.surface : 'slate';
    seen.add(theme.id);
    customThemes.push({
      id: theme.id,
      label: (typeof theme.label === 'string' ? theme.label.trim().slice(0, APPEARANCE_LIMITS.labelMax) : '') || 'Mon thème',
      mode: theme.mode === 'dark' ? 'dark' : 'light',
      preset: (THEME_PRESETS as readonly unknown[]).includes(theme.preset) ? (theme.preset as ThemePresetName) : 'aura',
      primary: theme.primary,
      surface,
    });
    if (customThemes.length >= APPEARANCE_LIMITS.themes) break;
  }
  const fontsSource = (source.fonts && typeof source.fonts === 'object' ? source.fonts : {}) as Record<string, unknown>;
  const font = (key: 'body' | 'heading' | 'mono') => (isFontFamily(fontsSource[key]) ? (fontsSource[key] as string).trim() : '');
  const size = typeof fontsSource.size === 'number' && Number.isInteger(fontsSource.size) ? Math.min(APPEARANCE_LIMITS.sizeMax, Math.max(APPEARANCE_LIMITS.sizeMin, fontsSource.size)) : DEFAULT_FONTS.size;
  return { customThemes, fonts: { body: font('body'), heading: font('heading'), mono: font('mono'), size } };
}
