<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import Button from 'primevue/button';
import Message from 'primevue/message';
import type { ApiTokenDTO } from '@shared/types';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useProjectsStore } from '@/stores/projects';
import { notify, notifyError } from '@/utils/notify';
import TokenCreateForm from './TokenCreateForm.vue';
import TokenList from './TokenList.vue';
import TokenEditDialog from './TokenEditDialog.vue';
import TokenRevealDialog from './TokenRevealDialog.vue';
import TokenSecretBox from './TokenSecretBox.vue';

import { t } from '@/i18n';
const auth = useAuthStore();
const projects = useProjectsStore();
const confirm = useConfirm();

const tokens = ref<ApiTokenDTO[]>([]);
const loading = ref(true);
const creating = ref(false);
const fresh = ref<{ secret: string; name: string } | null>(null);
const editing = ref<ApiTokenDTO | null>(null);
const revealing = ref<ApiTokenDTO | null>(null);

function onSaved(token: ApiTokenDTO): void {
  editing.value = null;
  tokens.value = tokens.value.map((entry) => (entry.id === token.id ? token : entry));
}

async function load(): Promise<void> {
  try {
    tokens.value = (await api.myTokens()).tokens;
  } catch (error) {
    notifyError(error, t('Jetons indisponibles'));
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
  if (!projects.loaded) {
    void projects.fetch().catch(() => undefined);
  }
});

async function onCreated(secret: string, name: string): Promise<void> {
  creating.value = false;
  fresh.value = { secret, name };
  await load();
}

function askRevoke(token: ApiTokenDTO): void {
  confirm.require({
    header: t('Révoquer « {name} » ?', { name: token.name }),
    message: t('Tout script ou agent qui utilise ce jeton sera immédiatement refusé. Cette action est définitive.'),
    icon: 'pi pi-ban',
    acceptLabel: t('Révoquer'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      try {
        await api.revokeToken(token.id);
        notify('success', t('Jeton révoqué'));
        await load();
      } catch (error) {
        notifyError(error);
      }
    },
  });
}
</script>

<template>
  <div class="panel">
    <p class="intro muted small"> {{ $t('Un jeton d\'API permet à un script ou à une') }} <strong>{{ $t('IA') }}</strong> {{ $t('de travailler sur vos projets avec vos droits (lire le tableau, déplacer des tickets, commenter…).') }} <a href="/api/docs" target="_blank" rel="noopener">{{ $t('Documentation Swagger') }}</a> ·
      <a href="/api/docs/guide.md" target="_blank" rel="noopener">{{ $t('Guide pour les IA') }}</a>
    </p>

    <TokenSecretBox v-if="fresh" :secret="fresh.secret" :name="fresh.name" @done="fresh = null" />

    <TokenCreateForm v-else-if="creating" @created="onCreated" @cancel="creating = false" />

    <template v-else>
      <Message v-if="!auth.can('tokens.create')" severity="info" :closable="false"> {{ $t('Vous n\'avez pas la permission de créer des jetons d\'API. Demandez à un administrateur.') }} </Message>
      <Button v-else :label="$t('Nouveau jeton')" icon="pi pi-plus" class="new" @click="creating = true" />
    </template>

    <h4 class="list-title">{{ $t('Mes jetons') }}</h4>
    <p v-if="loading" class="muted"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</p>
    <TokenList v-else :tokens="tokens" can-reveal @revoke="askRevoke" @edit="(token) => (editing = token)" @reveal="(token) => (revealing = token)" />
    <TokenEditDialog :token="editing" @close="editing = null" @saved="onSaved" />
    <TokenRevealDialog :token="revealing" @close="revealing = null" />
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.intro {
  margin: 0;
}
.new {
  align-self: flex-start;
}
.list-title {
  margin: 0.5rem 0 0;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--fb-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
</style>
