<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import { docTitle, type DocNodeDTO, type DocVersionDTO, type DocVersionOrigin } from '@shared/docs';
import type { UserSummaryDTO } from '@shared/types';
import { api } from '@/api';
import { formatBytes } from '@/utils/files';
import { formatDateTime } from '@/utils/format';
import { notify, notifyError } from '@/utils/notify';
import DocPreview from './DocPreview.vue';

import { t } from '@/i18n';
/** Versions d'une note : leur rendu, et le retour à l'une d'elles. */
const props = defineProps<{ node: DocNodeDTO; nodes: DocNodeDTO[]; users: UserSummaryDTO[]; canRestore: boolean }>();
const visible = defineModel<boolean>('visible', { required: true });

const confirm = useConfirm();
const versions = ref<DocVersionDTO[]>([]);
const retention = ref(15);
const selectedId = ref<number | null>(null);
const content = ref('');
const loading = ref(false);

const originLabels = computed<Record<DocVersionOrigin, string>>(() => ({
  create: t('Création'),
  edit: t('Édition'),
  api: t('Par l’API'),
  import: t('Import'),
  restore: t('Restauration'),
  delete: t('Avant suppression'),
}));

async function show(version: DocVersionDTO): Promise<void> {
  selectedId.value = version.id;
  try {
    content.value = (await api.docVersion(version.id)).content;
  } catch (error) {
    notifyError(error);
  }
}

watch(visible, async (open) => {
  if (!open) return;
  loading.value = true;
  try {
    const result = await api.docVersions(props.node.id);
    versions.value = result.versions;
    retention.value = result.retentionDays;
    content.value = '';
    selectedId.value = null;
    if (result.versions[0]) await show(result.versions[0]);
  } catch (error) {
    notifyError(error);
  } finally {
    loading.value = false;
  }
});

function askRestore(): void {
  const version = versions.value.find((entry) => entry.id === selectedId.value);
  if (!version) return;
  confirm.require({
    header: t('Restaurer cette version ?'),
    message: t('Le texte actuel est remplacé pour tout le monde. Il reste dans l’historique.'),
    icon: 'pi pi-replay',
    acceptLabel: t('Restaurer'),
    rejectLabel: t('Annuler'),
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      try {
        await api.docRestoreVersion(version.id);
        notify('success', t('Version restaurée'));
        visible.value = false;
      } catch (error) {
        notifyError(error, t('Restauration impossible'));
      }
    },
  });
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="$t('Historique de « {name} »', { name: docTitle(node.path) })" :style="{ width: 'min(60rem, calc(100vw - 2rem))' }">
    <p class="muted small hint">{{ $t('Les versions sont gardées {n} jours.', { n: retention }) }}</p>
    <div v-if="versions.length" class="layout">
      <ul class="versions">
        <li v-for="version in versions" :key="version.id">
          <button type="button" class="version" :class="{ active: version.id === selectedId }" @click="show(version)">
            <strong>{{ formatDateTime(version.createdAt) }}</strong>
            <span class="muted small">{{ originLabels[version.origin] }} · {{ formatBytes(version.size) }}</span>
            <span v-if="version.authors.length" class="muted small truncate">{{ version.authors.join(', ') }}</span>
          </button>
        </li>
      </ul>
      <div class="preview">
        <DocPreview :key="selectedId ?? 0" :text="content" :nodes="nodes" :note-path="node.path" :users="users" />
      </div>
    </div>
    <p v-else-if="!loading" class="muted">{{ $t('Aucune version enregistrée.') }}</p>
    <template #footer>
      <Button v-if="canRestore" :label="$t('Restaurer cette version')" icon="pi pi-replay" :disabled="selectedId === null" @click="askRestore" />
    </template>
  </Dialog>
</template>

<style scoped>
.hint {
  margin: 0 0 0.75rem;
}
.layout {
  display: grid;
  grid-template-columns: 15rem minmax(0, 1fr);
  gap: 1rem;
  height: min(60vh, 34rem);
}
.versions {
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
.version {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  width: 100%;
  padding: 0.4rem 0.6rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.85rem;
  text-align: left;
  cursor: pointer;
}
.version:hover {
  background: var(--fb-panel-alt);
}
.version.active {
  background: var(--fb-accent-soft);
}
.preview {
  min-width: 0;
  padding: 0 1rem;
  overflow: auto;
  border-left: 1px solid var(--fb-border);
}
@media (max-width: 700px) {
  .layout {
    grid-template-columns: 1fr;
    grid-template-rows: 10rem minmax(0, 1fr);
    height: 70vh;
  }
  .preview {
    padding: 0.5rem 0 0;
    border-top: 1px solid var(--fb-border);
    border-left: 0;
  }
}
</style>
