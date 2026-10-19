<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import Button from 'primevue/button';
import Select from 'primevue/select';
import type { RoleDTO, UserSummaryDTO } from '@shared/types';
import { isSubsetOfPermissions } from '@shared/permissions';
import { api } from '@/api';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/project';
import { notify, notifyError } from '@/utils/notify';

import { t } from '@/i18n';
const project = useProjectStore();
const auth = useAuthStore();
const confirm = useConfirm();

const roles = ref<RoleDTO[]>([]);
const directory = ref<UserSummaryDTO[]>([]);
const newUserId = ref<number | null>(null);
const newRoleId = ref<number | null>(null);
const adding = ref(false);

const canManage = computed(() => project.can('project.members') && !project.archived);

/** On ne peut attribuer que des rôles dont les permissions sont incluses dans les siennes. */
const grantableRoles = computed(() => roles.value.filter((role) => isSubsetOfPermissions(role.permissions, project.permissions)));
const roleOptions = computed(() => grantableRoles.value.map((role) => ({ ...role, name: t(role.name) })));
const roleById = computed(() => new Map(roles.value.map((role) => [role.id, role])));

const rows = computed(() =>
  project.members.map((member) => ({ member, user: project.usersById.get(member.userId), role: roleById.value.get(member.roleId) })),
);
const candidates = computed(() => directory.value.filter((user) => !project.usersById.has(user.id)));

onMounted(async () => {
  try {
    const [roleResponse, userResponse] = await Promise.all([api.projectRoles(), canManage.value ? api.directory() : Promise.resolve({ users: [] })]);
    roles.value = roleResponse.roles;
    directory.value = userResponse.users;
    newRoleId.value = roles.value.find((role) => role.key === 'editor')?.id ?? grantableRoles.value[0]?.id ?? null;
  } catch (error) {
    notifyError(error, t('Chargement des membres impossible'));
  }
});

function canEditMember(roleId: number): boolean {
  const role = roleById.value.get(roleId);
  return canManage.value && !!role && isSubsetOfPermissions(role.permissions, project.permissions);
}

async function add(): Promise<void> {
  if (newUserId.value === null || newRoleId.value === null || project.projectId === null) {
    return;
  }
  adding.value = true;
  try {
    await api.addMember(project.projectId, newUserId.value, newRoleId.value);
    notify('success', t('Membre ajouté'), t('La personne voit désormais ce projet.'));
    newUserId.value = null;
    await project.reload();
  } catch (error) {
    notifyError(error, t('Ajout impossible'));
  } finally {
    adding.value = false;
  }
}

async function changeRole(userId: number, roleId: number): Promise<void> {
  if (project.projectId === null) return;
  try {
    await api.changeMemberRole(project.projectId, userId, roleId);
    await project.reload();
  } catch (error) {
    notifyError(error, t('Changement de rôle impossible'));
    await project.reload();
  }
}

function askRemove(userId: number, name: string): void {
  confirm.require({
    header: t('Retirer {name} du projet ?', { name }),
    message: t('Elle ou il perdra l’accès au projet et sera désassigné de ses tickets.'),
    icon: 'pi pi-user-minus',
    acceptLabel: t('Retirer'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      if (project.projectId === null) return;
      try {
        await api.removeMember(project.projectId, userId);
        await project.reload();
      } catch (error) {
        notifyError(error, t('Retrait impossible'));
      }
    },
  });
}
</script>

<template>
  <div class="members">
    <form v-if="canManage" class="add card" @submit.prevent="add">
      <h4>{{ $t('Inviter une personne') }}</h4>
      <div class="add-row">
        <Select v-model="newUserId" :options="candidates" option-label="name" option-value="id" :placeholder="$t('Choisir un utilisateur')" filter :empty-message="$t('Tous les utilisateurs sont déjà membres')" class="grow" :aria-label="$t('Utilisateur')">
          <template #option="{ option }">
            <span class="row"><UserAvatar :user="option" size="small" /><span>{{ option.name }} <small class="muted">{{ option.email }}</small></span></span>
          </template>
        </Select>
        <Select v-model="newRoleId" :options="roleOptions" option-label="name" option-value="id" :placeholder="$t('Rôle')" class="role" :aria-label="$t('Rôle')" />
        <Button type="submit" :label="$t('Ajouter')" icon="pi pi-user-plus" :disabled="newUserId === null || newRoleId === null" :loading="adding" />
      </div>
    </form>

    <ul class="list">
      <li v-for="row in rows" :key="row.member.userId" class="item card">
        <UserAvatar :user="row.user" size="large" />
        <div class="info">
          <strong class="truncate">{{ row.user?.name ?? $t('Utilisateur supprimé') }} <span v-if="row.member.userId === auth.user?.id" class="muted small">{{ $t('(vous)') }}</span></strong>
          <span class="muted small truncate">{{ row.user?.email }}</span>
        </div>
        <Select
          v-if="canEditMember(row.member.roleId)"
          :model-value="row.member.roleId"
          :options="roleOptions"
          option-label="name"
          option-value="id"
          class="role"
          :aria-label="$t('Rôle de {name}', { name: row.user?.name })"
          @update:model-value="(roleId: number) => changeRole(row.member.userId, roleId)"
        />
        <span v-else class="role-label">{{ row.role ? $t(row.role.name) : "" }}</span>
        <Button v-if="canEditMember(row.member.roleId) && row.member.userId !== auth.user?.id" icon="pi pi-user-minus" text rounded severity="danger" size="small" :aria-label="$t('Retirer {name}', { name: row.user?.name })" @click="askRemove(row.member.userId, row.user?.name ?? '')" />
      </li>
    </ul>
  </div>
</template>

<style scoped>
.members {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  max-width: 48rem;
}
.add {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 1.1rem;
}
.add-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}
.role {
  width: 12rem;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.item {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  padding: 0.65rem 0.9rem;
}
.info {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.role-label {
  min-width: 8rem;
  padding: 0.15rem 0.7rem;
  border-radius: 999px;
  background: var(--fb-panel-alt);
  font-size: 0.8rem;
  font-weight: 600;
  text-align: center;
}
@media (max-width: 600px) {
  .role {
    width: 100%;
  }
}
</style>
