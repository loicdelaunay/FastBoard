<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';

/**
 * Page web dans un onglet de la documentation, comme le « Web viewer » d'Obsidian : un lien d'une note s'y ouvre au
 * clic (Ctrl clic l'ouvre dans le navigateur). La page est isolée : elle ne peut ni lire FastBoard ni le quitter. Beaucoup
 * de sites refusent d'être affichés dans une autre page : le bouton « Ouvrir dans le navigateur » reste alors à portée.
 */
const props = defineProps<{ url: string }>();

const loading = ref(true);
/** Rechargement : une nouvelle clé recrée le cadre. */
const reloads = ref(0);
const host = computed(() => {
  try {
    return new URL(props.url).host;
  } catch {
    return props.url;
  }
});

watch(
  () => props.url,
  () => {
    loading.value = true;
  },
);

function reload(): void {
  loading.value = true;
  reloads.value += 1;
}

function openExternal(): void {
  window.open(props.url, '_blank', 'noopener');
}
</script>

<template>
  <div class="web-view">
    <header class="web-bar">
      <Button v-tooltip.bottom="$t('Recharger')" icon="pi pi-refresh" text rounded size="small" severity="secondary" :aria-label="$t('Recharger')" @click="reload" />
      <div class="address" :title="url">
        <i :class="loading ? 'pi pi-spin pi-spinner' : 'pi pi-globe'" aria-hidden="true"></i>
        <span class="truncate">{{ url }}</span>
      </div>
      <Button :label="$t('Ouvrir dans le navigateur')" icon="pi pi-external-link" text size="small" @click="openExternal" />
    </header>
    <p class="hint muted small">{{ $t('Page vide ? {host} refuse peut-être d’être affiché ici : ouvrez-le dans le navigateur (ou Ctrl clic sur le lien).', { host }) }}</p>
    <iframe
      :key="`${url}-${reloads}`"
      class="frame"
      :src="url"
      :title="host"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
      referrerpolicy="no-referrer"
      @load="loading = false"
    ></iframe>
  </div>
</template>

<style scoped>
.web-view {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.web-bar {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.6rem;
  border-bottom: 1px solid var(--fb-border);
}
.address {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
  padding: 0.3rem 0.7rem;
  border: 1px solid var(--fb-border);
  border-radius: 999px;
  background: var(--fb-bg);
  color: var(--fb-text);
  font-size: 0.82rem;
}
.address i {
  color: var(--fb-muted);
  font-size: 0.8rem;
}
.hint {
  margin: 0;
  padding: 0.25rem 0.9rem;
  border-bottom: 1px solid var(--fb-border);
}
.frame {
  flex: 1;
  width: 100%;
  min-height: 0;
  border: 0;
  background: #fff;
}
</style>
