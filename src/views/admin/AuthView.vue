<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import Button from 'primevue/button';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Password from 'primevue/password';
import Select from 'primevue/select';
import SelectButton from 'primevue/selectbutton';
import ToggleSwitch from 'primevue/toggleswitch';
import { LDAP_DEFAULTS, LDAP_LIMITS, LDAP_PROFILE_DEFAULTS, type LdapFields, type LdapProfile, type LdapSecurity, type LdapSettingsDTO, type LdapTestResultDTO } from '@shared/ldap';
import type { RoleDTO } from '@shared/types';
import { api } from '@/api';
import { errorMessage } from '@/api/http';
import { translateServerMessage } from '@/i18n/server';
import { useAppStore } from '@/stores/app';
import { formatDateTime } from '@/utils/format';
import { notify, notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Connexion par annuaire LDAP : profil, serveur, compte de service, recherche des personnes et test des réglages. */
const app = useAppStore();
const settings = ref<LdapSettingsDTO | null>(null);
const form = reactive<LdapFields>({ ...LDAP_DEFAULTS });
const bindPassword = ref('');
const replacingPassword = ref(false);
const roles = ref<RoleDTO[]>([]);
const saving = ref(false);

const testLogin = ref('');
const testPassword = ref('');
const testing = ref(false);
const test = ref<LdapTestResultDTO | null>(null);

const profileOptions = computed(() => [
  { value: 'classic', label: t('Classique') },
  { value: 'specific', label: t('Spécifique') },
]);
const profileHint = computed(() =>
  form.profile === 'specific'
    ? t('Compte de service obligatoire, recherche par adresse e-mail, et nom écrit « NOM, Prénom (Société) » dans l’annuaire, repris sous la forme « Prénom NOM ».')
    : t('Annuaire standard (OpenLDAP, Active Directory…) : la personne est cherchée avec le filtre, puis l’annuaire vérifie son mot de passe. Le nom est lu tel quel.'),
);
const securityOptions = computed(() => [
  { value: 'ldaps', label: t('LDAPS (TLS dès la connexion)') },
  { value: 'starttls', label: t('StartTLS (passage en TLS)') },
  { value: 'none', label: t('Aucune (en clair)') },
]);
/** Le joker `*` n'est jamais attribué automatiquement. */
const roleOptions = computed(() => roles.value.filter((role) => !role.permissions.includes('*')).map((role) => ({ id: role.id, name: t(role.name) })));
const usesTls = computed(() => form.security !== 'none');
const needsBind = computed(() => form.profile === 'specific');
const attributes = computed(() => Object.entries(test.value?.entry?.attributes ?? {}));

function apply(next: LdapSettingsDTO): void {
  settings.value = next;
  const { hasBindPassword: _saved, updatedAt: _date, ...fields } = next;
  Object.assign(form, fields);
  bindPassword.value = '';
  replacingPassword.value = false;
}

onMounted(async () => {
  try {
    apply((await api.adminAuth()).ldap);
  } catch (error) {
    notifyError(error, t('Réglages d’authentification indisponibles'));
  }
  roles.value = (await api.globalRoles().catch(() => ({ roles: [] }))).roles;
});

/** Le profil propose son filtre et ses attributs, qui restent modifiables. */
function chooseProfile(profile: LdapProfile): void {
  Object.assign(form, { profile }, LDAP_PROFILE_DEFAULTS[profile]);
}

function chooseSecurity(security: LdapSecurity): void {
  const defaultPort = (value: LdapSecurity) => (value === 'ldaps' ? 636 : 389);
  if (form.port === defaultPort(form.security)) form.port = defaultPort(security);
  form.security = security;
}

/** Le mot de passe du compte de service n'est envoyé que s'il a été saisi ou effacé. */
const passwordInput = (): { bindPassword?: string } => (replacingPassword.value || !settings.value?.hasBindPassword ? { bindPassword: bindPassword.value } : {});

async function save(): Promise<void> {
  saving.value = true;
  try {
    const result = await api.adminSaveAuth({ ...form, ...passwordInput() });
    apply(result.ldap);
    app.set(result.app);
    notify('success', t('Réglages enregistrés'));
  } catch (error) {
    notifyError(error, t('Enregistrement impossible'));
  } finally {
    saving.value = false;
  }
}

async function runTest(): Promise<void> {
  testing.value = true;
  test.value = null;
  try {
    test.value = await api.adminTestLdap({ ...form, ...passwordInput(), login: testLogin.value.trim(), password: testPassword.value });
  } catch (error) {
    test.value = { ok: false, step: 'connection', message: errorMessage(error), detail: null, entry: null };
  } finally {
    testing.value = false;
    testPassword.value = '';
  }
}
</script>

<template>
  <div class="page auth-settings">
    <header>
      <h1 class="page-title">{{ $t('Authentification') }}</h1>
      <p class="muted">{{ $t('Laissez vos équipes se connecter avec leur compte d’entreprise. Les comptes locaux gardent leur mot de passe, même si l’annuaire ne répond plus.') }}</p>
    </header>

    <form v-if="settings" class="card block" @submit.prevent="save">
      <label class="row master">
        <ToggleSwitch v-model="form.enabled" :aria-label="$t('Activer la connexion LDAP')" />
        <strong>{{ $t('Activer la connexion LDAP') }}</strong>
        <span v-if="settings.updatedAt" class="muted small">· {{ $t('modifié le {date}', { date: formatDateTime(settings.updatedAt) }) }}</span>
      </label>

      <div class="field">
        <span class="field-label">{{ $t('Profil') }}</span>
        <SelectButton :model-value="form.profile" :options="profileOptions" option-label="label" option-value="value" :allow-empty="false" :aria-label="$t('Profil')" @update:model-value="chooseProfile" />
        <small class="muted">{{ profileHint }}</small>
      </div>

      <h2 class="block-title"><i class="pi pi-server"></i> {{ $t('Serveur') }}</h2>
      <div class="grid">
        <div class="field">
          <label for="ldap-host" class="label">{{ $t('Serveur') }}</label>
          <InputText id="ldap-host" v-model="form.host" :placeholder="$t('ldap.exemple.fr')" autocomplete="off" />
        </div>
        <div class="field">
          <label for="ldap-port" class="label">{{ $t('Port') }}</label>
          <InputNumber v-model="form.port" input-id="ldap-port" :min="1" :max="65535" :use-grouping="false" />
        </div>
        <div class="field">
          <label for="ldap-security" class="label">{{ $t('Chiffrement') }}</label>
          <Select :model-value="form.security" :options="securityOptions" option-label="label" option-value="value" input-id="ldap-security" @update:model-value="chooseSecurity" />
        </div>
        <div class="field">
          <label for="ldap-timeout" class="label">{{ $t('Délai maximal (secondes)') }}</label>
          <InputNumber v-model="form.timeoutSeconds" input-id="ldap-timeout" :min="LDAP_LIMITS.timeoutMin" :max="LDAP_LIMITS.timeoutMax" />
        </div>
      </div>
      <Message v-if="!usesTls" severity="warn" :closable="false" size="small">{{ $t('Sans chiffrement, les mots de passe circulent en clair sur le réseau : préférez LDAPS ou StartTLS.') }}</Message>
      <div v-else class="grid">
        <label class="row master">
          <ToggleSwitch v-model="form.verifyCertificate" :aria-label="$t('Vérifier le certificat du serveur')" />
          <span>{{ $t('Vérifier le certificat du serveur') }}</span>
        </label>
        <div class="field">
          <label for="ldap-ca" class="label">{{ $t('Autorité de certification (PEM, facultatif)') }}</label>
          <InputText id="ldap-ca" v-model="form.caPath" autocomplete="off" />
          <small class="muted">{{ $t('Pour une autorité interne. Chemin sur le serveur, absolu ou relatif au dossier de FastBoard.') }}</small>
        </div>
      </div>

      <h2 class="block-title"><i class="pi pi-key"></i> {{ $t('Compte de service') }}</h2>
      <div class="grid">
        <div class="field">
          <label for="ldap-bind" class="label">{{ $t('Identifiant du compte de service') }}</label>
          <InputText id="ldap-bind" v-model="form.bindDn" :placeholder="$t('CN=fastboard,OU=Services,DC=exemple,DC=fr')" autocomplete="off" />
          <small class="muted">{{ needsBind ? $t('Obligatoire avec ce profil : DN complet ou adresse du compte.') : $t('DN complet ou adresse du compte. Vide : recherche anonyme.') }}</small>
        </div>
        <div class="field">
          <label for="ldap-pass" class="label">{{ $t('Mot de passe du compte de service') }}</label>
          <div v-if="settings.hasBindPassword && !replacingPassword" class="row key-row">
            <span class="key"><i class="pi pi-lock"></i> {{ $t('Mot de passe enregistré') }}</span>
            <Button type="button" :label="$t('Remplacer')" size="small" severity="secondary" outlined @click="replacingPassword = true" />
          </div>
          <Password v-else v-model="bindPassword" input-id="ldap-pass" :feedback="false" toggle-mask autocomplete="new-password" fluid />
          <small class="muted">{{ $t('Enregistré chiffré, jamais réaffiché.') }}</small>
        </div>
      </div>

      <h2 class="block-title"><i class="pi pi-search"></i> {{ $t('Recherche des personnes') }}</h2>
      <div class="field">
        <label for="ldap-base" class="label">{{ $t('Base de recherche') }}</label>
        <InputText id="ldap-base" v-model="form.searchBase" :placeholder="$t('OU=Utilisateurs,DC=exemple,DC=fr')" autocomplete="off" />
      </div>
      <div class="field">
        <label for="ldap-filter" class="label">{{ $t('Filtre de recherche') }}</label>
        <InputText id="ldap-filter" v-model="form.userFilter" class="mono" autocomplete="off" />
        <small class="muted">{{ $t('{user} est remplacé par l’identifiant saisi à la connexion.', { user: '{user}' }) }}</small>
      </div>
      <div class="grid">
        <div class="field">
          <label for="ldap-mail" class="label">{{ $t('Attribut de l’adresse e-mail') }}</label>
          <InputText id="ldap-mail" v-model="form.emailAttribute" class="mono" autocomplete="off" />
        </div>
        <div class="field">
          <label for="ldap-name" class="label">{{ $t('Attribut du nom') }}</label>
          <InputText id="ldap-name" v-model="form.nameAttribute" class="mono" autocomplete="off" />
        </div>
      </div>

      <h2 class="block-title"><i class="pi pi-users"></i> {{ $t('Comptes') }}</h2>
      <div class="grid">
        <div class="field">
          <label for="ldap-role" class="label">{{ $t('Rôle des nouveaux comptes') }}</label>
          <Select v-model="form.defaultRoleId" :options="roleOptions" option-label="name" option-value="id" input-id="ldap-role" show-clear :placeholder="$t('Membre')" />
          <small class="muted">{{ $t('Un compte est créé à la première connexion. Le mot de passe reste dans l’annuaire : FastBoard ne l’enregistre jamais.') }}</small>
        </div>
        <div class="field">
          <label for="ldap-label" class="label">{{ $t('Libellé sur la page de connexion') }}</label>
          <InputText id="ldap-label" v-model="form.loginLabel" :maxlength="LDAP_LIMITS.labelMax" :placeholder="$t('Identifiant')" autocomplete="off" />
        </div>
      </div>
      <label class="row master">
        <ToggleSwitch v-model="form.linkExisting" :aria-label="$t('Rattacher les comptes locaux de même adresse e-mail')" />
        <span>{{ $t('Rattacher les comptes locaux de même adresse e-mail') }}</span>
      </label>
      <small class="muted hint">{{ $t('Ils se connectent ensuite avec l’annuaire. Un super administrateur n’est jamais rattaché : il garde son mot de passe pour dépanner.') }}</small>

      <div class="test">
        <h2 class="block-title"><i class="pi pi-play"></i> {{ $t('Tester les réglages') }}</h2>
        <p class="muted small">{{ $t('Sans enregistrer. Sans identifiant, seuls le serveur et le compte de service sont essayés.') }}</p>
        <div class="grid">
          <InputText v-model="testLogin" :placeholder="$t('Identifiant à chercher (facultatif)')" :aria-label="$t('Identifiant à chercher (facultatif)')" autocomplete="off" />
          <Password v-model="testPassword" :feedback="false" toggle-mask :placeholder="$t('Mot de passe de ce compte (facultatif)')" :aria-label="$t('Mot de passe de ce compte (facultatif)')" autocomplete="new-password" fluid />
        </div>
        <div class="test-row">
          <Button type="button" :label="$t('Tester')" icon="pi pi-play" severity="secondary" outlined :loading="testing" :disabled="!form.host" @click="runTest" />
          <Message v-if="test" :severity="test.ok ? 'success' : 'error'" :closable="false" size="small" class="grow">
            {{ translateServerMessage(test.message) }}
            <template v-if="test.detail"><br /><span class="mono detail">{{ test.detail }}</span></template>
          </Message>
        </div>
        <dl v-if="test?.entry" class="entry">
          <dt>{{ $t('DN') }}</dt><dd class="mono">{{ test.entry.dn }}</dd>
          <dt>{{ $t('Nom retenu') }}</dt><dd>{{ test.entry.name }}</dd>
          <dt>{{ $t('Adresse e-mail') }}</dt><dd>{{ test.entry.email ?? '—' }}</dd>
        </dl>
        <details v-if="attributes.length" class="attributes">
          <summary>{{ $t('{n} attribut lu dans l’annuaire|{n} attributs lus dans l’annuaire', { n: attributes.length }) }}</summary>
          <dl class="entry">
            <template v-for="[name, value] in attributes" :key="name"><dt class="mono">{{ name }}</dt><dd>{{ value }}</dd></template>
          </dl>
        </details>
      </div>

      <div>
        <Button type="submit" :label="$t('Enregistrer')" icon="pi pi-check" :loading="saving" />
      </div>
    </form>
  </div>
</template>

<style scoped>
.auth-settings {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
header p {
  margin: 0.25rem 0 0;
}
.block {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.1rem 1.25rem;
}
.block-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.4rem 0 0;
  font-size: 1rem;
}
.master {
  gap: 0.6rem;
  cursor: pointer;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: 1rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}
.label {
  font-weight: 600;
  font-size: 0.88rem;
}
.hint {
  margin-top: -0.6rem;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 0.85rem;
}
.key-row {
  gap: 0.4rem;
}
.key {
  padding: 0.4rem 0.7rem;
  border-radius: 8px;
  background: var(--fb-panel-alt);
  font-size: 0.85rem;
}
.test {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.9rem 1rem;
  border: 1px solid var(--fb-border);
  border-radius: 10px;
  background: var(--fb-panel-alt);
}
.test .block-title {
  margin: 0;
}
.test p {
  margin: -0.4rem 0 0;
}
.test-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 0.75rem;
}
.grow {
  flex: 1;
  min-width: 14rem;
}
.detail {
  overflow-wrap: anywhere;
}
.entry {
  display: grid;
  grid-template-columns: minmax(6rem, max-content) minmax(0, 1fr);
  gap: 0.2rem 1rem;
  margin: 0;
  font-size: 0.85rem;
}
.entry dt {
  color: var(--fb-muted);
}
.entry dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.attributes summary {
  font-size: 0.85rem;
  cursor: pointer;
}
.attributes .entry {
  margin-top: 0.5rem;
}
</style>
