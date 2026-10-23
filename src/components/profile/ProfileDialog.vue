<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import Tab from 'primevue/tab';
import TabList from 'primevue/tablist';
import TabPanel from 'primevue/tabpanel';
import TabPanels from 'primevue/tabpanels';
import Tabs from 'primevue/tabs';
import { api } from '@/api';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';
import { squareThumbnail } from '@/utils/image';
import { notify, notifyError } from '@/utils/notify';
import ApiTokensPanel from '@/components/tokens/ApiTokensPanel.vue';
import LanguageSwitch from '@/components/common/LanguageSwitch.vue';
import ThemePicker from './ThemePicker.vue';
import FontSettings from './FontSettings.vue';

import { t } from '@/i18n';
const auth = useAuthStore();
const ui = useUiStore();

const name = ref('');
const savingName = ref(false);
const uploading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const savingPassword = ref(false);

const visible = computed({
  get: () => ui.profileOpen,
  set: (value: boolean) => {
    ui.profileOpen = value;
  },
});

watch(
  () => ui.profileOpen,
  (open) => {
    if (open) {
      name.value = auth.user?.name ?? '';
      currentPassword.value = newPassword.value = confirmPassword.value = '';
    }
  },
);

const nameChanged = computed(() => name.value.trim() !== '' && name.value.trim() !== auth.user?.name);
const passwordMismatch = computed(() => confirmPassword.value !== '' && confirmPassword.value !== newPassword.value);
const canChangePassword = computed(
  () => currentPassword.value !== '' && newPassword.value.length >= 8 && newPassword.value === confirmPassword.value,
);

async function saveName(): Promise<void> {
  savingName.value = true;
  try {
    await auth.updateProfile({ name: name.value.trim() });
    notify('success', t('Profil mis à jour'));
  } catch (error) {
    notifyError(error);
  } finally {
    savingName.value = false;
  }
}

async function onFileSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) {
    return;
  }
  if (!file.type.startsWith('image/')) {
    notify('warn', t('Fichier non pris en charge'), t('Choisissez une image (PNG, JPEG, WebP…).'));
    return;
  }
  uploading.value = true;
  try {
    await auth.uploadAvatar(await squareThumbnail(file));
    notify('success', t('Image de profil mise à jour'));
  } catch (error) {
    notifyError(error, t('Impossible d\'enregistrer l\'image'));
  } finally {
    uploading.value = false;
  }
}

async function removeAvatar(): Promise<void> {
  uploading.value = true;
  try {
    await auth.removeAvatar();
  } catch (error) {
    notifyError(error);
  } finally {
    uploading.value = false;
  }
}

async function chooseTheme(themeId: string): Promise<void> {
  try {
    await auth.updateProfile({ theme: themeId });
  } catch (error) {
    notifyError(error, t('Thème non enregistré'));
  }
}

async function changePassword(): Promise<void> {
  savingPassword.value = true;
  try {
    await api.changePassword(currentPassword.value, newPassword.value);
    notify('success', t('Mot de passe modifié'), t('Vos autres sessions ont été déconnectées.'));
    currentPassword.value = newPassword.value = confirmPassword.value = '';
  } catch (error) {
    notifyError(error);
  } finally {
    savingPassword.value = false;
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="$t('Mon compte')" :style="{ width: 'min(48rem, 96vw)' }" dismissable-mask>
    <Tabs v-model:value="ui.profileTab">
      <TabList>
        <Tab value="profile"><i class="pi pi-user"></i> {{ $t('Profil') }}</Tab>
        <Tab value="appearance"><i class="pi pi-palette"></i> {{ $t('Apparence') }}</Tab>
        <Tab value="security"><i class="pi pi-lock"></i> {{ $t('Sécurité') }}</Tab>
        <Tab value="tokens"><i class="pi pi-key"></i> {{ $t('Jetons d\'API') }}</Tab>
      </TabList>
      <TabPanels>
        <TabPanel value="profile">
          <div class="profile">
            <div class="avatar-block">
              <UserAvatar :user="auth.user" size="xlarge" />
              <div class="avatar-actions">
                <input ref="fileInput" type="file" accept="image/*" hidden @change="onFileSelected" />
                <Button :label="$t('Changer l\'image')" icon="pi pi-upload" size="small" :loading="uploading" @click="fileInput?.click()" />
                <Button
                  v-if="(auth.user?.avatarVersion ?? 0) > 0"
                  :label="$t('Retirer')"
                  icon="pi pi-trash"
                  size="small"
                  severity="secondary"
                  text
                  :disabled="uploading"
                  @click="removeAvatar"
                />
                <p class="muted small">{{ $t('Recadrée au carré automatiquement.') }}</p>
              </div>
            </div>

            <form class="stack" @submit.prevent="saveName">
              <div class="field">
                <label for="profile-name">{{ $t('Nom affiché') }}</label>
                <InputText id="profile-name" v-model="name" maxlength="100" autocomplete="name" />
              </div>
              <div class="field">
                <label for="profile-email">{{ $t('Adresse e-mail') }}</label>
                <InputText id="profile-email" :model-value="auth.user?.email" disabled />
              </div>
              <div class="field">
                <label>{{ $t('Rôle') }}</label>
                <span class="muted">{{ auth.user ? $t(auth.user.roleName) : "" }}</span>
              </div>
              <div>
                <Button type="submit" :label="$t('Enregistrer')" icon="pi pi-check" :disabled="!nameChanged" :loading="savingName" />
              </div>
            </form>
          </div>
        </TabPanel>

        <TabPanel value="appearance">
          <p class="muted small intro">{{ $t('Thème, thèmes personnalisés et polices sont enregistrés sur votre compte et vous suivent sur tous vos appareils.') }}</p>
          <section class="language">
            <h4 class="language-title"><i class="pi pi-language"></i> {{ $t('Langue') }}</h4>
            <p class="muted small">{{ $t("La langue de l'interface est enregistrée sur votre compte.") }}</p>
            <LanguageSwitch />
          </section>
          <FontSettings />
          <ThemePicker @select="chooseTheme" />
        </TabPanel>

        <TabPanel value="security">
          <form class="stack security" @submit.prevent="changePassword">
            <div class="field">
              <label for="pw-current">{{ $t('Mot de passe actuel') }}</label>
              <Password id="pw-current" v-model="currentPassword" :feedback="false" toggle-mask autocomplete="current-password" fluid />
            </div>
            <div class="field">
              <label for="pw-new">{{ $t('Nouveau mot de passe (8 caractères minimum)') }}</label>
              <Password id="pw-new" v-model="newPassword" :feedback="false" toggle-mask autocomplete="new-password" fluid />
            </div>
            <div class="field">
              <label for="pw-confirm">{{ $t('Confirmation') }}</label>
              <Password id="pw-confirm" v-model="confirmPassword" :feedback="false" toggle-mask autocomplete="new-password" fluid :invalid="passwordMismatch" />
              <small v-if="passwordMismatch" class="error">{{ $t('Les mots de passe ne correspondent pas.') }}</small>
            </div>
            <div>
              <Button type="submit" :label="$t('Changer le mot de passe')" icon="pi pi-key" :disabled="!canChangePassword" :loading="savingPassword" />
            </div>
          </form>
        </TabPanel>

        <TabPanel value="tokens">
          <ApiTokensPanel v-if="ui.profileOpen" />
        </TabPanel>
      </TabPanels>
    </Tabs>
  </Dialog>
</template>

<style scoped>
.profile {
  display: grid;
  grid-template-columns: 11rem 1fr;
  gap: 1.5rem;
  align-items: start;
}
.avatar-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.9rem;
}
.avatar-block :deep(.p-avatar) {
  width: 6.5rem;
  height: 6.5rem;
  font-size: 2.2rem;
}
.avatar-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
}
.intro {
  margin-bottom: 1rem;
}
.security {
  max-width: 24rem;
}
.error {
  color: var(--fb-danger);
}
@media (max-width: 600px) {
  .profile {
    grid-template-columns: 1fr;
  }
}
.language {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.4rem;
  margin-bottom: 1.25rem;
}
.language-title {
  margin: 0;
  font-size: 0.95rem;
}
</style>
