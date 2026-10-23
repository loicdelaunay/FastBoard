<script setup lang="ts">
import { computed, ref } from 'vue';
import Button from 'primevue/button';
import type { AiChangeDTO } from '@shared/ai';
import { useAiStore, type AiTurn } from '@/stores/ai';

import { t } from '@/i18n';
/** Modifications faites ou proposées par l'assistant dans une réponse : différences, annulation, validation. */
const props = defineProps<{ turn: AiTurn }>();
const ai = useAiStore();

const opened = ref(new Set<string>());
const edits = computed(() => props.turn.edits ?? []);
const pending = computed(() => edits.value.filter((change) => change.state === 'pending').length);
const applied = computed(() => edits.value.filter((change) => change.state === 'applied').length);
const title = computed(() =>
  pending.value
    ? t('{n} modification proposée|{n} modifications proposées', { n: pending.value })
    : applied.value
      ? t('{n} modification faite par l’assistant|{n} modifications faites par l’assistant', { n: applied.value })
      : t('{n} modification annulée ou ignorée|{n} modifications annulées ou ignorées', { n: edits.value.length }),
);

function toggle(id: string): void {
  const next = new Set(opened.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  opened.value = next;
}

const FIELD_LABELS = computed<Record<string, string>>(() => ({
  title: t('Titre'),
  description: t('Description'),
  status: t('Colonne'),
  priorityId: t('Priorité'),
  categoryId: t('Catégorie'),
  deliveryId: t('Livraison'),
  componentIds: t('Composants'),
  assigneeIds: t('Assignés'),
  startDate: t('Début'),
  endDate: t('Fin'),
  progress: t('Avancement'),
  parentId: t('Ticket parent'),
  comment: t('Commentaire'),
  subtask: t('Sous-tâche'),
  subtaskDone: t('État'),
  link: t('Dépendance'),
}));

const STATE = computed<Record<AiChangeDTO['state'], { label: string; icon: string }>>(() => ({
  applied: { label: t('Appliquée'), icon: 'pi pi-check-circle' },
  pending: { label: t('À valider'), icon: 'pi pi-clock' },
  reverted: { label: t('Annulée'), icon: 'pi pi-undo' },
  rejected: { label: t('Ignorée'), icon: 'pi pi-ban' },
}));

/** Valeurs techniques renvoyées par le serveur (« cochée », « à faire ») traduites pour l'affichage. */
const show = (value: string | null) => (value === null ? t('aucun') : value === 'cochée' ? t('cochée') : value === 'à faire' ? t('à faire') : value);
</script>

<template>
  <div v-if="edits.length" class="changes">
    <div class="head">
      <span class="title"><i class="pi pi-pencil"></i> {{ title }}</span>
      <Button v-if="pending > 1" :label="$t('Tout appliquer')" icon="pi pi-check" size="small" text :disabled="ai.changeBusy !== null" @click="ai.applyAll(turn)" />
      <Button v-else-if="applied > 1" :label="$t('Tout annuler')" icon="pi pi-undo" size="small" text severity="secondary" :disabled="ai.changeBusy !== null" @click="ai.revertAll(turn)" />
    </div>
    <ul class="list">
      <li v-for="change in edits" :key="change.id" class="change" :class="change.state">
        <div class="row-line">
          <button type="button" class="label" :aria-expanded="opened.has(change.id)" @click="toggle(change.id)">
            <i :class="opened.has(change.id) ? 'pi pi-chevron-down' : 'pi pi-chevron-right'" class="chevron"></i>
            <span class="truncate">{{ change.label }}</span>
          </button>
          <span class="state" :title="STATE[change.state].label"><i :class="STATE[change.state].icon"></i> {{ STATE[change.state].label }}</span>
        </div>
        <dl v-if="opened.has(change.id)" class="diff">
          <div v-for="entry in change.diff" :key="entry.field" class="diff-row">
            <dt>{{ FIELD_LABELS[entry.field] ?? entry.field }}</dt>
            <dd>
              <span v-if="entry.from !== null" class="from">{{ show(entry.from) }}</span>
              <i v-if="entry.from !== null" class="pi pi-arrow-right arrow"></i>
              <span class="to">{{ show(entry.to) }}</span>
            </dd>
          </div>
        </dl>
        <div class="buttons">
          <template v-if="change.state === 'pending'">
            <Button :label="$t('Appliquer')" icon="pi pi-check" size="small" :loading="ai.changeBusy === change.id" :disabled="ai.changeBusy !== null && ai.changeBusy !== change.id" @click="ai.applyChange(change)" />
            <Button :label="$t('Ignorer')" size="small" text severity="secondary" :disabled="ai.changeBusy !== null" @click="ai.rejectChange(change)" />
          </template>
          <Button v-else-if="change.state === 'applied'" :label="$t('Annuler')" icon="pi pi-undo" size="small" text severity="secondary" :loading="ai.changeBusy === change.id" :disabled="ai.changeBusy !== null && ai.changeBusy !== change.id" @click="ai.revertChange(change)" />
          <Button v-else :label="change.state === 'rejected' ? $t('Appliquer quand même') : $t('Réappliquer')" icon="pi pi-replay" size="small" text :loading="ai.changeBusy === change.id" :disabled="ai.changeBusy !== null && ai.changeBusy !== change.id" @click="ai.applyChange(change)" />
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.changes {
  border: 1px solid color-mix(in srgb, #a95cff 35%, var(--fb-border));
  border-radius: 10px;
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.4rem 0.3rem 0.65rem;
  background: color-mix(in srgb, #a95cff 9%, transparent);
}
.title {
  flex: 1;
  color: #a95cff;
  font-size: 0.8rem;
  font-weight: 700;
}
.list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.change {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.45rem 0.65rem;
  border-top: 1px solid var(--fb-border);
  font-size: 0.82rem;
}
.change.reverted .label,
.change.rejected .label {
  text-decoration: line-through;
  opacity: 0.7;
}
.row-line {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.label {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--fb-text);
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.chevron {
  font-size: 0.65rem;
  color: var(--fb-muted);
}
.state {
  color: var(--fb-muted);
  font-size: 0.72rem;
  white-space: nowrap;
}
.change.applied .state {
  color: #16a34a;
}
.change.pending .state {
  color: #d97706;
}
.diff {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin: 0;
  padding: 0.4rem 0.5rem;
  border-radius: 8px;
  background: var(--fb-panel-alt);
}
.diff-row {
  display: grid;
  grid-template-columns: 6.5rem 1fr;
  gap: 0.4rem;
}
.diff dt {
  color: var(--fb-muted);
  font-weight: 700;
}
.diff dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.from {
  color: var(--fb-danger);
  text-decoration: line-through;
}
.to {
  color: #16a34a;
}
.arrow {
  margin: 0 0.3rem;
  font-size: 0.65rem;
  color: var(--fb-muted);
}
.buttons {
  display: flex;
  gap: 0.25rem;
}
</style>
