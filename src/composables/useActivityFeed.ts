import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { todayISO, addDays } from '@shared/dates';
import type { ActivityCommentDTO, ActivityDTO, ActivityGroup } from '@shared/types';
import { api } from '@/api';
import { realtime } from '@/realtime/socket';
import { useProjectStore } from '@/stores/project';
import { notifyError } from '@/utils/notify';
import { matchesQuery } from '@/utils/search';

import { t, intlLocale } from '@/i18n';
export type GroupFilter = 'all' | ActivityGroup;

const dayFormat = new Intl.DateTimeFormat(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
const dayYearFormat = new Intl.DateTimeFormat(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function dayKey(iso: string): string {
  return todayISO(new Date(iso));
}

function dayLabel(key: string): string {
  const today = todayISO();
  if (key === today) return t("Aujourd'hui");
  if (key === addDays(today, -1)) return t('Hier');
  const date = new Date(`${key}T12:00:00`);
  const label = (key.slice(0, 4) === today.slice(0, 4) ? dayFormat : dayYearFormat).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Textes recherchables d'un évènement (auteur, ticket, extrait…). */
function searchableText(activity: ActivityDTO, authorName: string | undefined): string[] {
  const data = activity.data;
  const parts: Array<string | undefined> = [authorName, activity.via ?? undefined];
  switch (data.kind) {
    case 'ticket':
      parts.push(data.ticketKey, data.ticketTitle);
      if (data.entry.kind === 'assignees') parts.push(...data.entry.added.map((u) => u.name), ...data.entry.removed.map((u) => u.name));
      if (data.entry.kind === 'part') parts.push(data.entry.user.name);
      if (data.entry.kind === 'subtask') parts.push(data.entry.title, data.entry.previousTitle);
      if (data.entry.kind === 'link') parts.push(data.entry.reason, data.entry.target.key, data.entry.target.title);
      if (data.entry.kind === 'created') parts.push(...(data.entry.assignees ?? []).map((u) => u.name));
      break;
    case 'ticket_deleted':
      parts.push(data.ticketKey, data.ticketTitle);
      break;
    case 'ticket_transferred':
      parts.push(data.ticketKey, data.ticketTitle, data.otherProject, data.otherKey);
      break;
    case 'comment':
      parts.push(data.ticketKey, data.ticketTitle, data.excerpt);
      break;
    case 'category':
    case 'priority':
    case 'component':
    case 'delivery':
      parts.push(data.name, data.previousName);
      break;
    case 'member':
      parts.push(data.user.name, data.role);
      break;
    default:
      break;
  }
  return parts.filter((part): part is string => Boolean(part));
}

/** Fil d'activité du projet courant : chargement paginé, filtres côté serveur, insertion en direct. */
export function useActivityFeed() {
  const project = useProjectStore();
  /** Origine des actions : toutes, interface uniquement, ou API (agents, scripts) uniquement. */
  const filters = reactive({ group: 'all' as GroupFilter, userId: null as number | null, source: 'all' as 'all' | 'ui' | 'api', search: '' });
  const items = ref<ActivityDTO[]>([]);
  const nextBefore = ref<number | null>(null);
  const loading = ref(true);
  const loadingMore = ref(false);
  const fresh = ref(new Set<number>());
  let generation = 0;

  function serverFilters() {
    return {
      group: filters.group === 'all' ? undefined : [filters.group],
      userId: filters.userId ?? undefined,
      source: filters.source === 'all' ? undefined : filters.source,
    };
  }

  async function load(): Promise<void> {
    const id = project.projectId;
    if (id === null) return;
    const current = ++generation;
    loading.value = true;
    try {
      const page = await api.activity(id, serverFilters());
      if (current === generation) {
        items.value = page.activities;
        nextBefore.value = page.nextBefore;
      }
    } catch (error) {
      notifyError(error, t('Activité indisponible'));
    } finally {
      if (current === generation) loading.value = false;
    }
  }

  async function loadMore(): Promise<void> {
    const id = project.projectId;
    if (id === null || nextBefore.value === null || loadingMore.value) return;
    loadingMore.value = true;
    const current = generation;
    try {
      const page = await api.activity(id, { ...serverFilters(), before: nextBefore.value });
      if (current === generation) {
        const known = new Set(items.value.map((item) => item.id));
        items.value = [...items.value, ...page.activities.filter((item) => !known.has(item.id))];
        nextBefore.value = page.nextBefore;
      }
    } catch (error) {
      notifyError(error, t('Impossible de charger la suite'));
    } finally {
      loadingMore.value = false;
    }
  }

  /** Un évènement reçu en direct correspond-il aux filtres serveur actuels ? */
  function matchesFilters(activity: ActivityDTO): boolean {
    return (
      (filters.group === 'all' || activity.group === filters.group) &&
      (filters.userId === null || activity.userId === filters.userId) &&
      (filters.source === 'all' || (filters.source === 'api') === (activity.via !== null))
    );
  }

  /** Ajoute ou remplace un commentaire (réponse de l'API ou évènement temps réel, sans doublon). */
  function upsertComment(comment: ActivityCommentDTO): void {
    const item = items.value.find((entry) => entry.id === comment.activityId);
    if (!item) return;
    const list = item.comments ?? [];
    const index = list.findIndex((entry) => entry.id === comment.id);
    item.comments = index >= 0 ? list.map((entry) => (entry.id === comment.id ? comment : entry)) : [...list, comment];
  }

  const stopComments = realtime.on('event', (event, meta) => {
    if (event.type === 'activity.comment' && meta.projectId === project.projectId) upsertComment(event.comment);
  });

  const stopListening = realtime.on('event', (event, meta) => {
    if (event.type !== 'activity.created' || meta.projectId !== project.projectId || !matchesFilters(event.activity)) return;
    if (items.value.some((item) => item.id === event.activity.id)) return;
    items.value = [event.activity, ...items.value];
    fresh.value = new Set(fresh.value).add(event.activity.id);
    window.setTimeout(() => {
      const next = new Set(fresh.value);
      next.delete(event.activity.id);
      fresh.value = next;
    }, 2200);
  });
  const stopResync = realtime.on('resync', () => void load());

  onMounted(() => {
    project.setActivityViewOpen(true);
    void load();
  });
  onBeforeUnmount(() => {
    stopListening();
    stopComments();
    stopResync();
    project.setActivityViewOpen(false);
  });

  watch(() => [filters.group, filters.userId, filters.source], () => void load());
  watch(() => project.projectId, () => void load());

  const visible = computed(() =>
    filters.search.trim()
      ? items.value.filter((activity) =>
          matchesQuery(filters.search, searchableText(activity, activity.userId ? project.usersById.get(activity.userId)?.name : undefined)),
        )
      : items.value,
  );

  const days = computed(() => {
    const groups: Array<{ key: string; label: string; items: ActivityDTO[] }> = [];
    for (const activity of visible.value) {
      const key = dayKey(activity.createdAt);
      const last = groups.at(-1);
      if (last && last.key === key) {
        last.items.push(activity);
      } else {
        groups.push({ key, label: dayLabel(key), items: [activity] });
      }
    }
    return groups;
  });

  const activeFilters = computed(() => Number(filters.group !== 'all') + Number(filters.userId !== null) + Number(filters.source !== 'all') + Number(Boolean(filters.search.trim())));

  function reset(): void {
    filters.group = 'all';
    filters.userId = null;
    filters.source = 'all';
    filters.search = '';
  }

  return { filters, items, days, loading, loadingMore, hasMore: computed(() => nextBefore.value !== null), fresh, activeFilters, load, loadMore, reset, upsertComment };
}
