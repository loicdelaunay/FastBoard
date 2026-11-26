<script setup lang="ts">
import type { NotificationDTO } from '@shared/types';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { connection } from '@/offline/connection';
import { formatDateTime, formatRelative } from '@/utils/format';
import { notificationIcon as icon, notificationSentence as sentence } from '@/utils/notificationText';

/** Une notification : auteur, ce qui s'est passé, extrait, projet et date ; un clic l'ouvre, la croix l'efface. */
defineProps<{ item: NotificationDTO; fresh?: boolean }>();
const emit = defineEmits<{ open: [item: NotificationDTO]; remove: [item: NotificationDTO] }>();
</script>

<template>
  <div class="notification" :class="{ unread: !item.readAt, fresh }">
    <button type="button" class="item" @click="emit('open', item)">
      <span class="avatar">
        <UserAvatar :user="item.actorId ? { id: item.actorId, name: item.actorName ?? '?', avatarVersion: 0 } : undefined" size="small" />
        <i :class="icon(item)" class="kind"></i>
      </span>
      <span class="body">
        <span class="text">
          <strong>{{ item.actorName ?? $t('Quelqu’un') }}</strong>
          {{ sentence(item) }}
          <span v-if="item.doc" class="key">{{ item.doc.title }}</span>
          <span v-if="item.ticketKey" class="key">{{ item.ticketKey }}</span>
          <span v-if="item.ticketTitle" class="muted"> « {{ item.ticketTitle }} »</span>
        </span>
        <q v-if="item.excerpt" class="excerpt">{{ item.excerpt }}</q>
        <span class="muted small meta">
          <span v-if="item.projectName">{{ item.projectName }} · </span>
          <time :datetime="item.createdAt" :title="formatDateTime(item.createdAt)">{{ formatRelative(item.createdAt) }}</time>
          <span v-if="item.via"> · {{ $t('via « {via} »', { via: item.via }) }}</span>
        </span>
      </span>
      <i v-if="!item.readAt" class="dot" aria-hidden="true"></i>
    </button>
    <button v-if="!connection.offline" v-tooltip.left="$t('Effacer la notification')" type="button" class="remove" :aria-label="$t('Effacer la notification')" @click="emit('remove', item)">
      <i class="pi pi-times"></i>
    </button>
  </div>
</template>

<style scoped>
.notification {
  position: relative;
  border-radius: 8px;
}
.notification:hover {
  background: var(--fb-panel-alt);
}
.notification.unread {
  background: color-mix(in srgb, var(--fb-accent) 7%, transparent);
}
.notification.fresh {
  animation: fb-flash 1.8s ease-out;
}
.item {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  width: 100%;
  padding: 0.5rem 1.9rem 0.5rem 0.4rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--fb-text);
  font: inherit;
  font-size: 0.85rem;
  text-align: left;
  cursor: pointer;
}
.avatar {
  position: relative;
  flex: none;
}
.kind {
  position: absolute;
  right: -0.3rem;
  bottom: -0.25rem;
  display: grid;
  place-items: center;
  width: 1rem;
  height: 1rem;
  border-radius: 50%;
  background: var(--fb-accent);
  color: #fff;
  font-size: 0.55rem;
}
.body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}
.text {
  overflow-wrap: anywhere;
}
.key {
  color: var(--fb-accent);
  font-weight: 700;
  font-size: 0.78rem;
}
.excerpt {
  color: var(--fb-muted);
  font-style: italic;
}
.dot {
  flex: none;
  width: 0.5rem;
  height: 0.5rem;
  margin-top: 0.35rem;
  border-radius: 50%;
  background: var(--fb-accent);
}
.remove {
  position: absolute;
  top: 0.35rem;
  right: 0.3rem;
  display: grid;
  place-items: center;
  width: 1.5rem;
  height: 1.5rem;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--fb-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s;
}
.notification:hover .remove,
.remove:focus-visible {
  opacity: 1;
}
.remove:hover {
  background: color-mix(in srgb, var(--fb-danger) 14%, transparent);
  color: var(--fb-danger);
}
@media (hover: none) {
  .remove {
    opacity: 0.7;
  }
}
</style>
