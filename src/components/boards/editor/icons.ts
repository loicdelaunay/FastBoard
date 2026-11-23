import { ref, shallowRef } from 'vue';
import type { BoardColor, BoardIconDTO, IconFill } from '@shared/boards';
import { api } from '@/api';

/**
 * Bibliothèque d'icônes, chargée à la demande (plus de 2 000 icônes) : dès qu'un tableau en montre une, ou que l'on
 * ouvre l'ajout rapide. Les icônes ajoutées par les administrateurs viennent du serveur.
 */
type Library = typeof import('@shared/boardIcons');

export const iconLibrary = shallowRef<Library | null>(null);
let loading: Promise<Library> | null = null;

export function loadIconLibrary(): Promise<Library> {
  loading ??= import('@shared/boardIcons').then((module) => {
    iconLibrary.value = module;
    return module;
  });
  return loading;
}

/** Icônes ajoutées par les administrateurs (relues à chaque ouverture de l'ajout rapide). */
export const customIcons = shallowRef<BoardIconDTO[]>([]);

export async function loadCustomIcons(): Promise<BoardIconDTO[]> {
  try {
    customIcons.value = (await api.boardIcons()).icons;
  } catch {
    // Sans la liste, la bibliothèque intégrée reste disponible.
  }
  return customIcons.value;
}

/** Contenu SVG d'une icône intégrée, une fois la bibliothèque chargée (vide sinon). */
export function libraryMarkup(id: string): string {
  const library = iconLibrary.value;
  const icon = library?.libraryIcon(id);
  return library && icon ? library.iconMarkup(icon.node) : '';
}

/** Style et couleur des prochaines icônes posées, choisis dans le sélecteur d'icônes (gardés le temps de la page). */
export const iconFill = ref<IconFill | null>(null);
export const iconColor = ref<BoardColor>('default');

/** Couleur CSS d'une icône du tableau : celle du texte par défaut, sinon le trait de la couleur choisie. */
export const iconCssColor = (color: BoardColor): string => (color === 'default' ? 'var(--board-default-text)' : `var(--board-${color}-stroke)`);
