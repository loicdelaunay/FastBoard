<script setup lang="ts">
import { computed, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import { LIMITS, PICKABLE_ICONS } from '@shared/constants';
import type { ProjectListItemDTO } from '@shared/types';
import ColorChip from '@/components/common/ColorChip.vue';
import ColorInput from '@/components/common/ColorInput.vue';
import { useProjectStore, type ListKind } from '@/stores/project';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Liste réglable du projet (priorités ou composants) : nom, icône, couleur et ordre. */
const props = defineProps<{ kind: ListKind }>();

const project = useProjectStore();
const confirm = useConfirm();

const items = computed<ProjectListItemDTO[]>(() => (props.kind === 'priority' ? project.priorities : project.components));
const canEdit = computed(() => project.can('project.edit') && !project.archived);
const texts = computed(() =>
  props.kind === 'priority'
    ? {
        intro: t("Les priorités vont de la plus haute (en haut) à la plus basse. L'ordre sert aussi au tri des tickets."),
        add: t('Ajouter une priorité'),
        name: t('Nom de la priorité'),
        empty: t('Aucune priorité : les tickets ne seront pas priorisés.'),
      }
    : {
        intro: t("Les composants désignent les parties du produit concernées par un ticket (application, API, base de données…). Un ticket peut en avoir plusieurs."),
        add: t('Ajouter un composant'),
        name: t('Nom du composant'),
        empty: t('Aucun composant pour l’instant.'),
      },
);

const editingId = ref<number | null>(null);
const adding = ref(false);
const saving = ref(false);
const draft = ref({ name: '', color: '#6366f1', icon: 'pi pi-tag' });

const iconOptions = PICKABLE_ICONS.map((icon) => ({ value: icon }));

function usage(item: ProjectListItemDTO): number {
  return project.tickets.filter((ticket) => (props.kind === 'priority' ? ticket.priorityId === item.id : ticket.componentIds.includes(item.id))).length;
}

function startEdit(item: ProjectListItemDTO): void {
  adding.value = false;
  editingId.value = item.id;
  // Le nom affiché peut être traduit : on édite le nom enregistré.
  const raw = (props.kind === 'priority' ? project.rawPriorities.find((entry) => entry.id === item.id)?.name : undefined) ?? item.name;
  draft.value = { name: raw, color: item.color, icon: item.icon };
}

function startAdd(): void {
  editingId.value = null;
  adding.value = true;
  draft.value = { name: '', color: '#6366f1', icon: props.kind === 'priority' ? 'pi pi-flag' : 'pi pi-box' };
}

function cancel(): void {
  editingId.value = null;
  adding.value = false;
}

async function save(): Promise<void> {
  const name = draft.value.name.trim();
  if (!name) return;
  saving.value = true;
  try {
    await project.saveListItem(props.kind, { ...draft.value, name }, editingId.value ?? undefined);
    cancel();
  } catch (error) {
    notifyError(error, t('Enregistrement impossible'));
  } finally {
    saving.value = false;
  }
}

async function move(item: ProjectListItemDTO, offset: number): Promise<void> {
  const index = items.value.findIndex((entry) => entry.id === item.id);
  const position = index + offset;
  if (position < 0 || position >= items.value.length) return;
  try {
    await project.saveListItem(props.kind, { position }, item.id);
  } catch (error) {
    notifyError(error);
  }
}

function askDelete(item: ProjectListItemDTO): void {
  const count = usage(item);
  confirm.require({
    header: t('Supprimer « {name} » ?', { name: item.name }),
    message: count ? t('{n} ticket est concerné.|{n} tickets sont concernés.', { n: count }) : t('Aucun ticket n’est concerné.'),
    icon: 'pi pi-trash',
    acceptLabel: t('Supprimer'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      try {
        await project.deleteListItem(props.kind, item.id);
      } catch (error) {
        notifyError(error);
      }
    },
  });
}
</script>

<template>
  <div class="list-settings">
    <p class="muted intro">{{ texts.intro }}</p>

    <ul class="list">
      <li v-for="(item, index) in items" :key="item.id" class="item card">
        <form v-if="editingId === item.id" class="edit" @submit.prevent="save">
          <Select v-model="draft.icon" :options="iconOptions" option-value="value" class="icon-select" :aria-label="$t('Icône')" filter :filter-fields="['value']">
            <template #value="{ value }"><i :class="value" :style="{ color: draft.color }"></i></template>
            <template #option="{ option }"><span class="row"><i :class="option.value"></i> <span class="muted small">{{ option.value.replace('pi pi-', '') }}</span></span></template>
          </Select>
          <InputText v-model="draft.name" :maxlength="LIMITS.listItemNameMax" size="small" :aria-label="texts.name" autofocus />
          <ColorInput v-model="draft.color" :label="$t('Couleur')" />
          <Button type="submit" icon="pi pi-check" size="small" rounded :loading="saving" :disabled="!draft.name.trim()" :aria-label="$t('Enregistrer')" />
          <Button type="button" icon="pi pi-times" size="small" rounded text severity="secondary" :aria-label="$t('Annuler')" @click="cancel" />
        </form>
        <template v-else>
          <span v-if="kind === 'priority'" class="rank muted small">{{ index + 1 }}</span>
          <ColorChip :label="item.name" :color="item.color" :icon="item.icon" />
          <span class="muted small usage">{{ $t('{n} ticket|{n} tickets', { n: usage(item) }) }}</span>
          <div v-if="canEdit" class="actions">
            <Button icon="pi pi-arrow-up" text rounded size="small" severity="secondary" :disabled="index === 0" :aria-label="$t('Monter')" @click="move(item, -1)" />
            <Button icon="pi pi-arrow-down" text rounded size="small" severity="secondary" :disabled="index === items.length - 1" :aria-label="$t('Descendre')" @click="move(item, 1)" />
            <Button icon="pi pi-pencil" text rounded size="small" severity="secondary" :aria-label="$t('Modifier {name}', { name: item.name })" @click="startEdit(item)" />
            <Button icon="pi pi-trash" text rounded size="small" severity="danger" :aria-label="$t('Supprimer {name}', { name: item.name })" @click="askDelete(item)" />
          </div>
        </template>
      </li>

      <li v-if="adding" class="item card">
        <form class="edit" @submit.prevent="save">
          <Select v-model="draft.icon" :options="iconOptions" option-value="value" class="icon-select" :aria-label="$t('Icône')" filter :filter-fields="['value']">
            <template #value="{ value }"><i :class="value" :style="{ color: draft.color }"></i></template>
            <template #option="{ option }"><span class="row"><i :class="option.value"></i> <span class="muted small">{{ option.value.replace('pi pi-', '') }}</span></span></template>
          </Select>
          <InputText v-model="draft.name" :maxlength="LIMITS.listItemNameMax" size="small" :placeholder="texts.name" :aria-label="texts.name" autofocus />
          <ColorInput v-model="draft.color" :label="$t('Couleur')" />
          <Button type="submit" icon="pi pi-check" size="small" rounded :loading="saving" :disabled="!draft.name.trim()" :aria-label="$t('Ajouter')" />
          <Button type="button" icon="pi pi-times" size="small" rounded text severity="secondary" :aria-label="$t('Annuler')" @click="cancel" />
        </form>
      </li>
    </ul>

    <p v-if="!items.length && !adding" class="muted">{{ texts.empty }}</p>
    <Button v-if="canEdit && !adding" :label="texts.add" icon="pi pi-plus" severity="secondary" outlined @click="startAdd" />
  </div>
</template>

<style scoped>
.list-settings {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1rem;
  max-width: 44rem;
}
.intro {
  margin: 0;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
}
.item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-height: 3.2rem;
  padding: 0.5rem 0.9rem;
}
.rank {
  width: 1.2rem;
  text-align: right;
  font-weight: 700;
}
.usage {
  margin-left: auto;
}
.actions {
  display: flex;
}
.edit {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.6rem;
  width: 100%;
}
.edit :deep(.p-inputtext) {
  flex: 1;
  min-width: 10rem;
}
.icon-select {
  flex: none;
  width: auto;
  min-width: 5.5rem;
}
.icon-select :deep(.p-select-label) {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: visible;
  padding-inline: 0.75rem;
  font-size: 1rem;
}
</style>
