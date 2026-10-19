<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import Button from 'primevue/button';
import Textarea from 'primevue/textarea';
import { LIMITS } from '@shared/constants';

import { t } from '@/i18n';
const props = defineProps<{
  /** Mission actuelle (vide si non renseignée). */
  note: string;
  /** Prénom ou nom de la personne, pour les libellés. */
  name: string;
  /** Vrai pour « moi » : les libellés passent à la première personne. */
  isMe: boolean;
  editable: boolean;
}>();
const emit = defineEmits<{ save: [note: string] }>();

const editing = ref(false);
const draft = ref('');
const saving = ref(false);
const field = ref<{ $el: HTMLTextAreaElement } | null>(null);

const addLabel = computed(() => (props.isMe ? t('Décrire ma mission') : t('Décrire la mission de {name}', { name: props.name })));
const placeholder = computed(() => (props.isMe ? t('Ce que vous devez faire sur ce ticket…') : t('Ce que {name} doit faire sur ce ticket…', { name: props.name })));

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
  <div class="part-note">
    <form v-if="editing" class="edit" @submit.prevent="save">
      <Textarea
        ref="field"
        v-model="draft"
        auto-resize
        rows="2"
        :maxlength="LIMITS.partNoteMax"
        :placeholder="placeholder"
        fluid
        :aria-label="isMe ? $t('Ma mission sur ce ticket') : $t('Mission de {name}', { name })"
        @keydown.ctrl.enter.prevent="save"
        @keydown.meta.enter.prevent="save"
        @keydown.esc="cancel"
      />
      <div class="actions">
        <Button type="submit" :label="$t('Enregistrer')" size="small" :loading="saving" />
        <Button type="button" :label="$t('Annuler')" size="small" severity="secondary" text @click="cancel" />
        <span class="muted small hint">{{ $t('Ctrl + Entrée pour enregistrer · laisser vide pour effacer') }}</span>
      </div>
    </form>

    <div v-else-if="note" class="view">
      <span class="label">{{ $t('Mission') }}</span>
      <p class="text">{{ note }}</p>
      <Button
        v-if="editable"
        class="edit-btn"
        icon="pi pi-pencil"
        text
        rounded
        size="small"
        severity="secondary"
        :aria-label="isMe ? $t('Modifier ma mission') : $t('Modifier la mission de {name}', { name })"
        @click="start"
      />
    </div>

    <button v-else-if="editable" type="button" class="add" @click="start"><i class="pi pi-plus"></i> {{ addLabel }}</button>
  </div>
</template>

<style scoped>
.part-note {
  min-width: 0;
}
/* Rien à montrer (pas de mission et pas le droit d'en écrire) : la ligne disparaît. */
.part-note:empty {
  display: none;
}
.view {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.4rem 2.2rem 0.4rem 0.75rem;
  border-left: 3px solid var(--fb-accent);
  border-radius: 0 8px 8px 0;
  background: var(--fb-accent-soft);
}
.label {
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--fb-accent);
}
.text {
  margin: 0;
  font-size: 0.9rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.edit-btn {
  position: absolute;
  top: 0.2rem;
  right: 0.2rem;
}
.add {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.15rem 0;
  border: 0;
  background: none;
  color: var(--fb-muted);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}
.add:hover,
.add:focus-visible {
  color: var(--fb-accent);
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
