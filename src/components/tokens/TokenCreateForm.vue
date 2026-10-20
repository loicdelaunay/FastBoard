<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import MultiSelect from 'primevue/multiselect';
import Select from 'primevue/select';
import SelectButton from 'primevue/selectbutton';
import type { ProjectSummaryDTO } from '@shared/types';
import { api, type TokenInput } from '@/api';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
const emit = defineEmits<{ created: [secret: string, name: string]; cancel: [] }>();

const projects = ref<ProjectSummaryDTO[]>([]);
const saving = ref(false);
const form = reactive({
  name: '',
  displayName: '',
  scope: 'write' as TokenInput['scope'],
  allProjects: true,
  projectIds: [] as number[],
  expiresInDays: 90 as number | null,
});

const scopeOptions = [
  { label: t('Lecture et écriture'), value: 'write' },
  { label: t('Lecture seule'), value: 'read' },
];
const projectModeOptions = [
  { label: t('Tous mes projets'), value: true },
  { label: t('Sélection'), value: false },
];
const expirationOptions = [
  { label: t('30 jours'), value: 30 },
  { label: t('90 jours'), value: 90 },
  { label: t('1 an'), value: 365 },
  { label: t('N\'expire jamais'), value: null },
];

const valid = computed(() => form.name.trim() !== '' && (form.allProjects || form.projectIds.length > 0));

onMounted(async () => {
  try {
    projects.value = (await api.projects()).projects.filter((project) => !project.archived);
  } catch (error) {
    notifyError(error, t('Projets indisponibles'));
  }
});

async function submit(): Promise<void> {
  saving.value = true;
  try {
    const { secret, token } = await api.createToken({
      name: form.name.trim(),
      displayName: form.displayName.trim() || null,
      scope: form.scope,
      projectIds: form.allProjects ? null : form.projectIds,
      expiresInDays: form.expiresInDays,
    });
    emit('created', secret, token.name);
  } catch (error) {
    notifyError(error, t('Création impossible'));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <form class="stack form" @submit.prevent="submit">
    <div class="field">
      <label for="token-name">{{ $t('Nom du jeton') }}</label>
      <InputText id="token-name" v-model="form.name" maxlength="60" :placeholder="$t('Ex. agent-planning')" autofocus />
      <small class="muted">{{ $t('Identifiant technique du jeton (ex. le nom du script).') }}</small>
    </div>

    <div class="field">
      <label for="token-display-name">{{ $t('Nom d\'affichage (facultatif)') }}</label>
      <InputText id="token-display-name" v-model="form.displayName" maxlength="60" :placeholder="$t('Ex. Claude, Robot de planification')" />
      <small class="muted">{{ $t('Affiché dans l\'activité et l\'historique des tickets à côté de chaque action faite avec ce jeton (« via … »).') }}</small>
    </div>

    <div class="field">
      <label>{{ $t('Droits') }}</label>
      <SelectButton v-model="form.scope" :options="scopeOptions" option-label="label" option-value="value" :allow-empty="false" :aria-label="$t('Droits du jeton')" />
      <small class="muted">
        {{ form.scope === 'read' ? $t('Peut consulter le tableau, jamais le modifier.') : $t('Peut créer, déplacer et commenter les tickets, avec vos droits.') }}
      </small>
    </div>

    <div class="field">
      <label>{{ $t('Projets accessibles') }}</label>
      <SelectButton v-model="form.allProjects" :options="projectModeOptions" option-label="label" option-value="value" :allow-empty="false" :aria-label="$t('Projets accessibles')" />
      <MultiSelect
        v-if="!form.allProjects"
        v-model="form.projectIds"
        :options="projects"
        option-label="name"
        option-value="id"
        :placeholder="$t('Choisir les projets')"
        display="chip"
        filter
        :empty-message="$t('Aucun projet disponible')"
      />
      <small class="muted">{{ $t('Recommandé pour un agent : limitez-le aux projets sur lesquels il doit travailler.') }}</small>
    </div>

    <div class="field">
      <label for="token-expiration">{{ $t('Expiration') }}</label>
      <Select v-model="form.expiresInDays" input-id="token-expiration" :options="expirationOptions" option-label="label" option-value="value" />
    </div>

    <div class="actions">
      <Button type="button" :label="$t('Annuler')" severity="secondary" text @click="emit('cancel')" />
      <Button type="submit" :label="$t('Générer le jeton')" icon="pi pi-key" :disabled="!valid" :loading="saving" />
    </div>
  </form>
</template>

<style scoped>
.form {
  padding: 1rem;
  border: 1px solid var(--fb-border);
  border-radius: var(--fb-radius);
  background: var(--fb-panel);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
