<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import ToggleSwitch from 'primevue/toggleswitch';
import type { NotificationLevel } from '@shared/constants';
import { useNotificationsStore } from '@/stores/notifications';
import { useBrowserNotifications } from '@/utils/browserNotifications';
import { notificationLevelOptions } from '@/utils/notificationText';
import { notify, notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Onglet « Notifications » du compte : notifications du navigateur (ce navigateur) et niveau de chaque projet. */
const store = useNotificationsStore();
const { support, permission, enabled, enable, disable, refresh, test } = useBrowserNotifications();
const levels = notificationLevelOptions();
const loading = ref(false);
const asking = ref(false);
const filter = ref('');

onMounted(async () => {
  refresh();
  loading.value = true;
  try {
    await store.loadSettings();
  } catch (error) {
    notifyError(error);
  } finally {
    loading.value = false;
  }
});

const shown = computed(() => {
  const query = filter.value.trim().toLowerCase();
  if (!query) return store.settings;
  return store.settings.filter((setting) => setting.projectName.toLowerCase().includes(query) || setting.projectKey.toLowerCase().includes(query));
});

function option(level: NotificationLevel) {
  return levels.find((entry) => entry.value === level) ?? levels[1]!;
}

async function toggleBrowser(on: boolean): Promise<void> {
  if (!on) {
    disable();
    return;
  }
  asking.value = true;
  try {
    const answer = await enable();
    if (answer === 'granted') notify('success', t('Notifications du navigateur activées'));
    else if (answer === 'denied') notify('warn', t('Notifications bloquées'), t('Le navigateur refuse les notifications pour ce site.'));
    else notify('info', t('Autorisation non accordée'), t('Le navigateur attend votre réponse : réessayez et choisissez « Autoriser ».'));
  } catch (error) {
    notifyError(error);
  } finally {
    asking.value = false;
  }
}

async function choose(projectId: number, level: NotificationLevel): Promise<void> {
  try {
    await store.setLevel(projectId, level);
  } catch (error) {
    notifyError(error, t('Réglage non enregistré'));
  }
}
</script>

<template>
  <div class="notification-settings">
    <section class="block">
      <h4 class="title"><i class="pi pi-desktop"></i> {{ $t('Notifications du navigateur') }}</h4>
      <p class="muted small">
        {{ $t('Une notification système s’affiche quand une notification arrive alors que l’application n’est pas au premier plan ; un clic ouvre le ticket ou la note. Réglage propre à ce navigateur.') }}
      </p>
      <Message v-if="support === 'unsupported'" severity="warn" :closable="false">{{ $t('Ce navigateur n’affiche pas de notifications système.') }}</Message>
      <Message v-else-if="support === 'insecure'" severity="info" :closable="false">
        {{ $t('Les notifications du navigateur exigent une adresse sécurisée (HTTPS, ou localhost sur votre poste). Demandez à un administrateur d’activer HTTPS.') }}
      </Message>
      <template v-else>
        <Message v-if="permission === 'denied'" severity="warn" :closable="false">
          {{ $t('Les notifications sont bloquées pour ce site. Autorisez-les dans les réglages du site (icône à gauche de l’adresse), puis rechargez la page.') }}
        </Message>
        <div class="toggle-row">
          <ToggleSwitch input-id="browser-notifications" :model-value="enabled" :disabled="asking || permission === 'denied'" @update:model-value="toggleBrowser" />
          <label for="browser-notifications">{{ $t('Afficher les notifications dans le système') }}</label>
          <Button v-if="enabled" :label="$t('Essayer')" icon="pi pi-send" size="small" text @click="test" />
        </div>
      </template>
    </section>

    <section class="block">
      <h4 class="title"><i class="pi pi-bell"></i> {{ $t('Notifications par projet') }}</h4>
      <p class="muted small">{{ $t('Choisissez, pour chaque projet, ce qui vous est notifié. Par défaut : « Ma participation ». Les mentions dans la documentation sont toujours notifiées.') }}</p>
      <ul class="legend">
        <li v-for="entry in levels" :key="entry.value">
          <i :class="entry.icon"></i>
          <span><strong>{{ entry.label }}</strong> — <span class="muted">{{ entry.hint }}</span></span>
        </li>
      </ul>
      <InputText v-if="store.settings.length > 8" v-model="filter" :placeholder="$t('Filtrer les projets')" size="small" class="filter" />
      <p v-if="loading && !store.settingsLoaded" class="muted small">{{ $t('Chargement…') }}</p>
      <p v-else-if="!store.settings.length" class="muted small">{{ $t('Vous ne voyez encore aucun projet.') }}</p>
      <ul v-else class="projects">
        <li v-for="setting in shown" :key="setting.projectId" class="project" :class="{ archived: setting.archived }">
          <span class="key">{{ setting.projectKey }}</span>
          <span class="name truncate" :title="setting.projectName">{{ setting.projectName }}</span>
          <span v-if="setting.archived" class="muted small archived-tag"><i class="pi pi-lock"></i> {{ $t('Archivé') }}</span>
          <Select
            :model-value="setting.level"
            :options="levels"
            option-label="label"
            option-value="value"
            size="small"
            class="level"
            :aria-label="$t('Notifications du projet {name}', { name: setting.projectName })"
            @update:model-value="(value: NotificationLevel) => choose(setting.projectId, value)"
          >
            <template #value="{ value }">
              <span class="row"><i :class="option(value).icon"></i> {{ option(value).label }}</span>
            </template>
            <template #option="{ option: entry }">
              <span class="row"><i :class="entry.icon"></i> {{ entry.label }}</span>
            </template>
          </Select>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.notification-settings {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}
.block {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.5rem;
}
.title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-size: 0.95rem;
}
.block > p {
  margin: 0;
}
.toggle-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
}
.toggle-row label {
  cursor: pointer;
}
.legend {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin: 0;
  padding: 0;
  font-size: 0.85rem;
  list-style: none;
}
.legend li {
  display: flex;
  align-items: baseline;
  gap: 0.45rem;
}
.legend i {
  color: var(--fb-accent);
}
.filter {
  max-width: 18rem;
}
.projects {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  border: 1px solid var(--fb-border);
  border-radius: var(--fb-radius);
  list-style: none;
}
.project {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
  padding: 0.45rem 0.6rem;
}
.project + .project {
  border-top: 1px solid var(--fb-border);
}
.project.archived .name,
.project.archived .key {
  opacity: 0.65;
}
.key {
  flex: none;
  color: var(--fb-accent);
  font-size: 0.78rem;
  font-weight: 700;
}
.name {
  flex: 1;
}
.archived-tag {
  flex: none;
}
.level {
  flex: none;
  width: 13rem;
}
@media (max-width: 600px) {
  .project {
    flex-wrap: wrap;
  }
  .level {
    width: 100%;
  }
}
</style>
