<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useConfirm } from 'primevue/useconfirm';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import ToggleSwitch from 'primevue/toggleswitch';
import { todayISO } from '@shared/dates';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { downloadFile } from '@/utils/csv';
import { useProjectStore } from '@/stores/project';
import { notify, notifyError } from '@/utils/notify';

import { t } from '@/i18n';
const project = useProjectStore();
const auth = useAuthStore();
const router = useRouter();
const confirm = useConfirm();

const name = ref('');
const key = ref('');
const description = ref('');
const saving = ref(false);

watch(
  () => project.project,
  (value) => {
    if (value) {
      name.value = value.name;
      key.value = value.key;
      description.value = value.description;
    }
  },
  { immediate: true },
);

const canEdit = computed(() => project.can('project.edit'));
const keyValid = computed(() => /^[A-Za-z0-9]{2,8}$/.test(key.value));
const dirty = computed(
  () => name.value.trim() !== project.project?.name || key.value.toUpperCase() !== project.project?.key || description.value.trim() !== project.project?.description,
);

async function save(): Promise<void> {
  saving.value = true;
  try {
    await project.updateProjectInfo({ name: name.value.trim(), key: key.value.toUpperCase(), description: description.value.trim() });
    notify('success', t('Projet mis à jour'));
  } catch (error) {
    notifyError(error);
  } finally {
    saving.value = false;
  }
}

async function toggleArchive(value: boolean): Promise<void> {
  try {
    await project.updateProjectInfo({ archived: value });
    notify('info', value ? t('Projet archivé') : t('Projet réactivé'), value ? t('Il est désormais en lecture seule.') : undefined);
  } catch (error) {
    notifyError(error);
  }
}

/** Sauvegarde du projet (tickets, catégories, livraisons, membres) au format JSON. */
async function exportProject(): Promise<void> {
  if (project.projectId === null) return;
  try {
    const snapshot = await api.snapshot(project.projectId);
    const key = (project.project?.key ?? 'projet').toLowerCase();
    downloadFile(`${key}-export-${todayISO()}.json`, JSON.stringify(snapshot, null, 2), 'application/json;charset=utf-8');
  } catch (error) {
    notifyError(error, t('Export impossible'));
  }
}

function askDelete(): void {
  confirm.require({
    header: t('Supprimer définitivement le projet ?'),
    message: t('« {name} » et tous ses tickets, commentaires et historiques seront supprimés. Cette action est irréversible.', { name: project.project?.name }),
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: t('Supprimer le projet'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      if (project.projectId === null) return;
      try {
        await api.deleteProject(project.projectId);
        notify('success', t('Projet supprimé'));
        await router.replace('/');
      } catch (error) {
        notifyError(error);
      }
    },
  });
}

function askLeave(): void {
  confirm.require({
    header: t('Quitter ce projet ?'),
    message: t('Vous perdrez l’accès au projet jusqu’à ce qu’un membre vous réinvite.'),
    icon: 'pi pi-sign-out',
    acceptLabel: t('Quitter'),
    rejectLabel: t('Annuler'),
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      if (project.projectId === null || !auth.user) return;
      try {
        await api.removeMember(project.projectId, auth.user.id);
        await router.replace('/');
      } catch (error) {
        notifyError(error, t('Impossible de quitter le projet'));
      }
    },
  });
}
</script>

<template>
  <div class="general">
    <form class="stack form" @submit.prevent="save">
      <div class="field">
        <label for="s-name">{{ $t('Nom du projet') }}</label>
        <InputText id="s-name" v-model="name" maxlength="100" :disabled="!canEdit" />
      </div>
      <div class="field">
        <label for="s-key">{{ $t('Clé (préfixe des tickets)') }}</label>
        <InputText id="s-key" v-model="key" maxlength="8" :disabled="!canEdit" :invalid="!keyValid" />
        <small class="muted">{{ $t('Les tickets existants affichent immédiatement la nouvelle clé.') }}</small>
      </div>
      <div class="field">
        <label for="s-desc">{{ $t('Description') }}</label>
        <Textarea id="s-desc" v-model="description" rows="3" auto-resize maxlength="2000" :disabled="!canEdit" />
      </div>
      <div v-if="canEdit">
        <Button type="submit" :label="$t('Enregistrer')" icon="pi pi-check" :disabled="!dirty || !name.trim() || !keyValid" :loading="saving" />
      </div>
    </form>

    <section class="zone card">
      <div class="zone-row">
        <div>
          <h4>{{ $t('Exporter le projet') }}</h4>
          <p class="muted small">{{ $t('Télécharge une sauvegarde JSON : tickets, catégories, livraisons et membres.') }}</p>
        </div>
        <Button :label="$t('Exporter')" icon="pi pi-download" severity="secondary" outlined @click="exportProject" />
      </div>
    </section>

    <section v-if="canEdit" class="zone card">
      <div class="zone-row">
        <div>
          <h4>{{ $t('Archiver le projet') }}</h4>
          <p class="muted small">{{ $t('Un projet archivé reste consultable mais plus modifiable (tickets, commentaires).') }}</p>
        </div>
        <ToggleSwitch :model-value="project.archived" :aria-label="$t('Archiver le projet')" @update:model-value="toggleArchive" />
      </div>
    </section>

    <section class="zone card danger">
      <div class="zone-row">
        <div>
          <h4>{{ $t('Quitter le projet') }}</h4>
          <p class="muted small">{{ $t('Retire votre accès. Impossible si vous êtes le dernier propriétaire.') }}</p>
        </div>
        <Button :label="$t('Quitter')" icon="pi pi-sign-out" severity="secondary" outlined @click="askLeave" />
      </div>
      <div v-if="project.can('project.delete')" class="zone-row">
        <div>
          <h4>{{ $t('Supprimer le projet') }}</h4>
          <p class="muted small">{{ $t('Supprime définitivement le projet et toutes ses données.') }}</p>
        </div>
        <Button :label="$t('Supprimer')" icon="pi pi-trash" severity="danger" @click="askDelete" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.general {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  max-width: 40rem;
}
.zone {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem 1.2rem;
}
.zone.danger {
  border-color: color-mix(in srgb, var(--fb-danger) 40%, var(--fb-border));
}
.zone-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.zone-row h4 {
  margin-bottom: 0.15rem;
}
</style>
