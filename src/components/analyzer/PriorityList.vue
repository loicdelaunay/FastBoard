<script setup lang="ts">
import { formatDateShort } from '@shared/dates';
import ProgressMeter from '@/components/common/ProgressMeter.vue';
import StatusTag from '@/components/common/StatusTag.vue';
import UserAvatarGroup from '@/components/common/UserAvatarGroup.vue';
import type { PriorityItem } from '@/composables/useAnalysis';
import { useProjectStore } from '@/stores/project';
import { dueDate, ticketKey } from '@/utils/tickets';
import { progressOf } from '@/utils/progress';

defineProps<{ items: PriorityItem[] }>();
const emit = defineEmits<{ open: [ticketId: number] }>();

const project = useProjectStore();

function people(item: PriorityItem) {
  return item.ticket.assignees.flatMap((assignee) => {
    const user = project.usersById.get(assignee.userId);
    return user ? [user] : [];
  });
}

function due(item: PriorityItem): string {
  const delivery = item.ticket.deliveryId ? project.deliveriesById.get(item.ticket.deliveryId) : undefined;
  const date = dueDate(item.ticket, delivery);
  return date ? formatDateShort(date) : '';
}
</script>

<template>
  <section class="priorities card">
    <header class="head">
      <h3 class="title">{{ $t('Priorités de suivi') }}</h3>
      <span class="muted small">{{ $t('Tickets à surveiller en premier') }}</span>
    </header>

    <p v-if="!items.length" class="muted">{{ $t('Aucun ticket prioritaire.') }}</p>
    <ol v-else class="list">
      <li v-for="item in items" :key="item.ticket.id">
        <button type="button" class="item" @click="emit('open', item.ticket.id)">
          <div class="top">
            <span class="key">{{ ticketKey(project.project, item.ticket) }}</span>
            <span class="name truncate">{{ item.ticket.title }}</span>
            <StatusTag :status="item.ticket.status" compact />
          </div>
          <div class="bottom">
            <span v-for="reason in item.reasons" :key="reason" class="reason">{{ reason }}</span>
            <span v-if="due(item)" class="muted small due"><i class="pi pi-calendar"></i> {{ due(item) }}</span>
            <UserAvatarGroup v-if="people(item).length" :users="people(item)" :max="3" />
            <div class="meter"><ProgressMeter :value="progressOf(item.ticket)" :height="4" /></div>
          </div>
        </button>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.priorities {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 1.1rem;
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}
.title {
  font-size: 0.95rem;
  font-weight: 700;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.item {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  width: 100%;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--fb-border);
  border-radius: 8px;
  background: transparent;
  color: var(--fb-text);
  text-align: left;
  cursor: pointer;
}
.item:hover {
  border-color: var(--fb-accent);
  background: var(--fb-accent-soft);
}
.top,
.bottom {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem 0.6rem;
  min-width: 0;
}
.key {
  font-size: 0.72rem;
  font-weight: 800;
  color: var(--fb-muted);
}
.name {
  flex: 1;
  font-size: 0.88rem;
  font-weight: 600;
}
.reason {
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  background: color-mix(in srgb, #ef4444 14%, transparent);
  color: #dc2626;
  font-size: 0.72rem;
  font-weight: 700;
}
:root.app-dark .reason {
  color: #f87171;
}
.meter {
  flex: 1;
  min-width: 5rem;
}
.due i {
  margin-right: 0.2rem;
}
</style>
