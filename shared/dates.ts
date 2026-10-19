/**
 * Utilitaires de dates « jour calendaire » (chaînes `YYYY-MM-DD`).
 * Tous les calculs passent par un numéro de jour UTC pour éviter les décalages de fuseau horaire / heure d'été.
 */

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isISODate(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const match = ISO_DATE.exec(value);
  if (!match) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Numéro de jour (jours depuis 1970-01-01 UTC). */
export function toDayNumber(iso: string): number {
  const match = ISO_DATE.exec(iso);
  if (!match) {
    return Number.NaN;
  }
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS);
}

export function fromDayNumber(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return fromDayNumber(toDayNumber(iso) + days);
}

/** Nombre de jours entre deux dates (fin − début). */
export function diffDays(startIso: string, endIso: string): number {
  return toDayNumber(endIso) - toDayNumber(startIso);
}

/** Date locale du jour au format ISO. */
export function todayISO(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Jour de la semaine ISO : 1 = lundi … 7 = dimanche. */
export function isoWeekday(day: number): number {
  const weekday = new Date(day * DAY_MS).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** Numéro de semaine ISO 8601 d'un numéro de jour. */
export function isoWeekNumber(day: number): number {
  // Le jeudi de la semaine détermine l'année ISO.
  const thursday = day + (4 - isoWeekday(day));
  const thursdayDate = new Date(thursday * DAY_MS);
  const yearStart = Date.UTC(thursdayDate.getUTCFullYear(), 0, 1) / DAY_MS;
  return Math.floor((thursday - yearStart) / 7) + 1;
}

export function parseDayParts(day: number): { year: number; month: number; date: number } {
  const date = new Date(day * DAY_MS);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth(), date: date.getUTCDate() };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

import type { Locale } from './locales.ts';

const MONTHS: Record<Locale, string[]> = {
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const MONTHS_SHORT: Record<Locale, string[]> = {
  fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
const WEEKDAYS_SHORT: Record<Locale, string[]> = {
  fr: ['L', 'M', 'M', 'J', 'V', 'S', 'D'],
  en: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
};

let dateLocale: Locale = 'fr';

/** Langue des noms de mois et de jours (l'interface l'appelle au démarrage). */
export function setDateLocale(locale: Locale): void {
  dateLocale = locale;
}

export function monthName(month: number, short = false): string {
  return (short ? MONTHS_SHORT : MONTHS)[dateLocale][month] ?? '';
}

export function weekdayInitial(day: number): string {
  return WEEKDAYS_SHORT[dateLocale][isoWeekday(day) - 1] ?? '';
}

/** `2026-10-15` → `15/10/2026`. */
export function formatDateFr(iso: string | null | undefined): string {
  if (!iso || !isoDateLike(iso)) {
    return '';
  }
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** `2026-10-15` → `15 oct.` (ou `15 oct. 2026` si `withYear`). */
export function formatDateShort(iso: string | null | undefined, withYear = false): string {
  if (!iso || !isoDateLike(iso)) {
    return '';
  }
  const day = Number(iso.slice(8, 10));
  const month = MONTHS_SHORT[dateLocale][Number(iso.slice(5, 7)) - 1] ?? '';
  const base = `${day} ${month}`;
  return withYear ? `${base} ${iso.slice(0, 4)}` : base;
}

function isoDateLike(value: string): boolean {
  return ISO_DATE.test(value);
}
