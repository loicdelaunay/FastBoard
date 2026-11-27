<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import ToggleSwitch from 'primevue/toggleswitch';
import { SAVED_FILTER_LIMITS, type SavedFilterDTO } from '@shared/ticketFilters';
import { api } from '@/api';
import { currentTicketFilters } from '@/composables/useTicketFilters';
import { t } from '@/i18n';
import { connection } from '@/offline/connection';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/project';
import { describeFilters } from '@/utils/filterSummary';
import { notify, notifyError } from '@/utils/notify';

/**
 * Enregistrer les filtres en cours (ou modifier un filtre enregistré) : un nom, une description facultative, et
 * « Partager avec le projet » pour que tous ses membres puissent l'utiliser.
 */
const props = defineProps<{ editing: SavedFilterDTO | null }>();
const visible = defineModel<boolean>('visible', { required: true });

const project = useProjectStore();
const auth = useAuthStore();
const name = ref('');
const description = ref('');
const shared = ref(false);
/** En modification : remplacer les critères du filtre par les filtres en cours. */
const replace = ref(false);
const busy = ref(false);

const current = computed(() => describeFilters(currentTicketFilters(), project));
/** Seul l'auteur peut ne plus partager (qui gère le projet modifie les autres, sans les leur retirer). */
const lockShared = computed(() => props.editing !== null && props.editing.shared && props.editing.createdBy !== auth.user?.id);

watch(visible, (open) => {
  if (!open) return;
  name.value = props.editing?.name ?? '';
  description.value = props.editing?.description ?? '';
  shared.value = props.editing?.shared ?? false;
  replace.value = false;
});

async function save(): Promise<void> {
  if (!name.value.trim() || busy.value || project.projectId === null) return;
  busy.value = true;
  try {
    const body = { name: name.value.trim(), description: description.value.trim(), shared: shared.value };
    const { filter } = props.editing
      ? await api.updateFilter(props.editing.id, { ...body, ...(replace.value ? { filters: currentTicketFilters() } : {}) })
      : await api.createFilter(project.projectId, { ...body, filters: currentTicketFilters() });
    project.upsertSavedFilter(filter);
    notify('success', props.editing ? t('Filtre modifié') : t('Filtre enregistré'), filter.shared ? t('Tout le projet peut l’utiliser.') : t('Vous le retrouvez dans « Filtres enregistrés ».'));
    visible.value = false;
  } catch (error) {
    notifyError(error, t('Filtre non enregistré'));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="editing ? $t('Modifier le filtre') : $t('Enregistrer les filtres')" :style="{ width: 'min(30rem, 94vw)' }" :draggable="false">
    <form class="form" @submit.prevent="save">
      <label class="field">
        <span class="label">{{ $t('Nom') }}</span>
        <InputText v-model="name" :maxlength="SAVED_FILTER_LIMITS.nameMax" autofocus :placeholder="$t('ex. Bugs à tester cette semaine')" fluid />
      </label>
      <label class="field">
        <span class="label">{{ $t('Description') }} <span class="muted optional">{{ $t('(facultatif)') }}</span></span>
        <Textarea v-model="description" :maxlength="SAVED_FILTER_LIMITS.descriptionMax" rows="2" auto-resize :placeholder="$t('À quoi sert ce filtre ?')" fluid />
      </label>
      <div v-if="!editing || replace" class="criteria">
        <span class="label">{{ editing ? $t('Nouveaux critères') : $t('Critères') }}</span>
        <ul v-if="current.length">
          <li v-for="part in current" :key="part">{{ part }}</li>
        </ul>
        <p v-else class="muted small">{{ $t('Aucun filtre : tous les tickets.') }}</p>
      </div>
      <label v-if="editing" class="check">
        <Checkbox v-model="replace" binary />
        <span>{{ $t('Remplacer ses critères par les filtres en cours') }}</span>
      </label>
      <label class="check share">
        <ToggleSwitch v-model="shared" :disabled="lockShared" />
        <span>
          <strong>{{ $t('Partager avec le projet') }}</strong>
          <small class="muted">{{ $t('Tous les membres du projet le voient et peuvent l’utiliser, avec votre nom.') }}</small>
        </span>
      </label>
      <div class="actions">
        <Button type="button" :label="$t('Annuler')" severity="secondary" text @click="visible = false" />
        <Button type="submit" :label="editing ? $t('Enregistrer') : $t('Enregistrer le filtre')" icon="pi pi-bookmark" :loading="busy" :disabled="!name.trim() || connection.offline" />
      </div>
    </form>
  </Dialog>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.label {
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--fb-muted);
}
.optional {
  text-transform: none;
  font-weight: 400;
}
.criteria ul {
  margin: 0.3rem 0 0;
  padding-left: 1.1rem;
  font-size: 0.88rem;
}
.criteria p {
  margin: 0.3rem 0 0;
}
.check {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.9rem;
  cursor: pointer;
}
.share span {
  display: flex;
  flex-direction: column;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
