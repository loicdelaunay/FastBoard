<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useProjectStore } from '@/stores/project';
import { useUiStore } from '@/stores/ui';
import { linkReasonLabel } from '@/utils/historyFormat';
import { ticketKey } from '@/utils/tickets';

import { t } from '@/i18n';

/**
 * Liens dessinés entre le ticket survolé et ses dépendances (courbes animées, raison au milieu). Une dépendance hors de
 * vue est quand même indiquée : flèche vers le bord de sa colonne, à l'endroit où se trouve le ticket (défilement), ou
 * vers l'en-tête de sa colonne quand les filtres la masquent. Superposé au tableau, sans intercepter la souris.
 */
const props = defineProps<{ container: HTMLElement | null }>();

const project = useProjectStore();
const ui = useUiStore();
const svg = ref<SVGSVGElement | null>(null);

interface Line {
  key: string;
  d: string;
  labelX: number;
  labelY: number;
  reason: string;
  incoming: boolean;
  /** Ticket lié hors de vue : repère au bord (sens du défilement) ou sur l'en-tête de la colonne (filtré). */
  ghost: { x: number; y: number; text: string; anchor: 'start' | 'middle' | 'end'; dy: number } | null;
}
const lines = ref<Line[]>([]);
const size = ref({ width: 0, height: 0 });

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/** Où pointer pour un ticket : sa carte si elle est visible, sinon un point au bord de la zone visible. */
interface Target {
  box: Box;
  /** Hors de vue : direction (haut, bas, gauche, droite) ou masqué par les filtres. */
  hidden: 'up' | 'down' | 'left' | 'right' | 'filtered' | null;
}

const point = (x: number, y: number): Box => ({ left: x, right: x, top: y, bottom: y, width: 0, height: 0 });
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function locate(ticketId: number, allowHidden: boolean): Target | null {
  const board = props.container;
  if (!board) return null;
  const view = board.getBoundingClientRect();
  const card = board.querySelector<HTMLElement>(`.ticket-card[data-ticket-id="${ticketId}"]`);
  if (card) {
    const rect = card.getBoundingClientRect();
    if (!allowHidden) return { box: rect, hidden: null };
    const centerY = rect.top + rect.height / 2;
    // Colonne hors du tableau (défilement horizontal) : bord gauche ou droit, à la hauteur du ticket.
    if (rect.right < view.left + 4) return { box: point(view.left + 6, clamp(centerY, view.top + 24, view.bottom - 24)), hidden: 'left' };
    if (rect.left > view.right - 4) return { box: point(view.right - 6, clamp(centerY, view.top + 24, view.bottom - 24)), hidden: 'right' };
    // Carte hors de la zone visible de sa colonne (défilement vertical) : bord haut ou bas de la colonne.
    const bounds = card.closest('.cards')?.getBoundingClientRect();
    const x = clamp(rect.left + rect.width / 2, view.left + 6, view.right - 6);
    if (bounds && rect.bottom < bounds.top + 8) return { box: point(x, bounds.top + 4), hidden: 'up' };
    if (bounds && rect.top > bounds.bottom - 8) return { box: point(x, bounds.bottom - 4), hidden: 'down' };
    return { box: rect, hidden: null };
  }
  // Pas de carte : ticket masqué par les filtres, on montre sa colonne.
  const ticket = project.ticketsById.get(ticketId);
  const head = ticket ? board.querySelector<HTMLElement>(`.column[data-status="${ticket.status}"] .head`) : null;
  if (!allowHidden || !head) return null;
  const rect = head.getBoundingClientRect();
  return { box: point(clamp(rect.left + rect.width / 2, view.left + 6, view.right - 6), rect.bottom), hidden: 'filtered' };
}

function ghostOf(target: Target, ticketId: number, origin: DOMRect): Line['ghost'] {
  if (!target.hidden) return null;
  const ticket = project.ticketsById.get(ticketId);
  const key = ticket ? ticketKey(project.project, ticket) : '';
  const x = target.box.left - origin.left;
  const y = target.box.top - origin.top;
  switch (target.hidden) {
    case 'up':
      return { x, y, text: `↑ ${key}`, anchor: 'middle', dy: 16 };
    case 'down':
      return { x, y, text: `↓ ${key}`, anchor: 'middle', dy: -8 };
    case 'left':
      return { x, y, text: `← ${key}`, anchor: 'start', dy: 18 };
    case 'right':
      return { x, y, text: `${key} →`, anchor: 'end', dy: 18 };
    case 'filtered':
      return { x, y, text: t('{key} (filtré)', { key }), anchor: 'middle', dy: 16 };
  }
}

function compute(): void {
  const hovered = ui.hoveredTicketId;
  const root = svg.value?.parentElement;
  if (hovered === null || !root || !props.container) {
    lines.value = [];
    return;
  }
  const origin = root.getBoundingClientRect();
  size.value = { width: origin.width, height: origin.height };
  const source = locate(hovered, false)?.box;
  if (!source) {
    lines.value = [];
    return;
  }
  const next: Line[] = [];
  for (const link of project.linksOf(hovered)) {
    const located = locate(link.other.id, true);
    if (!located) continue;
    const target = located.box;
    const rightward = target.left >= source.right - 1;
    const leftward = target.right <= source.left + 1;
    // Point d'attache : bord de la carte tourné vers l'autre (côtés), ou bas/haut dans la même colonne.
    let x1: number, y1: number, x2: number, y2: number, c1x: number, c1y: number, c2x: number, c2y: number;
    if (rightward || leftward) {
      x1 = (rightward ? source.right : source.left) - origin.left;
      y1 = source.top + source.height / 2 - origin.top;
      x2 = (rightward ? target.left : target.right) - origin.left;
      y2 = target.top + target.height / 2 - origin.top;
      const bend = Math.max(40, Math.abs(x2 - x1) / 2);
      c1x = x1 + (rightward ? bend : -bend);
      c2x = x2 + (rightward ? -bend : bend);
      c1y = y1;
      c2y = y2;
    } else {
      const below = target.top > source.top;
      x1 = source.right - origin.left - 8;
      y1 = (below ? source.bottom : source.top) - origin.top;
      x2 = target.right - origin.left - 8;
      y2 = (below ? target.top : target.bottom) - origin.top;
      c1x = x1 + 60;
      c2x = x2 + 60;
      c1y = y1;
      c2y = y2;
    }
    next.push({
      key: `${link.id}-${link.incoming}`,
      d: `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`,
      labelX: (x1 + x2) / 2 + (rightward || leftward ? 0 : 50),
      labelY: (y1 + y2) / 2,
      reason: linkReasonLabel(link.reason),
      incoming: link.incoming,
      ghost: ghostOf(located, link.other.id, origin),
    });
  }
  lines.value = next;
}

let frame = 0;
function schedule(): void {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(compute);
}

watch(
  () => ui.hoveredTicketId,
  (id) => {
    if (id !== null) {
      window.addEventListener('scroll', schedule, true);
      window.addEventListener('resize', schedule);
    } else {
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    }
    void nextTick(compute);
  },
);
// Les cartes bougent (évènement temps réel) pendant le survol.
watch(() => project.tickets, schedule, { deep: false });

onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  window.removeEventListener('scroll', schedule, true);
  window.removeEventListener('resize', schedule);
  ui.hoveredTicketId = null;
});
</script>

<template>
  <svg ref="svg" class="dependency-lines" :width="size.width" :height="size.height" aria-hidden="true">
    <defs>
      <marker id="fb-dep-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" class="arrow" />
      </marker>
    </defs>
    <g v-for="line in lines" :key="line.key">
      <!-- Ticket hors de vue : la flèche pointe toujours vers lui (bord de la colonne ou en-tête). -->
      <path :d="line.d" class="line" :class="{ hidden: line.ghost }" :marker-end="line.incoming && !line.ghost ? undefined : 'url(#fb-dep-arrow)'" :marker-start="line.incoming ? 'url(#fb-dep-arrow)' : undefined" />
      <text :x="line.labelX" :y="line.labelY - 6" class="label" text-anchor="middle">{{ line.reason }}</text>
      <g v-if="line.ghost" class="ghost">
        <circle :cx="line.ghost.x" :cy="line.ghost.y" r="5" class="pulse" />
        <text :x="line.ghost.x + (line.ghost.anchor === 'start' ? 8 : line.ghost.anchor === 'end' ? -8 : 0)" :y="line.ghost.y + line.ghost.dy" :text-anchor="line.ghost.anchor" class="label ghost-label">{{ line.ghost.text }}</text>
      </g>
    </g>
  </svg>
</template>

<style scoped>
.dependency-lines {
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
  overflow: visible;
}
.line {
  fill: none;
  stroke: var(--fb-accent);
  stroke-width: 2;
  stroke-dasharray: 6 5;
  opacity: 0.85;
  animation: fb-dash 0.9s linear infinite;
}
.line.hidden {
  stroke-dasharray: 2 5;
}
.arrow {
  fill: var(--fb-accent);
}
.pulse {
  fill: var(--fb-accent);
  opacity: 0.35;
  transform-box: fill-box;
  transform-origin: center;
  animation: fb-dep-pulse 1.2s ease-out infinite;
}
.ghost-label {
  font-size: 11.5px;
}
@keyframes fb-dep-pulse {
  from {
    transform: scale(0.6);
    opacity: 0.6;
  }
  to {
    transform: scale(2.2);
    opacity: 0;
  }
}
.label {
  fill: var(--fb-accent);
  font-size: 11px;
  font-weight: 700;
  paint-order: stroke;
  stroke: var(--fb-bg, #0b1020);
  stroke-width: 4px;
  stroke-linejoin: round;
}
@keyframes fb-dash {
  to {
    stroke-dashoffset: -22;
  }
}
@media (prefers-reduced-motion: reduce) {
  .line,
  .pulse {
    animation: none;
  }
}
</style>
