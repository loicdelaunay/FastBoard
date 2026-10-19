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
