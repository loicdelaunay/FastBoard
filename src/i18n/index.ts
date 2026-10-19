import { DEFAULT_LOCALE, LOCALE_META, isLocale, type Locale } from '@shared/locales';
import { setDateLocale } from '@shared/dates';
import { en } from './en';

/**
 * Traduction : le français est la langue source, ses textes servent de clés. Un texte absent du catalogue de la langue
 * choisie s'affiche donc tel quel (en français) au lieu de disparaître.
 *
 * - Variables : `t('Bonjour {name}', { name })`.
 * - Pluriel : `t('{n} ticket|{n} tickets', { n })` — la forme est choisie selon la règle de la langue.
 * Changer de langue recharge la page : les textes sont lus une fois, sans état réactif à maintenir.
 */

const STORAGE_KEY = 'fb.locale';
const CATALOGS: Record<Locale, Record<string, string>> = { fr: {}, en };

function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) {
      return stored;
    }
  } catch {
    /* stockage indisponible */
  }
  const preferred = typeof navigator !== 'undefined' ? navigator.languages?.[0] ?? navigator.language : '';
  return preferred?.toLowerCase().startsWith('en') ? 'en' : DEFAULT_LOCALE;
}

let current: Locale = detectLocale();
setDateLocale(current);
if (typeof document !== 'undefined') {
  document.documentElement.lang = current;
}

export function currentLocale(): Locale {
  return current;
}

/** Étiquette BCP 47 pour `Intl` (`fr-FR`, `en-GB`). */
export function intlLocale(): string {
  return LOCALE_META[current].intl;
}

/** Mémorise la langue sur cet appareil (le compte la conserve en plus, voir le profil). */
export function rememberLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* stockage indisponible */
  }
}

/** Applique une langue sans recharger (démarrage) ; renvoie `true` si elle a changé. */
export function useLocale(locale: Locale): boolean {
  if (locale === current) {
    return false;
  }
  current = locale;
  rememberLocale(locale);
  setDateLocale(locale);
  document.documentElement.lang = locale;
  return true;
}

type Params = Record<string, string | number | boolean | null | undefined>;

function interpolate(text: string, params?: Params): string {
  if (!params) {
    return text;
  }
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name] ?? '') : match));
}

export function t(key: string, params?: Params): string {
  let text = CATALOGS[current][key] ?? key;
  if (params && typeof params.n === 'number' && text.includes('|')) {
    const [one, other] = text.split('|') as [string, string | undefined];
    text = new Intl.PluralRules(intlLocale()).select(params.n) === 'one' || other === undefined ? one : other;
  }
  return interpolate(text, params);
}

/** Vrai si une traduction existe pour ce texte dans la langue courante (ou si la langue est la langue source). */
export function hasTranslation(key: string): boolean {
  return current === DEFAULT_LOCALE || key in CATALOGS[current];
}
