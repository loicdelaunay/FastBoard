/** Langues de l'interface. Le français est la langue source : ses textes servent de clés de traduction. */

export const LOCALES = ['fr', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'fr';

export const LOCALE_META: Record<Locale, { label: string; /** Étiquette BCP 47 pour `Intl`. */ intl: string }> = {
  fr: { label: 'Français', intl: 'fr-FR' },
  en: { label: 'English', intl: 'en-GB' },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}
