<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import ToggleSwitch from 'primevue/toggleswitch';
import { LIMITS } from '@shared/constants';
import { partProgress, partsSummary } from '@shared/progress';
import { progressOf } from '@/utils/progress';
import type { PartDTO, TicketDTO } from '@shared/types';
import ProgressMeter from '@/components/common/ProgressMeter.vue';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/project';
import { notifyError } from '@/utils/notify';
import { formatRelative } from '@/utils/format';
import PartNote from './PartNote.vue';
import ProgressSlider from './ProgressSlider.vue';

import { t } from '@/i18n';
/** Avancement d'un ticket : ses lignes (un texte, une personne facultative, un pourcentage ; à 100 %, la ligne est terminée). */
const props = defineProps<{ ticket: TicketDTO }>();

const auth = useAuthStore();
const project = useProjectStore();
const confirm = useConfirm();

const global = computed(() => progressOf(props.ticket));
/** Sous-tickets : l'avancement peut suivre le leur (réglage du ticket, activé par défaut). */
const children = computed(() => (project.fieldOn('children') ? project.childrenOf(props.ticket.id) : []));
const fromChildren = computed(() => children.value.length > 0 && props.ticket.progressFromChildren);
const fromChildrenHint = computed(() =>
  props.ticket.progressFromChildren
    ? t('La progression du ticket suit celle de ses sous-tickets.')
    : t('La progression du ticket vient de ses lignes ou se règle à la main.'),
);

async function setFromChildren(value: boolean): Promise<void> {
  try {
    await project.updateTicket(props.ticket.id, { progressFromChildren: value }, { label: t('Calcul de l’avancement') });
  } catch (error) {
    notifyError(error);
  }
}
const summary = computed(() => partsSummary(props.ticket));
const writable = computed(() => !project.archived);
const canEditTicket = computed(() => writable.value && project.can('ticket.edit'));
const showPeople = computed(() => project.fieldOn('assignees'));
const people = computed(() => project.users.filter((user) => user.isActive));
/** La liste commence par « personne » : on retire quelqu'un en choisissant dans la même liste. */
const personOptions = computed(() => [{ id: 0, name: t('Sans responsable') }, ...people.value]);

function canEditPart(part: PartDTO): boolean {
  return writable.value && (project.can('ticket.edit') || (part.userId === auth.user?.id && project.can('ticket.update_own_part')));
}

const personName = (part: PartDTO): string | null => (part.userId === null ? null : (project.usersById.get(part.userId)?.name ?? t('Utilisateur supprimé')));

async function run(action: () => Promise<void>, summaryText?: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    notifyError(error, summaryText);
  }
}

const update = (part: PartDTO, patch: Parameters<typeof project.updatePart>[2], summaryText?: string) => run(() => project.updatePart(props.ticket.id, part.id, patch), summaryText);

function askDelete(part: PartDTO): void {
  const name = (part.note || personName(part) || '').replace(/\s+/g, ' ').slice(0, 80);
  confirm.require({
    header: t('Supprimer cette ligne ?'),
    message: t('« {name} » disparaît de l’avancement du ticket.', { name }),
    icon: 'pi pi-trash',
    acceptLabel: t('Supprimer'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: () => run(() => project.deletePart(part.id)),
  });
}

async function setManualProgress(progress: number): Promise<void> {
  try {
    await project.updateTicket(props.ticket.id, { progress }, { label: t('Avancement du ticket') });
  } catch (error) {
    notifyError(error);
  }
}

// --- Nouvelle ligne : le bouton + ouvre le formulaire, qui reste ouvert pour enchaîner ---
const adding = ref(false);
const saving = ref(false);
const newNote = ref('');
const newUserId = ref<number | null>(null);
const noteField = ref<{ $el: HTMLInputElement } | null>(null);
const canAdd = computed(() => newNote.value.trim() !== '' || newUserId.value !== null);

async function startAdding(): Promise<void> {
  adding.value = true;
  await nextTick();
  noteField.value?.$el.focus();
}

function stopAdding(): void {
  adding.value = false;
  newNote.value = '';
  newUserId.value = null;
}

async function add(): Promise<void> {
  if (!canAdd.value || saving.value) return;
  saving.value = true;
  await run(() => project.addPart(props.ticket.id, { note: newNote.value.trim(), userId: newUserId.value }), t('Ligne non ajoutée'));
  saving.value = false;
  newNote.value = '';
  newUserId.value = null;
  await nextTick();
  noteField.value?.$el.focus();
}

// --- Réordonner : glisser la poignée d'une ligne ---
const dragId = ref<number | null>(null);

function onDrop(target: PartDTO): void {
  const id = dragId.value;
  dragId.value = null;
  if (id === null || id === target.id) return;
  const position = props.ticket.parts.findIndex((part) => part.id === target.id);
  const moved = props.ticket.parts.find((part) => part.id === id);
  if (moved) void update(moved, { position });
}
</script>

<template>
  <section class="parts">
    <header class="head">
      <div class="title-row">
        <h3 class="title">{{ $t('Avancement') }}</h3>
        <label v-if="children.length" v-tooltip.top="fromChildrenHint" class="from-children muted">
          <ToggleSwitch class="mini-switch" :model-value="ticket.progressFromChildren" :disabled="!canEditTicket" :aria-label="$t('Avancement d’après les sous-tickets')" @update:model-value="setFromChildren" />
          <span>{{ $t('d’après les sous-tickets') }}</span>
        </label>
      </div>
      <div class="head-side">
        <span v-if="ticket.parts.length" class="muted small">{{ $t('{done} / {total} ligne terminée|{done} / {total} lignes terminées', { n: summary.total, done: summary.done, total: summary.total }) }}</span>
        <Button v-if="canEditTicket" v-tooltip.top="$t('Ajouter une ligne')" icon="pi pi-plus" text rounded size="small" :aria-label="$t('Ajouter une ligne')" @click="startAdding" />
      </div>
    </header>

    <div class="global">
      <ProgressMeter :value="global" :height="12" />
      <span class="muted small global-label">{{ fromChildren ? $t('Progression globale, moyenne des {n} sous-tickets', { n: children.length }) : $t('Progression globale') }}</span>
    </div>

    <ul v-if="ticket.parts.length" class="list">
      <li
        v-for="part in ticket.parts"
        :key="part.id"
        class="part"
        :class="{ done: part.done, dragging: dragId === part.id }"
        @dragover.prevent
        @drop.prevent="onDrop(part)"
      >
        <div class="lead">
          <i v-if="canEditTicket && ticket.parts.length > 1" class="pi pi-bars handle" draggable="true" :aria-label="$t('Glisser pour réordonner')" @dragstart="dragId = part.id" @dragend="dragId = null"></i>
          <Select
            v-if="showPeople && canEditTicket"
            :model-value="part.userId ?? 0"
            :options="personOptions"
            option-label="name"
            option-value="id"
            size="small"
            class="person"
            :placeholder="$t('Personne')"
            :aria-label="$t('Personne chargée de la ligne')"
            @update:model-value="(userId: number) => update(part, { userId: userId || null })"
          >
            <template #value="{ value }">
              <UserAvatar v-if="value" :user="project.usersById.get(value)" size="small" :ring="part.done ? 'done' : 'none'" />
              <i v-else class="pi pi-user-plus muted no-one"></i>
            </template>
            <template #option="{ option }">
              <span class="option"><UserAvatar v-if="option.id" :user="option" size="small" /><i v-else class="pi pi-user-minus muted"></i> {{ option.name }}</span>
            </template>
          </Select>
          <UserAvatar v-else-if="part.userId !== null" :user="project.usersById.get(part.userId)" size="small" :ring="part.done ? 'done' : 'none'" />
        </div>
        <div class="body">
          <strong v-if="part.userId !== null" class="who">{{ personName(part) }}<span v-if="part.userId === auth.user?.id" class="muted you">{{ $t('(vous)') }}</span></strong>
          <PartNote :note="part.note" :name="personName(part)" :is-me="part.userId === auth.user?.id" :editable="canEditPart(part)" @save="(note) => update(part, { note }, $t('Mission non enregistrée'))">
            <span v-if="part.done && part.doneAt" class="muted when">{{ $t('· terminé {value}', { value: formatRelative(part.doneAt) }) }}</span>
          </PartNote>
        </div>
        <ProgressSlider class="slider" :model-value="partProgress(part)" :disabled="!canEditPart(part)" @commit="(progress) => update(part, { progress })" />
        <button v-if="canEditTicket" v-tooltip.top="$t('Supprimer la ligne')" type="button" class="remove" :aria-label="$t('Supprimer la ligne')" @click="askDelete(part)"><i class="pi pi-times"></i></button>
      </li>
    </ul>

    <form v-if="adding" class="add-line" @submit.prevent="add">
      <Select v-if="showPeople" :model-value="newUserId ?? 0" :options="personOptions" option-label="name" option-value="id" size="small" class="person" :aria-label="$t('Personne chargée de la ligne')" @update:model-value="(userId: number) => (newUserId = userId || null)">
        <template #value="{ value }">
          <UserAvatar v-if="value" :user="project.usersById.get(value)" size="small" />
          <i v-else class="pi pi-user-plus muted no-one"></i>
        </template>
        <template #option="{ option }">
          <span class="option"><UserAvatar v-if="option.id" :user="option" size="small" /><i v-else class="pi pi-user-minus muted"></i> {{ option.name }}</span>
        </template>
      </Select>
      <InputText ref="noteField" v-model="newNote" size="small" :placeholder="$t('Ce qu’il y a à faire…')" :maxlength="LIMITS.partNoteMax" fluid :aria-label="$t('Texte de la ligne')" @keydown.esc.stop="stopAdding" />
      <Button type="submit" icon="pi pi-check" size="small" :disabled="!canAdd" :loading="saving" :aria-label="$t('Ajouter')" />
      <Button type="button" icon="pi pi-times" size="small" text severity="secondary" :aria-label="$t('Annuler')" @click="stopAdding" />
    </form>

    <div v-if="!ticket.parts.length && !fromChildren && !adding" class="manual">
      <p class="muted small">{{ $t('Aucune ligne : l’avancement se règle à la main.') }}</p>
      <ProgressSlider :model-value="ticket.status === 'done' ? 100 : ticket.progress" :disabled="!canEditTicket" @commit="setManualProgress" />
    </div>
  </section>
</template>

<style scoped>
.parts {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid var(--fb-border);
  border-radius: var(--fb-radius);
  background: var(--fb-panel);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.head-side {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem 0.75rem;
}
.title {
  font-size: 0.95rem;
  font-weight: 700;
}
.from-children {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  cursor: pointer;
}
.mini-switch {
  --p-toggleswitch-width: 1.75rem;
  --p-toggleswitch-height: 1rem;
  --p-toggleswitch-handle-size: 0.7rem;
}
.global {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.global-label {
  align-self: flex-start;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  margin: 0;
  padding: 0;
  list-style: none;
  container-type: inline-size;
}
.part {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) minmax(8rem, 11rem) 1.5rem;
  align-items: center;
  gap: 0.1rem 0.5rem;
  min-height: 2rem;
  padding: 0.1rem 0.25rem;
  border-radius: 6px;
}
.part:hover {
  background: var(--fb-panel-alt);
}
.part.done {
  background: color-mix(in srgb, #22c55e 9%, transparent);
}
.part.dragging {
  opacity: 0.4;
}
.lead {
  display: flex;
  align-items: center;
  gap: 0.15rem;
}
/* Ce qui agit sur la ligne n'apparaît qu'à son survol : au repos, on ne lit que le texte et la barre. */
.handle,
.remove {
  opacity: 0;
  transition: opacity 0.12s;
}
.part:hover .handle,
.part:hover .remove,
.part:hover :deep(.edit-btn),
.part:focus-within .handle,
.part:focus-within .remove,
.part:focus-within :deep(.edit-btn) {
  opacity: 1;
}
@media (hover: none) {
  .handle,
  .remove {
    opacity: 1;
  }
}
.handle {
  width: 0.75rem;
  color: var(--fb-muted);
  font-size: 0.7rem;
  cursor: grab;
}
.person {
  width: auto;
  min-width: 0;
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  cursor: pointer;
}
/* PrimeVue coupe ce qui dépasse du libellé : l'anneau d'une ligne terminée doit pouvoir déborder. */
.person :deep(.p-select-label) {
  display: flex;
  align-items: center;
  padding: 0.1rem;
  overflow: visible;
}
/* L'avatar suffit à ouvrir la liste. */
.person :deep(.p-select-dropdown) {
  display: none;
}
.no-one {
  display: inline-grid;
  place-items: center;
  width: 1.5rem;
  height: 1.5rem;
  font-size: 0.8rem;
}
.option {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.body {
  min-width: 0;
  font-size: 0.86rem;
  line-height: 1.4;
}
.who {
  margin-right: 0.35rem;
  font-weight: 600;
}
.you {
  margin-left: 0.25rem;
  font-weight: 400;
}
.when {
  margin-left: 0.25rem;
  font-size: 0.76rem;
  white-space: nowrap;
}
.part.done .body {
  color: var(--fb-muted);
}
.slider :deep(.percent) {
  font-size: 0.78rem;
}
.remove {
  display: grid;
  place-items: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--fb-muted);
  font-size: 0.7rem;
  cursor: pointer;
}
.remove:hover {
  background: color-mix(in srgb, var(--fb-danger) 14%, transparent);
  color: var(--fb-danger);
}
/* Le texte en cours d'édition prend toute la largeur, sous la ligne. */
.part:has(.edit) .body {
  grid-row: 2;
  grid-column: 1 / -1;
  padding: 0.2rem 0 0.4rem;
}
.add-line {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
/* Panneau étroit : la barre passe sous le texte. */
@container (max-width: 30rem) {
  .part {
    grid-template-columns: auto minmax(0, 1fr) 1.5rem;
    padding-block: 0.25rem;
  }
  .slider {
    grid-row: 2;
    grid-column: 1 / -1;
  }
  .part:has(.edit) .body {
    grid-row: 3;
  }
}
</style>
