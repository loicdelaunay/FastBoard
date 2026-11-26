<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import Button from 'primevue/button';
import { STATUS_META } from '@shared/constants';
import { formatDateShort, todayISO } from '@shared/dates';
import { docParent, docTitle } from '@shared/docs';
import type { FavoriteSpaceDTO, HomeDTO, HomeRecentDTO, HomeTicketDTO } from '@shared/home';
import { api } from '@/api';
import NotificationItem from '@/components/notifications/NotificationItem.vue';
import { useNotificationActions } from '@/composables/useNotificationActions';
import { t } from '@/i18n';
import { realtime } from '@/realtime/socket';
import { useAuthStore } from '@/stores/auth';
import { useNotificationsStore } from '@/stores/notifications';
import { formatDateTime, formatRelative } from '@/utils/format';
import { notifyError } from '@/utils/notify';

/**
 * Accueil : les espaces favoris en tête, puis ce qui m'est assigné, mes notifications importantes (mentions et
 * assignations non lues), ce que j'ai modifié récemment et mes documents favoris : tout, à un clic.
 */
const auth = useAuthStore();
const notifications = useNotificationsStore();
const actions = useNotificationActions();
const home = ref<HomeDTO | null>(null);
const failed = ref(false);

async function load(): Promise<void> {
  try {
    home.value = (await api.home()).home;
    failed.value = false;
  } catch (error) {
    if (!home.value) failed.value = true;
    notifyError(error);
  }
}

// Notifications et favoris changés (ici ou ailleurs) : l'accueil se relit, une fois les changements passés.
let timer = 0;
const refresh = (): void => {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void load(), 400);
};
const stops = [realtime.on('notification', refresh), realtime.on('notificationsRead', refresh), realtime.on('notificationsRemoved', refresh), realtime.on('favorites', refresh), realtime.on('resync', refresh)];
onMounted(() => void load());
onBeforeUnmount(() => {
  window.clearTimeout(timer);
  stops.forEach((stop) => stop());
});

const firstName = computed(() => auth.user?.name.split(/\s+/)[0] ?? '');
const greeting = computed(() => {
  const hour = new Date().getHours();
  return hour < 5 || hour >= 18 ? t('Bonsoir {name}', { name: firstName.value }) : t('Bonjour {name}', { name: firstName.value });
});
const todayLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const today = todayISO();

const SPACE_ICONS: Record<FavoriteSpaceDTO['kind'], string> = { docs: 'pi pi-book', boards: 'pi pi-objects-column', project: 'pi pi-th-large' };
const RECENT_ICONS: Record<HomeRecentDTO['kind'], string> = { note: 'pi pi-file', board: 'pi pi-objects-column', ticket: 'pi pi-ticket' };
const spaceRoute = (space: FavoriteSpaceDTO): RouteLocationRaw =>
  space.kind === 'docs' ? { name: 'doc-space', params: { spaceId: space.id } } : space.kind === 'boards' ? { name: 'board-space', params: { spaceId: space.id } } : `/p/${space.id}`;
const recentRoute = (item: HomeRecentDTO): RouteLocationRaw =>
  item.kind === 'note' ? { name: 'doc-file', params: { nodeId: item.id } } : item.kind === 'board' ? { name: 'board-file', params: { boardId: item.id } } : { name: 'project', params: { projectId: item.spaceId }, query: { ticket: String(item.id) } };
const ticketRoute = (ticket: HomeTicketDTO): RouteLocationRaw => ({ name: 'project', params: { projectId: ticket.projectId }, query: { ticket: String(ticket.id) } });
const overdue = (ticket: HomeTicketDTO): boolean => Boolean(ticket.endDate && ticket.endDate < today);
const lateCount = computed(() => home.value?.assigned.filter(overdue).length ?? 0);
</script>

<template>
  <div class="page home">
    <header class="head">
      <div>
        <h1 class="page-title">{{ greeting }}</h1>
        <p class="muted date">{{ todayLabel }}</p>
      </div>
    </header>

    <div v-if="!home && !failed" class="empty muted"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</div>
    <div v-else-if="!home" class="empty muted">
      <i class="pi pi-exclamation-circle"></i> {{ $t('L’accueil n’a pas pu être chargé.') }}
      <Button :label="$t('Réessayer')" icon="pi pi-refresh" text size="small" @click="load" />
    </div>

    <template v-else>
      <section class="block">
        <h2 class="block-title"><i class="pi pi-star-fill star"></i> {{ $t('Espaces favoris') }}</h2>
        <div v-if="home.favorites.length" class="spaces">
          <router-link v-for="space in home.favorites" :key="`${space.kind}:${space.id}`" :to="spaceRoute(space)" class="space" :class="`kind-${space.kind}`" :title="space.description || space.name">
            <i :class="SPACE_ICONS[space.kind]" class="space-icon"></i>
            <span class="space-text">
              <strong class="truncate">{{ space.name }}</strong>
              <span class="muted small">{{ space.kind === 'docs' ? $t('Documentation') : space.kind === 'boards' ? $t('Tableaux blancs') : space.key }}</span>
            </span>
          </router-link>
        </div>
        <p v-else class="hint muted small">{{ $t('Ajoutez un espace ou un projet aux favoris avec l’étoile de sa carte (ou son clic droit) : il apparaîtra ici.') }}</p>
      </section>

      <div class="columns">
        <div class="column">
          <section class="card panel">
            <h2 class="card-title">
              <i class="pi pi-user"></i> {{ $t('Assigné à moi') }} <span class="count">{{ home.assigned.length }}</span>
              <span v-if="lateCount" class="late small">{{ $t('{n} en retard', { n: lateCount }) }}</span>
            </h2>
            <ul v-if="home.assigned.length" class="rows">
              <li v-for="ticket in home.assigned" :key="ticket.id">
                <router-link :to="ticketRoute(ticket)" class="row">
                  <span class="status" :style="{ '--s': STATUS_META[ticket.status].color }" :title="$t(STATUS_META[ticket.status].label)"></span>
                  <span class="row-text">
                    <span class="truncate"><span class="key">{{ ticket.key }}</span> {{ ticket.title }}</span>
                    <span class="muted small truncate">{{ ticket.projectName }} · {{ $t(STATUS_META[ticket.status].label) }}<template v-if="ticket.progress"> · {{ ticket.progress }} %</template></span>
                  </span>
                  <span v-if="ticket.endDate" class="due small" :class="{ overdue: overdue(ticket) }">{{ formatDateShort(ticket.endDate) }}</span>
                </router-link>
              </li>
            </ul>
            <p v-else class="hint muted small">{{ $t('Rien ne vous est assigné pour l’instant.') }}</p>
          </section>

          <section class="card panel">
            <h2 class="card-title"><i class="pi pi-history"></i> {{ $t('Récemment modifié') }}</h2>
            <ul v-if="home.recent.length" class="rows">
              <li v-for="item in home.recent" :key="`${item.kind}:${item.id}`">
                <router-link :to="recentRoute(item)" class="row">
                  <i :class="RECENT_ICONS[item.kind]" class="row-icon" :data-kind="item.kind"></i>
                  <span class="row-text">
                    <span class="truncate"><span v-if="item.key" class="key">{{ item.key }}</span> {{ item.title }}</span>
                    <span class="muted small truncate">{{ item.spaceName }}</span>
                  </span>
                  <time class="muted small" :datetime="item.at" :title="formatDateTime(item.at)">{{ formatRelative(item.at) }}</time>
                </router-link>
              </li>
            </ul>
            <p v-else class="hint muted small">{{ $t('Les notes, tableaux et tickets que vous modifiez apparaîtront ici.') }}</p>
          </section>
        </div>

        <div class="column">
          <section class="card panel">
            <h2 class="card-title">
              <i class="pi pi-bell"></i> {{ $t('Notifications importantes') }} <span class="count">{{ home.notifications.length }}</span>
              <router-link :to="{ name: 'notifications' }" class="more small">{{ $t('Toutes ({n} non lues)', { n: notifications.unread }) }}</router-link>
            </h2>
            <ul v-if="home.notifications.length" class="rows">
              <li v-for="item in home.notifications" :key="item.id">
                <NotificationItem :item="item" @open="actions.open" @remove="actions.remove" />
              </li>
            </ul>
            <p v-else class="hint muted small"><i class="pi pi-check-circle"></i> {{ $t('Aucune mention ni assignation en attente.') }}</p>
          </section>

          <section class="card panel">
            <h2 class="card-title"><i class="pi pi-bookmark"></i> {{ $t('Documents favoris') }}</h2>
            <ul v-if="home.bookmarks.length" class="rows">
              <li v-for="entry in home.bookmarks" :key="entry.nodeId">
                <router-link :to="{ name: 'doc-file', params: { nodeId: entry.nodeId } }" class="row">
                  <i :class="entry.kind === 'image' ? 'pi pi-image' : 'pi pi-file'" class="row-icon" data-kind="note"></i>
                  <span class="row-text">
                    <span class="truncate">{{ docTitle(entry.path) }}</span>
                    <span class="muted small truncate">{{ entry.spaceName }}<template v-if="docParent(entry.path)"> · {{ docParent(entry.path) }}</template></span>
                  </span>
                </router-link>
              </li>
            </ul>
            <p v-else class="hint muted small">{{ $t('Mettez une note en favori (étoile de la note, ou clic droit dans l’arbre) pour la retrouver ici.') }}</p>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.home {
  max-width: 78rem;
}
.head {
  margin-bottom: 1rem;
}
.date {
  margin: 0.2rem 0 0;
}
/* Seule la première lettre : « Jeudi 26 novembre ». */
.date::first-letter {
  text-transform: uppercase;
}
.block {
  margin-bottom: 1.2rem;
}
.block-title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0 0.6rem;
  font-size: 0.95rem;
}
.star {
  color: #f59e0b;
}
.spaces {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
  gap: 0.6rem;
}
.space {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-width: 0;
  padding: 0.65rem 0.8rem;
  border: 1px solid var(--fb-border);
  border-radius: 12px;
  background: var(--fb-panel);
  color: var(--fb-text);
  text-decoration: none;
  transition: border-color 0.12s, transform 0.12s;
}
.space:hover {
  border-color: var(--fb-accent);
  transform: translateY(-1px);
}
.space-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 2.1rem;
  height: 2.1rem;
  border-radius: 10px;
  background: color-mix(in srgb, var(--k) 14%, transparent);
  color: var(--k);
}
.kind-docs {
  --k: var(--fb-module-docs);
}
.kind-boards {
  --k: var(--fb-module-boards);
}
.kind-project {
  --k: var(--fb-module-projects);
}
.space-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  align-items: start;
}
.column {
  display: grid;
  gap: 1rem;
  min-width: 0;
}
.panel {
  padding: 0.9rem 1rem;
  min-width: 0;
}
.card-title {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0 0 0.5rem;
  font-size: 0.95rem;
}
.card-title > i {
  color: var(--fb-accent);
}
.count {
  padding: 0 0.45rem;
  border-radius: 999px;
  background: var(--fb-panel-alt);
  color: var(--fb-muted);
  font-size: 0.75rem;
  font-weight: 700;
}
.late {
  color: var(--fb-danger);
  font-weight: 600;
}
.more {
  margin-left: auto;
  font-weight: 500;
  color: var(--fb-accent);
}
.rows {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 0.1rem;
  max-height: 26rem;
  overflow: auto;
}
.row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
  padding: 0.45rem 0.5rem;
  border-radius: 8px;
  color: var(--fb-text);
  text-decoration: none;
}
.row:hover {
  background: var(--fb-panel-alt);
}
.row-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.row-icon {
  flex: none;
  width: 1.1rem;
  color: var(--fb-muted);
}
.row-icon[data-kind='note'] {
  color: var(--fb-module-docs);
}
.row-icon[data-kind='board'] {
  color: var(--fb-module-boards);
}
.row-icon[data-kind='ticket'] {
  color: var(--fb-module-projects);
}
.status {
  flex: none;
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 999px;
  background: var(--s);
}
.key {
  color: var(--fb-accent);
  font-weight: 700;
  font-size: 0.8rem;
}
.due {
  flex: none;
  color: var(--fb-muted);
}
.due.overdue {
  color: var(--fb-danger);
  font-weight: 600;
}
.hint {
  margin: 0.2rem 0;
}
.empty {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 2rem 0;
}
@media (max-width: 900px) {
  .columns {
    grid-template-columns: 1fr;
  }
}
</style>
