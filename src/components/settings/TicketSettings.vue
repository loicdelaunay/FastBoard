<script setup lang="ts">
import { computed } from 'vue';
import ToggleSwitch from 'primevue/toggleswitch';
import type { ProjectSettingsDTO } from '@shared/settings';
import { useProjectStore } from '@/stores/project';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Onglet « Ticket » des réglages du projet : affichage des tickets. */
type Flag = 'hideZeroProgress';

const project = useProjectStore();
const canEdit = computed(() => project.can('project.edit') && !project.archived);

const options: Array<{ key: Flag; title: string; help: string; icon: string }> = [
  {
    key: 'hideZeroProgress',
    title: t('Masquer l’avancement à 0 %'),
    help: t('Les cartes des tickets dont l’avancement est à 0 % n’affichent pas de barre de progression : elle apparaît dès que le travail commence.'),
    icon: 'pi pi-percentage',
  },
];

async function toggle(key: Flag, value: boolean): Promise<void> {
  try {
    await project.updateProjectInfo({ settings: { [key]: value } as Partial<ProjectSettingsDTO> });
  } catch (error) {
    notifyError(error, t('Réglage non enregistré'));
  }
}
</script>

<template>
  <div class="ticket-settings">
    <p v-if="!canEdit" class="muted small">{{ $t('Seules les personnes pouvant configurer le projet modifient ces réglages.') }}</p>
    <section v-for="option in options" :key="option.key" class="row card">
      <i :class="option.icon" class="icon" aria-hidden="true"></i>
      <div class="text">
        <label :for="`ticket-${option.key}`" class="title">{{ option.title }}</label>
        <p class="muted small">{{ option.help }}</p>
      </div>
      <ToggleSwitch :input-id="`ticket-${option.key}`" :model-value="project.settings[option.key]" :disabled="!canEdit" @update:model-value="(value: boolean) => toggle(option.key, value)" />
    </section>
  </div>
</template>

<style scoped>
.ticket-settings {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-width: 42rem;
}
.row {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.2rem;
}
.icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 10px;
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
}
.text {
  flex: 1;
  min-width: 0;
}
.text p {
  margin: 0;
}
.title {
  display: block;
  margin-bottom: 0.15rem;
  font-weight: 700;
}
</style>
