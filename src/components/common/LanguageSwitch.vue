<script setup lang="ts">
import { LOCALES, LOCALE_META, type Locale } from '@shared/locales';
import { currentLocale, rememberLocale } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import { notifyError } from '@/utils/notify';

defineProps<{ compact?: boolean }>();

const auth = useAuthStore();
const active = currentLocale();

/** Mémorise la langue (appareil et, si l'on est connecté, compte) puis recharge : les textes sont lus au chargement. */
async function choose(locale: Locale): Promise<void> {
  if (locale === active) {
    return;
  }
  try {
    if (auth.isAuthenticated) {
      await auth.updateProfile({ locale });
    }
    rememberLocale(locale);
    window.location.reload();
  } catch (error) {
    notifyError(error);
  }
}
</script>

<template>
  <div class="lang" role="group" :aria-label="$t('Langue')" :class="{ compact }">
    <button
      v-for="locale in LOCALES"
      :key="locale"
      type="button"
      class="option"
      :class="{ active: locale === active }"
      :aria-pressed="locale === active"
      :lang="locale"
      @click="choose(locale)"
    >
      {{ LOCALE_META[locale].label }}
    </button>
  </div>
</template>

<style scoped>
.lang {
  display: inline-flex;
  padding: 0.2rem;
  border: 1px solid var(--fb-border);
  border-radius: 999px;
  background: var(--fb-panel);
}
.option {
  padding: 0.3rem 0.9rem;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--fb-muted);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}
.option:hover {
  color: var(--fb-text);
}
.option.active {
  background: var(--fb-accent);
  color: #fff;
}
.compact .option {
  padding: 0.2rem 0.65rem;
  font-size: 0.78rem;
}
</style>
