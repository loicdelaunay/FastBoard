<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import Button from 'primevue/button';
import DatePicker from 'primevue/datepicker';
import InputText from 'primevue/inputtext';
import SelectButton from 'primevue/selectbutton';
import Textarea from 'primevue/textarea';
import ToggleSwitch from 'primevue/toggleswitch';
import type { MaintenanceLevel } from '@shared/types';
import { api } from '@/api';
import { useAppStore } from '@/stores/app';
import { formatDateTime } from '@/utils/format';
import { notify, notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Message de maintenance affiché en bandeau à tous les utilisateurs (y compris sur la page de connexion). */
const app = useAppStore();
const loading = ref(true);
const saving = ref(false);
const form = reactive({
  enabled: false,
  level: 'info' as MaintenanceLevel,
  title: '',
  message: '',
  startsAt: null as Date | null,
  endsAt: null as Date | null,
});
const updatedAt = ref<string | null>(null);

const levels = computed(() => [
  { value: 'info', label: t('Information'), icon: 'pi pi-info-circle' },
  { value: 'warning', label: t('Perturbations'), icon: 'pi pi-exclamation-triangle' },
  { value: 'danger', label: t('Interruption'), icon: 'pi pi-ban' },
]);
const help = computed(() =>
  form.level === 'info'
    ? t('Bandeau bleu, que chacun peut masquer : annonce d’une mise à jour, d’une nouveauté…')
    : form.level === 'warning'
      ? t('Bandeau orange, toujours visible : lenteurs ou maintenance en cours.')
      : t('Bandeau rouge, toujours visible : service interrompu ou sur le point de l’être.'),
);

onMounted(async () => {
  try {
    const { maintenance } = await api.adminMaintenance();
    Object.assign(form, {
      enabled: maintenance.enabled,
      level: maintenance.level,
      title: maintenance.title,
      message: maintenance.message,
      startsAt: maintenance.startsAt ? new Date(maintenance.startsAt) : null,
      endsAt: maintenance.endsAt ? new Date(maintenance.endsAt) : null,
    });
    updatedAt.value = maintenance.updatedAt;
  } catch (error) {
    notifyError(error, t('Maintenance indisponible'));
  } finally {
    loading.value = false;
  }
});

const datesValid = computed(() => !form.startsAt || !form.endsAt || form.startsAt < form.endsAt);

async function save(enabled = form.enabled): Promise<void> {
  saving.value = true;
  try {
    const result = await api.adminSetMaintenance({
      enabled,
      level: form.level,
      title: form.title,
      message: form.message,
      startsAt: form.startsAt ? form.startsAt.toISOString() : null,
      endsAt: form.endsAt ? form.endsAt.toISOString() : null,
    });
    form.enabled = enabled;
    updatedAt.value = result.maintenance.updatedAt;
    app.set(result.app);
    notify('success', enabled ? t('Message affiché à tous les utilisateurs') : t('Message retiré'));
  } catch (error) {
    notifyError(error, t('Message non enregistré'));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="page maintenance">
    <header>
      <h1 class="page-title">{{ $t('Maintenance') }}</h1>
      <p class="muted">{{ $t('Affichez un message à tous les utilisateurs connectés, en direct, et sur la page de connexion.') }}</p>
    </header>

    <form v-if="!loading" class="card block" @submit.prevent="save()">
      <label class="row master">
        <ToggleSwitch v-model="form.enabled" />
        <strong>{{ form.enabled ? $t('Message affiché') : $t('Aucun message affiché') }}</strong>
        <span v-if="updatedAt" class="muted small">· {{ $t('modifié le {date}', { date: formatDateTime(updatedAt) }) }}</span>
      </label>

      <div class="field">
        <span class="label">{{ $t('Niveau') }}</span>
        <SelectButton v-model="form.level" :options="levels" option-label="label" option-value="value" :allow-empty="false">
          <template #option="{ option }"><i :class="option.icon"></i> {{ option.label }}</template>
        </SelectButton>
        <small class="muted">{{ help }}</small>
      </div>
      <div class="field">
        <label for="mt-title" class="label">{{ $t('Titre') }}</label>
        <InputText id="mt-title" v-model="form.title" maxlength="120" :placeholder="$t('ex. Maintenance programmée')" fluid />
      </div>
      <div class="field">
        <label for="mt-message" class="label">{{ $t('Message') }}</label>
        <Textarea id="mt-message" v-model="form.message" rows="3" auto-resize maxlength="2000" :placeholder="$t('ex. FastBoard sera indisponible quelques minutes pour une mise à jour.')" fluid />
      </div>
      <div class="dates">
        <label class="field">
          <span class="label">{{ $t('Début (facultatif)') }}</span>
          <DatePicker v-model="form.startsAt" show-time hour-format="24" show-icon show-button-bar icon-display="input" :placeholder="$t('Maintenant')" />
        </label>
        <label class="field">
          <span class="label">{{ $t('Fin (facultatif)') }}</span>
          <DatePicker v-model="form.endsAt" show-time hour-format="24" show-icon show-button-bar icon-display="input" :min-date="form.startsAt ?? undefined" :placeholder="$t('Jusqu’à désactivation')" :invalid="!datesValid" />
        </label>
      </div>
      <small class="muted">{{ $t('Avant le début, le bandeau annonce la maintenance (« prévue ») ; après la fin, il disparaît tout seul.') }}</small>

      <div class="preview">
        <span class="label">{{ $t('Aperçu') }}</span>
        <div class="banner" :class="form.level">
          <i :class="levels.find((level) => level.value === form.level)?.icon"></i>
          <strong>{{ form.title || levels.find((level) => level.value === form.level)?.label }}</strong>
          <span>{{ form.message }}</span>
        </div>
      </div>

      <div class="actions">
        <Button v-if="form.enabled" type="button" :label="$t('Retirer le message')" icon="pi pi-eye-slash" severity="secondary" outlined :loading="saving" @click="save(false)" />
        <Button type="submit" :label="form.enabled ? $t('Enregistrer et afficher') : $t('Enregistrer')" icon="pi pi-check" :loading="saving" :disabled="!datesValid || (form.enabled && !form.title.trim() && !form.message.trim())" />
      </div>
    </form>
  </div>
</template>

<style scoped>
.maintenance {
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
.master {
  gap: 0.6rem;
  cursor: pointer;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.label {
  font-weight: 600;
  font-size: 0.88rem;
}
.dates {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: 0.75rem;
}
.preview {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.banner {
  --tone: #3b82f6;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.5rem 0.9rem;
  border-radius: 8px;
  background: color-mix(in srgb, var(--tone) 16%, var(--fb-panel));
  border: 1px solid color-mix(in srgb, var(--tone) 45%, transparent);
  font-size: 0.88rem;
}
.banner i {
  color: var(--tone);
}
.banner.warning {
  --tone: #f59e0b;
}
.banner.danger {
  --tone: #ef4444;
  background: color-mix(in srgb, var(--tone) 85%, #000);
  color: #fff;
}
.banner.danger i {
  color: #fff;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
