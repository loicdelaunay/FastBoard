import { computed, ref, type Ref } from 'vue';
import { toDayNumber } from '@shared/dates';
import { ticketProgress } from '@shared/progress';
import type { TicketDTO } from '@shared/types';
import { useProjectStore } from '@/stores/project';
import { resolveRange, type ScheduleRange } from '@/utils/tickets';

import { t } from '@/i18n';
export type GanttGroupBy = 'delivery' | 'assignee' | 'none';

export interface GanttGroupRow {
  kind: 'group';
  id: string;
  title: string;
  subtitle: string;
  color: string;
  range: { start: string; end: string } | null;
  progress: number;
  count: number;
  badge: { label: string; level: 'medium' | 'high' } | null;
  collapsed: boolean;
}

export interface GanttTicketRow {
  kind: 'ticket';
  id: string;
  ticket: TicketDTO;
  range: ScheduleRange | null;
  color: string;
  progress: number;
}

export type GanttRow = GanttGroupRow | GanttTicketRow;

function averageProgress(tickets: TicketDTO[]): number {
  return tickets.length ? Math.round(tickets.reduce((sum, ticket) => sum + ticketProgress(ticket), 0) / tickets.length) : 0;
}

/** Plus grand nombre de tickets actifs simultanés (balayage des bornes de dates). */
function peakLoad(ranges: Array<{ start: string; end: string }>): number {
  const events: Array<[number, number]> = [];
  for (const range of ranges) {
    events.push([toDayNumber(range.start), 1], [toDayNumber(range.end) + 1, -1]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0;
  let peak = 0;
  for (const [, delta] of events) {
    current += delta;
    peak = Math.max(peak, current);
  }
  return peak;
}

function workloadBadge(tickets: Array<{ ticket: TicketDTO; range: ScheduleRange | null }>): GanttGroupRow['badge'] {
  const active = tickets.filter((entry) => entry.ticket.status !== 'done' && entry.range).map((entry) => entry.range!);
  const peak = peakLoad(active);
  if (peak >= 4) {
    return { label: t('Surcharge'), level: 'high' };
  }
  if (peak === 3) {
    return { label: t('Chargé'), level: 'medium' };
  }
  return null;
}

export function useGanttRows(tickets: Ref<TicketDTO[]>, groupBy: Ref<GanttGroupBy>) {
  const project = useProjectStore();
  const collapsed = ref(new Set<string>());

  function toggle(groupId: string): void {
    const next = new Set(collapsed.value);
    if (!next.delete(groupId)) {
      next.add(groupId);
    }
    collapsed.value = next;
  }

  function ticketRow(ticket: TicketDTO, groupId: string): GanttTicketRow {
    const delivery = ticket.deliveryId ? project.deliveriesById.get(ticket.deliveryId) : undefined;
    return {
      kind: 'ticket',
      id: `${groupId}/t${ticket.id}`,
      ticket,
      range: resolveRange(ticket, delivery),
      color: project.statusMeta(ticket.status).color,
      progress: ticketProgress(ticket),
    };
  }

  function sortRows(rows: GanttTicketRow[]): GanttTicketRow[] {
    return rows.sort((a, b) => {
      const sa = a.range?.start ?? '9999';
      const sb = b.range?.start ?? '9999';
      return sa.localeCompare(sb) || a.ticket.number - b.ticket.number;
    });
  }

  function build(
    groupId: string,
    title: string,
    subtitle: string,
    color: string,
    range: GanttGroupRow['range'],
    members: GanttTicketRow[],
    withBadge: boolean,
  ): GanttRow[] {
    const isCollapsed = collapsed.value.has(groupId);
    const group: GanttGroupRow = {
      kind: 'group',
      id: groupId,
      title,
      subtitle,
      color,
      range,
      progress: averageProgress(members.map((row) => row.ticket)),
      count: members.length,
      badge: withBadge ? workloadBadge(members) : null,
      collapsed: isCollapsed,
    };
    return isCollapsed ? [group] : [group, ...members];
  }

  const rows = computed<GanttRow[]>(() => {
    const list = tickets.value;
    if (groupBy.value === 'none') {
      return sortRows(list.map((ticket) => ticketRow(ticket, 'all')));
    }

    if (groupBy.value === 'assignee') {
      const result: GanttRow[] = [];
      const people = project.users.map((user) => ({ user, tickets: list.filter((ticket) => ticket.assignees.some((a) => a.userId === user.id)) }));
      for (const { user, tickets: owned } of people) {
        if (!owned.length) {
          continue;
        }
        const id = `u${user.id}`;
        const members = sortRows(owned.map((ticket) => ticketRow(ticket, id)));
        const ranges = members.flatMap((row) => (row.range ? [row.range] : []));
        const range = ranges.length ? { start: ranges.map((r) => r.start).sort()[0]!, end: ranges.map((r) => r.end).sort().at(-1)! } : null;
        result.push(...build(id, user.name, t('{n} en cours', { n: owned.filter((ticket) => ticket.status !== 'done').length }), '#6366f1', range, members, true));
      }
      const unassigned = list.filter((ticket) => ticket.assignees.length === 0);
      if (unassigned.length) {
        result.push(...build('u-none', t('Non assigné'), t('{n} ticket|{n} tickets', { n: unassigned.length }), '#94a3b8', null, sortRows(unassigned.map((t) => ticketRow(t, 'u-none'))), false));
      }
      return result;
    }

    const result: GanttRow[] = [];
    for (const delivery of project.deliveries) {
      const owned = list.filter((ticket) => ticket.deliveryId === delivery.id);
      const id = `d${delivery.id}`;
      result.push(...build(id, delivery.name, '', delivery.color, { start: delivery.startDate, end: delivery.endDate }, sortRows(owned.map((t) => ticketRow(t, id))), false));
    }
    const orphans = list.filter((ticket) => !ticket.deliveryId);
    if (orphans.length) {
      result.push(...build('d-none', t('Sans livraison'), '', '#94a3b8', null, sortRows(orphans.map((t) => ticketRow(t, 'd-none'))), false));
    }
    return result;
  });

  /** Bornes de la frise : tous les tickets planifiés et toutes les livraisons. */
  const bounds = computed<{ start: number; end: number } | null>(() => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    const consider = (start: string, end: string): void => {
      min = Math.min(min, toDayNumber(start));
      max = Math.max(max, toDayNumber(end));
    };
    for (const row of rows.value) {
      if (row.kind === 'ticket' && row.range) {
        consider(row.range.start, row.range.end);
      } else if (row.kind === 'group' && row.range) {
        consider(row.range.start, row.range.end);
      }
    }
    return Number.isFinite(min) ? { start: min, end: max } : null;
  });

  return { rows, bounds, toggle, collapsed, expandAll: () => (collapsed.value = new Set()), collapseAll: () => (collapsed.value = new Set(rows.value.filter((r) => r.kind === 'group').map((r) => r.id))) };
}
