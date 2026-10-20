import { ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import type { TicketStatus } from '@shared/constants';
import type { TicketInput } from '@/api';

export type ProfileTab = 'profile' | 'appearance' | 'security' | 'tokens';

export type TicketDraftDefaults = Partial<Pick<TicketInput, 'title' | 'status' | 'categoryId' | 'priorityId' | 'componentIds' | 'deliveryId' | 'assigneeIds' | 'startDate' | 'endDate'>>;

/** État d'interface global : fenêtre de création de ticket, profil, etc. */
export const useUiStore = defineStore('ui', () => {
  /** Non nul = la fenêtre « Nouveau ticket » est ouverte avec ces valeurs initiales. */
  const createDefaults = ref<TicketDraftDefaults | null>(null);
  const profileOpen = ref(false);
  /** Demande d'ouverture du menu contextuel d'un ticket (clic droit ou bouton « ⋯ »). */
  const ticketMenu = shallowRef<{ ticketId: number; event: MouseEvent } | null>(null);
  const profileTab = ref<ProfileTab>('profile');
  /** Ticket survolé : ses dépendances sont mises en évidence (liens et clignotement). */
  const hoveredTicketId = ref<number | null>(null);

  function openCreate(defaults: TicketDraftDefaults = {}): void {
    createDefaults.value = { status: 'backlog' as TicketStatus, ...defaults };
  }

  function closeCreate(): void {
    createDefaults.value = null;
  }

  function openTicketMenu(event: MouseEvent, ticketId: number): void {
    event.preventDefault();
    ticketMenu.value = { ticketId, event };
  }

  function openProfile(tab: ProfileTab = 'profile'): void {
    profileTab.value = tab;
    profileOpen.value = true;
  }

  return { createDefaults, profileOpen, profileTab, ticketMenu, hoveredTicketId, openCreate, closeCreate, openProfile, openTicketMenu };
});
