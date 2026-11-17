/**
 * Modèles de notes d'un espace de documentation. Comme dans Obsidian, un modèle est une note dont les variables
 * `{{title}}`, `{{date}}` et `{{time}}` sont remplacées à la création : `{{date:DD/MM/YYYY}}` choisit le format (celui de
 * Moment.js : `YYYY`, `MM`, `DD`, `dddd`, `HH`, `mm`…, le texte entre crochets restant tel quel).
 */

export interface DocTemplateValues {
  /** Titre de la note créée. */
  title: string;
  /** Personne qui crée la note. */
  author?: string;
  now?: Date;
  /** Langue des noms de mois et de jours. */
  locale?: string;
}

/** Variables reconnues, et leurs synonymes français. */
export const DOC_TEMPLATE_VARIABLES = [
  { name: '{{title}}', aliases: ['{{titre}}'], description: 'Titre de la note' },
  { name: '{{date}}', aliases: ['{{date:DD/MM/YYYY}}'], description: 'Date du jour (AAAA-MM-JJ, ou au format donné)' },
  { name: '{{time}}', aliases: ['{{heure}}'], description: 'Heure (HH:mm, ou au format donné)' },
  { name: '{{author}}', aliases: ['{{auteur}}'], description: 'Personne qui crée la note' },
] as const;

const pad = (value: number, size = 2): string => String(value).padStart(size, '0');

function names(locale: string, options: Intl.DateTimeFormatOptions, date: Date): string {
  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return new Intl.DateTimeFormat('fr', options).format(date);
  }
}

/** Date mise en forme avec les jetons de Moment.js les plus courants. */
export function formatTemplateDate(date: Date, format: string, locale = 'fr'): string {
  return format.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|s|A|a/g, (token, literal?: string) => {
    if (literal !== undefined) return literal;
    switch (token) {
      case 'YYYY':
        return String(date.getFullYear());
      case 'YY':
        return pad(date.getFullYear() % 100);
      case 'MMMM':
        return names(locale, { month: 'long' }, date);
      case 'MMM':
        return names(locale, { month: 'short' }, date);
      case 'MM':
        return pad(date.getMonth() + 1);
      case 'M':
        return String(date.getMonth() + 1);
      case 'DD':
        return pad(date.getDate());
      case 'D':
        return String(date.getDate());
      case 'dddd':
        return names(locale, { weekday: 'long' }, date);
      case 'ddd':
        return names(locale, { weekday: 'short' }, date);
      case 'HH':
        return pad(date.getHours());
      case 'H':
        return String(date.getHours());
      case 'hh':
        return pad(date.getHours() % 12 || 12);
      case 'h':
        return String(date.getHours() % 12 || 12);
      case 'mm':
        return pad(date.getMinutes());
      case 'm':
        return String(date.getMinutes());
      case 'ss':
        return pad(date.getSeconds());
      case 's':
        return String(date.getSeconds());
      case 'A':
        return date.getHours() < 12 ? 'AM' : 'PM';
      default:
        return date.getHours() < 12 ? 'am' : 'pm';
    }
  });
}

/** Texte d'un modèle, variables remplacées ; les variables inconnues restent telles quelles (autres extensions). */
export function applyDocTemplate(text: string, values: DocTemplateValues): string {
  const now = values.now ?? new Date();
  const locale = values.locale ?? 'fr';
  return text.replace(/\{\{\s*([a-zA-Zéè]+)\s*(?::([^}]*))?\}\}/g, (whole, rawName: string, format?: string) => {
    const name = rawName.toLowerCase();
    if (name === 'title' || name === 'titre') return values.title;
    if (name === 'author' || name === 'auteur') return values.author ?? '';
    if (name === 'date') return formatTemplateDate(now, format?.trim() || 'YYYY-MM-DD', locale);
    if (name === 'time' || name === 'heure') return formatTemplateDate(now, format?.trim() || 'HH:mm', locale);
    return whole;
  });
}
