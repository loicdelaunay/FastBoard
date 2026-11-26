<script setup lang="ts">
import { computed } from 'vue';
import Toast from 'primevue/toast';
import ConfirmDialog from 'primevue/confirmdialog';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import AppSidebar from '@/components/layout/AppSidebar.vue';
import SearchPalette from '@/components/layout/SearchPalette.vue';
import ProfileDialog from '@/components/profile/ProfileDialog.vue';
import MaintenanceBanner from '@/components/layout/MaintenanceBanner.vue';
import OfflineBanner from '@/components/layout/OfflineBanner.vue';
import HoverPreviews from '@/components/layout/HoverPreviews.vue';
import UpdatePrompt from '@/components/layout/UpdatePrompt.vue';
import OfflineScreen from '@/components/layout/OfflineScreen.vue';
import AiPanel from '@/components/ai/AiPanel.vue';
import { useAppStore } from '@/stores/app';

const auth = useAuthStore();
const app = useAppStore();
const route = useRoute();
/** Pages autonomes (site web d'un espace) : sans la navigation de l'application. */
const shell = computed(() => auth.isAuthenticated && !route.meta.bare);
</script>

<template>
  <div class="app-root">
    <MaintenanceBanner v-if="!route.meta.bare" />
    <OfflineBanner v-if="auth.isAuthenticated && !route.meta.bare" />
    <div class="app-body">
      <AppSidebar v-if="shell" />
      <main class="app-main">
        <!-- Ouverte sans réseau, la session n'a pas pu être vérifiée : on le dit plutôt que de demander de se reconnecter. -->
        <OfflineScreen v-if="auth.offline && !auth.isAuthenticated && !route.meta.public" />
        <router-view v-else />
      </main>
    </div>
    <template v-if="shell">
      <SearchPalette />
      <ProfileDialog />
      <!-- La page dédiée de l'assistant affiche sa propre conversation : pas de panneau latéral en plus. -->
      <AiPanel v-if="app.info.ai && auth.can('ai.use') && route.name !== 'assistant'" />
      <HoverPreviews />
    </template>
    <UpdatePrompt />
    <Toast position="bottom-right" :base-z-index="1250" />
    <!-- Un long message de confirmation se lit sur plusieurs lignes, pas sur toute la largeur de l'écran. -->
    <ConfirmDialog :style="{ maxWidth: 'min(36rem, calc(100vw - 2rem))' }" />
  </div>
</template>

<style scoped>
.app-root {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  min-height: 0;
}
.app-body {
  display: flex;
  flex: 1;
  min-height: 0;
}
.app-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: auto;
}
</style>
