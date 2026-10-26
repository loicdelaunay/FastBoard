<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import Tag from 'primevue/tag';
import { RouterLink } from 'vue-router';
import type { AdminUserDTO, RoleDTO } from '@shared/types';
import { api } from '@/api';
import UserFormDialog from '@/components/admin/UserFormDialog.vue';
import ColumnValueFilter from '@/components/common/ColumnValueFilter.vue';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { useColumnFilters } from '@/composables/useColumnFilters';
import { useAuthStore } from '@/stores/auth';
import { formatDateTime, formatRelative } from '@/utils/format';
import { notify, notifyError } from '@/utils/notify';
import { matchesQuery } from '@/utils/search';

import { t } from '@/i18n';
const auth = useAuthStore();
const confirm = useConfirm();

const users = ref<AdminUserDTO[]>([]);
const online = ref<Set<number>>(new Set());
const roles = ref<RoleDTO[]>([]);
const loading = ref(true);
const search = ref('');
const dialogOpen = ref(false);
const editing = ref<AdminUserDTO | null>(null);
let timer: number | null = null;

const filtered = computed(() =>
  users.value
    .filter((user) => matchesQuery(search.value, [user.name, user.email, user.roleName, t(user.roleName)]))
    .map((user) => ({
      ...user,
      roleLabel: t(user.roleName),
      statusLabel: !user.isActive ? t('Désactivé') : online.value.has(user.id) ? t('En ligne') : t('Hors ligne'),
      lastLogin: online.value.has(user.id) ? '9999' : (user.lastSeenAt ?? user.lastLoginAt ?? ''),
    })),
);
const columnFilters = useColumnFilters(filtered, ['roleLabel', 'statusLabel']);
const filterProps = { showFilterMatchModes: false, showFilterOperator: false, showAddButton: false, showApplyButton: false } as const;

async function load(): Promise<void> {
  try {
    const response = await api.adminUsers();
    users.value = response.users;
    online.value = new Set(response.online);
  } catch (error) {
    notifyError(error, t('Chargement des utilisateurs impossible'));
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  roles.value = (await api.globalRoles().catch(() => ({ roles: [] }))).roles;
  await load();
  timer = window.setInterval(load, 15_000);
});
onBeforeUnmount(() => timer !== null && window.clearInterval(timer));

function openCreate(): void {
  editing.value = null;
  dialogOpen.value = true;
}

function openEdit(user: AdminUserDTO): void {
  editing.value = user;
  dialogOpen.value = true;
}

function askDelete(user: AdminUserDTO): void {
  confirm.require({
    header: t('Supprimer le compte de {name} ?', { name: user.name }),
    message: t('Le compte, ses appartenances aux projets et ses assignations seront supprimés. Ses commentaires restent, signés « Utilisateur supprimé ». Pour conserver l\'historique, préférez désactiver le compte.'),
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: t('Supprimer'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      try {
        await api.adminDeleteUser(user.id);
        notify('success', t('Compte supprimé'));
        await load();
      } catch (error) {
        notifyError(error);
      }
    },
  });
}

async function toggleActive(user: AdminUserDTO): Promise<void> {
  try {
    await api.adminUpdateUser(user.id, { isActive: !user.isActive });
    notify('success', user.isActive ? t('Compte désactivé') : t('Compte réactivé'));
    await load();
  } catch (error) {
    notifyError(error);
  }
}
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <h1 class="page-title">{{ $t('Utilisateurs') }}</h1>
        <p class="muted">{{ $t('{n} compte|{n} comptes', { n: users.length }) }} · {{ $t('{n} connecté en ce moment|{n} connectés en ce moment', { n: online.size }) }}</p>
      </div>
      <Button v-if="auth.can('users.create')" :label="$t('Nouvel utilisateur')" icon="pi pi-user-plus" @click="openCreate" />
    </header>

    <IconField class="search">
      <InputIcon class="pi pi-search" />
      <InputText v-model="search" :placeholder="$t('Rechercher un nom, un e-mail, un rôle…')" fluid />
    </IconField>

    <DataTable v-model:filters="columnFilters.filters.value" filter-display="menu" :value="filtered" :loading="loading" data-key="id" size="small" row-hover paginator :rows="20" removable-sort class="table">
      <template #empty><p class="muted">{{ $t('Aucun utilisateur.') }}</p></template>
      <Column :header="$t('Utilisateur')" sort-field="name" sortable style="min-width: 15rem">
        <template #body="{ data }">
          <div class="row">
            <UserAvatar :user="data" :ring="online.has(data.id) ? 'online' : 'none'" />
            <div class="who">
              <RouterLink :to="{ name: 'user', params: { id: data.id } }" class="name-link"><strong>{{ data.name }}</strong></RouterLink>
              <span class="muted small">{{ data.email }}</span>
            </div>
          </div>
        </template>
      </Column>
      <Column field="roleLabel" :header="$t('Rôle')" sortable v-bind="filterProps" style="min-width: 10rem">
        <template #body="{ data }"><Tag :value="data.roleLabel" :severity="data.roleKey === 'super_admin' ? 'danger' : data.roleKey === 'admin' ? 'warn' : 'secondary'" /></template>
        <template #filter="{ filterModel, filterCallback }"><ColumnValueFilter :filter-model="filterModel" :options="columnFilters.optionsFor('roleLabel')" @apply="filterCallback()" /></template>
      </Column>
      <Column field="statusLabel" :header="$t('Statut')" sortable v-bind="filterProps" style="width: 9rem">
        <template #filter="{ filterModel, filterCallback }"><ColumnValueFilter :filter-model="filterModel" :options="columnFilters.optionsFor('statusLabel')" @apply="filterCallback()" /></template>
        <template #body="{ data }">
          <Tag v-if="!data.isActive" :value="$t('Désactivé')" severity="contrast" />
          <span v-else-if="online.has(data.id)" class="online"><i class="dot"></i> {{ $t('En ligne') }}</span>
          <span v-else class="muted small">{{ $t('Hors ligne') }}</span>
        </template>
      </Column>
      <Column field="lastLogin" :header="$t('Dernière activité')" sortable style="min-width: 10rem">
        <template #body="{ data }">
          <span v-if="online.has(data.id)" class="small online-now">{{ $t('En ce moment') }}</span>
          <span v-else class="muted small" :title="data.lastLoginAt ? $t('Dernière connexion : {date}', { date: formatDateTime(data.lastLoginAt) }) : undefined">{{ data.lastSeenAt || data.lastLoginAt ? formatRelative(data.lastSeenAt ?? data.lastLoginAt) : $t('Jamais') }}</span>
        </template>
      </Column>
      <Column header="" style="width: 9rem">
        <template #body="{ data }">
          <div class="actions">
            <Button v-if="auth.can('users.edit')" icon="pi pi-pencil" text rounded size="small" severity="secondary" :aria-label="$t('Modifier {name}', { name: data.name })" @click="openEdit(data)" />
            <Button v-if="auth.can('users.edit') && data.id !== auth.user?.id" :icon="data.isActive ? 'pi pi-ban' : 'pi pi-check-circle'" text rounded size="small" severity="secondary" :aria-label="data.isActive ? $t('Désactiver {name}', { name: data.name }) : $t('Réactiver {name}', { name: data.name })" @click="toggleActive(data)" />
            <Button v-if="auth.can('users.delete') && data.id !== auth.user?.id" icon="pi pi-trash" text rounded size="small" severity="danger" :aria-label="$t('Supprimer {name}', { name: data.name })" @click="askDelete(data)" />
          </div>
        </template>
      </Column>
    </DataTable>

    <UserFormDialog v-model:visible="dialogOpen" :user="editing" :roles="roles" @saved="load" />
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}
.search {
  max-width: 26rem;
  margin-bottom: 1rem;
}
.table {
  border: 1px solid var(--fb-border);
  border-radius: var(--fb-radius);
  overflow: hidden;
}
.who {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.actions {
  display: flex;
  justify-content: flex-end;
}
.online-now {
  color: #16a34a;
  font-weight: 600;
}
.online {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: #16a34a;
  font-size: 0.82rem;
  font-weight: 600;
}
.dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: #22c55e;
}
.name-link {
  color: inherit;
  text-decoration: none;
}
.name-link:hover {
  color: var(--fb-accent);
  text-decoration: underline;
}
</style>
