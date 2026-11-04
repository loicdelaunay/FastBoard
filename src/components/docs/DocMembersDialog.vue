<script setup lang="ts">
import { computed, ref } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import { DOC_ROLE_LABELS, DOC_ROLES, type DocRole } from '@shared/docs';
import type { UserSummaryDTO } from '@shared/types';
import { api } from '@/api';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { useDocsStore } from '@/stores/docs';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Membres d'un espace : tout le monde les voit, seul un propriétaire les change. */
const props = defineProps<{ users: UserSummaryDTO[] }>();
const visible = defineModel<boolean>('visible', { required: true });

const store = useDocsStore();
const newUser = ref<number | null>(null);
const newRole = ref<DocRole>('editor');

const roleOptions = computed(() => DOC_ROLES.map((role) => ({ value: role, label: t(DOC_ROLE_LABELS[role]) })));
const candidates = computed(() => props.users.filter((user) => user.isActive && !store.members.some((member) => member.userId === user.id)));
const userOf = (id: number) => props.users.find((user) => user.id === id);

async function run(action: () => Promise<{ members: typeof store.members }>): Promise<void> {
  try {
    store.members = (await action()).members;
  } catch (error) {
    notifyError(error);
  }
}

const setRole = (userId: number, role: DocRole) => run(() => api.docSetMember(store.space!.id, userId, role));
const remove = (userId: number) => run(() => api.docRemoveMember(store.space!.id, userId));

async function add(): Promise<void> {
  if (newUser.value === null || !store.space) return;
  const { id } = store.space;
  const userId = newUser.value;
  await run(() => api.docAddMember(id, userId, newRole.value));
  newUser.value = null;
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="$t('Membres de l’espace')" :style="{ width: 'min(32rem, calc(100vw - 2rem))' }">
    <ul class="members">
      <li v-for="member in store.members" :key="member.userId" class="member">
        <UserAvatar :user="userOf(member.userId)" />
        <strong class="truncate grow">{{ userOf(member.userId)?.name ?? $t('Utilisateur supprimé') }}</strong>
        <template v-if="store.isOwner">
          <Select :model-value="member.role" :options="roleOptions" option-label="label" option-value="value" size="small" :aria-label="$t('Rôle')" @update:model-value="(role: DocRole) => setRole(member.userId, role)" />
          <Button icon="pi pi-times" text rounded size="small" severity="secondary" :aria-label="$t('Retirer')" @click="remove(member.userId)" />
        </template>
        <Tag v-else :value="$t(DOC_ROLE_LABELS[member.role])" severity="secondary" />
      </li>
    </ul>

    <form v-if="store.isOwner" class="add" @submit.prevent="add">
      <Select v-model="newUser" :options="candidates" option-label="name" option-value="id" filter size="small" class="grow" :placeholder="$t('Ajouter une personne…')" :aria-label="$t('Ajouter une personne')" :empty-message="$t('Tout le monde est déjà membre.')" />
      <Select v-model="newRole" :options="roleOptions" option-label="label" option-value="value" size="small" :aria-label="$t('Rôle')" />
      <Button type="submit" icon="pi pi-plus" size="small" :disabled="newUser === null" :aria-label="$t('Ajouter')" />
    </form>
    <p class="muted small hint">{{ $t('Lecteur : consulte et suit en direct. Éditeur : écrit, importe, restaure. Propriétaire : gère aussi les membres et l’espace.') }}</p>
  </Dialog>
</template>

<style scoped>
.members {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0 0 0.75rem;
  padding: 0;
  list-style: none;
}
.member,
.add {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.grow {
  flex: 1;
  min-width: 0;
}
.hint {
  margin: 0.75rem 0 0;
}
</style>
