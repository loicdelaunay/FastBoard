<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useProjectStore } from '@/stores/project';
import { useUiStore } from '@/stores/ui';
import { linkReasonLabel } from '@/utils/historyFormat';

/**
 * Liens dessinés entre le ticket survolé et ses dépendances visibles sur le tableau (courbes animées, raison au milieu).
 * Superposé au tableau, sans intercepter la souris.
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
}
const lines = ref<Line[]>([]);
const size = ref({ width: 0, height: 0 });

function cardRect(ticketId: number): DOMRect | null {
  const card = props.container?.querySelector<HTMLElement>(`.ticket-card[data-ticket-id="${ticketId}"]`);
  if (!card) return null;
  const rect = card.getBoundingClientRect();
  // Carte masquée par le défilement d'une colonne : pas de lien.
  const column = card.closest('.cards');
  const bounds = column?.getBoundingClientRect();
  if (bounds && (rect.bottom < bounds.top || rect.top > bounds.bottom)) return null;
  return rect;
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
  const source = cardRect(hovered);
  if (!source) {
    lines.value = [];
    return;
  }
  const next: Line[] = [];
  for (const link of project.linksOf(hovered)) {
    const target = cardRect(link.other.id);
    if (!target) continue;
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
      <path :d="line.d" class="line" :marker-end="line.incoming ? undefined : 'url(#fb-dep-arrow)'" :marker-start="line.incoming ? 'url(#fb-dep-arrow)' : undefined" />
      <text :x="line.labelX" :y="line.labelY - 6" class="label" text-anchor="middle">{{ line.reason }}</text>
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
.arrow {
  fill: var(--fb-accent);
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
  .line {
    animation: none;
  }
}
</style>
