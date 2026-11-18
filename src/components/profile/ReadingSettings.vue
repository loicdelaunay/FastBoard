<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ReadingWidth } from '@shared/themes';
import { useAuthStore } from '@/stores/auth';
import { readingWidth } from '@/theme/themeManager';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Largeur du texte des notes : centré sur l'écran, centré dans sa colonne, ou sur toute la largeur (sans marges). */
const auth = useAuthStore();
const saving = ref(false);

const options = computed<Array<{ value: ReadingWidth; icon: string; label: string; hint: string }>>(() => [
  { value: 'screen', icon: 'pi pi-desktop', label: t('Centré sur l’écran'), hint: t('Le texte se place au milieu de l’écran, même avec l’arbre et le sommaire ouverts : on lit sans tourner la tête.') },
  { value: 'column', icon: 'pi pi-align-center', label: t('Centré dans sa colonne'), hint: t('Le texte se centre dans l’espace qui lui reste, à droite de l’arbre et du sommaire.') },
  { value: 'full', icon: 'pi pi-arrows-h', label: t('Toute la largeur'), hint: t('Sans marges sur les côtés : le texte prend toute la largeur disponible.') },
]);

async function choose(value: ReadingWidth): Promise<void> {
  const current = auth.user?.appearance;
  if (!current || current.reading === value) return;
  saving.value = true;
  try {
    await auth.updateProfile({ appearance: { ...current, reading: value } });
  } catch (error) {
    notifyError(error, t('Réglage non enregistré'));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section class="reading">
    <div class="head">
      <h4 class="title"><i class="pi pi-book"></i> {{ $t('Lecture des notes') }}</h4>
      <i v-if="saving" class="pi pi-spin pi-spinner muted"></i>
    </div>
    <div class="choices" role="radiogroup" :aria-label="$t('Lecture des notes')">
      <button v-for="option in options" :key="option.value" type="button" role="radio" class="choice" :class="{ on: readingWidth === option.value }" :aria-checked="readingWidth === option.value" @click="choose(option.value)">
        <span class="choice-title"><i :class="option.icon"></i> {{ option.label }}</span>
        <span class="muted small">{{ option.hint }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.reading {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin-bottom: 1.25rem;
}
.head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.title {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--fb-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.choices {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  gap: 0.5rem;
}
.choice {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.6rem 0.7rem;
  border: 2px solid var(--fb-border);
  border-radius: 10px;
  background: var(--fb-panel);
  color: var(--fb-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.choice:hover {
  border-color: var(--fb-accent);
}
.choice.on {
  border-color: var(--fb-accent);
  box-shadow: 0 0 0 3px var(--fb-accent-soft);
}
.choice-title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-weight: 600;
  font-size: 0.88rem;
}
.choice-title .pi {
  color: var(--fb-accent);
}
</style>
