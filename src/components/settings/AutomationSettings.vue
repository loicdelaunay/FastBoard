<script setup lang="ts">
import { computed } from 'vue';
import ToggleSwitch from 'primevue/toggleswitch';
import type { ProjectSettingsDTO } from '@shared/settings';
import { useProjectStore } from '@/stores/project';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
type Flag = 'autoMoveDone' | 'autoReopen' | 'confetti';

const project = useProjectStore();
const canEdit = computed(() => project.can('project.edit') && !project.archived);

const options: Array<{ key: Flag; title: string; help: string; icon: string }> = [
  {
    key: 'autoMoveDone',
    title: t('Déplacer automatiquement dans « Terminé »'),
    help: t('Quand toutes les personnes assignées ont terminé leur part, le ticket passe tout seul dans la colonne Terminé. Désactivé, il reste où il est : c\'est à vous de le déplacer.'),
    icon: 'pi pi-check-circle',
  },
  {
    key: 'autoReopen',
    title: t('Rouvrir automatiquement un ticket terminé'),
    help: t('Si une part est rouverte (ou quelqu\'un est assigné) sur un ticket terminé, il repasse « En cours ». Désactivé, il reste dans Terminé.'),
    icon: 'pi pi-replay',
  },
  {
    key: 'confetti',
    title: t('Confettis dans la colonne « Terminé »'),
    help: t('Une petite fête chaque fois qu\'un ticket arrive dans Terminé, pour vous comme pour vos collègues. Désactivée automatiquement si votre système réduit les animations.'),
    icon: 'pi pi-sparkles',
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
  <div class="automation">
    <p v-if="!canEdit" class="muted small">{{ $t('Seules les personnes pouvant configurer le projet modifient ces réglages.') }}</p>
    <section v-for="option in options" :key="option.key" class="row card">
      <i :class="option.icon" class="icon" aria-hidden="true"></i>
      <div class="text">
        <label :for="`auto-${option.key}`" class="title">{{ option.title }}</label>
        <p class="muted small">{{ option.help }}</p>
      </div>
      <ToggleSwitch :input-id="`auto-${option.key}`" :model-value="project.settings[option.key]" :disabled="!canEdit" @update:model-value="(value: boolean) => toggle(option.key, value)" />
    </section>
  </div>
</template>

<style scoped>
.automation {
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
.title {
  display: block;
  margin-bottom: 0.15rem;
  font-weight: 700;
}
</style>
