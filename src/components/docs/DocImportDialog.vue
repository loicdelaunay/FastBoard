<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import Message from 'primevue/message';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import Textarea from 'primevue/textarea';
import { docBaseName, type DocImportAction, type DocImportEntryDTO, type DocImportPreviewDTO, type DocImportStatus, type DocNodeDTO } from '@shared/docs';
import { api } from '@/api';
import { notify, notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Réimport : d'abord le bilan fichier par fichier, puis les choix, et rien n'est écrit avant « Importer ». */
const props = defineProps<{
  spaceId: number;
  /** Sans cela, tout l'espace : un dossier reçoit un ZIP, un fichier se réimporte seul. */
  node?: DocNodeDTO | null;
}>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ done: [] }>();

const file = computed(() => (props.node && props.node.kind !== 'folder' ? props.node : null));
const folder = computed(() => (props.node?.kind === 'folder' ? props.node.path : ''));
const title = computed(() => {
  if (file.value) return t('Réimporter {name}', { name: docBaseName(file.value.path) });
  return folder.value ? t('Réimporter un ZIP dans {name}', { name: docBaseName(folder.value) }) : t('Importer un ZIP');
});
const accept = computed(() => {
  if (!file.value) return '.zip,application/zip';
  return file.value.kind === 'image' ? 'image/png,image/jpeg,image/webp,image/gif' : '.md,.markdown,text/markdown';
});

const picker = ref<HTMLInputElement | null>(null);
const preview = ref<DocImportPreviewDTO | null>(null);
const busy = ref(false);
/** Choix par fichier, et texte corrigé à la main pour les conflits. */
const actions = ref<Record<string, DocImportAction>>({});
const texts = ref<Record<string, string>>({});
const editing = ref<string | null>(null);

const STATUS = computed<Record<DocImportStatus, { label: string; severity: 'success' | 'info' | 'warn' | 'danger' | 'secondary' }>>(() => ({
  new: { label: t('Nouveau'), severity: 'success' },
  updated: { label: t('Modifié dans l’import'), severity: 'info' },
  merged: { label: t('Fusionné'), severity: 'info' },
  conflict: { label: t('Conflit'), severity: 'danger' },
  removed: { label: t('Retiré de l’import'), severity: 'warn' },
  kept: { label: t('Modifié sur le serveur'), severity: 'secondary' },
  same: { label: t('Identique'), severity: 'secondary' },
}));

function optionsFor(entry: DocImportEntryDTO): Array<{ value: DocImportAction; label: string }> {
  const keep = { value: 'keep' as const, label: t('Garder le serveur') };
  switch (entry.status) {
    case 'new':
      return [{ value: 'auto', label: t('Importer') }, { value: 'keep', label: t('Ignorer') }];
    case 'updated':
      return [{ value: 'auto', label: t('Prendre l’import') }, keep];
    case 'merged':
      return [{ value: 'auto', label: t('Fusion automatique') }, { value: 'incoming', label: t('Prendre l’import') }, keep];
    case 'conflict':
      return [...(entry.kind === 'markdown' ? [{ value: 'auto' as const, label: t('Fusionner à la main') }] : []), keep, { value: 'incoming', label: t('Prendre l’import') }, { value: 'both', label: t('Garder les deux') }];
    case 'removed':
      return [keep, { value: 'delete', label: t('Supprimer du serveur') }];
    default:
      return [];
  }
}

const defaultAction = (entry: DocImportEntryDTO): DocImportAction => (entry.status === 'conflict' || entry.status === 'removed' ? 'keep' : 'auto');

const toReview = computed(() => preview.value?.entries.filter((entry) => optionsFor(entry).length > 0) ?? []);
const unchanged = computed(() => (preview.value?.entries.length ?? 0) - toReview.value.length);
const unresolved = computed(() => toReview.value.filter((entry) => entry.status === 'conflict' && actions.value[entry.path] === 'auto' && (texts.value[entry.path] ?? '').includes('<<<<<<<')));
const hasWork = computed(() => toReview.value.some((entry) => actions.value[entry.path] !== 'keep'));

watch(visible, (open) => {
  if (!open) return;
  preview.value = null;
  editing.value = null;
});

async function onFile(event: Event): Promise<void> {
  const element = event.target as HTMLInputElement;
  const chosen = element.files?.[0];
  element.value = '';
  if (!chosen) return;
  busy.value = true;
  try {
    const result = file.value ? await api.docFileImportPreview(file.value.id, chosen) : await api.docImportPreview(props.spaceId, chosen, folder.value);
    preview.value = result;
    actions.value = Object.fromEntries(result.entries.map((entry) => [entry.path, defaultAction(entry)]));
    texts.value = Object.fromEntries(result.entries.filter((entry) => entry.merged !== null).map((entry) => [entry.path, entry.merged!]));
  } catch (error) {
    notifyError(error, t('Archive illisible'));
  } finally {
    busy.value = false;
  }
}

async function apply(): Promise<void> {
  if (!preview.value) return;
  busy.value = true;
  try {
    const decisions = toReview.value
      .filter((entry) => actions.value[entry.path] !== 'keep')
      .map((entry) => ({ path: entry.path, action: actions.value[entry.path]!, ...(entry.status === 'conflict' && actions.value[entry.path] === 'auto' ? { content: texts.value[entry.path] ?? '' } : {}) }));
    const result = await api.docApplyImport(props.spaceId, preview.value.importId, decisions);
    notify('success', t('Import terminé'), t('{written} fichier(s) écrit(s), {deleted} supprimé(s).', { written: result.written, deleted: result.deleted }));
    emit('done');
    visible.value = false;
  } catch (error) {
    notifyError(error, t('Import impossible'));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="title" :style="{ width: 'min(48rem, calc(100vw - 2rem))' }">
    <div v-if="!preview" class="start">
      <p class="muted">{{ file ? $t('Choisissez la version modifiée de ce fichier. Elle sera fusionnée avec le texte actuel, et vous verrez le résultat avant que quoi que ce soit ne soit écrit.') : $t('Choisissez un export de cet espace, ou un coffre Obsidian zippé. Vous verrez le bilan de chaque fichier avant que quoi que ce soit ne soit écrit.') }}</p>
      <Button :label="file ? $t('Choisir le fichier') : $t('Choisir un fichier ZIP')" icon="pi pi-upload" :loading="busy" @click="picker?.click()" />
      <input ref="picker" type="file" :accept="accept" class="file" @change="onFile" />
    </div>

    <template v-else>
      <p class="muted small summary">
        {{ $t('{n} fichier à examiner|{n} fichiers à examiner', { n: toReview.length }) }}<template v-if="unchanged"> · {{ $t('{n} sans changement à apporter|{n} sans changement à apporter', { n: unchanged }) }}</template><template v-if="preview.ignored.length"> · {{ $t('{n} ignoré|{n} ignorés', { n: preview.ignored.length }) }}</template>
      </p>
      <Message v-if="preview.ignored.length" severity="warn" size="small" :closable="false">{{ $t('Formats non pris en charge : {files}', { files: preview.ignored.slice(0, 5).join(', ') }) }}</Message>

      <ul class="entries">
        <li v-for="entry in toReview" :key="entry.path" class="entry">
          <div class="line">
            <i :class="entry.kind === 'image' ? 'pi pi-image' : 'pi pi-file'" class="muted"></i>
            <span class="truncate path" :title="entry.path">{{ entry.path }}</span>
            <Tag :value="STATUS[entry.status].label" :severity="STATUS[entry.status].severity" />
            <Select v-model="actions[entry.path]" :options="optionsFor(entry)" option-label="label" option-value="value" size="small" class="action" :aria-label="$t('Que faire de {name}', { name: entry.path })" />
          </div>
          <div v-if="entry.status === 'conflict' && actions[entry.path] === 'auto'" class="resolve">
            <Button :label="editing === entry.path ? $t('Fermer') : $t('Corriger le texte')" icon="pi pi-pencil" size="small" severity="secondary" text @click="editing = editing === entry.path ? null : entry.path" />
            <span v-if="(texts[entry.path] ?? '').includes('<<<<<<<')" class="small conflict-left">{{ $t('Marques de conflit à retirer') }}</span>
            <Textarea v-if="editing === entry.path" v-model="texts[entry.path]" rows="10" fluid class="mono" :aria-label="$t('Texte fusionné de {name}', { name: entry.path })" />
          </div>
        </li>
      </ul>
      <p v-if="!toReview.length" class="muted">{{ $t('Rien à importer : tout est déjà à jour.') }}</p>
    </template>

    <template v-if="preview" #footer>
      <small v-if="unresolved.length" class="conflict-left">{{ $t('{n} conflit à résoudre|{n} conflits à résoudre', { n: unresolved.length }) }}</small>
      <Button :label="$t('Annuler')" severity="secondary" text @click="visible = false" />
      <Button :label="$t('Importer')" icon="pi pi-check" :loading="busy" :disabled="!hasWork || unresolved.length > 0" @click="apply" />
    </template>
  </Dialog>
</template>

<style scoped>
.start {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.75rem;
}
.start p,
.summary {
  margin: 0;
}
.summary {
  margin-bottom: 0.5rem;
}
.file {
  display: none;
}
.entries {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0.5rem 0 0;
  padding: 0;
  list-style: none;
}
.entry {
  padding: 0.4rem 0.6rem;
  border-radius: 8px;
  background: var(--fb-panel-alt);
}
.line {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.path {
  flex: 1;
  min-width: 0;
  font-size: 0.86rem;
}
.action {
  width: 12rem;
  flex-shrink: 0;
}
.resolve {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.25rem;
}
.conflict-left {
  color: var(--fb-danger);
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 0.82rem;
}
@media (max-width: 700px) {
  .line {
    flex-wrap: wrap;
  }
  .action {
    width: 100%;
  }
}
</style>
