<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import ToggleSwitch from 'primevue/toggleswitch';
import type { ApiTokenDTO } from '@shared/types';
import { api } from '@/api';
import TokenEditDialog from '@/components/tokens/TokenEditDialog.vue';
import TokenList from '@/components/tokens/TokenList.vue';
import { useProjectsStore } from '@/stores/projects';
import { notify, notifyError } from '@/utils/notify';
import { matchesQuery } from '@/utils/search';
import { tokenState } from '@/utils/tokens';

import { t } from '@/i18n';
const confirm = useConfirm();
const projects = useProjectsStore();

const tokens = ref<ApiTokenDTO[]>([]);
const loading = ref(true);
const search = ref('');
const onlyActive = ref(true);
const editing = ref<ApiTokenDTO | null>(null);

function onSaved(token: ApiTokenDTO): void {
  editing.value = null;
  void load();
  void token;
}

const visible = computed(() =>
  tokens.value.filter(
    (token) => (!onlyActive.value || tokenState(token) === 'active') && matchesQuery(search.value, [token.name, token.displayName, token.userName, token.prefix]),
  ),
);
const activeCount = computed(() => tokens.value.filter((token) => tokenState(token) === 'active').length);

async function load(): Promise<void> {
  try {
    tokens.value = (await api.adminTokens()).tokens;
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

function askRevoke(token: ApiTokenDTO): void {
  confirm.require({
    header: t('Révoquer « {name} » ?', { name: token.name }),
    message: t("Ce jeton appartient à {name} : tout script ou agent qui l'utilise sera immédiatement refusé.", { name: token.userName ?? t('un utilisateur') }),
    icon: 'pi pi-ban',
    acceptLabel: t('Révoquer'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      try {
        await api.adminRevokeToken(token.id);
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
  <div class="page">
    <header class="head">
      <h1 class="page-title">{{ $t('Jetons d\'API') }}</h1>
      <p class="muted">
        {{ $t('{n} jeton actif. Les jetons permettent à des scripts ou à des IA d\'agir avec les droits de leur propriétaire.|{n} jetons actifs. Les jetons permettent à des scripts ou à des IA d\'agir avec les droits de leur propriétaire.', { n: activeCount }) }} <a href="/api/docs" target="_blank" rel="noopener">{{ $t('Documentation Swagger') }}</a>
      </p>
    </header>

    <div class="toolbar">
      <IconField class="search">
        <InputIcon class="pi pi-search" />
        <InputText v-model="search" :placeholder="$t('Rechercher un jeton ou un propriétaire…')" fluid />
      </IconField>
      <label class="row"><ToggleSwitch v-model="onlyActive" /><span class="small">{{ $t('Actifs uniquement') }}</span></label>
    </div>

    <p v-if="loading" class="muted"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</p>
    <TokenList v-else :tokens="visible" show-owner @revoke="askRevoke" @edit="(token) => (editing = token)" />
    <TokenEditDialog :token="editing" admin @close="editing = null" @saved="onSaved" />
  </div>
</template>

<style scoped>
.head {
  margin-bottom: 1rem;
}
.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 1rem;
}
.search {
  flex: 1;
  min-width: 14rem;
  max-width: 26rem;
}
</style>
