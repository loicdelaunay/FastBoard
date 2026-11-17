import { shallowRef } from 'vue';
import type { BoardIconDTO } from '@shared/boards';
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
