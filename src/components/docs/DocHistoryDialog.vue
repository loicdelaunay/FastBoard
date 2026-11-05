<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import SelectButton from 'primevue/selectbutton';
import { docTitle, type DocNodeDTO, type DocVersionDTO, type DocVersionOrigin } from '@shared/docs';
import type { UserSummaryDTO } from '@shared/types';
import { api } from '@/api';
import { formatBytes } from '@/utils/files';
import { formatDateTime } from '@/utils/format';
import { notify, notifyError } from '@/utils/notify';
import DocMergeView, { type MergeSnapshot } from './DocMergeView.vue';
import DocPreview from './DocPreview.vue';

import { t } from '@/i18n';
/** Versions d'une note : leur rendu, leur comparaison au texte actuel, et le retour à tout ou partie de l'une d'elles. */
const props = defineProps<{
  node: DocNodeDTO;
  nodes: DocNodeDTO[];
  users: UserSummaryDTO[];
  canRestore: boolean;
  /** Texte actuel de la note, tenu à jour pendant l'édition. */
  current: string;
}>();
const visible = defineModel<boolean>('visible', { required: true });

const confirm = useConfirm();
const versions = ref<DocVersionDTO[]>([]);
const retention = ref(15);
const selectedId = ref<number | null>(null);
const content = ref('');
const loading = ref(false);
const view = ref<'preview' | 'compare'>('preview');
/** Texte actuel au moment de comparer : la comparaison ne bouge pas sous les yeux si quelqu'un écrit. */
const baseline = ref('');
const merge = ref<MergeSnapshot | null>(null);
/** Refait le comparateur quand on repart du texte actuel. */
const round = ref(0);

const viewOptions = computed(() => [
  { value: 'preview', label: t('Aperçu'), icon: 'pi pi-eye' },
  { value: 'compare', label: t('Comparer au texte actuel'), icon: 'pi pi-arrow-right-arrow-left' },
]);
const comparing = computed(() => view.value === 'compare');
const stale = computed(() => comparing.value && baseline.value !== props.current);
const selected = computed(() => versions.value.find((entry) => entry.id === selectedId.value) ?? null);
const leftLabel = computed(() => (selected.value ? t('Version du {date}', { date: formatDateTime(selected.value.createdAt) }) : ''));

const originLabels = computed<Record<DocVersionOrigin, string>>(() => ({
  create: t('Création'),
  edit: t('Édition'),
  api: t('Par l’API'),
  import: t('Import'),
  restore: t('Restauration'),
  delete: t('Avant suppression'),
  ai: t('Assistant IA'),
}));

function refreshBaseline(): void {
  baseline.value = props.current;
  merge.value = null;
  round.value += 1;
}

async function show(version: DocVersionDTO): Promise<void> {
  selectedId.value = version.id;
  merge.value = null;
  try {
    content.value = (await api.docVersion(version.id)).content;
    refreshBaseline();
  } catch (error) {
    notifyError(error);
  }
}

watch(visible, async (open) => {
  if (!open) return;
  loading.value = true;
  view.value = 'preview';
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

watch(view, (next) => next === 'compare' && refreshBaseline());

async function restore(version: DocVersionDTO, text?: string): Promise<void> {
  try {
    await api.docRestoreVersion(version.id, text);
    notify('success', t('Version restaurée'));
    visible.value = false;
  } catch (error) {
    notifyError(error, t('Restauration impossible'));
  }
}

function askRestore(): void {
  const version = selected.value;
  if (!version) return;
  confirm.require({
    header: t('Restaurer cette version ?'),
    message: t('Le texte actuel est remplacé pour tout le monde. Il reste dans l’historique.'),
    icon: 'pi pi-replay',
    acceptLabel: t('Restaurer'),
    rejectLabel: t('Annuler'),
    rejectProps: { severity: 'secondary', text: true },
    accept: () => restore(version),
  });
}

function askSaveResult(): void {
  const version = selected.value;
  const text = merge.value?.text;
  if (!version || text === undefined) return;
  confirm.require({
    header: t('Enregistrer le résultat ?'),
    message: t('Le texte actuel est remplacé par le résultat pour tout le monde. Il reste dans l’historique.'),
    icon: 'pi pi-check',
    acceptLabel: t('Enregistrer'),
    rejectLabel: t('Annuler'),
    rejectProps: { severity: 'secondary', text: true },
    accept: () => restore(version, text),
  });
}
</script>

<template>
  <Dialog
    v-model:visible="visible"
    modal
    maximizable
    :header="$t('Historique de « {name} »', { name: docTitle(node.path) })"
    :style="comparing ? { width: 'min(90rem, calc(100vw - 2rem))', height: 'min(90vh, 60rem)' } : { width: 'min(60rem, calc(100vw - 2rem))' }"
    :content-style="comparing ? { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' } : undefined"
  >
    <div class="top">
      <p class="muted small hint">{{ $t('Les versions sont gardées {n} jours.', { n: retention }) }}</p>
      <SelectButton v-if="versions.length" v-model="view" :options="viewOptions" option-value="value" option-label="label" size="small" :allow-empty="false" :aria-label="$t('Affichage de la version')">
        <template #option="{ option }"><i :class="option.icon"></i><span>{{ option.label }}</span></template>
      </SelectButton>
    </div>
    <div v-if="versions.length" class="layout" :class="{ comparing }">
      <ul class="versions">
        <li v-for="version in versions" :key="version.id">
          <button type="button" class="version" :class="{ active: version.id === selectedId }" @click="show(version)">
            <strong>{{ formatDateTime(version.createdAt) }}</strong>
            <span class="muted small">{{ originLabels[version.origin] }} · {{ formatBytes(version.size) }}</span>
            <span v-if="version.authors.length" class="muted small truncate">{{ version.authors.join(', ') }}</span>
          </button>
        </li>
      </ul>
      <div v-if="comparing" class="compare">
        <p v-if="stale" class="stale small">
          <i class="pi pi-info-circle"></i> {{ $t('Le texte a changé depuis l’ouverture de la comparaison.') }}
          <Button :label="$t('Comparer de nouveau')" size="small" text @click="refreshBaseline" />
        </p>
        <div class="compare-body">
          <DocMergeView :key="`${selectedId}-${round}`" :left="{ label: leftLabel, text: content }" :right="{ label: $t('Texte actuel'), text: baseline }" prefer="right" :readonly="!canRestore" @change="merge = $event" />
        </div>
      </div>
      <div v-else class="preview">
        <DocPreview :key="selectedId ?? 0" :text="content" :nodes="nodes" :note-path="node.path" :users="users" />
      </div>
    </div>
    <p v-else-if="!loading" class="muted">{{ $t('Aucune version enregistrée.') }}</p>
    <template #footer>
      <template v-if="canRestore">
        <Button v-if="comparing" :label="$t('Enregistrer le résultat')" icon="pi pi-check" :disabled="!merge?.dirty" @click="askSaveResult" />
        <Button v-else :label="$t('Restaurer cette version')" icon="pi pi-replay" :disabled="selectedId === null" @click="askRestore" />
      </template>
    </template>
  </Dialog>
</template>

<style scoped>
.top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem 1rem;
  margin-bottom: 0.75rem;
}
.top :deep(.p-togglebutton-content) {
  gap: 0.35rem;
}
.hint {
  margin: 0;
}
.layout {
  display: grid;
  flex: 1;
  grid-template-columns: 15rem minmax(0, 1fr);
  gap: 1rem;
  height: min(60vh, 34rem);
}
.layout.comparing {
  height: auto;
  min-height: 0;
}
.versions {
  min-height: 0;
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
.compare {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-width: 0;
  min-height: 0;
}
.compare-body {
  flex: 1;
  min-height: 0;
}
.stale {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.5rem;
  margin: 0;
  color: #d97706;
}
@media (max-width: 700px) {
  .layout {
    height: 72vh;
  }
  .layout,
  .layout.comparing {
    grid-template-columns: 1fr;
    grid-template-rows: 8rem minmax(0, 1fr);
  }
  .preview {
    padding: 0.5rem 0 0;
    border-top: 1px solid var(--fb-border);
    border-left: 0;
  }
}
</style>
