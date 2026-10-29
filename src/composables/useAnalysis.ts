import { computed, type Ref } from 'vue';
import { TICKET_STATUSES, type TicketStatus } from '@shared/constants';
import { addDays, diffDays, toDayNumber, todayISO } from '@shared/dates';
import { progressOf } from '@/utils/progress';
import type { DeliveryDTO, TicketDTO, UserSummaryDTO } from '@shared/types';
import { useProjectStore } from '@/stores/project';
import { dueDate, isOverdue } from '@/utils/tickets';

import { t } from '@/i18n';
export type AnalysisScope = 'all' | number;

export interface Alert {
  id: string;
  severity: 'danger' | 'warn' | 'info';
  icon: string;
  title: string;
  detail: string;
  tickets: TicketDTO[];
}

export interface PriorityItem {
  ticket: TicketDTO;
  score: number;
  reasons: string[];
}

export interface WorkloadRow {
  key: string;
  label: string;
  user: UserSummaryDTO | null;
  /** Tickets de la personne dans chaque colonne du Kanban. */
  byStatus: Record<TicketStatus, number>;
  done: number;
  active: number;
  blocked: number;
  waiting: number;
}

export interface BurndownSeries {
  labels: string[];
  ideal: Array<number | null>;
  actual: Array<number | null>;
  /** Reste à faire en comptant les tickets « À tester » comme faits (à partir du jour où ils y sont arrivés). */
  withReview: Array<number | null>;
  /** Des tickets sont « À tester » : la courbe orange apporte quelque chose. */
  hasReview: boolean;
}

const clampPercent = (value: number): number => Math.min(100, Math.max(0, Math.round(value)));

/** Jour calendaire local d'un horodatage ISO. */
function localDay(iso: string): string {
  return todayISO(new Date(iso));
}

/** Indicateurs de pilotage d'un périmètre (tout le projet ou une livraison). */
export function useAnalysis(scope: Ref<AnalysisScope>) {
  const project = useProjectStore();
  const today = todayISO();

  const delivery = computed<DeliveryDTO | null>(() => (scope.value === 'all' ? null : (project.deliveriesById.get(scope.value) ?? null)));
  const tickets = computed(() => (scope.value === 'all' ? project.tickets : project.tickets.filter((ticket) => ticket.deliveryId === scope.value)));

  const deliveryOf = (ticket: TicketDTO): DeliveryDTO | undefined => (ticket.deliveryId ? project.deliveriesById.get(ticket.deliveryId) : undefined);

  const byStatus = computed(() => {
    const counts = Object.fromEntries(TICKET_STATUSES.map((status) => [status, 0])) as Record<TicketStatus, number>;
    for (const ticket of tickets.value) {
      counts[ticket.status]++;
    }
    return counts;
  });

  const overdue = computed(() => tickets.value.filter((ticket) => isOverdue(ticket, deliveryOf(ticket), today)));
  const blocked = computed(() => tickets.value.filter((ticket) => ticket.status === 'blocked'));
  const unassigned = computed(() => tickets.value.filter((ticket) => ticket.assignees.length === 0 && !['done', 'backlog'].includes(ticket.status)));
  const withoutDelivery = computed(() => (scope.value === 'all' ? project.tickets.filter((ticket) => !ticket.deliveryId && ticket.status !== 'done') : []));
  const slipped = computed(() => tickets.value.filter((ticket) => ticket.initialDeliveryId !== null && ticket.deliveryId !== null && ticket.initialDeliveryId !== ticket.deliveryId));

  const progress = computed(() =>
    tickets.value.length ? clampPercent(tickets.value.reduce((sum, ticket) => sum + progressOf(ticket), 0) / tickets.value.length) : 0,
  );

  /** Période de référence : la livraison choisie, ou l'étendue de toutes les livraisons. */
  const period = computed<{ start: string; end: string } | null>(() => {
    if (delivery.value) {
      return { start: delivery.value.startDate, end: delivery.value.endDate };
    }
    if (project.deliveries.length) {
      return {
        start: project.deliveries.map((d) => d.startDate).sort()[0]!,
        end: project.deliveries.map((d) => d.endDate).sort().at(-1)!,
      };
    }
    return null;
  });

  /** Avancement « théorique » : part du temps écoulé de la période. */
  const theoretical = computed<number | null>(() => {
    const range = period.value;
    if (!range) {
      return null;
    }
    const total = diffDays(range.start, range.end) + 1;
    return clampPercent((((toDayNumber(today) - toDayNumber(range.start)) + 1) / total) * 100);
  });

  const gap = computed(() => (theoretical.value === null ? null : progress.value - theoretical.value));
  const daysLeft = computed(() => (period.value ? diffDays(today, period.value.end) : null));

  const burndown = computed<BurndownSeries>(() => {
    const list = tickets.value;
    const total = list.length;
    let start = period.value?.start;
    let end = period.value?.end;
    if (!start || !end) {
      start = list.map((ticket) => localDay(ticket.createdAt)).sort()[0] ?? today;
      end = today;
    }
    if (toDayNumber(end) < toDayNumber(today) && list.some((ticket) => ticket.status !== 'done')) {
      end = today;
    }
    const doneDay = new Map<string, number>();
    for (const ticket of list) {
      if (ticket.status === 'done') {
        const day = localDay(ticket.completedAt ?? ticket.updatedAt);
        doneDay.set(day, (doneDay.get(day) ?? 0) + 1);
      }
    }
    // Tickets « À tester » : arrivés dans la colonne le jour de leur dernier changement de colonne.
    const reviewDay = new Map<string, number>();
    for (const ticket of list) {
      if (ticket.status === 'review') {
        const day = localDay(ticket.statusChangedAt);
        reviewDay.set(day, (reviewDay.get(day) ?? 0) + 1);
      }
    }
    const days = Math.max(1, diffDays(start, end) + 1);
    const labels: string[] = [];
    const withReview: Array<number | null> = [];
    let inReview = 0;
    for (const [day, count] of reviewDay) {
      if (day < start) inReview += count;
    }
    const ideal: Array<number | null> = [];
    const actual: Array<number | null> = [];
    let remaining = total;
    // Les tickets terminés avant le début de la période sont déjà décomptés.
    for (const [day, count] of doneDay) {
      if (day < start) {
        remaining -= count;
      }
    }
    const startRemaining = remaining;
    for (let index = 0; index < days; index++) {
      const day = addDays(start, index);
      labels.push(day);
      ideal.push(Math.round((startRemaining * (days - 1 - index)) / Math.max(1, days - 1) * 100) / 100);
      remaining -= doneDay.get(day) ?? 0;
      inReview += reviewDay.get(day) ?? 0;
      actual.push(day <= today ? remaining : null);
      withReview.push(day <= today ? Math.max(0, remaining - inReview) : null);
    }
    return { labels, ideal, actual, withReview, hasReview: reviewDay.size > 0 };
  });

  const workload = computed<WorkloadRow[]>(() => {
    const rows = new Map<number | 'none', WorkloadRow>();
    const rowFor = (userId: number | 'none'): WorkloadRow => {
      let row = rows.get(userId);
      if (!row) {
        const user = userId === 'none' ? null : (project.usersById.get(userId) ?? null);
        row = { key: String(userId), label: user?.name ?? t('Non assigné'), user, byStatus: Object.fromEntries(TICKET_STATUSES.map((status) => [status, 0])) as Record<TicketStatus, number>, done: 0, active: 0, blocked: 0, waiting: 0 };
        rows.set(userId, row);
      }
      return row;
    };
    for (const ticket of tickets.value) {
      const owners: Array<number | 'none'> = ticket.assignees.length ? ticket.assignees.map((assignee) => assignee.userId) : ['none'];
      // Réglage du projet : un ticket terminé sans assigné n'est plus du « travail non assigné ».
      if (owners[0] === 'none' && ticket.status === 'done' && project.settings.hideDoneUnassigned) continue;
      for (const owner of owners) {
        const row = rowFor(owner);
        row.byStatus[ticket.status]++;
        if (ticket.status === 'done') row.done++;
        else if (ticket.status === 'blocked') row.blocked++;
        else if (ticket.status === 'in_progress' || ticket.status === 'review') row.active++;
        else row.waiting++;
      }
    }
    return [...rows.values()].sort((a, b) => b.active + b.blocked + b.waiting - (a.active + a.blocked + a.waiting));
  });

  const byCategory = computed(() => {
    const entries = project.categories.map((category) => ({
      id: category.id,
      name: category.name,
      color: category.color,
      count: tickets.value.filter((ticket) => ticket.categoryId === category.id).length,
    }));
    const none = tickets.value.filter((ticket) => !ticket.categoryId).length;
    if (none) {
      entries.push({ id: 0, name: t('Sans catégorie'), color: '#94a3b8', count: none });
    }
    return entries.filter((entry) => entry.count > 0);
  });

  const alerts = computed<Alert[]>(() => {
    const list: Alert[] = [];
    if (gap.value !== null && gap.value <= -10 && period.value && toDayNumber(today) >= toDayNumber(period.value.start)) {
      list.push({
        id: 'behind',
        severity: gap.value <= -25 ? 'danger' : 'warn',
        icon: 'pi pi-chart-line',
        title: t('Avancement en retard sur le planning'),
        detail: t('{value} % réalisé pour {value2} % de temps écoulé ({value3} pts).', { value: progress.value, value2: theoretical.value, value3: gap.value }),
        tickets: [],
      });
    }
    if (overdue.value.length) {
      list.push({ id: 'overdue', severity: 'danger', icon: 'pi pi-clock', title: t('{n} ticket en retard|{n} tickets en retard', { n: overdue.value.length }), detail: t('Échéance dépassée et non terminés.'), tickets: overdue.value });
    }
    if (blocked.value.length) {
      list.push({ id: 'blocked', severity: 'danger', icon: 'pi pi-ban', title: t('{n} ticket bloqué|{n} tickets bloqués', { n: blocked.value.length }), detail: t('Un déblocage est nécessaire.'), tickets: blocked.value });
    }
    if (unassigned.value.length) {
      list.push({ id: 'unassigned', severity: 'warn', icon: 'pi pi-user-minus', title: t('{n} ticket sans responsable|{n} tickets sans responsable', { n: unassigned.value.length }), detail: t('À faire ou en cours, mais personne n’est assigné.'), tickets: unassigned.value });
    }
    if (slipped.value.length) {
      list.push({ id: 'slipped', severity: 'warn', icon: 'pi pi-history', title: t('{n} ticket reporté|{n} tickets reportés', { n: slipped.value.length }), detail: t('Déplacés vers une autre livraison que celle prévue à l’origine.'), tickets: slipped.value });
    }
    if (withoutDelivery.value.length) {
      list.push({ id: 'no-delivery', severity: 'info', icon: 'pi pi-truck', title: t('{n} ticket sans livraison|{n} tickets sans livraison', { n: withoutDelivery.value.length }), detail: t('Non rattachés à une livraison.'), tickets: withoutDelivery.value });
    }
    const loaded = workload.value.filter((row) => row.user && row.active + row.blocked >= 5);
    if (loaded.length) {
      list.push({ id: 'load', severity: 'info', icon: 'pi pi-users', title: t('Charge élevée'), detail: loaded.map((row) => t('{label} ({value} tickets actifs)', { label: row.label, value: row.active + row.blocked })).join(', '), tickets: [] });
    }
    return list;
  });

  const priorities = computed<PriorityItem[]>(() => {
    const items: PriorityItem[] = [];
    for (const ticket of tickets.value) {
      if (ticket.status === 'done') {
        continue;
      }
      const due = dueDate(ticket, deliveryOf(ticket));
      const reasons: string[] = [];
      let score = 0;
      if (isOverdue(ticket, deliveryOf(ticket), today)) {
        score += 5;
        reasons.push(t('En retard'));
      }
      if (ticket.status === 'blocked') {
        score += 4;
        reasons.push(t('Bloqué'));
      }
      if (due && !reasons.includes('En retard')) {
        const left = diffDays(today, due);
        if (left <= 3 && progressOf(ticket) < 60) {
          score += 3;
          reasons.push(left <= 0 ? t('Échéance aujourd\'hui') : t('Échéance dans {left} j', { left }));
        }
      }
      if (ticket.assignees.length === 0 && ticket.status !== 'backlog') {
        score += 2;
        reasons.push(t('Sans responsable'));
      }
      if (ticket.status === 'review') {
        score += 1;
        reasons.push(t('À tester'));
      }
      if (score > 0) {
        items.push({ ticket, score, reasons });
      }
    }
    return items.sort((a, b) => b.score - a.score || (dueDate(a.ticket, deliveryOf(a.ticket)) ?? '9999').localeCompare(dueDate(b.ticket, deliveryOf(b.ticket)) ?? '9999')).slice(0, 8);
  });

  return {
    today, delivery, tickets, byStatus, overdue, blocked, unassigned, progress, period, theoretical, gap, daysLeft,
    burndown, workload, byCategory, alerts, priorities,
  };
}
