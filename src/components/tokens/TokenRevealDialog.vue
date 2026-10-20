<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import Password from 'primevue/password';
import type { ApiTokenDTO } from '@shared/types';
import { api } from '@/api';
import { notifyError } from '@/utils/notify';
import TokenSecretBox from './TokenSecretBox.vue';

import { t } from '@/i18n';
/** Réaffiche le secret d'un de ses jetons, après confirmation du mot de passe. */
const props = defineProps<{ token: ApiTokenDTO | null }>();
const emit = defineEmits<{ close: [] }>();

const password = ref('');
const secret = ref<string | null>(null);
const loading = ref(false);

watch(
  () => props.token,
  () => {
    password.value = '';
    secret.value = null;
  },
);

const visible = computed({
  get: () => props.token !== null,
  set: (value: boolean) => !value && emit('close'),
});

async function reveal(): Promise<void> {
  if (!props.token || !password.value) return;
  loading.value = true;
  try {
    secret.value = (await api.revealToken(props.token.id, password.value)).secret;
    password.value = '';
  } catch (error) {
    notifyError(error, t('Clé non affichée'));
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="$t('Voir la clé « {name} »', { name: token?.displayName || token?.name || '' })" :style="{ width: 'min(36rem, 94vw)' }">
    <TokenSecretBox v-if="secret && token" :secret="secret" :name="token.name" revealed @done="emit('close')" />
    <form v-else class="stack" @submit.prevent="reveal">
      <p class="muted">{{ $t('Par sécurité, confirmez votre mot de passe pour afficher la clé.') }}</p>
      <Password v-model="password" :feedback="false" toggle-mask fluid autofocus :input-props="{ autocomplete: 'current-password' }" :aria-label="$t('Mot de passe')" :placeholder="$t('Mot de passe')" />
      <div class="actions">
        <Button type="button" :label="$t('Annuler')" severity="secondary" text @click="emit('close')" />
        <Button type="submit" :label="$t('Afficher la clé')" icon="pi pi-eye" :loading="loading" :disabled="!password" />
      </div>
    </form>
  </Dialog>
</template>

<style scoped>
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
