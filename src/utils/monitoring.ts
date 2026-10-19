import type { MonitoringRange } from '@shared/monitoring';
import { intlLocale, t } from '@/i18n';

/** « 12 ms », « 1,4 s » */
export function formatMs(ms: number): string {
  if (ms < 1) {
    return `${ms.toLocaleString(intlLocale(), { maximumFractionDigits: 2 })} ms`;
  }
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  return `${(ms / 1000).toLocaleString(intlLocale(), { maximumFractionDigits: 1 })} ${t('s')}`;
}

export function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString(intlLocale(), { maximumFractionDigits: digits });
}

/** « 3 j 4 h », « 12 min », « 45 s » */
export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} ${t('j')} ${hours} ${t('h')}`;
  if (hours > 0) return `${hours} ${t('h')} ${minutes} min`;
  if (minutes > 0) return `${minutes} min`;
  return `${seconds} ${t('s')}`;
}

export function formatMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toLocaleString(intlLocale(), { maximumFractionDigits: 1 })} ${t('Go')}` : `${formatNumber(mb, mb < 10 ? 1 : 0)} ${t('Mo')}`;
}

const timeFormat = new Intl.DateTimeFormat(intlLocale(), { hour: '2-digit', minute: '2-digit' });
const dayTimeFormat = new Intl.DateTimeFormat(intlLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Libellé d'un point de courbe : l'heure, accompagnée de la date quand la fenêtre dépasse 24 h. */
export function pointLabel(timestamp: number, range: MonitoringRange): string {
  const date = new Date(timestamp);
  return range === '3d' || range === '24h' ? dayTimeFormat.format(date) : timeFormat.format(date);
}

const logTimeFormat = new Intl.DateTimeFormat(intlLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const logDayFormat = new Intl.DateTimeFormat(intlLocale(), { day: '2-digit', month: 'short' });

export function logTime(iso: string): string {
  return logTimeFormat.format(new Date(iso));
}

export function logDay(iso: string): string {
  return logDayFormat.format(new Date(iso));
}
