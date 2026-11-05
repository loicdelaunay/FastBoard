<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import Button from 'primevue/button';
import Textarea from 'primevue/textarea';
import { LIMITS } from '@shared/constants';

import { t } from '@/i18n';
/** Texte d'une ligne d'avancement, dans le fil de la ligne ; le crayon apparaît à son survol. */
const props = defineProps<{
  /** Mission actuelle (vide si non renseignée). */
  note: string;
  /** Prénom ou nom de la personne, pour les libellés (`null` : ligne sans personne). */
  name: string | null;
  /** Vrai pour « moi » : les libellés passent à la première personne. */
  isMe: boolean;
  editable: boolean;
}>();
const emit = defineEmits<{ save: [note: string] }>();

const editing = ref(false);
const draft = ref('');
const saving = ref(false);
const field = ref<{ $el: HTMLTextAreaElement } | null>(null);

const editLabel = computed(() => {
  if (props.note) return props.isMe ? t('Modifier ma mission') : props.name ? t('Modifier la mission de {name}', { name: props.name }) : t('Modifier la ligne');
  return props.isMe ? t('Décrire ma mission') : props.name ? t('Décrire la mission de {name}', { name: props.name }) : t('Décrire cette ligne');
});
const placeholder = computed(() => (props.isMe ? t('Ce que vous devez faire sur ce ticket…') : props.name ? t('Ce que {name} doit faire sur ce ticket…', { name: props.name }) : t('Ce qu’il y a à faire…')));

async function start(): Promise<void> {
  draft.value = props.note;
  editing.value = true;
  await nextTick();
  field.value?.$el.focus();
}

function cancel(): void {
  editing.value = false;
}

async function save(): Promise<void> {
  if (draft.value.trim() === props.note) {
    editing.value = false;
    return;
  }
  saving.value = true;
  try {
    emit('save', draft.value.trim());
    editing.value = false;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <form v-if="editing" class="edit" @submit.prevent="save">
    <Textarea
      ref="field"
      v-model="draft"
      auto-resize
      rows="2"
      :maxlength="LIMITS.partNoteMax"
      :placeholder="placeholder"
      fluid
      :aria-label="isMe ? $t('Ma mission sur ce ticket') : name ? $t('Mission de {name}', { name }) : $t('Texte de la ligne')"
      @keydown.ctrl.enter.prevent="save"
      @keydown.meta.enter.prevent="save"
      @keydown.esc.stop="cancel"
    />
    <div class="actions">
      <Button type="submit" :label="$t('Enregistrer')" size="small" :loading="saving" />
      <Button type="button" :label="$t('Annuler')" size="small" severity="secondary" text @click="cancel" />
      <span class="muted small hint">{{ $t('Ctrl + Entrée pour enregistrer · laisser vide pour effacer') }}</span>
    </div>
  </form>

  <span v-else class="view">
    <span v-if="note" class="text">{{ note }}</span>
    <slot />
    <button v-if="editable" v-tooltip.top="editLabel" type="button" class="edit-btn" :aria-label="editLabel" @click="start"><i class="pi pi-pencil"></i></button>
  </span>
</template>

<style scoped>
.text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.edit-btn {
  display: inline-grid;
  place-items: center;
  width: 1.3rem;
  height: 1.3rem;
  margin-left: 0.15rem;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--fb-muted);
  font-size: 0.7rem;
  vertical-align: middle;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s;
}
.edit-btn:hover {
  background: var(--fb-panel);
  color: var(--fb-accent);
}
.edit-btn:focus-visible {
  opacity: 1;
}
/* Sans survol possible (écran tactile), le crayon reste visible. */
@media (hover: none) {
  .edit-btn {
    opacity: 1;
  }
}
.edit {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.hint {
  margin-left: auto;
}
@media (max-width: 600px) {
  .hint {
    display: none;
  }
}
</style>
