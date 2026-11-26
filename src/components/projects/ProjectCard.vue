<script setup lang="ts">
import Tag from 'primevue/tag';
import type { ProjectSummaryDTO } from '@shared/types';
import ProgressMeter from '@/components/common/ProgressMeter.vue';
import { formatDateShort } from '@shared/dates';
import UserAvatarGroup from '@/components/common/UserAvatarGroup.vue';
import OfflinePinBadge from '@/components/common/OfflinePinBadge.vue';

defineProps<{ project: ProjectSummaryDTO }>();
/** Icône des rôles de projet du système ; un rôle personnalisé prend une carte d'identité. */
const ROLE_ICONS: Record<string, string> = { owner: 'pi pi-crown', manager: 'pi pi-briefcase', editor: 'pi pi-pencil', contributor: 'pi pi-user-edit', viewer: 'pi pi-eye' };
const emit = defineEmits<{ menu: [event: MouseEvent, project: ProjectSummaryDTO] }>();
</script>

<template>
  <router-link :to="{ path: `/p/${project.id}` }" class="project-card card module-card module-projects" :class="{ archived: project.archived }" @contextmenu.prevent="emit('menu', $event, project)">
    <div class="top">
      <span class="key">{{ project.key }}</span>
      <OfflinePinBadge kind="project" :id="project.id" class="pin" />
      <Tag v-if="project.archived" :value="$t('Archivé')" severity="secondary" />
      <!-- Rôle en icône, son nom au survol ; sans rôle, le projet n'est visible que par les droits d'administration. -->
      <span v-else-if="project.myRoleName" v-tooltip.top="$t(project.myRoleName)" class="role" role="img" :aria-label="$t(project.myRoleName)" tabindex="0"><i :class="ROLE_ICONS[project.myRoleKey ?? ''] ?? 'pi pi-id-card'"></i></span>
      <span
        v-else
        v-tooltip.top="$t('Accès avec droit admin : vous n’êtes pas membre de ce projet, vous le voyez grâce à vos droits d’administration.')"
        class="role admin"
        role="img"
        :aria-label="$t('Accès avec droit admin')"
        tabindex="0"
        ><i class="pi pi-shield"></i
      ></span>
    </div>
    <h3 class="name">{{ project.name }}</h3>
    <p class="description muted small">{{ project.description || $t('Aucune description.') }}</p>

    <!-- Livraison en cours : avancement comparé au temps déjà écoulé. -->
    <div v-if="project.currentDelivery && !project.archived" class="progress release" :style="{ '--d': project.currentDelivery.color }">
      <div class="release-head">
        <span class="release-name truncate"><i class="pi pi-truck"></i> {{ project.currentDelivery.name }}</span>
        <span class="muted small">{{ formatDateShort(project.currentDelivery.endDate) }}</span>
      </div>
      <div class="bar-row">
        <span class="muted small bar-label">{{ $t('Avancement') }}</span>
        <ProgressMeter :value="project.currentDelivery.progress" />
      </div>
      <div class="bar-row">
        <span class="muted small bar-label">{{ $t('Temps écoulé') }}</span>
        <div class="time-bar" role="progressbar" :aria-valuenow="project.currentDelivery.timeElapsed" aria-valuemin="0" aria-valuemax="100" :aria-label="$t('Temps écoulé')">
          <span :style="{ width: `${project.currentDelivery.timeElapsed}%` }"></span>
        </div>
        <span class="muted small pct">{{ project.currentDelivery.timeElapsed }}%</span>
      </div>
      <span class="small" :class="project.currentDelivery.progress + 5 < project.currentDelivery.timeElapsed ? 'late' : 'muted'">
        {{ project.currentDelivery.progress + 5 < project.currentDelivery.timeElapsed ? $t('En retard sur le calendrier') : $t('Dans les temps') }}
        · {{ $t('{n} jour restant|{n} jours restants', { n: project.currentDelivery.daysLeft }) }}
        · {{ $t('{doneCount} / {ticketCount} tickets terminés', { doneCount: project.currentDelivery.doneCount, ticketCount: project.currentDelivery.ticketCount }) }}
      </span>
    </div>
    <div v-else class="progress">
      <ProgressMeter :value="project.progress" />
      <span class="muted small">{{ $t('{doneCount} / {ticketCount} tickets terminés', { doneCount: project.doneCount, ticketCount: project.ticketCount }) }}</span>
    </div>

    <div class="bottom">
      <UserAvatarGroup :users="project.memberPreview" :max="5" />
      <span class="muted small"><i class="pi pi-users"></i> {{ project.memberCount }}</span>
    </div>
  </router-link>
</template>

<style scoped>
.project-card {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 1.1rem 1.15rem;
  color: var(--fb-text);
  transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
}
.project-card:hover,
.project-card:focus-visible {
  transform: translateY(-2px);
  border-color: var(--fb-accent);
  box-shadow: var(--fb-shadow-lg);
}
.archived {
  opacity: 0.7;
}
.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.top .pin {
  margin-left: auto;
}
.key {
  padding: 0.1rem 0.5rem;
  border-radius: 6px;
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.04em;
}
.role {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 999px;
  background: var(--fb-panel-alt);
  color: var(--fb-muted);
  font-size: 0.8rem;
  cursor: help;
}
.role.admin {
  background: color-mix(in srgb, #f59e0b 18%, transparent);
  color: #b45309;
}
:global(.app-dark) .role.admin {
  color: #fbbf24;
}
.name {
  font-size: 1.1rem;
  font-weight: 700;
}
.description {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 2.4em;
}
.release-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.release-name {
  font-size: 0.82rem;
  font-weight: 700;
  color: color-mix(in srgb, var(--d) 70%, var(--fb-text));
}
.bar-row {
  display: grid;
  grid-template-columns: 5.5rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.5rem;
}
.bar-row :deep(.progress-meter),
.bar-row > :nth-child(2) {
  grid-column: 2;
}
.time-bar {
  height: 6px;
  border-radius: 999px;
  background: var(--fb-panel-alt);
  overflow: hidden;
}
.time-bar span {
  display: block;
  height: 100%;
  background: color-mix(in srgb, var(--fb-muted) 70%, transparent);
}
.pct {
  min-width: 2.4rem;
  text-align: right;
}
.late {
  color: var(--fb-danger);
  font-weight: 600;
}
.progress {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-top: 0.25rem;
}
.bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  padding-top: 0.4rem;
}
</style>
