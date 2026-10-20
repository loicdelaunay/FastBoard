<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import ProgressBar from 'primevue/progressbar';
import Skeleton from 'primevue/skeleton';
import Tag from 'primevue/tag';
import { formatDateShort, todayISO } from '@shared/dates';
import type { UserActivityDTO, UserSummaryPageDTO } from '@shared/types';
import { api } from '@/api';
import ChartCard from '@/components/analyzer/ChartCard.vue';
import StatusTag from '@/components/common/StatusTag.vue';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { useChartColors } from '@/composables/useChartColors';
import { useAuthStore } from '@/stores/auth';
import { formatDateTime, formatRelative } from '@/utils/format';
import { SUBTASK_ACTIONS } from '@/utils/historyFormat';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Page d'un utilisateur : résumé de son activité dans les projets que vous voyez. */
const route = useRoute();
const auth = useAuthStore();
const colors = useChartColors();

const summary = ref<UserSummaryPageDTO | null>(null);
const loading = ref(true);
const failed = ref(false);

async function load(): Promise<void> {
  const id = Number(route.params.id);
  loading.value = true;
  failed.value = false;
  try {
    summary.value = (await api.userSummary(id)).summary;
  } catch (error) {
    failed.value = true;
    notifyError(error, t('Profil indisponible'));
  } finally {
    loading.value = false;
  }
}
watch(() => route.params.id, () => void load(), { immediate: true });

const isMe = computed(() => summary.value?.user.id === auth.user?.id);
const today = todayISO();

const stats = computed(() => {
  const s = summary.value?.stats;
  if (!s) return [];
  return [
    { label: t('Tickets en cours'), value: s.openTickets, icon: 'pi pi-ticket' },
    { label: t('Parts terminées (30 j)'), value: s.donePartsLast30, icon: 'pi pi-check-circle' },
    { label: t('Commentaires (30 j)'), value: s.commentsLast30, icon: 'pi pi-comments' },
    { label: t('Actions (30 j)'), value: s.actionsLast30, icon: 'pi pi-bolt' },
    { label: t('Dont via l’API'), value: s.viaApiLast30, icon: 'pi pi-microchip-ai' },
  ];
});

const chartData = computed(() => ({
  labels: (summary.value?.activityByDay ?? []).map((entry) => formatDateShort(entry.day)),
  datasets: [
    {
      label: t('Actions'),
      data: (summary.value?.activityByDay ?? []).map((entry) => entry.count),
      backgroundColor: colors.value.accent,
      borderRadius: 4,
      maxBarThickness: 18,
    },
  ],
}));
const chartOptions = { plugins: { legend: { display: false } }, scales: { x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } }, y: { beginAtZero: true, ticks: { precision: 0 } } } };

/** Résumé court d'une action pour la liste « Activité récente ». */
function describe(activity: UserActivityDTO): { icon: string; text: string; ticketKey?: string; ticketId?: number; title?: string } {
  const data = activity.data;
  switch (data.kind) {
    case 'ticket': {
      const entry = data.entry;
      const base = { ticketKey: data.ticketKey, ticketId: data.ticketId, title: data.ticketTitle };
      if (entry.kind === 'created') return { icon: 'pi pi-plus-circle', text: t('a créé'), ...base };
      if (entry.kind === 'updated' && entry.changes.some((change) => change.field === 'status')) return { icon: 'pi pi-arrow-right-arrow-left', text: t('a déplacé'), ...base };
      if (entry.kind === 'updated') return { icon: 'pi pi-pencil', text: t('a modifié'), ...base };
      if (entry.kind === 'assignees') return { icon: 'pi pi-users', text: t('a changé les assignés de'), ...base };
      if (entry.kind === 'part') return { icon: 'pi pi-check-circle', text: t('a mis à jour une part de'), ...base };
      if (entry.kind === 'attachment') return { icon: 'pi pi-paperclip', text: entry.action === 'added' ? t('a joint un fichier à') : t('a retiré un fichier de'), ...base };
      if (entry.kind === 'subtask') return { icon: 'pi pi-list-check', text: `${SUBTASK_ACTIONS[entry.action]} « ${entry.title} » ${t('sur')}`, ...base };
      return { icon: 'pi pi-link', text: t('a modifié les dépendances de'), ...base };
    }
    case 'ticket_deleted':
      return { icon: 'pi pi-trash', text: t('a supprimé'), ticketKey: data.ticketKey, title: data.ticketTitle };
    case 'comment':
      return { icon: 'pi pi-comment', text: data.action === 'created' ? t('a commenté') : t('a supprimé un commentaire sur'), ticketKey: data.ticketKey, ticketId: data.ticketId, title: data.ticketTitle };
    case 'member':
      return { icon: 'pi pi-user-plus', text: t('a modifié les membres du projet') };
    default:
      return { icon: 'pi pi-cog', text: t('a modifié la configuration du projet') };
  }
}

function dueClass(endDate: string | null): string {
  return endDate && endDate < today ? 'late' : '';
}
</script>

<template>
  <div class="page">
    <div v-if="loading && !summary" class="stack">
      <Skeleton height="5rem" />
      <Skeleton height="12rem" />
    </div>
    <p v-else-if="failed && !summary" class="muted">{{ $t('Cet utilisateur est introuvable.') }}</p>

    <template v-else-if="summary">
      <header class="profile card">
        <UserAvatar :user="summary.user" size="xlarge" />
        <div class="grow">
          <h1 class="page-title name">{{ summary.user.name }} <Tag v-if="!summary.user.isActive" :value="$t('Désactivé')" severity="contrast" /></h1>
          <p class="muted">{{ summary.user.email }}</p>
          <p v-if="isMe" class="muted small">{{ $t('Votre activité, telle que la voient vos collègues dans les projets communs.') }}</p>
        </div>
      </header>

      <div class="stats">
        <div v-for="stat in stats" :key="stat.label" class="stat card">
          <i :class="stat.icon" class="stat-icon"></i>
          <strong class="stat-value">{{ stat.value }}</strong>
          <span class="muted small">{{ stat.label }}</span>
        </div>
      </div>

      <ChartCard :title="$t('Activité des 30 derniers jours')" :subtitle="$t('Nombre d\'actions par jour')" type="bar" :data="chartData" :options="chartOptions" :height="200" :empty="!summary.stats.actionsLast30" />

      <div class="columns">
        <section class="card block">
          <h2 class="block-title"><i class="pi pi-ticket"></i> {{ $t('Tickets assignés en cours') }} <span class="muted">{{ summary.assigned.length }}</span></h2>
          <p v-if="!summary.assigned.length" class="muted small">{{ $t('Aucun ticket en cours.') }}</p>
          <ul v-else class="list">
            <li v-for="ticket in summary.assigned" :key="ticket.id">
              <router-link :to="{ name: 'project', params: { projectId: ticket.projectId }, query: { ticket: String(ticket.id) } }" class="ticket">
                <span class="key">{{ ticket.key }}</span>
                <span class="grow truncate" :class="{ done: ticket.partDone }">{{ ticket.title }}</span>
                <StatusTag :status="ticket.status" compact />
                <span v-if="ticket.endDate" class="small due" :class="dueClass(ticket.endDate)"><i class="pi pi-calendar"></i> {{ formatDateShort(ticket.endDate) }}</span>
              </router-link>
              <ProgressBar :value="ticket.partDone ? 100 : ticket.partProgress" :show-value="false" class="part" />
            </li>
          </ul>
        </section>

        <section class="card block">
          <h2 class="block-title"><i class="pi pi-th-large"></i> {{ $t('Projets') }} <span class="muted">{{ summary.projects.length }}</span></h2>
          <p v-if="!summary.projects.length" class="muted small">{{ $t('Aucun projet en commun.') }}</p>
          <ul v-else class="list">
            <li v-for="project in summary.projects" :key="project.id">
              <router-link :to="{ name: 'project', params: { projectId: project.id } }" class="ticket">
                <span class="key">{{ project.key }}</span>
                <span class="grow truncate">{{ project.name }}</span>
                <Tag :value="$t(project.roleName)" severity="secondary" />
              </router-link>
            </li>
          </ul>
        </section>
      </div>

      <section class="card block">
        <h2 class="block-title"><i class="pi pi-history"></i> {{ $t('Activité récente') }}</h2>
        <p v-if="!summary.recent.length" class="muted small">{{ $t('Aucune action ces 30 derniers jours.') }}</p>
        <ul v-else class="list">
          <li v-for="activity in summary.recent" :key="activity.id" class="activity">
            <i :class="describe(activity).icon" class="activity-icon"></i>
            <span class="grow">
              {{ describe(activity).text }}
              <router-link v-if="describe(activity).ticketId" :to="{ name: 'project', params: { projectId: activity.projectId }, query: { ticket: String(describe(activity).ticketId) } }" class="key">{{ describe(activity).ticketKey }}</router-link>
              <span v-else-if="describe(activity).ticketKey" class="key">{{ describe(activity).ticketKey }}</span>
              <span v-if="describe(activity).title" class="muted"> « {{ describe(activity).title }} »</span>
              <span class="muted small"> — {{ activity.projectName }}</span>
              <span v-if="activity.via" class="via small"><i class="pi pi-microchip-ai"></i> {{ $t('via « {via} »', { via: activity.via }) }}</span>
            </span>
            <time class="muted small when" :datetime="activity.createdAt" :title="formatDateTime(activity.createdAt)">{{ formatRelative(activity.createdAt) }}</time>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.profile {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  padding: 1.25rem 1.5rem;
}
.name {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin: 0;
}
.profile p {
  margin: 0.2rem 0 0;
}
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 0.75rem;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.9rem 1rem;
}
.stat-icon {
  color: var(--fb-accent);
}
.stat-value {
  font-size: 1.6rem;
  line-height: 1.1;
}
.columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 26rem), 1fr));
  gap: 1rem;
  align-items: start;
}
.block {
  padding: 1rem 1.2rem;
}
.block-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.75rem;
  font-size: 1rem;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.ticket {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.3rem 0.4rem;
  border-radius: 8px;
  color: var(--fb-text);
  text-decoration: none;
}
.ticket:hover {
  background: var(--fb-accent-soft);
}
.key {
  flex: none;
  font-size: 0.75rem;
  font-weight: 800;
  color: var(--fb-accent);
}
.done {
  text-decoration: line-through;
  color: var(--fb-muted);
}
.due.late {
  color: var(--fb-danger);
  font-weight: 700;
}
.part {
  height: 4px;
  margin: 0 0.4rem 0.2rem;
}
.activity {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  padding: 0.3rem 0;
  border-bottom: 1px solid var(--fb-border);
}
.activity:last-child {
  border-bottom: 0;
}
.activity-icon {
  color: var(--fb-accent);
  font-size: 0.8rem;
}
.via {
  margin-left: 0.4rem;
  color: var(--fb-accent);
  font-weight: 600;
}
.when {
  flex: none;
  white-space: nowrap;
}
</style>
