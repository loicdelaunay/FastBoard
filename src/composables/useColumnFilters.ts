import { computed, ref, type Ref } from 'vue';
import { FilterService } from '@primevue/core/api';

/** Règle de filtre des tableaux : la valeur (ou l'une des valeurs d'une liste) fait partie de la sélection. */
export const ANY_OF = 'fbAnyOf';
FilterService.register(ANY_OF, (value: unknown, selection: unknown[] | null | undefined) => {
  if (!selection || selection.length === 0) return true;
  if (Array.isArray(value)) return value.some((entry) => selection.includes(entry));
  return selection.includes(value ?? '');
});

export type ColumnFilters = Record<string, { value: unknown[] | null; matchMode: string }>;

/**
 * Filtres par valeur des en-têtes de tableau (DataTable `filter-display="menu"`) : chaque colonne listée propose la
 * liste de ses valeurs distinctes, à cocher.
 */
export function useColumnFilters<Row extends object>(rows: Ref<Row[]>, fields: Array<keyof Row & string>) {
  const filters = ref<ColumnFilters>(Object.fromEntries(fields.map((field) => [field, { value: null, matchMode: ANY_OF }])));

  /** Valeurs distinctes d'une colonne (les listes sont aplaties), triées. */
  function optionsFor(field: keyof Row & string): Array<{ label: string; value: string }> {
    const values = new Set<string>();
    for (const row of rows.value) {
      const raw = row[field] as unknown;
      for (const value of Array.isArray(raw) ? raw : [raw]) {
        values.add(value === null || value === undefined ? '' : String(value));
      }
    }
    return [...values].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b))).map((value) => ({ label: value, value }));
  }

  const activeCount = computed(() => Object.values(filters.value).filter((filter) => filter.value?.length).length);

  function clear(): void {
    for (const filter of Object.values(filters.value)) filter.value = null;
  }

  return { filters, optionsFor, activeCount, clear };
}
