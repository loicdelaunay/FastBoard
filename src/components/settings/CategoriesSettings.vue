<script setup lang="ts">
import { computed, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import type { CategoryDTO } from '@shared/types';
import ColorChip from '@/components/common/ColorChip.vue';
import ColorInput from '@/components/common/ColorInput.vue';
import { useProjectStore } from '@/stores/project';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
const project = useProjectStore();
const confirm = useConfirm();

const canEdit = computed(() => project.can('project.edit') && !project.archived);
const editingId = ref<number | null>(null);
const draftName = ref('');
const draftColor = ref('#6366f1');
const adding = ref(false);
const saving = ref(false);

function usage(category: CategoryDTO): number {
  return project.tickets.filter((ticket) => ticket.categoryId === category.id).length;
}

function startEdit(category: CategoryDTO): void {
  adding.value = false;
  editingId.value = category.id;
  draftName.value = category.name;
  draftColor.value = category.color;
}

function startAdd(): void {
  editingId.value = null;
  adding.value = true;
  draftName.value = '';
  draftColor.value = '#6366f1';
}

function cancel(): void {
  editingId.value = null;
  adding.value = false;
}

async function save(): Promise<void> {
  const name = draftName.value.trim();
  if (!name) {
    return;
  }
  saving.value = true;
  try {
    await project.saveCategory({ name, color: draftColor.value }, editingId.value ?? undefined);
    cancel();
  } catch (error) {
    notifyError(error, t('Enregistrement impossible'));
  } finally {
    saving.value = false;
  }
}

function askDelete(category: CategoryDTO): void {
  const count = usage(category);
  confirm.require({
    header: t('Supprimer « {name} » ?', { name: category.name }),
    message: count ? t('{n} ticket perdra cette catégorie.|{n} tickets perdront cette catégorie.', { n: count }) : t('Cette catégorie n’est utilisée par aucun ticket.'),
    icon: 'pi pi-trash',
    acceptLabel: t('Supprimer'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      try {
        await project.deleteCategory(category.id);
      } catch (error) {
        notifyError(error);
      }
    },
  });
}
</script>

<template>
  <div class="categories">
    <p class="muted intro">{{ $t('Les catégories sont propres à ce projet et servent à classer les tickets (fonctionnalité, bug, tâche…).') }}</p>

    <ul class="list">
      <li v-for="category in project.categories" :key="category.id" class="item card">
        <template v-if="editingId === category.id">
          <form class="edit" @submit.prevent="save">
            <InputText v-model="draftName" maxlength="60" size="small" :aria-label="$t('Nom de la catégorie')" autofocus />
            <ColorInput v-model="draftColor" :label="$t('Couleur de la catégorie')" />
            <Button type="submit" icon="pi pi-check" size="small" rounded :loading="saving" :disabled="!draftName.trim()" :aria-label="$t('Enregistrer')" />
            <Button type="button" icon="pi pi-times" size="small" rounded text severity="secondary" :aria-label="$t('Annuler')" @click="cancel" />
          </form>
        </template>
        <template v-else>
          <ColorChip :label="category.name" :color="category.color" />
          <span class="muted small usage">{{ $t('{n} ticket|{n} tickets', { n: usage(category) }) }}</span>
          <div v-if="canEdit" class="actions">
            <Button icon="pi pi-pencil" text rounded size="small" severity="secondary" :aria-label="$t('Modifier {name}', { name: category.name })" @click="startEdit(category)" />
            <Button icon="pi pi-trash" text rounded size="small" severity="danger" :aria-label="$t('Supprimer {name}', { name: category.name })" @click="askDelete(category)" />
          </div>
        </template>
      </li>

      <li v-if="adding" class="item card">
        <form class="edit" @submit.prevent="save">
          <InputText v-model="draftName" maxlength="60" size="small" :placeholder="$t('Nom de la catégorie')" :aria-label="$t('Nom de la catégorie')" autofocus />
          <ColorInput v-model="draftColor" :label="$t('Couleur de la catégorie')" />
          <Button type="submit" icon="pi pi-check" size="small" rounded :loading="saving" :disabled="!draftName.trim()" :aria-label="$t('Ajouter')" />
          <Button type="button" icon="pi pi-times" size="small" rounded text severity="secondary" :aria-label="$t('Annuler')" @click="cancel" />
        </form>
      </li>
    </ul>

    <p v-if="!project.categories.length && !adding" class="muted">{{ $t('Aucune catégorie : les tickets ne seront pas classés.') }}</p>
    <Button v-if="canEdit && !adding" :label="$t('Ajouter une catégorie')" icon="pi pi-plus" severity="secondary" outlined @click="startAdd" />
  </div>
</template>

<style scoped>
.categories {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1rem;
  max-width: 40rem;
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
</style>
