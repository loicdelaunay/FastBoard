<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import Textarea from 'primevue/textarea';
import { docBaseName, docTitle, DOC_LIMITS, type DocNodeDTO, type DocNodeInfoDTO } from '@shared/docs';
import { api } from '@/api';
import { formatBytes } from '@/utils/files';
import { formatDateTime, formatRelative } from '@/utils/format';
import { notify, notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** « Infos » d'un fichier ou d'un dossier (taille, contenu, dates), ou sa note : à quoi il sert. */
const props = defineProps<{ node: DocNodeDTO | null; mode: 'info' | 'memo'; canEdit: boolean }>();
const visible = defineModel<boolean>('visible', { required: true });

const info = ref<DocNodeInfoDTO | null>(null);
const memo = ref('');
const saving = ref(false);

const name = computed(() => (props.node ? (props.node.kind === 'markdown' || props.node.kind === 'template' ? docTitle(props.node.path) : docBaseName(props.node.path)) : ''));
const kindLabel = computed(() => (props.node?.kind === 'folder' ? t('Dossier') : props.node?.kind === 'image' ? t('Image') : props.node?.kind === 'template' ? t('Modèle de note') : t('Note Markdown')));

watch(visible, async (open) => {
  if (!open || !props.node) return;
  memo.value = props.node.memo;
  info.value = null;
  if (props.mode !== 'info') return;
  try {
    info.value = await api.docNodeInfo(props.node.id);
  } catch (error) {
    notifyError(error, t('Infos indisponibles'));
  }
});

async function saveMemo(): Promise<void> {
  if (!props.node) return;
  saving.value = true;
  try {
    await api.docSetMemo(props.node.id, memo.value);
    notify('success', memo.value.trim() ? t('Note enregistrée') : t('Note effacée'));
    visible.value = false;
  } catch (error) {
    notifyError(error, t('Note non enregistrée'));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="mode === 'info' ? $t('Infos : {name}', { name }) : $t('Note : {name}', { name })" :style="{ width: 'min(28rem, calc(100vw - 2rem))' }">
    <template v-if="node && mode === 'info'">
      <dl v-if="info" class="facts">
        <dt>{{ $t('Type') }}</dt>
        <dd>{{ kindLabel }}</dd>
        <dt>{{ $t('Emplacement') }}</dt>
        <dd class="path">{{ node.path }}</dd>
        <dt>{{ node.kind === 'folder' ? $t('Taille totale') : $t('Taille') }}</dt>
        <dd>{{ formatBytes(info.size) }}</dd>
        <template v-if="node.kind === 'folder'">
          <dt>{{ $t('Contenu') }}</dt>
          <dd>{{ $t('{n} fichier|{n} fichiers', { n: info.files }) }} · {{ $t('{n} dossier|{n} dossiers', { n: info.folders }) }}</dd>
        </template>
        <template v-if="info.words !== null">
          <dt>{{ $t('Texte') }}</dt>
          <dd>{{ $t('{n} mot|{n} mots', { n: info.words }) }} · {{ $t('{n} caractère|{n} caractères', { n: info.chars ?? 0 }) }} · {{ $t('{n} ligne|{n} lignes', { n: info.lines ?? 0 }) }}</dd>
          <dt>{{ $t('Historique') }}</dt>
          <dd>{{ $t('{n} version|{n} versions', { n: info.versions }) }}</dd>
        </template>
        <dt>{{ $t('Créé') }}</dt>
        <dd :title="formatDateTime(info.createdAt)">{{ formatRelative(info.createdAt) }}</dd>
        <dt>{{ $t('Modifié') }}</dt>
        <dd :title="formatDateTime(node.updatedAt)">{{ formatRelative(node.updatedAt) }}<template v-if="info.updatedByName"> · {{ info.updatedByName }}</template></dd>
        <dt>{{ $t('Note') }}</dt>
        <dd class="memo" :class="{ muted: !node.memo }">{{ node.memo || $t('Aucune note.') }}</dd>
      </dl>
      <p v-else class="muted"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</p>
    </template>

    <form v-else-if="node" class="memo-form" @submit.prevent="saveMemo">
      <p class="muted small">{{ node.kind === 'folder' ? $t('À quoi sert ce dossier ? Tous les membres de l’espace la verront, au survol dans l’arbre et dans « Infos ».') : $t('À quoi sert ce fichier ? Tous les membres de l’espace la verront, au survol dans l’arbre et dans « Infos ».') }}</p>
      <Textarea v-model="memo" rows="4" auto-resize fluid autofocus :maxlength="DOC_LIMITS.memoMax" :disabled="!canEdit" :aria-label="$t('Note')" />
      <div class="actions">
        <Button type="button" :label="$t('Annuler')" severity="secondary" text @click="visible = false" />
        <Button type="submit" :label="$t('Enregistrer')" icon="pi pi-check" :loading="saving" :disabled="!canEdit" />
      </div>
    </form>
  </Dialog>
</template>

<style scoped>
.facts {
  display: grid;
  grid-template-columns: 8.5rem minmax(0, 1fr);
  gap: 0.45rem 0.75rem;
  margin: 0;
}
.facts dt {
  color: var(--fb-muted);
  font-size: 0.85rem;
  font-weight: 600;
}
.facts dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.path {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 0.85rem;
}
.memo {
  white-space: pre-wrap;
}
.memo-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.memo-form p {
  margin: 0;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
