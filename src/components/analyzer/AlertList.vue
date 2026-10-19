<script setup lang="ts">
import { ref } from 'vue';
import type { Alert } from '@/composables/useAnalysis';
import { useProjectStore } from '@/stores/project';
import { ticketKey } from '@/utils/tickets';

defineProps<{ alerts: Alert[] }>();
const emit = defineEmits<{ open: [ticketId: number] }>();

const project = useProjectStore();
const expanded = ref(new Set<string>());

function toggle(id: string): void {
  const next = new Set(expanded.value);
  if (!next.delete(id)) {
    next.add(id);
  }
  expanded.value = next;
}
</script>

<template>
  <section class="alerts card">
    <header class="head">
      <h3 class="title">{{ $t('Points de vigilance') }}</h3>
      <span class="muted small">{{ $t('{n} alerte|{n} alertes', { n: alerts.length }) }}</span>
    </header>

    <p v-if="!alerts.length" class="ok"><i class="pi pi-check-circle"></i> {{ $t('Rien à signaler : le périmètre est sous contrôle.') }}</p>

    <ul v-else class="list">
      <li v-for="alert in alerts" :key="alert.id" class="alert" :class="`sev-${alert.severity}`">
        <button type="button" class="summary" :disabled="!alert.tickets.length" :aria-expanded="expanded.has(alert.id)" @click="toggle(alert.id)">
          <i :class="alert.icon" class="icon"></i>
          <span class="text">
            <strong>{{ alert.title }}</strong>
            <span class="muted small">{{ alert.detail }}</span>
          </span>
          <i v-if="alert.tickets.length" :class="expanded.has(alert.id) ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" class="chevron"></i>
        </button>
        <ul v-if="expanded.has(alert.id)" class="tickets">
          <li v-for="ticket in alert.tickets.slice(0, 12)" :key="ticket.id">
            <button type="button" class="ticket" @click="emit('open', ticket.id)">
              <span class="key">{{ ticketKey(project.project, ticket) }}</span>
              <span class="truncate">{{ ticket.title }}</span>
            </button>
          </li>
          <li v-if="alert.tickets.length > 12" class="muted small more">{{ $t('+ {value} autres', { value: alert.tickets.length - 12 }) }}</li>
        </ul>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.alerts {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 1.1rem;
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.title {
  font-size: 0.95rem;
  font-weight: 700;
}
.ok {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  color: #16a34a;
  font-weight: 600;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.alert {
  border: 1px solid color-mix(in srgb, var(--sev) 35%, transparent);
  border-left: 4px solid var(--sev);
  border-radius: 8px;
  background: color-mix(in srgb, var(--sev) 7%, transparent);
}
.sev-danger {
  --sev: #ef4444;
}
.sev-warn {
  --sev: #f59e0b;
}
.sev-info {
  --sev: #0ea5e9;
}
.summary {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.6rem 0.8rem;
  border: 0;
  background: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.summary:disabled {
  cursor: default;
}
.icon {
  color: var(--sev);
}
.text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.chevron {
  color: var(--fb-muted);
  font-size: 0.8rem;
}
.tickets {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0 0.5rem 0.5rem 2.4rem;
  list-style: none;
}
.ticket {
  display: flex;
  gap: 0.6rem;
  width: 100%;
  padding: 0.3rem 0.4rem;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--fb-text);
  font-size: 0.85rem;
  text-align: left;
  cursor: pointer;
}
.ticket:hover {
  background: var(--fb-panel-alt);
}
.key {
  flex: none;
  font-size: 0.72rem;
  font-weight: 800;
  color: var(--fb-muted);
}
.more {
  padding: 0.2rem 0.4rem;
}
</style>
