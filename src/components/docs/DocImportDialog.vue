<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import Message from 'primevue/message';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import { docBaseName, type DocImportAction, type DocImportCompareDTO, type DocImportEntryDTO, type DocImportPreviewDTO, type DocImportStatus, type DocNodeDTO } from '@shared/docs';
import { api } from '@/api';
import { notify, notifyError } from '@/utils/notify';
import DocMergeView, { type MergeSnapshot } from './DocMergeView.vue';

import { t } from '@/i18n';
/** Import : le bilan de chaque fichier, une comparaison bloc par bloc de ce qui existe déjà, et rien n'est écrit avant « Importer ». */
const props = defineProps<{
  spaceId: number;
  /** Sans cela, tout l'espace : un dossier reçoit un ZIP ou un fichier, une note ou une image se met à jour. */
  node?: DocNodeDTO | null;
}>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ done: [] }>();

const file = computed(() => (props.node && props.node.kind !== 'folder' ? props.node : null));
const folder = computed(() => (props.node?.kind === 'folder' ? props.node.path : ''));
const title = computed(() => {
  if (file.value) return t('Importer sur {name}', { name: docBaseName(file.value.path) });
  return folder.value ? t('Importer dans {name}', { name: docBaseName(folder.value) }) : t('Importer un .md ou un ZIP');
});
const accept = computed(() => {
  if (!file.value) return '.zip,application/zip,.md,.markdown,text/markdown,image/png,image/jpeg,image/webp,image/gif';
  return file.value.kind === 'image' ? 'image/png,image/jpeg,image/webp,image/gif' : '.md,.markdown,text/markdown';
});

const picker = ref<HTMLInputElement | null>(null);
const preview = ref<DocImportPreviewDTO | null>(null);
const busy = ref(false);
const actions = ref<Record<string, DocImportAction>>({});
/** État du comparateur de chaque fichier ouvert : retrouvé en y revenant. */
const merges = ref<Record<string, MergeSnapshot>>({});
const selected = ref<string | null>(null);
const pair = ref<DocImportCompareDTO | null>(null);
const pairs = new Map<string, DocImportCompareDTO>();
const loading = ref(false);

const STATUS = computed<Record<DocImportStatus, { label: string; severity: 'success' | 'info' | 'warn' | 'danger' | 'secondary'; hint: string }>>(() => ({
  new: { label: t('Nouveau'), severity: 'success', hint: t('Ce fichier n’existe pas encore ici.') },
  updated: { label: t('Modifié dans l’import'), severity: 'info', hint: t('Seul l’import a changé depuis l’export.') },
  merged: { label: t('Fusionné'), severity: 'info', hint: t('Les deux versions ont changé, sans se gêner : les blocs sont déjà choisis.') },
  conflict: { label: t('Conflit'), severity: 'danger', hint: t('Choisissez ce que vous gardez de chaque bloc.') },
  removed: { label: t('Retiré de l’import'), severity: 'warn', hint: t('Ce fichier a été exporté, mais n’est plus dans l’import.') },
  kept: { label: t('Modifié sur le serveur'), severity: 'secondary', hint: t('L’import n’apporte rien de neuf : seul le serveur a changé depuis l’export.') },
  same: { label: t('Identique'), severity: 'secondary', hint: '' },
}));

const isDirty = (entry: DocImportEntryDTO): boolean => merges.value[entry.path]?.dirty === true;

function optionsFor(entry: DocImportEntryDTO): Array<{ value: DocImportAction; label: string }> {
  const keep = { value: 'keep' as const, label: t('Garder le serveur') };
  const incoming = { value: 'incoming' as const, label: t('Prendre l’import') };
  const result = { value: 'auto' as const, label: t('Résultat de la comparaison') };
  switch (entry.status) {
    case 'new':
      return [{ value: 'auto', label: t('Importer') }, { value: 'keep', label: t('Ignorer') }];
    case 'updated':
      return isDirty(entry) ? [result, incoming, keep] : [{ value: 'auto', label: t('Prendre l’import') }, keep];
    case 'merged':
      return isDirty(entry) ? [result, incoming, keep] : [{ value: 'auto', label: t('Fusion automatique') }, incoming, keep];
    case 'kept':
      return isDirty(entry) ? [result, keep, incoming] : [keep, incoming];
    case 'conflict':
      return entry.kind === 'markdown' ? [result, keep, incoming, { value: 'both', label: t('Garder les deux') }] : [keep, incoming, { value: 'both', label: t('Garder les deux') }];
    case 'removed':
      return [keep, { value: 'delete', label: t('Supprimer du serveur') }];
    default:
      return [];
  }
}

/** Les conflits d'abord : c'est là que l'attention est utile. */
const RANK: Record<DocImportStatus, number> = { conflict: 0, merged: 1, updated: 2, new: 3, removed: 4, kept: 5, same: 6 };

const toReview = computed(() => [...(preview.value?.entries ?? [])].filter((entry) => entry.status !== 'same').sort((a, b) => RANK[a.status] - RANK[b.status] || a.path.localeCompare(b.path)));
const unchanged = computed(() => (preview.value?.entries.length ?? 0) - toReview.value.length);
const entry = computed(() => toReview.value.find((candidate) => candidate.path === selected.value) ?? null);
const unresolved = computed(() => toReview.value.filter((candidate) => candidate.status === 'conflict' && candidate.kind === 'markdown' && actions.value[candidate.path] === 'auto' && (merges.value[candidate.path]?.pending ?? 1) > 0));
const hasWork = computed(() => toReview.value.some((candidate) => actions.value[candidate.path] !== 'keep'));
/** Comparer n'a de sens que s'il y a deux versions ; une image se tranche d'un choix. */
const comparable = computed(() => entry.value?.kind === 'markdown');
const twoSided = computed(() => pair.value !== null && pair.value.server !== null && pair.value.incoming !== null);
const wide = computed(() => toReview.value.length > 0);

/** Fichier seul : son comparateur est l'écran principal, et un conflit se résout là. */
function defaultAction(candidate: DocImportEntryDTO, alone: boolean): DocImportAction {
  if (candidate.status === 'removed' || candidate.status === 'kept') return 'keep';
  if (candidate.status !== 'conflict') return 'auto';
  return alone && candidate.kind === 'markdown' ? 'auto' : 'keep';
}

watch(visible, (open) => {
  if (!open) return;
  preview.value = null;
  selected.value = null;
  pair.value = null;
  pairs.clear();
  merges.value = {};
});

async function select(path: string): Promise<void> {
  selected.value = path;
  const known = pairs.get(path);
  pair.value = known ?? null;
  if (known || !preview.value || toReview.value.find((candidate) => candidate.path === path)?.kind !== 'markdown') return;
  loading.value = true;
  try {
    const loaded = await api.docImportCompare(props.spaceId, preview.value.importId, path);
    pairs.set(path, loaded);
    if (selected.value === path) pair.value = loaded;
  } catch (error) {
    notifyError(error, t('Comparaison impossible'));
  } finally {
    loading.value = false;
  }
}

async function onFile(event: Event): Promise<void> {
  const element = event.target as HTMLInputElement;
  const chosen = element.files?.[0];
  element.value = '';
  if (!chosen) return;
  busy.value = true;
  try {
    const result = file.value ? await api.docFileImportPreview(file.value.id, chosen) : await api.docImportPreview(props.spaceId, chosen, folder.value);
    preview.value = result;
    const alone = result.entries.filter((candidate) => candidate.status !== 'same').length === 1;
    actions.value = Object.fromEntries(result.entries.map((candidate) => [candidate.path, defaultAction(candidate, alone)]));
    if (toReview.value[0]) await select(toReview.value[0].path);
  } catch (error) {
    notifyError(error, t('Fichier illisible'));
  } finally {
    busy.value = false;
  }
}

function onMerge(snapshot: MergeSnapshot): void {
  const path = selected.value;
  if (!path) return;
  const wasDirty = merges.value[path]?.dirty;
  merges.value = { ...merges.value, [path]: snapshot };
  // Toucher au comparateur, c'est vouloir son résultat.
  if (snapshot.dirty && !wasDirty) actions.value[path] = 'auto';
}

function decision(candidate: DocImportEntryDTO): { path: string; action: DocImportAction; content?: string } {
  const action = actions.value[candidate.path]!;
  const merge = merges.value[candidate.path];
  const useResult = action === 'auto' && merge && (merge.dirty || candidate.status === 'conflict');
  return { path: candidate.path, action, ...(useResult ? { content: merge.text } : {}) };
}

async function apply(): Promise<void> {
  if (!preview.value) return;
  busy.value = true;
  try {
    const decisions = toReview.value.filter((candidate) => actions.value[candidate.path] !== 'keep').map(decision);
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
  <Dialog v-model:visible="visible" modal :maximizable="wide" :header="title" :style="wide ? { width: 'min(90rem, calc(100vw - 2rem))', height: 'min(90vh, 60rem)' } : { width: 'min(36rem, calc(100vw - 2rem))' }" :content-style="wide ? { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' } : undefined">
    <div v-if="!preview" class="start">
      <p class="muted">{{ file ? $t('Choisissez la version à comparer à ce fichier. Vous choisirez bloc par bloc ce que vous gardez avant que quoi que ce soit ne soit écrit.') : $t('Choisissez un fichier .md, une image, un export de cet espace ou un coffre Obsidian zippé. Ce qui existe déjà se compare bloc par bloc avant que quoi que ce soit ne soit écrit.') }}</p>
      <Button :label="file ? $t('Choisir le fichier') : $t('Choisir un fichier ou un ZIP')" icon="pi pi-upload" :loading="busy" @click="picker?.click()" />
      <input ref="picker" type="file" :accept="accept" class="file" @change="onFile" />
    </div>

    <template v-else>
      <p v-if="toReview.length > 1 || unchanged || preview.ignored.length" class="muted small summary">
        {{ $t('{n} fichier à examiner|{n} fichiers à examiner', { n: toReview.length }) }}<template v-if="unchanged"> · {{ $t('{n} sans changement à apporter|{n} sans changement à apporter', { n: unchanged }) }}</template><template v-if="preview.ignored.length"> · {{ $t('{n} ignoré|{n} ignorés', { n: preview.ignored.length }) }}</template>
      </p>
      <Message v-if="preview.ignored.length" severity="warn" size="small" :closable="false">{{ $t('Formats non pris en charge : {files}', { files: preview.ignored.slice(0, 5).join(', ') }) }}</Message>

      <div v-if="toReview.length" class="review" :class="{ alone: toReview.length === 1 }">
        <ul v-if="toReview.length > 1" class="entries" role="listbox" :aria-label="$t('Fichiers de l’import')">
          <li v-for="candidate in toReview" :key="candidate.path">
            <button type="button" class="entry" :class="{ active: candidate.path === selected, skipped: actions[candidate.path] === 'keep' }" role="option" :aria-selected="candidate.path === selected" :title="candidate.path" @click="select(candidate.path)">
              <span class="entry-name"><i :class="candidate.kind === 'image' ? 'pi pi-image' : 'pi pi-file'" class="muted"></i><span class="truncate">{{ candidate.path }}</span></span>
              <Tag :value="STATUS[candidate.status].label" :severity="STATUS[candidate.status].severity" />
            </button>
          </li>
        </ul>

        <section v-if="entry" class="detail">
          <header class="detail-head">
            <div class="detail-title">
              <strong class="truncate" :title="entry.path">{{ entry.path }}</strong>
              <Tag :value="STATUS[entry.status].label" :severity="STATUS[entry.status].severity" />
              <span class="muted small hint">{{ STATUS[entry.status].hint }}</span>
            </div>
            <Select v-model="actions[entry.path]" :options="optionsFor(entry)" option-label="label" option-value="value" size="small" class="action" :aria-label="$t('Que faire de {name}', { name: entry.path })" />
          </header>

          <div class="compare">
            <div v-if="!comparable" class="placeholder muted"><i class="pi pi-image"></i> {{ $t('Une image ne se compare pas : choisissez la version à garder.') }}</div>
            <div v-else-if="loading && !pair" class="placeholder muted"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</div>
            <DocMergeView
              v-else-if="pair"
              :key="entry.path"
              :left="{ label: $t('Sur le serveur'), text: pair.server ?? '' }"
              :right="{ label: $t('Dans l’import'), text: pair.incoming ?? '' }"
              :base="pair.base"
              :readonly="!twoSided"
              :saved="merges[entry.path]"
              @change="onMerge"
            />
          </div>
        </section>
      </div>
      <p v-else class="muted">{{ $t('Rien à importer : tout est déjà à jour.') }}</p>
    </template>

    <template v-if="preview" #footer>
      <small v-if="unresolved.length" class="left">{{ $t('{n} fichier avec des blocs à choisir|{n} fichiers avec des blocs à choisir', { n: unresolved.length }) }}</small>
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
.review {
  display: grid;
  flex: 1;
  grid-template-columns: 17rem minmax(0, 1fr);
  gap: 0.75rem;
  min-height: 0;
}
.review.alone {
  grid-template-columns: minmax(0, 1fr);
}
.entries {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-height: 0;
  margin: 0;
  padding: 0 0.4rem 0 0;
  overflow-y: auto;
  list-style: none;
}
.entry {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.2rem;
  width: 100%;
  padding: 0.4rem 0.5rem;
  border: 0;
  border-radius: 8px;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 0.82rem;
  text-align: left;
  cursor: pointer;
}
.entry:hover {
  background: var(--fb-panel-alt);
}
.entry.active {
  background: var(--fb-accent-soft);
}
.entry.skipped .entry-name {
  opacity: 0.65;
}
.entry-name {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  width: 100%;
  min-width: 0;
}
.detail {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
  min-height: 0;
}
.detail-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.75rem;
}
.detail-title {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.2rem 0.5rem;
  min-width: 0;
}
.hint {
  flex-basis: 100%;
}
.action {
  width: 16rem;
  flex-shrink: 0;
}
.compare {
  flex: 1;
  min-height: 0;
}
.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  height: 100%;
}
.left {
  margin-right: auto;
  color: var(--fb-danger);
}
@media (max-width: 760px) {
  .review {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 7.5rem minmax(0, 1fr);
  }
  .review.alone {
    grid-template-rows: minmax(0, 1fr);
  }
  .action {
    width: 100%;
  }
}
</style>
