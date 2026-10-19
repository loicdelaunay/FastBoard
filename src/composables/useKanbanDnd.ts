import { reactive } from 'vue';
import type { TicketStatus } from '@shared/constants';

/** État de glisser-déposer partagé entre les colonnes du Kanban (HTML5 drag & drop natif). */
const state = reactive({
  draggingId: null as number | null,
  overStatus: null as TicketStatus | null,
  /** Ticket devant lequel la carte sera insérée ; `null` = fin de colonne. */
  beforeId: null as number | null,
});

export function useKanbanDnd() {
  function start(event: DragEvent, ticketId: number): void {
    if (!event.dataTransfer) {
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(ticketId));
    // Laisse le navigateur capturer l'image de la carte avant de l'estomper.
    window.setTimeout(() => {
      state.draggingId = ticketId;
    }, 0);
  }

  function end(): void {
    state.draggingId = null;
    state.overStatus = null;
    state.beforeId = null;
  }

  /** Calcule la position d'insertion d'après la position verticale du pointeur dans la colonne. */
  function over(event: DragEvent, status: TicketStatus, list: HTMLElement): void {
    if (state.draggingId === null) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    const cards = [...list.querySelectorAll<HTMLElement>('[data-ticket-id]')].filter(
      (card) => Number(card.dataset.ticketId) !== state.draggingId,
    );
    let before: number | null = null;
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        before = Number(card.dataset.ticketId);
        break;
      }
    }
    state.overStatus = status;
    state.beforeId = before;
  }

  function leave(event: DragEvent, column: HTMLElement): void {
    const next = event.relatedTarget as Node | null;
    if (!next || !column.contains(next)) {
      state.overStatus = null;
      state.beforeId = null;
    }
  }

  /** Retourne la cible de dépôt courante, puis réinitialise l'état. */
  function drop(event: DragEvent, status: TicketStatus): { ticketId: number; status: TicketStatus; beforeId: number | null } | null {
    event.preventDefault();
    const ticketId = state.draggingId ?? Number(event.dataTransfer?.getData('text/plain'));
    const beforeId = state.overStatus === status ? state.beforeId : null;
    end();
    return Number.isInteger(ticketId) && ticketId > 0 ? { ticketId, status, beforeId } : null;
  }

  /** Fait défiler le plateau quand le pointeur approche de ses bords pendant un glisser. */
  function autoScroll(event: DragEvent, board: HTMLElement): void {
    if (state.draggingId === null) {
      return;
    }
    const rect = board.getBoundingClientRect();
    const edge = 70;
    if (event.clientX < rect.left + edge) {
      board.scrollLeft -= 18;
    } else if (event.clientX > rect.right - edge) {
      board.scrollLeft += 18;
    }
  }

  return { state, start, end, over, leave, drop, autoScroll };
}
