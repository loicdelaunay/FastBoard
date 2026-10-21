<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import Button from 'primevue/button';
import Message from 'primevue/message';
import SelectButton from 'primevue/selectbutton';
import Skeleton from 'primevue/skeleton';
import Tag from 'primevue/tag';
import type { ServiceActionResultDTO, ServiceScope, ServiceStatusDTO } from '@shared/system';
import { api } from '@/api';
import { translateServerMessage } from '@/i18n/server';
import { notify, notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Installation de FastBoard comme service : démarrage automatique et relance en arrière-plan. */
const confirm = useConfirm();
const status = ref<ServiceStatusDTO | null>(null);
const loading = ref(true);
const busy = ref<string | null>(null);
const scope = ref<ServiceScope>('user');
const lastResult = ref<ServiceActionResultDTO | null>(null);
const showDetails = ref(false);

async function load(): Promise<void> {
  try {
    status.value = (await api.adminService()).status;
    if (status.value.installedScope) scope.value = status.value.installedScope;
  } catch (error) {
    notifyError(error, t('État du service indisponible'));
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const PLATFORM_LABELS = computed<Record<ServiceStatusDTO['platform'], string>>(() => ({
  windows: t('Windows — tâche planifiée'),
  linux: t('Linux — service systemd'),
  macos: t('macOS — agent launchd'),
  other: t('Système non pris en charge'),
}));

const scopeOptions = computed(() => [
  { value: 'user', label: t('À l’ouverture de ma session'), icon: 'pi pi-user' },
  { value: 'system', label: t('Au démarrage de la machine'), icon: 'pi pi-power-off' },
]);
const plan = computed(() => status.value?.plans.find((entry) => entry.scope === scope.value) ?? null);
const needsElevation = computed(() => scope.value === 'system' && status.value && !status.value.elevated);

async function act(action: 'install' | 'uninstall' | 'start' | 'stop'): Promise<void> {
  busy.value = action;
  try {
    const result = await api.adminServiceAction(action, scope.value);
    lastResult.value = result;
    status.value = result.status;
    if (result.ok) notify('success', t('Opération réussie'));
    else notify('error', t('Opération en échec'), t('Voir le détail ci-dessous : les commandes peuvent être lancées à la main.'));
  } catch (error) {
    notifyError(error);
  } finally {
    busy.value = null;
  }
}

function askStop(): void {
  confirm.require({
    header: t('Arrêter le service ?'),
    message: status.value?.supervised ? t('Ce serveur tourne sous le service : l\'arrêter coupe FastBoard pour tout le monde, cette page comprise.') : t('Le serveur lancé par le service sera arrêté.'),
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: t('Arrêter'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: () => void act('stop'),
  });
}

function askUninstall(): void {
  confirm.require({
    header: t('Retirer le service ?'),
    message: t('FastBoard ne démarrera plus automatiquement. Les données ne sont pas touchées.'),
    icon: 'pi pi-trash',
    acceptLabel: t('Retirer'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: () => void act('uninstall'),
  });
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    notify('success', t('Copié'));
  } catch {
    notify('warn', t('Copie impossible'));
  }
}
</script>

<template>
  <div class="page service">
    <header>
      <h1 class="page-title">{{ $t('Installation') }}</h1>
      <p class="muted">{{ $t('Installez FastBoard comme service : il démarre tout seul avec la machine (ou votre session) et se relance s\'il s\'arrête.') }}</p>
    </header>

    <Skeleton v-if="loading" height="10rem" />

    <template v-else-if="status">
      <section class="card state">
        <i class="pi pi-server state-icon" :class="{ on: status.installed }"></i>
        <div class="grow">
          <h2 class="state-title">
            {{ status.installed ? $t('Service installé') : $t('Service non installé') }}
            <Tag v-if="status.installed && status.installedScope" :value="status.installedScope === 'system' ? $t('Démarrage de la machine') : $t('Ouverture de session')" severity="info" />
            <Tag v-if="status.state" :value="status.state" severity="secondary" />
            <Tag v-if="status.supervised" :value="$t('Ce serveur tourne sous le service')" severity="success" />
          </h2>
          <p class="muted small">{{ PLATFORM_LABELS[status.platform] }} · <code>{{ status.name }}</code></p>
        </div>
        <Button icon="pi pi-refresh" text rounded severity="secondary" :aria-label="$t('Actualiser')" @click="load" />
      </section>

      <Message v-if="!status.supported" severity="error" :closable="false">{{ $t('L\'installation en tant que service n\'est pas prise en charge sur ce système.') }}</Message>
      <Message v-for="warning in status.warnings" :key="warning" severity="warn" size="small" :closable="false">{{ translateServerMessage(warning) }}</Message>

      <section v-if="status.supported" class="card block">
        <h3 class="block-title">{{ $t('Démarrage automatique') }}</h3>
        <SelectButton v-model="scope" :options="scopeOptions" option-label="label" option-value="value" :allow-empty="false" :disabled="status.installed">
          <template #option="{ option }"><i :class="option.icon"></i> {{ option.label }}</template>
        </SelectButton>
        <p class="muted small">
          {{ scope === 'system' ? $t('Démarre avant toute connexion, sous le compte système : nécessite les droits administrateur.') : $t('Démarre quand vous ouvrez votre session, sans droits particuliers.') }}
        </p>
        <Message v-if="needsElevation" severity="info" size="small" :closable="false">{{ $t('FastBoard ne tourne pas avec les droits administrateur : lancez les commandes ci-dessous dans un terminal administrateur, ou relancez FastBoard en administrateur.') }}</Message>

        <div class="actions">
          <Button v-if="!status.installed" :label="$t('Installer le service')" icon="pi pi-download" :loading="busy === 'install'" :disabled="busy !== null" @click="act('install')" />
          <template v-else>
            <Button :label="$t('Démarrer')" icon="pi pi-play" severity="secondary" :loading="busy === 'start'" :disabled="busy !== null" @click="act('start')" />
            <Button :label="$t('Arrêter')" icon="pi pi-stop" severity="secondary" :loading="busy === 'stop'" :disabled="busy !== null" @click="askStop" />
            <Button :label="$t('Retirer le service')" icon="pi pi-trash" severity="danger" outlined :loading="busy === 'uninstall'" :disabled="busy !== null" @click="askUninstall" />
          </template>
        </div>

        <pre v-if="lastResult?.output" class="output" :class="{ failed: !lastResult.ok }">{{ lastResult.output }}</pre>
      </section>

      <section class="card block">
        <h3 class="block-title">{{ $t('Configuration reprise par le service') }}</h3>
        <dl class="facts">
          <div><dt>{{ $t('Programme') }}</dt><dd><code>{{ status.command }}</code></dd></div>
          <div><dt>{{ $t('Journal du service') }}</dt><dd><code>{{ status.logFile }}</code></dd></div>
          <div v-for="(value, key) in status.env" :key="key"><dt>{{ key }}</dt><dd><code>{{ value }}</code></dd></div>
        </dl>
      </section>

      <section v-if="plan" class="card block">
        <button type="button" class="toggle" @click="showDetails = !showDetails">
          <i class="pi" :class="showDetails ? 'pi-chevron-down' : 'pi-chevron-right'"></i>
          {{ $t('Installation manuelle : fichiers et commandes') }}
        </button>
        <template v-if="showDetails">
          <div v-for="file in plan.files" :key="file.path" class="file">
            <div class="file-head"><code>{{ file.path }}</code><Button icon="pi pi-copy" text rounded size="small" :aria-label="$t('Copier')" @click="copy(file.content)" /></div>
            <pre class="output">{{ file.content }}</pre>
          </div>
          <div v-for="[label, commands] in ([[$t('Installer'), plan.install], [$t('Démarrer'), plan.start], [$t('Arrêter'), plan.stop], [$t('Retirer'), plan.uninstall]] as Array<[string, string[]]>)" :key="label" class="file">
            <div class="file-head"><strong>{{ label }}</strong><Button icon="pi pi-copy" text rounded size="small" :aria-label="$t('Copier')" @click="copy(commands.join('\n'))" /></div>
            <pre class="output">{{ commands.join('\n') }}</pre>
          </div>
        </template>
      </section>
    </template>
  </div>
</template>

<style scoped>
.service {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
header p {
  margin: 0.25rem 0 0;
}
.state {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.2rem;
}
.state-icon {
  display: grid;
  place-items: center;
  width: 2.8rem;
  height: 2.8rem;
  border-radius: 12px;
  background: var(--fb-panel-alt);
  color: var(--fb-muted);
  font-size: 1.2rem;
}
.state-icon.on {
  background: color-mix(in srgb, #22c55e 18%, transparent);
  color: #16a34a;
}
.state-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0;
  font-size: 1.05rem;
}
.state p {
  margin: 0.2rem 0 0;
}
.block {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 1.2rem;
}
.block-title {
  margin: 0;
  font-size: 1rem;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.output {
  margin: 0;
  padding: 0.75rem;
  max-height: 22rem;
  overflow: auto;
  border-radius: 8px;
  background: var(--fb-panel-alt);
  font-size: 0.78rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.output.failed {
  border-left: 3px solid var(--fb-danger);
}
.facts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 0.35rem 1rem;
  margin: 0;
}
.facts div {
  display: contents;
}
.facts dt {
  color: var(--fb-muted);
  font-size: 0.8rem;
}
.facts dd {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 0.8rem;
}
.toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0;
  border: 0;
  background: none;
  color: var(--fb-text);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.file {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.file-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.8rem;
}
</style>
