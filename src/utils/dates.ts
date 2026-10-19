/** Conversions entre dates ISO `YYYY-MM-DD` (stockées) et objets Date locaux (DatePicker). */

export function isoToDate(iso: string | null | undefined): Date | null {
  if (!iso) {
    return null;
  }
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) {
    return null;
  }
  return new Date(year, month - 1, day);
}

export function dateToIso(date: Date | null | undefined): string | null {
  if (!date) {
    return null;
  }
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
