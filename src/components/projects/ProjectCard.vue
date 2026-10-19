<script setup lang="ts">
import Tag from 'primevue/tag';
import type { ProjectSummaryDTO } from '@shared/types';
import ProgressMeter from '@/components/common/ProgressMeter.vue';
import UserAvatarGroup from '@/components/common/UserAvatarGroup.vue';

defineProps<{ project: ProjectSummaryDTO }>();
</script>

<template>
  <router-link :to="{ path: `/p/${project.id}` }" class="project-card card" :class="{ archived: project.archived }">
    <div class="top">
      <span class="key">{{ project.key }}</span>
      <Tag v-if="project.archived" :value="$t('Archivé')" severity="secondary" />
      <span v-else-if="project.myRoleName" class="role muted small">{{ $t(project.myRoleName) }}</span>
    </div>
    <h3 class="name">{{ project.name }}</h3>
    <p class="description muted small">{{ project.description || $t('Aucune description.') }}</p>

    <div class="progress">
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
.key {
  padding: 0.1rem 0.5rem;
  border-radius: 6px;
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.04em;
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
