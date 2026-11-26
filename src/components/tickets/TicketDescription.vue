<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import { attachmentMarkdown } from '@shared/attachmentMarkdown';
import MarkdownEditor from '@/components/common/MarkdownEditor.vue';
import MarkdownView from '@/components/common/MarkdownView.vue';
import type { MarkdownImageSupport } from '@/components/common/markdownImages';
import { claimFiles, droppedFiles, hasFiles } from '@/composables/useFileDrop';
import { t } from '@/i18n';
import { useProjectStore } from '@/stores/project';
import { attachmentUrl, isImageAttachment } from '@/utils/files';
import { notifyError } from '@/utils/notify';

/**
 * Description d'un ticket en Markdown : affichage mis en forme, édition au clic avec barre d'outils, et mode plein
 * écran (éditeur et aperçu côte à côte) depuis le bouton en haut à droite. Une image collée, glissée ou choisie
 * (« Image ») est jointe au ticket et s'affiche à l'endroit voulu du texte.
 */
const props = defineProps<{ ticketId: number; value: string; editable: boolean }>();
const emit = defineEmits<{ save: [value: string] }>();
const project = useProjectStore();

const draft = ref(props.value);
const editing = ref(false);
const fullscreen = ref(false);
const editor = ref<InstanceType<typeof MarkdownEditor> | null>(null);
const bigEditor = ref<InstanceType<typeof MarkdownEditor> | null>(null);

// Les modifications d'un collègue s'affichent, sauf pendant la saisie.
watch(() => props.value, (value) => !editing.value && !fullscreen.value && (draft.value = value));
watch(() => props.ticketId, () => {
  editing.value = false;
  fullscreen.value = false;
  draft.value = props.value;
});

function startEdit(event?: MouseEvent): void {
  // Un clic sur un lien, une mention, une case à cocher ou une image (agrandie) garde son effet au lieu de passer en édition.
  if (!props.editable || (event?.target as HTMLElement | null)?.closest('a, button, input, img, .md-mermaid')) return;
  editing.value = true;
  void nextTick(() => editor.value?.focus());
}

/** Enregistre le texte, sauf pendant un envoi d'image : il le sera une fois les repères remplacés. */
function saveDraft(): void {
  if (pending.value === 0 && draft.value !== props.value) emit('save', draft.value);
}

function commit(): void {
  editing.value = false;
  saveDraft();
}

function cancel(): void {
  draft.value = props.value;
  editing.value = false;
}

function openFullscreen(): void {
  editing.value = false;
  fullscreen.value = true;
  if (props.editable) void nextTick(() => bigEditor.value?.focus());
}

function closeFullscreen(): void {
  fullscreen.value = false;
  saveDraft();
}

// --- Images : jointes au ticket, affichées dans le texte -------------------------------------------------------------

const canAttach = computed(() => props.editable && project.can('attachment.create') && !project.archived && project.fieldOn('attachments'));
const pending = ref(0);

/** Remplace un repère « Envoi… » par le Markdown final (ou le retire). */
function settle(token: string, markdown: string): void {
  draft.value = markdown ? draft.value.replace(token, markdown) : draft.value.replace(`${token}\n`, '').replace(token, '');
  pending.value -= 1;
  // Le champ a été quitté pendant l'envoi : le texte s'enregistre maintenant, avec l'image.
  if (!editing.value && !fullscreen.value) saveDraft();
}

const images = computed<MarkdownImageSupport | undefined>(() =>
  canAttach.value
    ? {
        emptyText: t('Aucune image jointe à ce ticket : importez-en une.'),
        choices: () =>
          (project.attachments[props.ticketId] ?? [])
            .filter((attachment) => attachment.kind === 'file' && isImageAttachment(attachment))
            .map((attachment) => ({ key: String(attachment.id), name: attachment.name, thumb: attachmentUrl(attachment, true), markdown: attachmentMarkdown(attachment, true) })),
        upload: (file, token) => {
          pending.value += 1;
          project
            .addAttachment(props.ticketId, file)
            .then((attachment) => settle(token, attachmentMarkdown(attachment, attachment.kind === 'file' && isImageAttachment(attachment))))
            .catch((error) => {
              settle(token, '');
              notifyError(error, t('Envoi impossible'));
            });
        },
      }
    : undefined,
);

/** Fichiers lâchés sur la description affichée : elle passe en édition, et ils s'ajoutent à la fin. */
function onViewDragOver(event: DragEvent): void {
  if (!images.value || !hasFiles(event)) return;
  event.preventDefault();
}
function onViewDrop(event: DragEvent): void {
  if (!images.value || !hasFiles(event)) return;
  event.preventDefault();
  claimFiles(event);
  const files = droppedFiles(event);
  editing.value = true;
  void nextTick(() => editor.value?.insertFiles(files, 'end'));
}
</script>

<template>
  <div class="description">
    <div class="head">
      <label :for="`ticket-description-${ticketId}`" class="label">{{ $t('Description') }}</label>
      <Button v-tooltip.top="$t('Plein écran')" icon="pi pi-window-maximize" text rounded size="small" severity="secondary" :aria-label="$t('Afficher la description en plein écran')" @click="openFullscreen" />
    </div>

    <template v-if="editing">
      <MarkdownEditor
        :id="`ticket-description-${ticketId}`"
        ref="editor"
        v-model="draft"
        :images="images"
        rows="6"
        auto-resize
        maxlength="20000"
        :placeholder="$t('Contexte, critères d\'acceptation, liens utiles… (Markdown, @ pour mentionner)')"
        @blur="commit"
        @escape="cancel"
      />
      <small class="muted hint">{{ $t('Markdown : **gras**, _italique_, listes, tableaux, `code`, $formule$, blocs ```mermaid. Échap annule, cliquer ailleurs enregistre.') }}<template v-if="images"> {{ $t('Collez ou glissez une image pour l’insérer au curseur.') }}</template></small>
    </template>
    <div
      v-else
      class="view"
      :class="{ editable, empty: !draft.trim() }"
      :tabindex="editable ? 0 : -1"
      :role="editable ? 'button' : undefined"
      :aria-label="editable ? $t('Modifier la description') : undefined"
      :data-image-drop="images ? '' : undefined"
      @click="startEdit"
      @keydown.enter.self.prevent="startEdit()"
      @dragover="onViewDragOver"
      @drop="onViewDrop"
    >
      <MarkdownView v-if="draft.trim()" :text="draft" />
      <span v-else class="muted">{{ editable ? $t('Ajouter une description… (Markdown, @ pour mentionner une personne ou un ticket)') : $t('Aucune description.') }}</span>
    </div>

    <Dialog
      v-model:visible="fullscreen"
      modal
      :header="$t('Description')"
      class="description-fullscreen"
      :style="{ width: '96vw', height: '94vh', maxHeight: '94vh' }"
      :content-style="{ height: '100%', display: 'flex', minHeight: 0 }"
      @hide="closeFullscreen"
    >
      <div class="split" :class="{ single: !editable }">
        <MarkdownEditor v-if="editable" ref="bigEditor" v-model="draft" :images="images" maxlength="20000" class="big-editor" :placeholder="$t('Markdown, @ pour mentionner')" @escape="fullscreen = false" />
        <div class="preview">
          <MarkdownView v-if="draft.trim()" :text="draft" />
          <p v-else class="muted">{{ $t('Aucune description.') }}</p>
        </div>
      </div>
    </Dialog>
  </div>
</template>

<style scoped>
.description {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: -0.25rem;
}
.label {
  font-weight: 600;
  font-size: 0.85rem;
}
.hint {
  font-size: 0.72rem;
}
.view {
  min-height: 2.6rem;
  padding: 0.55rem 0.7rem;
  border: 1px solid transparent;
  border-radius: 8px;
}
.view.editable {
  cursor: text;
  border-color: var(--fb-border);
}
.view.editable:hover,
.view.editable:focus-visible {
  border-color: var(--fb-accent);
  outline: none;
}
.split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1rem;
  width: 100%;
  min-height: 0;
}
.split.single {
  grid-template-columns: minmax(0, 1fr);
}
.big-editor {
  min-height: 0;
  overflow: hidden;
}
.big-editor :deep(.mention-box),
.big-editor :deep(textarea) {
  height: 100%;
}
.big-editor :deep(.area) {
  flex: 1;
  min-height: 0;
}
.big-editor :deep(textarea) {
  resize: none;
}
.preview {
  min-height: 0;
  overflow-y: auto;
  padding: 0.75rem 1rem;
  border: 1px solid var(--fb-border);
  border-radius: 8px;
}
@media (max-width: 900px) {
  .split {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  }
}
</style>
