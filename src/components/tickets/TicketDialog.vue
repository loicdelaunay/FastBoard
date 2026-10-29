<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import StatusTag from '@/components/common/StatusTag.vue';
import UserAvatarGroup from '@/components/common/UserAvatarGroup.vue';
import { useTicketActions } from '@/composables/useTicketActions';
import { useTicketRoute } from '@/composables/useTicketRoute';
import { realtime } from '@/realtime/socket';
import { useAiStore } from '@/stores/ai';
import { useAppStore } from '@/stores/app';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/project';
import { notify } from '@/utils/notify';
import { ticketKey } from '@/utils/tickets';
import TicketCreateDialog from './TicketCreateDialog.vue';
import TicketDetail from './TicketDetail.vue';

import { t } from '@/i18n';
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const project = useProjectStore();
const { openTicketId, closeTicket } = useTicketRoute();
const actions = useTicketActions();
const ai = useAiStore();
const app = useAppStore();
/** Raccourci vers l'assistant IA, qui connaît alors le ticket ouvert. */
const aiAvailable = computed(() => app.info.ai && auth.can('ai.use'));

const canDelete = computed(() => project.can('ticket.delete') && !project.archived);

const ticket = computed(() => (openTicketId.value !== null ? project.ticketsById.get(openTicketId.value) : undefined));
const visible = computed(() => openTicketId.value !== null);
const missing = computed(
  () => visible.value && project.status === 'ready' && !ticket.value && !(openTicketId.value !== null && project.wasDeletedLocally(openTicketId.value)),
);

/** Collègues qui consultent ce ticket en ce moment. */
const viewers = computed(() =>
  project.presence
    .filter((entry) => entry.userId !== auth.user?.id && openTicketId.value !== null && entry.ticketIds.includes(openTicketId.value))
    .map((entry) => project.usersById.get(entry.userId))
    .filter((user): user is NonNullable<typeof user> => user !== undefined),
);

watch(openTicketId, (id) => realtime.setPresence({ ticketId: id }), { immediate: true });
onBeforeUnmount(() => realtime.setPresence({ ticketId: null }));

// Ticket supprimé par un collègue pendant qu'il est ouvert.
let wasPresent = false;
watch(ticket, (current) => {
  if (current) {
    wasPresent = true;
  } else if (wasPresent && openTicketId.value !== null) {
    wasPresent = false;
    // Une suppression faite ici (bouton, menu) ferme déjà la fenêtre elle-même.
    if (!project.wasDeletedLocally(openTicketId.value)) {
      notify('warn', t('Ticket supprimé'), t('Ce ticket vient d\'être supprimé par un collègue.'));
      closeTicket(true);
    }
  }
});
watch(openTicketId, () => (wasPresent = ticket.value !== undefined));

function close(): void {
  const back = (window.history.state as { back?: string | null } | null)?.back;
  if (back && !back.includes('ticket=') && back.split('?')[0] === route.path) {
    router.back();
  } else {
    closeTicket(true);
  }
}

/** La fenêtre peut déjà s'être fermée (suppression confirmée depuis le menu) : on ne ferme qu'une fois. */
function onDeleted(): void {
  if (openTicketId.value !== null) {
    close();
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    maximizable
    dismissable-mask
    class="ticket-dialog"
    :style="{ width: 'min(72rem, 96vw)' }"
    :pt="{ content: { class: 'ticket-dialog-content' } }"
    @update:visible="(value: boolean) => !value && close()"
  >
    <template #header>
      <div class="dlg-head">
        <span v-if="ticket" class="key">{{ ticketKey(project.project, ticket) }}</span>
        <StatusTag v-if="ticket" :status="ticket.status" />
        <span v-if="viewers.length" class="viewers muted small">
          <UserAvatarGroup :users="viewers" size="small" :max="4" /> {{ $t('consulte ce ticket|consultent ce ticket', { n: viewers.length }) }} </span>
        <Button v-if="ticket" v-tooltip.bottom="$t('Copier le lien')" icon="pi pi-link" text rounded severity="secondary" size="small" :aria-label="$t('Copier le lien du ticket')" @click="actions.copyLink(ticket.id)" />
        <Button v-if="ticket && canDelete" v-tooltip.bottom="$t('Supprimer le ticket')" icon="pi pi-trash" text rounded severity="danger" size="small" :aria-label="$t('Supprimer le ticket')" @click="actions.confirmDelete(ticket, onDeleted)" />
        <button
          v-if="ticket && aiAvailable"
          v-tooltip.bottom="ai.open ? $t('Fermer l’assistant IA') : $t('Demander à l’assistant IA à propos de ce ticket')"
          type="button"
          class="ai-toggle"
          :class="{ on: ai.open }"
          :aria-pressed="ai.open"
          :aria-label="$t('Assistant IA')"
          @click="ai.toggle()"
        >
          <i class="pi pi-sparkles"></i>
        </button>
      </div>
    </template>

    <TicketDetail v-if="ticket" :ticket="ticket" @deleted="onDeleted" />
    <div v-else-if="missing" class="missing">
      <i class="pi pi-ban"></i>
      <p>{{ $t('Ce ticket n\'existe pas ou a été supprimé.') }}</p>
      <Button :label="$t('Fermer')" severity="secondary" @click="close" />
    </div>
  </Dialog>

  <TicketCreateDialog />
</template>

<style scoped>
.dlg-head {
  display: flex;
  flex: 1;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.6rem;
}
/* Juste à gauche des boutons agrandir / fermer de la fenêtre. */
.ai-toggle {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  margin-left: auto;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #a95cff;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.ai-toggle:hover {
  background: color-mix(in srgb, #a95cff 14%, transparent);
}
.ai-toggle.on {
  background: conic-gradient(from 0deg, #4f8cff, #a95cff, #ff6fa7, #4f8cff);
  color: #fff;
}
.key {
  padding: 0.1rem 0.55rem;
  border-radius: 6px;
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
  font-size: 0.85rem;
  font-weight: 800;
  letter-spacing: 0.03em;
}
.viewers {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.missing {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 2rem;
  color: var(--fb-muted);
}
.missing i {
  font-size: 2rem;
}
</style>

<style>
.ticket-dialog .ticket-dialog-content {
  padding-top: 0.25rem;
}
</style>
