<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import MarkdownEditor from '@/components/common/MarkdownEditor.vue';
import MarkdownView from '@/components/common/MarkdownView.vue';

/**
 * Description d'un ticket en Markdown : affichage mis en forme, édition au clic avec barre d'outils, et mode plein
 * écran (éditeur et aperçu côte à côte) depuis le bouton en haut à droite.
 */
const props = defineProps<{ ticketId: number; value: string; editable: boolean }>();
const emit = defineEmits<{ save: [value: string] }>();

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
  // Un clic sur un lien, une mention ou une case à cocher garde son effet au lieu de passer en édition.
  if (!props.editable || (event?.target as HTMLElement | null)?.closest('a, button, input, .md-mermaid')) return;
  editing.value = true;
  void nextTick(() => editor.value?.focus());
}

function commit(): void {
  editing.value = false;
  if (draft.value !== props.value) emit('save', draft.value);
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
  if (draft.value !== props.value) emit('save', draft.value);
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
        rows="6"
        auto-resize
        maxlength="20000"
        :placeholder="$t('Contexte, critères d\'acceptation, liens utiles… (Markdown, @ pour mentionner)')"
        @blur="commit"
        @escape="cancel"
      />
      <small class="muted hint">{{ $t('Markdown : **gras**, _italique_, listes, tableaux, `code`, $formule$, blocs ```mermaid. Échap annule, cliquer ailleurs enregistre.') }}</small>
    </template>
    <div
      v-else
      class="view"
      :class="{ editable, empty: !draft.trim() }"
      :tabindex="editable ? 0 : -1"
      :role="editable ? 'button' : undefined"
      :aria-label="editable ? $t('Modifier la description') : undefined"
      @click="startEdit"
      @keydown.enter.self.prevent="startEdit()"
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
        <MarkdownEditor v-if="editable" ref="bigEditor" v-model="draft" maxlength="20000" class="big-editor" :placeholder="$t('Markdown, @ pour mentionner')" @escape="fullscreen = false" />
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
