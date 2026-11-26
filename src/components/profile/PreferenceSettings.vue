<script setup lang="ts">
import { ref } from 'vue';
import ToggleSwitch from 'primevue/toggleswitch';
import { useAuthStore } from '@/stores/auth';
import { spellcheck } from '@/theme/themeManager';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Préférences du compte : comment on écrit (correcteur orthographique du navigateur). */
const auth = useAuthStore();
const saving = ref(false);

async function setSpellcheck(enabled: boolean): Promise<void> {
  const current = auth.user?.appearance;
  if (!current || current.spellcheck === enabled) return;
  saving.value = true;
  try {
    await auth.updateProfile({ appearance: { ...current, spellcheck: enabled } });
  } catch (error) {
    notifyError(error, t('Réglage non enregistré'));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section class="preferences">
    <p class="muted small intro">{{ $t('Ces préférences sont enregistrées sur votre compte et vous suivent sur tous vos appareils.') }}</p>
    <h4 class="title"><i class="pi pi-pencil"></i> {{ $t('Écriture') }}</h4>
    <label class="option" for="pref-spellcheck">
      <ToggleSwitch input-id="pref-spellcheck" :model-value="spellcheck" :disabled="saving" @update:model-value="setSpellcheck" />
      <span class="text">
        <strong>{{ $t('Correcteur orthographique du navigateur') }}</strong>
        <span class="muted small">{{ $t('Souligne les fautes pendant que vous écrivez : notes, tickets, commentaires, tableaux blancs. Il utilise les dictionnaires de votre navigateur, dans les langues choisies dans ses réglages (plusieurs à la fois si besoin) ; FastBoard ne reçoit rien.') }}</span>
        <span class="muted small">{{ $t('Dans Chrome, la vérification « de base » reste sur votre appareil ; la vérification « avancée » envoie le texte à Google.') }}</span>
      </span>
      <i v-if="saving" class="pi pi-spin pi-spinner muted"></i>
    </label>
  </section>
</template>

<style scoped>
.preferences {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.intro {
  margin: 0 0 0.4rem;
}
.title {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0;
  font-size: 0.95rem;
}
.title .pi {
  color: var(--fb-accent);
}
.option {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem 0.85rem;
  border: 1px solid var(--fb-border);
  border-radius: 10px;
  background: var(--fb-panel);
  cursor: pointer;
}
.text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.25rem;
}
</style>
