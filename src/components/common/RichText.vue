<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { useTicketRoute } from '@/composables/useTicketRoute';
import { useProjectStore } from '@/stores/project';
import { parseRichText } from '@/utils/mentions';
import { ticketKey } from '@/utils/tickets';

/** Texte libre affiché avec ses mentions (personnes, tickets) et ses liens cliquables. */
const props = defineProps<{ text: string }>();

const project = useProjectStore();
const { openTicket } = useTicketRoute();
const segments = computed(() => parseRichText(props.text));

function ticketOf(id: number) {
  return project.ticketsById.get(id);
}
</script>

<template>
  <span class="rich-text">
    <template v-for="(segment, index) in segments" :key="index">
      <template v-if="segment.type === 'text'">{{ segment.text }}</template>
      <a v-else-if="segment.type === 'link'" :href="segment.url" target="_blank" rel="noopener noreferrer" class="link">{{ segment.url }}</a>
      <RouterLink v-else-if="segment.kind === 'user'" :to="{ name: 'user', params: { id: segment.id } }" class="mention user" @click.stop>
        <UserAvatar :user="project.usersById.get(segment.id)" size="small" class="mini" />@{{ project.usersById.get(segment.id)?.name ?? segment.label }}
      </RouterLink>
      <button
        v-else-if="ticketOf(segment.id)"
        v-tooltip.top="ticketOf(segment.id)!.title"
        type="button"
        class="mention ticket"
        @click.stop="openTicket(segment.id)"
      >
        <i class="pi pi-ticket"></i>{{ ticketKey(project.project, ticketOf(segment.id)!) }}
      </button>
      <span v-else class="mention ticket gone"><i class="pi pi-ticket"></i>{{ segment.label }}</span>
    </template>
  </span>
</template>

<style scoped>
.rich-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.link {
  color: var(--fb-accent);
  text-decoration: underline;
}
.mention {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0 0.4rem 0 0.15rem;
  border: 0;
  border-radius: 999px;
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
  font: inherit;
  font-weight: 600;
  line-height: 1.5;
  vertical-align: baseline;
  text-decoration: none;
  cursor: pointer;
}
.mention.ticket {
  padding-left: 0.4rem;
  font-family: var(--fb-mono, inherit);
  font-size: 0.9em;
}
.mention.gone {
  opacity: 0.6;
  cursor: default;
  text-decoration: line-through;
}
.mention .mini {
  width: 1.15rem !important;
  height: 1.15rem !important;
  font-size: 0.55rem !important;
}
.mention i {
  font-size: 0.75em;
}
</style>
