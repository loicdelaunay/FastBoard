<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import Button from 'primevue/button';
import Popover from 'primevue/popover';
import type { NotificationDTO } from '@shared/types';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { useNotificationsStore } from '@/stores/notifications';
import { describeActivity } from '@/utils/activitySummary';
import { formatDateTime, formatRelative } from '@/utils/format';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Cloche de l'en-tête : notifications des tickets suivis, assignations et mentions. */
const store = useNotificationsStore();
const router = useRouter();
const panel = ref<InstanceType<typeof Popover> | null>(null);
const onlyUnread = ref(false);

onMounted(() => {
  store.load().catch(() => undefined);
});

const visible = computed(() => (onlyUnread.value ? store.items.filter((item) => !item.readAt) : store.items));
const badge = computed(() => (store.unread > 99 ? '99+' : String(store.unread)));

function sentence(item: NotificationDTO): string {
  if (item.type === 'mention') return t('vous a mentionné sur');
  if (item.type === 'assigned') return t('vous a assigné');
  return item.activity ? describeActivity(item.activity).text : t('a modifié');
}

function icon(item: NotificationDTO): string {
  if (item.type === 'mention') return 'pi pi-at';
  if (item.type === 'assigned') return 'pi pi-user-plus';
  return item.activity ? describeActivity(item.activity).icon : 'pi pi-bell';
}

async function open(item: NotificationDTO): Promise<void> {
  panel.value?.hide();
  if (!item.readAt) void store.markRead([item.id]).catch(() => undefined);
  if (item.projectId && item.ticketId) {
    await router.push({ name: 'project', params: { projectId: item.projectId }, query: { ticket: String(item.ticketId) } });
  }
}

async function readAll(): Promise<void> {
  try {
    await store.markRead();
  } catch (error) {
    notifyError(error);
  }
}
</script>

<template>
  <button type="button" class="bell" :class="{ active: store.unread > 0 }" :aria-label="$t('Notifications ({n} non lues)', { n: store.unread })" aria-haspopup="dialog" @click="panel?.toggle($event)">
    <i class="pi pi-bell"></i>
    <span v-if="store.unread" class="badge">{{ badge }}</span>
  </button>
  <Popover ref="panel" class="notifications-panel">
    <div class="panel">
      <header class="head">
        <strong>{{ $t('Notifications') }}</strong>
        <label class="row small toggle"><input v-model="onlyUnread" type="checkbox" /> {{ $t('Non lues') }}</label>
        <Button :label="$t('Tout marquer comme lu')" text size="small" :disabled="!store.unread" @click="readAll" />
      </header>
      <ul v-if="visible.length" class="list">
        <li v-for="item in visible" :key="item.id">
          <button type="button" class="item" :class="{ unread: !item.readAt, fresh: store.fresh.has(item.id) }" @click="open(item)">
            <span class="avatar">
              <UserAvatar :user="item.actorId ? { id: item.actorId, name: item.actorName ?? '?', avatarVersion: 0 } : undefined" size="small" />
              <i :class="icon(item)" class="kind"></i>
            </span>
            <span class="body">
              <span class="text">
                <strong>{{ item.actorName ?? $t('Quelqu’un') }}</strong>
                {{ sentence(item) }}
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
        </li>
      </ul>
      <p v-else-if="store.loaded" class="empty muted">
        <i class="pi pi-bell-slash"></i>
        {{ onlyUnread ? $t('Aucune notification non lue.') : $t('Aucune notification. Suivez un ticket ou attendez qu’on vous mentionne avec @.') }}
      </p>
      <Button v-if="store.nextBefore !== null && !onlyUnread" :label="$t('Plus anciennes')" text size="small" class="more" :loading="store.loading" @click="store.loadMore" />
    </div>
  </Popover>
</template>

<style scoped>
.bell {
  position: relative;
  display: grid;
  place-items: center;
  width: 2.3rem;
  height: 2.3rem;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--fb-muted);
  cursor: pointer;
}
.bell:hover,
.bell:focus-visible {
  background: var(--fb-panel-alt);
  color: var(--fb-text);
}
.bell.active {
  color: var(--fb-text);
}
.badge {
  position: absolute;
  top: 0.1rem;
  right: 0.05rem;
  min-width: 1.05rem;
  height: 1.05rem;
  padding: 0 0.25rem;
  border-radius: 999px;
  background: var(--fb-danger);
  color: #fff;
  font-size: 0.62rem;
  font-weight: 800;
  line-height: 1.05rem;
  text-align: center;
}
.panel {
  width: min(26rem, 90vw);
  max-height: min(70vh, 34rem);
  display: flex;
  flex-direction: column;
}
.head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding-bottom: 0.4rem;
  border-bottom: 1px solid var(--fb-border);
}
.head strong {
  flex: 1;
}
.toggle {
  gap: 0.3rem;
  cursor: pointer;
}
.list {
  margin: 0;
  padding: 0.3rem 0;
  overflow-y: auto;
  list-style: none;
}
.item {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  width: 100%;
  padding: 0.5rem 0.4rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--fb-text);
  font: inherit;
  font-size: 0.85rem;
  text-align: left;
  cursor: pointer;
}
.item:hover {
  background: var(--fb-panel-alt);
}
.item.unread {
  background: color-mix(in srgb, var(--fb-accent) 7%, transparent);
}
.item.fresh {
  animation: fb-flash 1.8s ease-out;
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
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  padding: 1.5rem 1rem;
  text-align: center;
}
.more {
  align-self: center;
}
</style>
