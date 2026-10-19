<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import InputText from 'primevue/inputtext';
import SelectButton from 'primevue/selectbutton';
import Tag from 'primevue/tag';
import Textarea from 'primevue/textarea';
import type { PermissionDef, RoleScope } from '@shared/permissions';
import type { RoleDTO } from '@shared/types';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { notify, notifyError } from '@/utils/notify';

import { t } from '@/i18n';
const auth = useAuthStore();
const confirm = useConfirm();

const roles = ref<RoleDTO[]>([]);
const catalog = ref<{ global: PermissionDef[]; project: PermissionDef[] }>({ global: [], project: [] });
const scope = ref<RoleScope>('global');
const selectedId = ref<number | 'new' | null>(null);
const saving = ref(false);
const draft = reactive({ name: '', description: '', permissions: [] as string[] });

const scopeOptions = [
  { label: t('Rôles globaux'), value: 'global' },
  { label: t('Rôles de projet'), value: 'project' },
];

const scopedRoles = computed(() => roles.value.filter((role) => role.scope === scope.value));
const selected = computed(() => (typeof selectedId.value === 'number' ? roles.value.find((role) => role.id === selectedId.value) ?? null : null));
const isNew = computed(() => selectedId.value === 'new');
const locked = computed(() => selected.value?.locked === true);
const nameLocked = computed(() => selected.value?.isSystem === true);

const groups = computed(() => {
  const map = new Map<string, PermissionDef[]>();
  for (const permission of catalog.value[scope.value]) {
    const list = map.get(permission.group) ?? [];
    list.push(permission);
    map.set(permission.group, list);
  }
  return [...map.entries()].map(([name, items]) => ({ name, items }));
});

const fullAccess = computed(() => draft.permissions.includes('*'));

/** On ne peut cocher que les permissions que l'on possède soi-même. */
function canGrant(key: string): boolean {
  return scope.value === 'global' ? auth.can(key) : auth.can('projects.manage_all');
}

async function load(): Promise<void> {
  try {
    const response = await api.adminRoles();
    roles.value = response.roles;
    catalog.value = response.catalog;
    if (selectedId.value === null) {
      selectedId.value = scopedRoles.value[0]?.id ?? null;
    }
  } catch (error) {
    notifyError(error, t('Chargement des rôles impossible'));
  }
}
onMounted(load);

watch([selectedId, scope, roles], () => {
  if (selected.value) {
    draft.name = selected.value.isSystem ? t(selected.value.name) : selected.value.name;
    draft.description = selected.value.description;
    draft.permissions = [...selected.value.permissions];
  } else if (isNew.value && draft.name === '' && draft.permissions.length === 0) {
    draft.description = '';
  }
});

watch(scope, () => {
  selectedId.value = scopedRoles.value[0]?.id ?? null;
});

function startNew(): void {
  selectedId.value = 'new';
  draft.name = '';
  draft.description = '';
  draft.permissions = [];
}

function toggle(key: string, checked: boolean): void {
  draft.permissions = checked ? [...new Set([...draft.permissions, key])] : draft.permissions.filter((entry) => entry !== key);
}

function toggleGroup(items: PermissionDef[], checked: boolean): void {
  const keys = items.filter((item) => canGrant(item.key)).map((item) => item.key);
  draft.permissions = checked ? [...new Set([...draft.permissions, ...keys])] : draft.permissions.filter((entry) => !keys.includes(entry));
}

function groupState(items: PermissionDef[]): boolean {
  return items.every((item) => draft.permissions.includes(item.key));
}

async function save(): Promise<void> {
  saving.value = true;
  try {
    if (isNew.value) {
      const { role } = await api.adminCreateRole({ scope: scope.value, name: draft.name.trim(), description: draft.description.trim(), permissions: draft.permissions });
      await load();
      selectedId.value = role.id;
      notify('success', t('Rôle créé'));
    } else if (selected.value) {
      await api.adminUpdateRole(selected.value.id, {
        ...(nameLocked.value ? {} : { name: draft.name.trim() }),
        description: draft.description.trim(),
        permissions: draft.permissions,
      });
      await load();
      notify('success', t('Rôle enregistré'), t('Les permissions sont appliquées immédiatement.'));
    }
  } catch (error) {
    notifyError(error, t('Enregistrement impossible'));
  } finally {
    saving.value = false;
  }
}

function askDelete(): void {
  const role = selected.value;
  if (!role) return;
  confirm.require({
    header: t('Supprimer le rôle « {name} » ?', { name: t(role.name) }),
    message: t('Cette action est définitive.'),
    icon: 'pi pi-trash',
    acceptLabel: t('Supprimer'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      try {
        await api.adminDeleteRole(role.id);
        selectedId.value = null;
        await load();
        selectedId.value = scopedRoles.value[0]?.id ?? null;
      } catch (error) {
        notifyError(error, t('Suppression impossible'));
      }
    },
  });
}

const canSave = computed(() => draft.name.trim() !== '' && !locked.value);
</script>

<template>
  <div class="page roles">
    <header class="head">
      <div>
        <h1 class="page-title">{{ $t('Rôles et permissions') }}</h1>
        <p class="muted">{{ $t('Les rôles globaux définissent ce que chacun peut faire dans l\'application ; les rôles de projet, ce que chacun peut faire dans un projet.') }}</p>
      </div>
    </header>

    <SelectButton v-model="scope" :options="scopeOptions" option-label="label" option-value="value" :allow-empty="false" :aria-label="$t('Type de rôle')" />

    <div class="layout">
      <aside class="list">
        <button
          v-for="role in scopedRoles"
          :key="role.id"
          type="button"
          class="role-card card"
          :class="{ active: selectedId === role.id }"
          @click="selectedId = role.id"
        >
          <div class="line">
            <strong>{{ $t(role.name) }}</strong>
            <Tag v-if="role.locked" :value="$t('Verrouillé')" severity="contrast" />
            <Tag v-else-if="role.isSystem" :value="$t('Système')" severity="secondary" />
          </div>
          <span class="muted small desc">{{ role.description ? $t(role.description) : $t('Sans description') }}</span>
          <span class="muted small"><i class="pi pi-users"></i> {{ role.usage }} {{ scope === 'global' ? 'utilisateur' : 'membre' }}{{ role.usage > 1 ? 's' : '' }}</span>
        </button>
        <Button :label="$t('Nouveau rôle')" icon="pi pi-plus" severity="secondary" outlined @click="startNew" />
      </aside>

      <section v-if="selected || isNew" class="editor card">
        <div v-if="locked" class="notice"><i class="pi pi-lock"></i> {{ $t('Ce rôle est verrouillé : ses permissions ne peuvent pas être modifiées.') }}</div>

        <div class="field">
          <label for="r-name">{{ $t('Nom') }}</label>
          <InputText id="r-name" v-model="draft.name" maxlength="60" :disabled="nameLocked || locked" :placeholder="$t('Ex. Responsable qualité')" />
        </div>
        <div class="field">
          <label for="r-desc">{{ $t('Description') }}</label>
          <Textarea id="r-desc" v-model="draft.description" rows="2" auto-resize maxlength="300" :disabled="locked" />
        </div>

        <div v-if="fullAccess" class="notice"><i class="pi pi-star"></i> {{ $t('Accès total : toutes les permissions sont accordées, y compris celles ajoutées plus tard.') }}</div>

        <div v-else class="perms">
          <fieldset v-for="group in groups" :key="group.name" class="group">
            <legend>
              <label class="group-toggle">
                <Checkbox :model-value="groupState(group.items)" binary :disabled="locked" :aria-label="$t('Tout {name}', { name: $t(group.name) })" @update:model-value="(value: boolean) => toggleGroup(group.items, value)" />
                {{ $t(group.name) }}
              </label>
            </legend>
            <label v-for="permission in group.items" :key="permission.key" class="perm" :class="{ disabled: locked || !canGrant(permission.key) }">
              <Checkbox
                :model-value="draft.permissions.includes(permission.key)"
                binary
                :disabled="locked || !canGrant(permission.key)"
                @update:model-value="(value: boolean) => toggle(permission.key, value)"
              />
              <span>
                <strong>{{ $t(permission.label) }}</strong>
                <small class="muted">{{ $t(permission.description) }}</small>
              </span>
            </label>
          </fieldset>
        </div>

        <footer class="actions">
          <Button v-if="selected && !selected.isSystem" :label="$t('Supprimer')" icon="pi pi-trash" severity="danger" text :disabled="selected.usage > 0" @click="askDelete" />
          <small v-if="selected && !selected.isSystem && selected.usage > 0" class="muted">{{ $t('Rôle encore attribué.') }}</small>
          <Button :label="$t('Enregistrer')" icon="pi pi-check" class="save" :disabled="!canSave" :loading="saving" @click="save" />
        </footer>
      </section>
      <section v-else class="editor card empty muted">{{ $t('Sélectionnez un rôle ou créez-en un.') }}</section>
    </div>
  </div>
</template>

<style scoped>
.roles {
  max-width: 1200px;
}
.head {
  margin-bottom: 1rem;
}
.layout {
  display: grid;
  grid-template-columns: 19rem minmax(0, 1fr);
  gap: 1.25rem;
  margin-top: 1rem;
  align-items: start;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.role-card {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.75rem 0.9rem;
  color: var(--fb-text);
  text-align: left;
  cursor: pointer;
}
.role-card:hover {
  border-color: var(--fb-accent);
}
.role-card.active {
  border-color: var(--fb-accent);
  box-shadow: 0 0 0 3px var(--fb-accent-soft);
}
.line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.desc {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.editor {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem;
}
.editor.empty {
  align-items: center;
  padding: 3rem;
}
.notice {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.65rem 0.85rem;
  border-radius: 8px;
  background: var(--fb-accent-soft);
  font-size: 0.88rem;
}
.perms {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr));
  gap: 1rem;
}
.group {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin: 0;
  padding: 0.75rem 1rem 1rem;
  border: 1px solid var(--fb-border);
  border-radius: 10px;
}
.group legend {
  padding: 0 0.4rem;
}
.group-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--fb-muted);
  cursor: pointer;
}
.perm {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  cursor: pointer;
}
.perm.disabled {
  cursor: default;
  opacity: 0.55;
}
.perm span {
  display: flex;
  flex-direction: column;
}
.actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--fb-border);
}
.save {
  margin-left: auto;
}
@media (max-width: 900px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
</style>
