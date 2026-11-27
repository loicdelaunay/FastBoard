<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import type { HomeBlock } from '@shared/homeLayout';
import type { ActivityDTO } from '@shared/types';
import { api } from '@/api';
import { t } from '@/i18n';
import { formatDateTime, formatRelative } from '@/utils/format';
import HomeBlockFrame from '../HomeBlockFrame.vue';
import { useHomeSources } from '../homeContext';

/** Ce qui se passe sur mes tickets et ce que je fais, dans tous mes projets (l'activité de « Mon tableau »). */
const props = defineProps<{ block: HomeBlock }>();
const sources = useHomeSources();
sources.board.ensure();

const activities = ref<ActivityDTO[] | null>(null);
const failed = ref(false);
const limit = computed(() => props.block.options.limit ?? 10);
const group = computed(() => props.block.options.group ?? 'all');

async function load(): Promise<void> {
  try {
    activities.value = (await api.myActivity({ limit: limit.value, ...(group.value === 'all' ? {} : { group: [group.value] }) })).activities;
    failed.value = false;
  } catch {
    if (!activities.value) failed.value = true;
  }
}
watch([limit, group, sources.generation], () => void load(), { immediate: true });

const users = computed(() => new Map((sources.board.data.value?.users ?? []).map((user) => [user.id, user.name])));

interface Line {
  icon: string;
  subject: string;
  key: string | null;
  action: string;
  excerpt: string;
  route: RouteLocationRaw;
}

function describe(activity: ActivityDTO): Line {
  const data = activity.data;
  const board: RouteLocationRaw = { name: 'my-activity' };
  const ticketRoute = (ticketId: number | null): RouteLocationRaw => (ticketId ? { name: 'project', params: { projectId: activity.projectId }, query: { ticket: String(ticketId) } } : board);
  switch (data.kind) {
    case 'ticket': {
      const entry = data.entry;
      const action =
        entry.kind === 'created'
          ? t('a créé le ticket')
          : entry.kind === 'updated' && entry.changes.some((change) => change.field === 'status')
            ? t('a changé le statut')
            : entry.kind === 'assignees'
              ? t('a changé les personnes')
              : entry.kind === 'part'
                ? t('a mis à jour l’avancement')
                : entry.kind === 'attachment'
                  ? t('a changé les pièces jointes')
                  : entry.kind === 'subtask'
                    ? t('a changé les sous-tickets')
                    : entry.kind === 'link'
                      ? t('a changé les liens')
                      : t('a modifié le ticket');
      return { icon: entry.kind === 'created' ? 'pi pi-plus-circle' : 'pi pi-pencil', subject: data.ticketTitle, key: data.ticketKey, action, excerpt: '', route: ticketRoute(data.ticketId) };
    }
    case 'comment':
      return {
        icon: 'pi pi-comment',
        subject: data.ticketTitle,
        key: data.ticketKey,
        action: data.action === 'deleted' ? t('a supprimé un commentaire') : data.reply ? t('a répondu') : t('a commenté'),
        excerpt: data.action === 'deleted' ? '' : data.excerpt,
        route: ticketRoute(data.ticketId),
      };
    case 'ticket_deleted':
      return { icon: 'pi pi-trash', subject: data.ticketTitle, key: data.ticketKey, action: t('a supprimé le ticket'), excerpt: '', route: board };
    case 'ticket_transferred':
      return { icon: 'pi pi-folder', subject: data.ticketTitle, key: data.ticketKey, action: t('a déplacé le ticket'), excerpt: data.otherProject, route: ticketRoute(data.direction === 'in' ? data.ticketId : null) };
    case 'member':
      return { icon: 'pi pi-user-plus', subject: data.user.name, key: null, action: t('membres du projet'), excerpt: '', route: board };
    case 'project':
      return { icon: 'pi pi-cog', subject: t('Réglages du projet'), key: null, action: t('a modifié le projet'), excerpt: '', route: board };
    default:
      return { icon: 'pi pi-cog', subject: data.name, key: null, action: t('a modifié les réglages du projet'), excerpt: '', route: board };
  }
}

const lines = computed(() =>
  (activities.value ?? []).map((activity) => ({
    activity,
    author: activity.userId ? (users.value.get(activity.userId) ?? t('Un ancien membre')) : t('Un ancien membre'),
    ...describe(activity),
  })),
);
</script>

<template>
  <HomeBlockFrame :block="block">
    <template #extra>
      <router-link :to="{ name: 'my-activity' }" class="more small" draggable="false">{{ $t('Tout voir') }}</router-link>
    </template>
    <div v-if="!activities" class="state muted small">
      <template v-if="failed"><i class="pi pi-exclamation-circle"></i> {{ $t('Ce bloc n’a pas pu être chargé.') }}</template>
      <template v-else><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</template>
    </div>
    <ul v-else-if="lines.length" class="rows">
      <li v-for="line in lines" :key="line.activity.id">
        <router-link :to="line.route" class="row" draggable="false">
          <i :class="line.icon" class="row-icon" data-kind="ticket"></i>
          <span class="row-text">
            <span class="truncate"><span v-if="line.key" class="key">{{ line.key }}</span> {{ line.subject }}</span>
            <span class="muted small truncate">
              <strong>{{ line.author }}</strong><template v-if="line.activity.via"> ({{ $t('via {name}', { name: line.activity.via }) }})</template> {{ line.action }}<template v-if="line.excerpt"> · « {{ line.excerpt }} »</template>
            </span>
          </span>
          <time class="muted small" :datetime="line.activity.createdAt" :title="formatDateTime(line.activity.createdAt)">{{ formatRelative(line.activity.createdAt) }}</time>
        </router-link>
      </li>
    </ul>
    <p v-else class="hint muted small">{{ $t('Rien de nouveau sur vos tickets.') }}</p>
  </HomeBlockFrame>
</template>

<style scoped src="../home.css"></style>
