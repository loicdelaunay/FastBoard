import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

/** Le ticket ouvert est porté par l'URL (`?ticket=12`) : lien partageable et bouton « retour » qui ferme la fenêtre. */
export function useTicketRoute() {
  const route = useRoute();
  const router = useRouter();

  const openTicketId = computed<number | null>(() => {
    const raw = Array.isArray(route.query.ticket) ? route.query.ticket[0] : route.query.ticket;
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
  });

  function openTicket(ticketId: number): void {
    void router.push({ query: { ...route.query, ticket: String(ticketId) } });
  }

  function closeTicket(replace = false): void {
    const { ticket: _ticket, ...rest } = route.query;
    void (replace ? router.replace({ query: rest }) : router.push({ query: rest }));
  }

  return { openTicketId, openTicket, closeTicket };
}
