<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import Button from 'primevue/button';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Password from 'primevue/password';
import SelectButton from 'primevue/selectbutton';
import Tag from 'primevue/tag';
import ToggleSwitch from 'primevue/toggleswitch';
import { defaultHttpsSettings, type CertificateFormat, type CertificateInfoDTO, type HttpsSettingsDTO, type HttpsStatusDTO } from '@shared/https';
import { api } from '@/api';
import { translateServerMessage } from '@/i18n/server';
import { formatDateTime } from '@/utils/format';
import { notify, notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Accès HTTPS : certificats (PEM ou PFX), port, redirection, HSTS, proxy inverse ; appliqué sans redémarrer. */
const settings = ref<HttpsSettingsDTO | null>(null);
const status = ref<HttpsStatusDTO | null>(null);
const form = reactive(defaultHttpsSettings());
const passphrase = ref('');
const replacingPassphrase = ref(false);
const saving = ref(false);
const testing = ref(false);
const test = ref<{ ok: boolean; message: string; certificate: CertificateInfoDTO | null } | null>(null);
/** Certificat auto-signé : noms couverts (le nom utilisé pour cette page et localhost par défaut). */
const hostnames = ref([...new Set([window.location.hostname, 'localhost'])].join(', '));
const generating = ref(false);

async function generate(): Promise<void> {
  generating.value = true;
  try {
    const result = await api.adminSelfSigned(hostnames.value.split(/[\s,;]+/).filter(Boolean));
    Object.assign(form, { format: 'pem', certPath: result.certPath, keyPath: result.keyPath, caPath: '' });
    replacingPassphrase.value = true;
    passphrase.value = '';
    test.value = { ok: true, message: t('Certificat auto-signé créé : enregistrez pour l’utiliser.'), certificate: result.certificate };
  } catch (error) {
    notifyError(error, t('Certificat non créé'));
  } finally {
    generating.value = false;
  }
}

function apply(next: { settings: HttpsSettingsDTO; status: HttpsStatusDTO }): void {
  settings.value = next.settings;
  status.value = next.status;
  Object.assign(form, next.settings);
  passphrase.value = '';
  replacingPassphrase.value = !next.settings.hasPassphrase;
}

onMounted(async () => {
  try {
    apply(await api.adminHttps());
  } catch (error) {
    notifyError(error, t('Réglages HTTPS indisponibles'));
  }
});

const formats = computed(() => [
  { value: 'pem', label: t('PEM (certificat + clé)') },
  { value: 'pfx', label: t('PFX / PKCS#12') },
]);

const files = () => ({
  format: form.format as CertificateFormat,
  certPath: form.certPath.trim(),
  keyPath: form.keyPath.trim(),
  caPath: form.caPath.trim(),
  pfxPath: form.pfxPath.trim(),
  ...(replacingPassphrase.value ? { passphrase: passphrase.value } : {}),
});
const hasFiles = computed(() => (form.format === 'pfx' ? form.pfxPath.trim() : form.certPath.trim() && form.keyPath.trim()));

async function runTest(): Promise<void> {
  testing.value = true;
  test.value = null;
  try {
    const result = await api.adminTestHttps(files());
    test.value = { ...result, message: translateServerMessage(result.message) };
  } catch (error) {
    notifyError(error);
  } finally {
    testing.value = false;
  }
}

async function save(): Promise<void> {
  saving.value = true;
  try {
    const { updatedAt: _updated, hasPassphrase: _has, ...values } = form;
    const result = await api.adminSaveHttps({ ...values, ...files() });
    apply(result);
    notify(result.status.https.error ? 'warn' : 'success', result.settings.enabled ? (result.status.https.listening ? t('HTTPS actif') : t('HTTPS enregistré mais inactif')) : t('Réglages enregistrés'));
  } catch (error) {
    notifyError(error, t('Réglages non enregistrés'));
  } finally {
    saving.value = false;
  }
}

const httpsUrl = computed(() => {
  const port = status.value?.https.port;
  if (!port) return null;
  return `https://${window.location.hostname}${port === 443 ? '' : `:${port}`}`;
});

function certificateSeverity(certificate: CertificateInfoDTO): 'success' | 'warn' | 'danger' {
  if (certificate.daysLeft < 0) return 'danger';
  return certificate.daysLeft < 21 || certificate.selfSigned ? 'warn' : 'success';
}
</script>

<template>
  <div class="page https-settings">
    <header>
      <h1 class="page-title">{{ $t('HTTP / HTTPS') }}</h1>
      <p class="muted">{{ $t('Servez FastBoard en HTTPS avec vos certificats (Let’s Encrypt, autorité interne, certificat d’entreprise) ou derrière un proxy inverse. Les changements s’appliquent sans redémarrer et les certificats renouvelés sont relus automatiquement.') }}</p>
    </header>

    <section v-if="status" class="card block state">
      <h2 class="block-title"><i class="pi pi-wave-pulse"></i> {{ $t('État') }}</h2>
      <div class="state-grid">
        <div>
          <span class="muted small">{{ $t('HTTP') }}</span>
          <strong>{{ $t('Port {port}', { port: status.httpPort }) }}</strong>
          <span class="muted small">{{ settings?.redirectHttp && status.https.listening ? $t('redirigé vers HTTPS') : $t('ouvert') }}</span>
        </div>
        <div>
          <span class="muted small">{{ $t('HTTPS') }}</span>
          <strong v-if="status.https.listening" class="ok"><i class="pi pi-lock"></i> {{ $t('Actif sur le port {port}', { port: status.https.port ?? '' }) }}</strong>
          <strong v-else class="off">{{ settings?.enabled ? $t('Inactif') : $t('Désactivé') }}</strong>
          <a v-if="httpsUrl" :href="httpsUrl" target="_blank" rel="noopener" class="small">{{ httpsUrl }}</a>
        </div>
        <div>
          <span class="muted small">{{ $t('Cette page') }}</span>
          <strong>{{ status.requestSecure ? $t('Consultée en HTTPS') : $t('Consultée en HTTP') }}</strong>
        </div>
      </div>
      <Message v-if="status.https.error" severity="error" :closable="false" size="small">{{ translateServerMessage(status.https.error) }}</Message>
      <Message v-if="status.disabledByEnv" severity="warn" :closable="false" size="small">{{ $t('FASTBOARD_HTTPS=0 : les réglages HTTPS sont ignorés au démarrage (mode secours).') }}</Message>
      <div v-if="status.https.certificate" class="cert">
        <Tag :severity="certificateSeverity(status.https.certificate)" :value="status.https.certificate.daysLeft < 0 ? $t('Expiré') : $t('{n} jour restant|{n} jours restants', { n: status.https.certificate.daysLeft })" />
        <span class="small"><strong>{{ status.https.certificate.altNames.join(', ') || status.https.certificate.subject }}</strong></span>
        <span class="muted small">{{ $t('émis par {issuer}', { issuer: status.https.certificate.selfSigned ? $t('lui-même (auto-signé)') : status.https.certificate.issuer }) }}</span>
        <span v-if="status.https.loadedAt" class="muted small">· {{ $t('chargé le {date}', { date: formatDateTime(status.https.loadedAt) }) }}</span>
      </div>
    </section>

    <form v-if="settings" class="card block" @submit.prevent="save">
      <label class="row master">
        <ToggleSwitch v-model="form.enabled" />
        <strong>{{ form.enabled ? $t('HTTPS activé') : $t('HTTPS désactivé') }}</strong>
        <span v-if="settings.updatedAt" class="muted small">· {{ $t('modifié le {date}', { date: formatDateTime(settings.updatedAt) }) }}</span>
      </label>

      <div class="grid">
        <div class="field">
          <label for="https-port" class="label">{{ $t('Port HTTPS') }}</label>
          <InputNumber v-model="form.port" input-id="https-port" :min="1" :max="65535" :use-grouping="false" fluid />
          <small class="muted">{{ $t('443 pour une adresse sans numéro de port (droits administrateur souvent nécessaires).') }}</small>
        </div>
        <div class="field">
          <span class="label">{{ $t('Format du certificat') }}</span>
          <SelectButton v-model="form.format" :options="formats" option-label="label" option-value="value" :allow-empty="false" />
        </div>
      </div>

      <template v-if="form.format === 'pem'">
        <div class="field">
          <label for="https-cert" class="label">{{ $t('Certificat (PEM)') }}</label>
          <InputText id="https-cert" v-model="form.certPath" fluid placeholder="C:\certs\fullchain.pem" @keydown.enter.prevent />
          <small class="muted">{{ $t('Chaîne complète conseillée (fullchain.pem avec Let’s Encrypt). Chemin sur le serveur, absolu ou relatif au dossier de FastBoard.') }}</small>
        </div>
        <div class="field">
          <label for="https-key" class="label">{{ $t('Clé privée (PEM)') }}</label>
          <InputText id="https-key" v-model="form.keyPath" fluid placeholder="C:\certs\privkey.pem" @keydown.enter.prevent />
        </div>
        <div class="field">
          <label for="https-ca" class="label">{{ $t('Certificats intermédiaires (facultatif)') }}</label>
          <InputText id="https-ca" v-model="form.caPath" fluid placeholder="C:\certs\chain.pem" @keydown.enter.prevent />
        </div>
      </template>
      <div v-else class="field">
        <label for="https-pfx" class="label">{{ $t('Fichier PFX / P12') }}</label>
        <InputText id="https-pfx" v-model="form.pfxPath" fluid placeholder="C:\certs\fastboard.pfx" @keydown.enter.prevent />
        <small class="muted">{{ $t('Format courant sous Windows (export depuis le magasin de certificats, IIS, win-acme).') }}</small>
      </div>

      <div class="field">
        <label for="https-pass" class="label">{{ form.format === 'pfx' ? $t('Mot de passe du PFX') : $t('Mot de passe de la clé (si elle est chiffrée)') }}</label>
        <div v-if="settings.hasPassphrase && !replacingPassphrase" class="row key-row">
          <span class="key"><i class="pi pi-lock"></i> {{ $t('Mot de passe enregistré') }}</span>
          <Button type="button" :label="$t('Remplacer')" size="small" text @click="replacingPassphrase = true" />
          <Button type="button" :label="$t('Effacer')" size="small" text severity="danger" @click="(replacingPassphrase = true), (passphrase = '')" />
        </div>
        <Password v-else v-model="passphrase" input-id="https-pass" :feedback="false" toggle-mask fluid :input-props="{ autocomplete: 'off' }" :placeholder="$t('Facultatif')" />
      </div>

      <div class="test-row">
        <Button type="button" :label="$t('Vérifier le certificat')" icon="pi pi-verified" severity="secondary" outlined size="small" :loading="testing" :disabled="!hasFiles" @click="runTest" />
        <Message v-if="test" :severity="test.ok ? 'success' : 'error'" :closable="false" size="small" class="grow">
          {{ test.message }}
          <template v-if="test.certificate">
            — {{ test.certificate.altNames.join(', ') || test.certificate.subject }} · {{ $t('valide jusqu’au {date}', { date: formatDateTime(test.certificate.validTo) }) }}<template v-if="test.certificate.selfSigned"> · {{ $t('auto-signé') }}</template>
          </template>
        </Message>
      </div>

      <details class="self-signed">
        <summary>{{ $t('Pas encore de certificat ? Créer un certificat auto-signé') }}</summary>
        <p class="muted small">{{ $t('Pratique pour essayer HTTPS sur le réseau local. Les navigateurs l’afficheront comme « non sécurisé » tant qu’il n’est pas approuvé sur chaque poste : préférez un vrai certificat en production.') }}</p>
        <div class="generate">
          <InputText v-model="hostnames" size="small" class="grow" :aria-label="$t('Noms et adresses couverts')" :placeholder="$t('fastboard.local, 192.168.1.20')" @keydown.enter.prevent="generate" />
          <Button type="button" :label="$t('Créer')" icon="pi pi-key" size="small" severity="secondary" :loading="generating" :disabled="!hostnames.trim()" @click="generate" />
        </div>
      </details>

      <h2 class="block-title"><i class="pi pi-shield"></i> {{ $t('Sécurité') }}</h2>
      <label class="option">
        <ToggleSwitch v-model="form.redirectHttp" />
        <span>
          <strong>{{ $t('Rediriger HTTP vers HTTPS') }}</strong>
          <small class="muted">{{ $t('Les visites en HTTP sont renvoyées vers HTTPS. Depuis la machine elle-même (localhost), HTTP reste accessible pour garder un accès de secours.') }}</small>
        </span>
      </label>
      <label class="option">
        <ToggleSwitch v-model="form.hsts" />
        <span>
          <strong>{{ $t('HSTS (Strict-Transport-Security)') }}</strong>
          <small class="muted">{{ $t('Le navigateur n’utilise plus que HTTPS pour ce site pendant la durée choisie. À activer une fois HTTPS validé : difficile à annuler.') }}</small>
        </span>
      </label>
      <div v-if="form.hsts" class="field indent">
        <label for="https-hsts" class="label">{{ $t('Durée HSTS') }}</label>
        <InputNumber v-model="form.hstsMaxAgeDays" input-id="https-hsts" :min="1" :max="730" :suffix="$t(' jours')" show-buttons />
      </div>
      <label class="option">
        <ToggleSwitch v-model="form.trustProxy" />
        <span>
          <strong>{{ $t('Derrière un proxy inverse') }}</strong>
          <small class="muted">{{ $t('nginx, IIS, Caddy, Traefik… termine le TLS et transmet X-Forwarded-Proto / X-Forwarded-For. N’activez que si FastBoard n’est joignable que par ce proxy.') }}</small>
        </span>
      </label>

      <div class="actions">
        <Button type="submit" :label="$t('Enregistrer et appliquer')" icon="pi pi-check" :loading="saving" :disabled="form.enabled && !hasFiles" />
      </div>
    </form>

    <section class="card block help">
      <h2 class="block-title"><i class="pi pi-question-circle"></i> {{ $t('Obtenir un certificat') }}</h2>
      <ul class="muted small tips">
        <li>{{ $t('Let’s Encrypt (gratuit) : win-acme sous Windows, certbot sous Linux. Indiquez fullchain.pem et privkey.pem ; les renouvellements sont relus automatiquement.') }}</li>
        <li>{{ $t('Réseau d’entreprise : demandez un certificat à votre autorité interne (souvent au format PFX).') }}</li>
        <li>{{ $t('Proxy inverse : laissez HTTPS désactivé ici, configurez le certificat dans le proxy et activez « Derrière un proxy inverse ».') }}</li>
        <li>{{ $t('En cas de problème, démarrez FastBoard avec FASTBOARD_HTTPS=0 pour ignorer ces réglages.') }}</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.https-settings {
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
  margin: 0;
  font-size: 1rem;
}
.state-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 1rem;
}
.state-grid > div {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.ok {
  color: #16a34a;
}
.off {
  color: var(--fb-muted);
}
.cert {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
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
}
.field.indent {
  margin-left: 3.2rem;
}
.label {
  font-weight: 600;
  font-size: 0.88rem;
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
.test-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
}
.grow {
  flex: 1;
}
.self-signed summary {
  color: var(--fb-accent);
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
}
.self-signed p {
  margin: 0.5rem 0;
}
.generate {
  display: flex;
  gap: 0.5rem;
}
.option {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  cursor: pointer;
}
.option > span {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.actions {
  display: flex;
  justify-content: flex-end;
}
.tips {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin: 0;
  padding-left: 1.1rem;
}
</style>
