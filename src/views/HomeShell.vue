<script setup lang="ts">
import HomeTabs from '@/components/layout/HomeTabs.vue';

/**
 * Cadre de l'Accueil : une barre en haut, les onglets « Accueil » et « Mon tableau » toujours au même endroit (en haut
 * à gauche), et à droite les actions de l'onglet ouvert (déposées dans \`#home-shell-actions\`).
 */
</script>

<template>
  <div class="home-shell">
    <header class="shell-bar">
      <HomeTabs />
      <div id="home-shell-actions" class="shell-actions"></div>
    </header>
    <router-view />
  </div>
</template>

<style scoped>
.home-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* Onglets en haut à gauche, quelle que soit la hauteur des actions à leur droite (qui peuvent passer à la ligne). */
.shell-bar {
  display: flex;
  flex: none;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 0.6rem 1.25rem;
  min-height: 3.2rem;
  padding: 0.55rem 1rem;
  background: var(--fb-panel);
  border-bottom: 1px solid var(--fb-border);
}
.shell-actions {
  display: flex;
  flex: 1;
  align-items: center;
  min-height: 2.3rem;
  flex-wrap: wrap;
  gap: 0.6rem 1.25rem;
  min-width: 0;
}
</style>
