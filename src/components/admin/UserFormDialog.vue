<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import ToggleSwitch from 'primevue/toggleswitch';
import { isSubsetOfPermissions } from '@shared/permissions';
import type { AdminUserDTO, RoleDTO } from '@shared/types';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { copyText } from '@/utils/clipboard';
import { notify, notifyError } from '@/utils/notify';

import { t } from '@/i18n';
const props = defineProps<{ user: AdminUserDTO | null; roles: RoleDTO[] }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ saved: [] }>();

const auth = useAuthStore();
const saving = ref(false);
const form = reactive({ name: '', email: '', roleId: null as number | null, password: '', isActive: true });

const isEdit = computed(() => props.user !== null);
const isSelf = computed(() => props.user?.id === auth.user?.id);
/** Rôles proposés, avec leur nom dans la langue de l'interface (les rôles système sont traduits). */
const roleOptions = computed(() => grantableRoles.value.map((role) => ({ ...role, name: t(role.name) })));
const grantableRoles = computed(() =>
  props.roles.filter((role) => isSubsetOfPermissions(role.permissions, auth.user?.permissions ?? []) || role.id === props.user?.roleId),
);
const passwordOk = computed(() => (isEdit.value && form.password === '') || form.password.length >= 8);
const valid = computed(() => form.name.trim() !== '' && /^\S+@\S+\.\S+$/.test(form.email) && form.roleId !== null && passwordOk.value);

watch(visible, (open) => {
  if (!open) {
    return;
  }
  const user = props.user;
  form.name = user?.name ?? '';
  form.email = user?.email ?? '';
  form.roleId = user?.roleId ?? props.roles.find((role) => role.key === 'member')?.id ?? null;
  form.password = '';
  form.isActive = user?.isActive ?? true;
});

function generatePassword(): void {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  form.password = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

async function copyPassword(): Promise<void> {
  if (form.password && (await copyText(form.password))) {
    notify('success', t('Mot de passe copié'));
  }
}

async function submit(): Promise<void> {
  if (!valid.value || form.roleId === null) {
    return;
  }
  saving.value = true;
  try {
    if (props.user) {
      await api.adminUpdateUser(props.user.id, {
        name: form.name.trim(),
        email: form.email.trim(),
        roleId: form.roleId,
        isActive: form.isActive,
        ...(form.password ? { password: form.password } : {}),
      });
    } else {
      await api.adminCreateUser({ name: form.name.trim(), email: form.email.trim(), roleId: form.roleId, password: form.password });
    }
    notify('success', isEdit.value ? t('Compte mis à jour') : t('Compte créé'));
    visible.value = false;
    emit('saved');
  } catch (error) {
    notifyError(error, t('Enregistrement impossible'));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="isEdit ? $t('Modifier le compte') : $t('Nouveau compte')" :style="{ width: 'min(32rem, 96vw)' }">
    <form class="stack" autocomplete="off" @submit.prevent="submit">
      <div class="field">
        <label for="u-name">{{ $t('Nom affiché') }}</label>
        <InputText id="u-name" v-model="form.name" maxlength="100" autofocus />
      </div>
      <div class="field">
        <label for="u-email">{{ $t('Adresse e-mail (identifiant de connexion)') }}</label>
        <InputText id="u-email" v-model="form.email" type="email" autocomplete="off" />
      </div>
      <div class="field">
        <label for="u-role">{{ $t('Rôle global') }}</label>
        <Select v-model="form.roleId" input-id="u-role" :options="roleOptions" option-label="name" option-value="id" :disabled="isSelf" />
        <small v-if="isSelf" class="muted">{{ $t('Vous ne pouvez pas modifier votre propre rôle.') }}</small>
        <small v-else-if="form.roleId" class="muted">{{ $t(roles.find((role) => role.id === form.roleId)?.description ?? "") }}</small>
      </div>
      <div class="field">
        <label for="u-password">{{ isEdit ? $t('Nouveau mot de passe (laisser vide pour conserver)') : $t('Mot de passe (8 caractères minimum)') }}</label>
        <div class="password-row">
          <InputText id="u-password" v-model="form.password" autocomplete="new-password" :invalid="form.password !== '' && form.password.length < 8" />
          <Button type="button" icon="pi pi-sync" severity="secondary" outlined :aria-label="$t('Générer un mot de passe')" @click="generatePassword" />
          <Button type="button" icon="pi pi-copy" severity="secondary" outlined :aria-label="$t('Copier le mot de passe')" :disabled="!form.password" @click="copyPassword" />
        </div>
        <small v-if="isEdit && form.password" class="muted">{{ $t('Les sessions ouvertes de cette personne seront fermées.') }}</small>
      </div>
      <label v-if="isEdit" class="row toggle">
        <ToggleSwitch v-model="form.isActive" :disabled="isSelf" />
        <span>{{ $t('Compte actif') }}</span>
      </label>
      <div class="actions">
        <Button type="button" :label="$t('Annuler')" severity="secondary" text @click="visible = false" />
        <Button type="submit" :label="isEdit ? $t('Enregistrer') : $t('Créer le compte')" icon="pi pi-check" :disabled="!valid" :loading="saving" />
      </div>
    </form>
  </Dialog>
</template>

<style scoped>
.password-row {
  display: flex;
  gap: 0.4rem;
}
.password-row :deep(.p-inputtext) {
  flex: 1;
  font-family: var(--fb-font-mono, ui-monospace, 'Cascadia Mono', Consolas, monospace);
}
.toggle {
  cursor: pointer;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
</style>
