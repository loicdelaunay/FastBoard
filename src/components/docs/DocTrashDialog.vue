<script setup lang="ts">
import { ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import { DOC_LIMITS, type DocNodeDTO } from '@shared/docs';
import { api } from '@/api';
import { useDocsStore } from '@/stores/docs';
import { formatRelative } from '@/utils/format';
import { notify, notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Fichiers supprimés de l'espace, récupérables pendant la durée de conservation. */
const props = defineProps<{ spaceId: number }>();
const visible = defineModel<boolean>('visible', { required: true });

const store = useDocsStore();
const nodes = ref<DocNodeDTO[]>([]);
const loading = ref(false);

watch(visible, async (open) => {
  if (!open) return;
  loading.value = true;
  try {
    nodes.value = (await api.docTrash(props.spaceId)).nodes;
  } catch (error) {
    notifyError(error);
  } finally {
    loading.value = false;
  }
});

async function restore(node: DocNodeDTO): Promise<void> {
  try {
    await api.docRestoreNode(node.id);
    nodes.value = nodes.value.filter((entry) => entry.id !== node.id);
    notify('success', t('Fichier restauré'));
  } catch (error) {
    notifyError(error);
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="$t('Corbeille')" :style="{ width: 'min(32rem, calc(100vw - 2rem))' }">
    <p class="muted small hint">{{ $t('Les fichiers supprimés restent ici {n} jours.', { n: DOC_LIMITS.retentionDays }) }}</p>
    <ul v-if="nodes.length" class="list">
      <li v-for="node in nodes" :key="node.id" class="row">
        <i :class="node.kind === 'image' ? 'pi pi-image' : 'pi pi-file'" class="muted"></i>
        <span class="grow">
          <span class="truncate path">{{ node.path }}</span>
          <span class="muted small">{{ $t('supprimé {when}', { when: formatRelative(node.deletedAt!) }) }}</span>
        </span>
        <Button v-if="store.canEdit" :label="$t('Restaurer')" icon="pi pi-replay" size="small" severity="secondary" outlined @click="restore(node)" />
      </li>
    </ul>
    <p v-else-if="!loading" class="muted">{{ $t('La corbeille est vide.') }}</p>
  </Dialog>
</template>

<style scoped>
.hint {
  margin: 0 0 0.75rem;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.grow {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.path {
  display: block;
}
</style>
