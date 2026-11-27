<script setup lang="ts">
import { useRoute } from 'vue-router';

/** Onglets de l'Accueil : la page d'accueil, et « Mon tableau » (mes tickets de tous mes projets, vus comme un projet). */
const route = useRoute();
</script>

<template>
  <nav class="home-tabs" :aria-label="$t('Accueil')">
    <router-link :to="{ name: 'home' }" class="tab" :class="{ active: route.name === 'home' }">
      <i class="pi pi-home"></i><span>{{ $t('Accueil') }}</span>
    </router-link>
    <router-link :to="{ name: 'my-board' }" class="tab" :class="{ active: route.path.startsWith('/accueil/tableau') }">
      <i class="pi pi-id-card"></i><span>{{ $t('Mon tableau') }}</span>
    </router-link>
  </nav>
</template>

<style scoped>
.home-tabs {
  display: inline-flex;
  gap: 0.25rem;
  padding: 0.2rem;
  border-radius: 10px;
  background: var(--fb-panel-alt);
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.35rem 0.85rem;
  border-radius: 8px;
  color: var(--fb-muted);
  font-size: 0.9rem;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}
.tab:hover {
  color: var(--fb-text);
}
.tab.active {
  background: var(--fb-panel);
  color: var(--fb-accent);
  box-shadow: var(--fb-shadow);
}
</style>
