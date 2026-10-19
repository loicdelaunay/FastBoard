import { intlLocale, t } from '@/i18n';
const relativeFormat = new Intl.RelativeTimeFormat(intlLocale(), { numeric: 'auto' });
const dateTimeFormat = new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' });

/** « il y a 5 minutes », « hier »… */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) {
    return t("à l'instant");
  }
  if (abs < 3600) {
    return relativeFormat.format(Math.round(seconds / 60), 'minute');
  }
  if (abs < 86_400) {
    return relativeFormat.format(Math.round(seconds / 3600), 'hour');
  }
  if (abs < 86_400 * 30) {
    return relativeFormat.format(Math.round(seconds / 86_400), 'day');
  }
  return dateTimeFormat.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}
