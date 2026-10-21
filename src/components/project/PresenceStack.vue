<script setup lang="ts">
import { computed } from 'vue';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/project';

import { t } from '@/i18n';
const auth = useAuthStore();
const project = useProjectStore();

/** Collègues connectés sur ce projet (hors moi). */
const others = computed(() =>
  project.presence
    .filter((entry) => entry.userId !== auth.user?.id)
    .map((entry) => ({ entry, user: project.usersById.get(entry.userId) }))
    .filter((item): item is { entry: typeof item.entry; user: NonNullable<typeof item.user> } => item.user !== undefined),
);

const VIEW_LABELS: Record<string, string> = { analyzer: t('Analyseur'), list: t('Liste'), kanban: 'Kanban', gantt: 'Gantt', activity: t('Activités'), settings: t('Réglages') };

function where(entry: (typeof others.value)[number]['entry']): string {
  const views = entry.views.map((view) => VIEW_LABELS[view] ?? view).join(', ');
  const tickets = entry.ticketIds.flatMap((id) => {
    const ticket = project.ticketsById.get(id);
    return ticket ? [`${project.project?.key ?? '#'}-${ticket.number}`] : [];
  });
  return [views, tickets.length ? t('sur {keys}', { keys: tickets.join(', ') }) : ''].filter(Boolean).join(' · ') || t('en ligne');
}
</script>

<template>
  <div v-if="others.length" class="presence" :aria-label="$t('Collègues connectés')">
    <span v-for="item in others.slice(0, 6)" :key="item.user.id" v-tooltip.bottom="`${item.user.name} — ${where(item.entry)}`" class="who">
      <UserAvatar :user="item.user" ring="online" />
    </span>
    <!-- Survol (ou focus clavier) : liste complète des personnes connectées. -->
    <div class="online" tabindex="0" :aria-label="$t('{length} en ligne', { length: others.length })">
      <span v-if="others.length > 6" class="more">+{{ others.length - 6 }}</span>
      <span class="label muted small">{{ $t('{length} en ligne', { length: others.length }) }}</span>
      <div class="panel" role="tooltip">
        <p class="panel-title">{{ $t('Connectés sur ce projet') }}</p>
        <ul class="list">
          <li v-for="item in others" :key="item.user.id" class="row">
            <UserAvatar :user="item.user" size="small" ring="online" />
            <span class="grow">
              <strong class="truncate name">{{ item.user.name }}</strong>
              <span class="muted small truncate">{{ where(item.entry) }}</span>
            </span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.presence {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.who {
  display: inline-flex;
}
.online {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.15rem 0.3rem;
  border-radius: 6px;
  cursor: default;
}
.online:hover,
.online:focus-visible {
  background: var(--fb-panel-alt);
  outline: none;
}
.more {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--fb-muted);
}
.panel {
  position: absolute;
  z-index: 40;
  top: calc(100% + 6px);
  right: 0;
  display: none;
  width: 17rem;
  max-height: 22rem;
  overflow-y: auto;
  padding: 0.5rem;
  border: 1px solid var(--fb-border);
  border-radius: 10px;
  background: var(--fb-panel);
  box-shadow: 0 12px 30px rgb(0 0 0 / 20%);
}
.online:hover .panel,
.online:focus-within .panel {
  display: block;
}
.panel-title {
  margin: 0 0.25rem 0.4rem;
  font-size: 0.7rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--fb-muted);
}
.list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.list .row {
  gap: 0.5rem;
  padding: 0.25rem;
}
.grow {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.name {
  font-size: 0.85rem;
}
@media (max-width: 800px) {
  .label {
    display: none;
  }
}
</style>
