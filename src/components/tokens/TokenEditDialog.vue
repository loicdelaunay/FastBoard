<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import { LIMITS } from '@shared/constants';
import type { ApiTokenDTO } from '@shared/types';
import { api } from '@/api';
import { formatDateTime } from '@/utils/format';
import { notify, notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Nom d'affichage et prolongation d'un jeton (propriétaire, ou administrateur avec `admin`). */
const props = defineProps<{ token: ApiTokenDTO | null; admin?: boolean }>();
const emit = defineEmits<{ close: []; saved: [token: ApiTokenDTO] }>();

const KEEP = 'keep';
const displayName = ref('');
const expiration = ref<number | null | typeof KEEP>(KEEP);
const saving = ref(false);

watch(
  () => props.token,
  (token) => {
    displayName.value = token?.displayName ?? '';
    expiration.value = KEEP;
  },
  { immediate: true },
);

const visible = computed({
  get: () => props.token !== null,
  set: (value: boolean) => !value && emit('close'),
});

const expirationOptions = computed(() => [
  { label: props.token?.expiresAt ? t('Garder l’échéance actuelle ({date})', { date: formatDateTime(props.token.expiresAt) }) : t('Garder : n’expire pas'), value: KEEP },
  { label: t('30 jours à partir d’aujourd’hui'), value: 30 },
  { label: t('90 jours à partir d’aujourd’hui'), value: 90 },
  { label: t('1 an à partir d’aujourd’hui'), value: 365 },
  { label: t('N\'expire jamais'), value: null },
]);

async function save(): Promise<void> {
  if (!props.token) return;
  saving.value = true;
  try {
    const patch: { displayName: string | null; expiresInDays?: number | null } = { displayName: displayName.value.trim() || null };
    if (expiration.value !== KEEP) patch.expiresInDays = expiration.value;
    const { token } = props.admin ? await api.adminUpdateToken(props.token.id, patch) : await api.updateToken(props.token.id, patch);
    notify('success', t('Jeton mis à jour'));
    emit('saved', token);
  } catch (error) {
    notifyError(error, t('Modification impossible'));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="$t('Modifier le jeton « {name} »', { name: token?.name ?? '' })" :style="{ width: 'min(30rem, 94vw)' }">
    <form class="stack" @submit.prevent="save">
      <div class="field">
        <label for="token-display">{{ $t('Nom d\'affichage') }}</label>
        <InputText id="token-display" v-model="displayName" :maxlength="LIMITS.tokenDisplayNameMax" :placeholder="token?.name" fluid autofocus />
        <small class="muted">{{ $t('Affiché dans l\'activité et l\'historique (« via … »). Vide = nom du jeton.') }}</small>
      </div>
      <div class="field">
        <label for="token-extend">{{ $t('Validité') }}</label>
        <Select v-model="expiration" input-id="token-extend" :options="expirationOptions" option-label="label" option-value="value" fluid />
      </div>
      <div class="actions">
        <Button type="button" :label="$t('Annuler')" severity="secondary" text @click="emit('close')" />
        <Button type="submit" :label="$t('Enregistrer')" icon="pi pi-check" :loading="saving" />
      </div>
    </form>
  </Dialog>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
