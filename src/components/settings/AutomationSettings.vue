<script setup lang="ts">
import { computed } from 'vue';
import InputNumber from 'primevue/inputnumber';
import ToggleSwitch from 'primevue/toggleswitch';
import type { ProjectSettingsDTO } from '@shared/settings';
import { useProjectStore } from '@/stores/project';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
type Flag = 'autoMoveDone' | 'autoReopen' | 'confetti' | 'staleIndicator';

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
  {
    key: 'staleIndicator',
    title: t('Mettre un indicateur sur les tickets inactifs'),
    help: t('Des petits points sur chaque carte montrent depuis combien de temps le ticket n\'a pas changé de colonne : gris, puis orange au-delà du seuil, rouge au double. Les tickets terminés ne sont pas concernés.'),
    icon: 'pi pi-hourglass',
  },
];

async function setStaleDays(value: number | null): Promise<void> {
  if (!value || value === project.settings.staleDays) return;
  try {
    await project.updateProjectInfo({ settings: { staleDays: value } });
  } catch (error) {
    notifyError(error, t('Réglage non enregistré'));
  }
}

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
        <label v-if="option.key === 'staleIndicator' && project.settings.staleIndicator" class="days">
          <span class="small">{{ $t('Signaler après') }}</span>
          <InputNumber :model-value="project.settings.staleDays" :min="1" :max="365" show-buttons button-layout="horizontal" size="small" :input-style="{ width: '3.5rem', textAlign: 'center' }" increment-button-icon="pi pi-plus" decrement-button-icon="pi pi-minus" :disabled="!canEdit" :aria-label="$t('Jours sans changement de colonne')" @update:model-value="setStaleDays" />
          <span class="small">{{ $t('jours sans changement de colonne') }}</span>
        </label>
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
.days {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
.title {
  display: block;
  margin-bottom: 0.15rem;
  font-weight: 700;
}
</style>
