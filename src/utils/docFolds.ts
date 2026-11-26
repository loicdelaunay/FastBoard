import { ref } from 'vue';

/**
 * Titres repliés de chaque note, retenus sur l'appareil (comme Obsidian) et communs aux modes Lecture, Écriture et
 * Lecture et écriture. Voir `shared/docFolds.ts` pour les clés.
 */

const PREFIX = 'fb.doc.folds.';
/** Repli des notes quand le stockage du navigateur est indisponible (le choix vaut alors pour la page). */
const memory = new Map<string, string[]>();

/** Change à chaque repli ou dépli : les autres vues ouvertes de la note se remettent à jour. */
export const foldsVersion = ref(0);

export const noteFoldId = (spaceId: number, path: string): string => `${spaceId}:${path.toLowerCase()}`;

export function readFolds(id: string): Set<string> {
  try {
    const stored = localStorage.getItem(PREFIX + id);
    if (stored !== null) return new Set(JSON.parse(stored) as string[]);
  } catch {
    // Stockage indisponible ou valeur abîmée : la mémoire de la page.
  }
  return new Set(memory.get(id) ?? []);
}

export function writeFolds(id: string, keys: ReadonlySet<string>): void {
  const list = [...keys];
  memory.set(id, list);
  try {
    if (list.length) localStorage.setItem(PREFIX + id, JSON.stringify(list));
    else localStorage.removeItem(PREFIX + id);
  } catch {
    // Stockage indisponible : la mémoire de la page suffit.
  }
  foldsVersion.value += 1;
}
