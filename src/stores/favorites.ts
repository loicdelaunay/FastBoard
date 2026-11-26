import { ref, watch } from 'vue';
import { defineStore } from 'pinia';
import type { FavoriteKind, FavoriteSpaceDTO } from '@shared/home';
import { api } from '@/api';
import { realtime } from '@/realtime/socket';
import { useAuthStore } from '@/stores/auth';

/**
 * Espaces favoris de la personne connectée (documentation, tableaux blancs, projets) : l'étoile des cartes, les listes
 * qui les montrent en premier, et l'Accueil. Suivis en direct d'un onglet à l'autre.
 */
export const useFavoritesStore = defineStore('favorites', () => {
  const list = ref<FavoriteSpaceDTO[]>([]);
  const loaded = ref(false);
  let pending: Promise<void> | null = null;

  async function load(): Promise<void> {
    list.value = (await api.favorites()).favorites;
    loaded.value = true;
  }

  /** Charge les favoris une fois (sans erreur visible : sans eux, les listes s'affichent quand même). */
  function ensure(): Promise<void> {
    if (loaded.value) return Promise.resolve();
    pending ??= load()
      .catch(() => undefined)
      .finally(() => (pending = null));
    return pending;
  }

  const isFavorite = (kind: FavoriteKind, id: number): boolean => list.value.some((entry) => entry.kind === kind && entry.id === id);

  async function toggle(kind: FavoriteKind, id: number): Promise<boolean> {
    const on = !isFavorite(kind, id);
    list.value = (await api.setFavorite(kind, id, on)).favorites;
    return on;
  }

  /** Favoris d'abord, l'ordre de la liste gardé sinon. */
  function favoritesFirst<T extends { id: number }>(kind: FavoriteKind, items: readonly T[]): T[] {
    return [...items].sort((a, b) => Number(isFavorite(kind, b.id)) - Number(isFavorite(kind, a.id)));
  }

  realtime.on('favorites', (favorites) => {
    list.value = favorites;
    loaded.value = true;
  });
  // Autre compte (ou déconnexion) : les favoris se relisent à la demande.
  watch(
    () => useAuthStore().user?.id ?? null,
    () => {
      list.value = [];
      loaded.value = false;
    },
  );

  return { list, loaded, load, ensure, isFavorite, toggle, favoritesFirst };
});
