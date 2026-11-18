<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import Popover from 'primevue/popover';
import type { NotificationLevel } from '@shared/constants';
import { useNotificationsStore } from '@/stores/notifications';
import { useUiStore } from '@/stores/ui';
import { notificationLevelOptions } from '@/utils/notificationText';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** En-tête d'un projet : niveau de notification de la personne pour ce projet (« Tout », « Ma participation »…). */
const props = defineProps<{ projectId: number }>();
const store = useNotificationsStore();
const ui = useUiStore();
const panel = ref<InstanceType<typeof Popover> | null>(null);
const options = notificationLevelOptions();
const level = computed(() => store.levelOf(props.projectId));
const current = computed(() => options.find((option) => option.value === level.value) ?? options[1]!);

onMounted(() => {
  if (!store.settingsLoaded) store.loadSettings().catch(() => undefined);
});

async function choose(value: NotificationLevel): Promise<void> {
  panel.value?.hide();
  if (value === level.value) return;
  try {
    await store.setLevel(props.projectId, value);
  } catch (error) {
    notifyError(error, t('Réglage non enregistré'));
  }
}

function openSettings(): void {
  panel.value?.hide();
  ui.openProfile('notifications');
}
</script>

<template>
  <Button
    v-tooltip.bottom="$t('Notifications de ce projet : {level}', { level: current.label })"
    :icon="current.icon"
    text
    rounded
    severity="secondary"
    :aria-label="$t('Notifications de ce projet : {level}', { level: current.label })"
    aria-haspopup="dialog"
    @click="panel?.toggle($event)"
  />
  <Popover ref="panel">
    <div class="levels">
      <strong class="head">{{ $t('Notifications de ce projet') }}</strong>
      <div role="radiogroup" :aria-label="$t('Notifications de ce projet')" class="options">
        <button
          v-for="option in options"
          :key="option.value"
          type="button"
          role="radio"
          :aria-checked="option.value === level"
          class="option"
          :class="{ active: option.value === level }"
          @click="choose(option.value)"
        >
          <i :class="option.icon" class="icon"></i>
          <span class="text">
            <span class="label">{{ option.label }}<span v-if="option.value === 'participating'" class="muted small"> · {{ $t('par défaut') }}</span></span>
            <span class="muted small">{{ option.hint }}</span>
          </span>
          <i v-if="option.value === level" class="pi pi-check check"></i>
        </button>
      </div>
      <Button :label="$t('Tous mes réglages de notification')" icon="pi pi-cog" text size="small" class="more" @click="openSettings" />
    </div>
  </Popover>
</template>

<style scoped>
.levels {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  width: min(22rem, 88vw);
}
.head {
  padding: 0 0.4rem 0.3rem;
  border-bottom: 1px solid var(--fb-border);
}
.options {
  display: flex;
  flex-direction: column;
}
.option {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  width: 100%;
  padding: 0.5rem 0.45rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--fb-text);
  font: inherit;
  font-size: 0.88rem;
  text-align: left;
  cursor: pointer;
}
.option:hover,
.option:focus-visible {
  background: var(--fb-panel-alt);
}
.option.active {
  background: color-mix(in srgb, var(--fb-accent) 9%, transparent);
}
.icon {
  flex: none;
  margin-top: 0.15rem;
  color: var(--fb-accent);
}
.text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}
.label {
  font-weight: 600;
}
.check {
  flex: none;
  margin-top: 0.15rem;
  color: var(--fb-accent);
}
.more {
  align-self: flex-start;
}
</style>
