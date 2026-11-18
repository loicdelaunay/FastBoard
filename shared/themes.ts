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

/**
 * Couleurs réglables une à une dans un thème personnalisé : celles de l'interface et celles du rendu Markdown (notes,
 * descriptions, commentaires). Chacune remplace une variable CSS ; absente, la couleur du thème de base s'applique.
 */
export const THEME_COLORS = [
  { key: 'background', group: 'interface', label: 'Fond de page', vars: ['--fb-bg'] },
  { key: 'panel', group: 'interface', label: 'Panneaux et cartes', vars: ['--fb-panel', '--p-content-background'] },
  { key: 'panelAlt', group: 'interface', label: 'Panneaux secondaires', vars: ['--fb-panel-alt'] },
  { key: 'border', group: 'interface', label: 'Bordures', vars: ['--fb-border', '--p-content-border-color'] },
  { key: 'text', group: 'interface', label: 'Texte', vars: ['--fb-text', '--p-text-color'] },
  { key: 'muted', group: 'interface', label: 'Texte secondaire', vars: ['--fb-muted', '--p-text-muted-color'] },
  { key: 'mdText', group: 'markdown', label: 'Texte des notes', vars: ['--md-text'] },
  { key: 'mdH1', group: 'markdown', label: 'Titre 1', vars: ['--md-h1'] },
  { key: 'mdH2', group: 'markdown', label: 'Titre 2', vars: ['--md-h2'] },
  { key: 'mdH3', group: 'markdown', label: 'Titre 3', vars: ['--md-h3'] },
  { key: 'mdH4', group: 'markdown', label: 'Titres 4 à 6', vars: ['--md-h4'] },
  { key: 'mdBold', group: 'markdown', label: 'Gras', vars: ['--md-strong'] },
  { key: 'mdItalic', group: 'markdown', label: 'Italique', vars: ['--md-em'] },
  { key: 'mdLink', group: 'markdown', label: 'Liens', vars: ['--md-link'] },
  { key: 'mdCode', group: 'markdown', label: 'Code dans le texte', vars: ['--md-code'] },
  { key: 'mdCodeBg', group: 'markdown', label: 'Fond du code dans le texte', vars: ['--md-code-bg'] },
  { key: 'mdPre', group: 'markdown', label: 'Texte des blocs de code', vars: ['--md-pre'] },
  { key: 'mdPreBg', group: 'markdown', label: 'Fond des blocs de code', vars: ['--md-pre-bg'] },
  { key: 'mdQuote', group: 'markdown', label: 'Texte des citations', vars: ['--md-quote'] },
  { key: 'mdQuoteBar', group: 'markdown', label: 'Barre des citations', vars: ['--md-quote-bar'] },
  { key: 'mdQuoteBg', group: 'markdown', label: 'Fond des citations', vars: ['--md-quote-bg'] },
  { key: 'mdHighlight', group: 'markdown', label: 'Surlignage', vars: ['--md-highlight'] },
  { key: 'mdTableHead', group: 'markdown', label: 'En-tête des tableaux', vars: ['--md-th-bg'] },
  { key: 'mdTableBorder', group: 'markdown', label: 'Bordures des tableaux', vars: ['--md-table-border'] },
  { key: 'mdRule', group: 'markdown', label: 'Lignes horizontales', vars: ['--md-hr'] },
  { key: 'mdMarker', group: 'markdown', label: 'Puces et numéros', vars: ['--md-marker'] },
  { key: 'mdTag', group: 'markdown', label: 'Étiquettes', vars: ['--md-tag'] },
] as const;

export type ThemeColorKey = (typeof THEME_COLORS)[number]['key'];
export type ThemeColors = Partial<Record<ThemeColorKey, string>>;

/** Polices propres à un thème (`''` : celles choisies dans « Polices » s'appliquent). */
export interface ThemeFonts {
  body: string;
  heading: string;
  mono: string;
  /** Texte des notes. */
  doc: string;
}

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
  /** Couleurs réglées une à une (les autres viennent du thème de base). */
  colors: ThemeColors;
  fonts: ThemeFonts;
}

/** Polices de l'interface : pile CSS (`''` = police par défaut) et taille de base en pixels. */
export interface FontSettings {
  body: string;
  heading: string;
  mono: string;
  size: number;
  /** Texte des notes (`''` : comme le texte de l'interface). */
  doc: string;
  /** Taille du texte des notes en pixels (0 : comme l'interface). */
  docSize: number;
}

/**
 * Largeur du texte des notes : `screen` centré sur l'écran (pour lire sans tourner la tête), `column` centré dans sa
 * colonne, `full` sans marges sur les côtés.
 */
export const READING_WIDTHS = ['screen', 'column', 'full'] as const;
export type ReadingWidth = (typeof READING_WIDTHS)[number];

export interface AppearanceDTO {
  customThemes: CustomThemeDef[];
  fonts: FontSettings;
  reading: ReadingWidth;
}

export const APPEARANCE_LIMITS = { themes: 20, labelMax: 40, fontMax: 200, sizeMin: 12, sizeMax: 20, docSizeMin: 12, docSizeMax: 26 };
export const DEFAULT_FONTS: FontSettings = { body: '', heading: '', mono: '', size: 15, doc: '', docSize: 0 };
export const EMPTY_THEME_FONTS: ThemeFonts = { body: '', heading: '', mono: '', doc: '' };

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

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});
const fontOf = (source: Record<string, unknown>, key: string): string => (isFontFamily(source[key]) ? (source[key] as string).trim() : '');

/** Couleurs réglées d'un thème : seules les clés connues, en #RRGGBB. */
export function normalizeThemeColors(raw: unknown): ThemeColors {
  const source = asRecord(raw);
  const colors: ThemeColors = {};
  for (const { key } of THEME_COLORS) {
    if (isHexColor(source[key])) colors[key] = (source[key] as string).toLowerCase();
  }
  return colors;
}

/** Un thème personnalisé lu d'ailleurs (compte, fichier importé, bibliothèque partagée), ou `null` s'il est invalide. */
export function normalizeCustomTheme(raw: unknown, id?: string): CustomThemeDef | null {
  const theme = asRecord(raw);
  const themeId = id ?? theme.id;
  if (!isCustomThemeId(themeId) || !isHexColor(theme.primary)) return null;
  const surface = typeof theme.surface === 'string' && ((SURFACE_PALETTES as readonly string[]).includes(theme.surface) || isHexColor(theme.surface)) ? theme.surface : 'slate';
  const fonts = asRecord(theme.fonts);
  return {
    id: themeId,
    label: (typeof theme.label === 'string' ? theme.label.trim().slice(0, APPEARANCE_LIMITS.labelMax) : '') || 'Mon thème',
    mode: theme.mode === 'dark' ? 'dark' : 'light',
    preset: (THEME_PRESETS as readonly unknown[]).includes(theme.preset) ? (theme.preset as ThemePresetName) : 'aura',
    primary: theme.primary.toLowerCase(),
    surface,
    colors: normalizeThemeColors(theme.colors),
    fonts: { body: fontOf(fonts, 'body'), heading: fontOf(fonts, 'heading'), mono: fontOf(fonts, 'mono'), doc: fontOf(fonts, 'doc') },
  };
}

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => (typeof value === 'number' && Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback);

export function normalizeAppearance(raw: unknown): AppearanceDTO {
  const source = asRecord(raw);
  const seen = new Set<string>();
  const customThemes: CustomThemeDef[] = [];
  for (const entry of Array.isArray(source.customThemes) ? source.customThemes : []) {
    const theme = normalizeCustomTheme(entry);
    if (!theme || seen.has(theme.id)) continue;
    seen.add(theme.id);
    customThemes.push(theme);
    if (customThemes.length >= APPEARANCE_LIMITS.themes) break;
  }
  const fontsSource = asRecord(source.fonts);
  const size = clampInt(fontsSource.size, APPEARANCE_LIMITS.sizeMin, APPEARANCE_LIMITS.sizeMax, DEFAULT_FONTS.size);
  const docSize = fontsSource.docSize === 0 ? 0 : clampInt(fontsSource.docSize, APPEARANCE_LIMITS.docSizeMin, APPEARANCE_LIMITS.docSizeMax, 0);
  const reading = (READING_WIDTHS as readonly unknown[]).includes(source.reading) ? (source.reading as ReadingWidth) : 'screen';
  return {
    customThemes,
    fonts: { body: fontOf(fontsSource, 'body'), heading: fontOf(fontsSource, 'heading'), mono: fontOf(fontsSource, 'mono'), size, doc: fontOf(fontsSource, 'doc'), docSize },
    reading,
  };
}

// --- Partage d'un thème : fichier exporté, bibliothèque du site ------------------------------------------------------

export const THEME_FILE_FORMAT = 'fastboard-theme';

/** Ce qu'on exporte d'un thème : tout sauf son identifiant, propre au compte. */
export function themeFile(theme: CustomThemeDef): { format: string; version: 1; theme: Omit<CustomThemeDef, 'id'> } {
  const { id: _id, ...rest } = theme;
  return { format: THEME_FILE_FORMAT, version: 1, theme: rest };
}

/** Thème lu dans un fichier exporté (ou son seul contenu), avec l'identifiant donné ; `null` s'il est invalide. */
export function parseThemeFile(raw: unknown, id: string): CustomThemeDef | null {
  const source = asRecord(raw);
  return normalizeCustomTheme(source.format === THEME_FILE_FORMAT ? source.theme : source, id);
}

/** Thème publié dans la bibliothèque du site, que chacun peut ajouter à ses thèmes. */
export interface SharedThemeDTO {
  id: string;
  theme: Omit<CustomThemeDef, 'id'>;
  authorId: number | null;
  authorName: string;
  createdAt: string;
}

export const SHARED_THEMES_MAX = 200;
