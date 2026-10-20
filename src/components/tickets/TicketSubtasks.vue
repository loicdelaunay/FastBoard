<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import { LIMITS } from '@shared/constants';
import type { SubtaskDTO, TicketDTO } from '@shared/types';
import ProgressMeter from '@/components/common/ProgressMeter.vue';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/project';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
const props = defineProps<{ ticket: TicketDTO }>();

const auth = useAuthStore();
const project = useProjectStore();

const editable = computed(() => project.can('ticket.edit') && !project.archived);
const doneCount = computed(() => props.ticket.subtasks.filter((subtask) => subtask.done).length);
const percent = computed(() => (props.ticket.subtasks.length ? Math.round((doneCount.value / props.ticket.subtasks.length) * 100) : 0));

const newTitle = ref('');
const adding = ref(false);
const editingId = ref<number | null>(null);
const editTitle = ref('');
const dragId = ref<number | null>(null);
const input = ref<{ $el: HTMLInputElement } | null>(null);

const assigneeOptions = computed(() => project.users.filter((user) => user.isActive));

function canToggle(subtask: SubtaskDTO): boolean {
  return !project.archived && (project.can('ticket.edit') || (subtask.assigneeId === auth.user?.id && project.can('ticket.update_own_part')));
}

async function run(action: () => Promise<void>, summary?: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    notifyError(error, summary);
  }
}

async function add(): Promise<void> {
  const title = newTitle.value.trim();
  if (!title || adding.value) return;
  adding.value = true;
  await run(() => project.addSubtask(props.ticket.id, title), t('Sous-tâche non ajoutée'));
  newTitle.value = '';
  adding.value = false;
  void nextTick(() => input.value?.$el.focus());
}

function startEdit(subtask: SubtaskDTO): void {
  if (!editable.value) return;
  editingId.value = subtask.id;
  editTitle.value = subtask.title;
}

async function commitEdit(subtask: SubtaskDTO): Promise<void> {
  const title = editTitle.value.trim();
  editingId.value = null;
  if (title && title !== subtask.title) {
    await run(() => project.updateSubtask(props.ticket.id, subtask.id, { title }));
  }
}

function onDrop(target: SubtaskDTO): void {
  const id = dragId.value;
  dragId.value = null;
  if (id === null || id === target.id) return;
  const position = props.ticket.subtasks.findIndex((subtask) => subtask.id === target.id);
  void run(() => project.updateSubtask(props.ticket.id, id, { position }));
}
</script>

<template>
  <section class="subtasks">
    <header class="head">
      <h3 class="section-title"><i class="pi pi-list-check"></i> {{ $t('Sous-tâches') }}</h3>
      <template v-if="ticket.subtasks.length">
        <span class="muted small">{{ $t('{done} / {total} terminées', { done: doneCount, total: ticket.subtasks.length }) }}</span>
        <ProgressMeter :value="percent" class="meter" />
      </template>
    </header>

    <ul v-if="ticket.subtasks.length" class="list">
      <li
        v-for="subtask in ticket.subtasks"
        :key="subtask.id"
        class="item"
        :class="{ done: subtask.done, dragging: dragId === subtask.id }"
        :draggable="editable && editingId !== subtask.id"
        @dragstart="dragId = subtask.id"
        @dragend="dragId = null"
        @dragover.prevent
        @drop.prevent="onDrop(subtask)"
      >
        <i v-if="editable" class="pi pi-bars handle" :aria-label="$t('Glisser pour réordonner')"></i>
        <Checkbox
          :model-value="subtask.done"
          binary
          :disabled="!canToggle(subtask)"
          :aria-label="subtask.title"
          @update:model-value="(done: boolean) => run(() => project.updateSubtask(ticket.id, subtask.id, { done }))"
        />
        <InputText
          v-if="editingId === subtask.id"
          v-model="editTitle"
          class="edit"
          size="small"
          autofocus
          :maxlength="LIMITS.subtaskTitleMax"
          @blur="commitEdit(subtask)"
          @keydown.enter.prevent="commitEdit(subtask)"
          @keydown.esc="editingId = null"
        />
        <span v-else class="title" :class="{ clickable: editable }" @dblclick="startEdit(subtask)">{{ subtask.title }}</span>
        <Select
          :model-value="subtask.assigneeId"
          :options="assigneeOptions"
          option-label="name"
          option-value="id"
          show-clear
          :disabled="!editable"
          size="small"
          class="assignee"
          :placeholder="$t('Personne')"
          :aria-label="$t('Responsable de la sous-tâche')"
          @update:model-value="(assigneeId: number | null) => run(() => project.updateSubtask(ticket.id, subtask.id, { assigneeId: assigneeId ?? null }))"
        >
          <template #value="{ value }">
            <span v-if="value" class="row"><UserAvatar :user="project.usersById.get(value)" size="small" /></span>
            <i v-else class="pi pi-user-plus muted"></i>
          </template>
          <template #option="{ option }"><span class="row"><UserAvatar :user="option" size="small" /> {{ option.name }}</span></template>
        </Select>
        <Button v-if="editable" v-tooltip.top="$t('Renommer')" icon="pi pi-pencil" text rounded size="small" severity="secondary" :aria-label="$t('Renommer')" @click="startEdit(subtask)" />
        <Button v-if="editable" v-tooltip.top="$t('Supprimer')" icon="pi pi-times" text rounded size="small" severity="secondary" :aria-label="$t('Supprimer')" @click="run(() => project.deleteSubtask(subtask.id))" />
      </li>
    </ul>

    <form v-if="editable" class="add" @submit.prevent="add">
      <InputText ref="input" v-model="newTitle" size="small" :placeholder="$t('Ajouter une sous-tâche…')" :maxlength="LIMITS.subtaskTitleMax" fluid :aria-label="$t('Nouvelle sous-tâche')" />
      <Button type="submit" icon="pi pi-plus" size="small" :disabled="!newTitle.trim()" :loading="adding" :aria-label="$t('Ajouter')" />
    </form>
    <p v-else-if="!ticket.subtasks.length" class="muted small">{{ $t('Aucune sous-tâche.') }}</p>
  </section>
</template>

<style scoped>
.subtasks {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.section-title {
  margin: 0;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.meter {
  flex: 1;
  max-width: 10rem;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.2rem 0.35rem;
  border-radius: 8px;
}
.item:hover {
  background: var(--fb-hover, color-mix(in srgb, var(--fb-text) 5%, transparent));
}
.item.dragging {
  opacity: 0.4;
}
.handle {
  color: var(--fb-muted);
  font-size: 0.75rem;
  cursor: grab;
}
.title {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.title.clickable {
  cursor: text;
}
.item.done .title {
  color: var(--fb-muted);
  text-decoration: line-through;
}
.edit {
  flex: 1;
}
.assignee {
  width: auto;
  min-width: 3.2rem;
  border-color: transparent;
  background: transparent;
}
.add {
  display: flex;
  gap: 0.4rem;
}
</style>
