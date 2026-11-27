import { onBeforeUnmount, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { filtersFromQuery, filtersToQuery, sameFilters, withoutFilterQuery } from '@shared/ticketFilters';
import { applyTicketFilters, currentTicketFilters } from '@/composables/useTicketFilters';

/**
 * Les filtres des vues Liste, Kanban et Gantt suivent l'adresse de la page (`?categories=3&statuts=todo&retard=1`) :
 * copier l'adresse partage la vue filtrée, et Précédent / Suivant ou un lien ouvert la retrouvent. L'adresse est mise
 * à jour sans ajouter d'étape à l'historique du navigateur.
 */
export function useFilterQuery(): void {
  const route = useRoute();
  const router = useRouter();

  /** Une modification des filtres attend d'être reportée dans l'adresse : l'adresse, en retard, ne les remplace pas. */
  let pending = false;

  // Adresse → filtres : à l'ouverture de la page, d'un lien, ou en passant d'une page à l'autre.
  watch(
    () => route.query,
    (query) => {
      if (pending) return;
      const wanted = filtersFromQuery(query);
      if (!sameFilters(wanted, currentTicketFilters())) applyTicketFilters(wanted);
    },
    { immediate: true },
  );

  // Filtres → adresse, un instant après la dernière modification.
  let timer: number | undefined;
  watch(
    () => JSON.stringify(filtersToQuery(currentTicketFilters())),
    () => {
      window.clearTimeout(timer);
      if (sameFilters(filtersFromQuery(route.query), currentTicketFilters())) {
        pending = false;
        return;
      }
      pending = true;
      timer = window.setTimeout(() => {
        pending = false;
        if (sameFilters(filtersFromQuery(route.query), currentTicketFilters())) return;
        void router.replace({ query: { ...withoutFilterQuery(route.query), ...filtersToQuery(currentTicketFilters()) }, hash: route.hash });
      }, 250);
    },
  );
  onBeforeUnmount(() => window.clearTimeout(timer));
}

/** Paramètres de filtre de l'adresse en cours, à garder en passant d'une vue à l'autre (Liste, Kanban…). */
export function filterQueryOf(query: Readonly<Record<string, unknown>>): Record<string, string> {
  return filtersToQuery(filtersFromQuery(query));
}
