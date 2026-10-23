<script setup lang="ts">
import Toast from 'primevue/toast';
import ConfirmDialog from 'primevue/confirmdialog';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import AppHeader from '@/components/layout/AppHeader.vue';
import ProfileDialog from '@/components/profile/ProfileDialog.vue';
import MaintenanceBanner from '@/components/layout/MaintenanceBanner.vue';
import AiPanel from '@/components/ai/AiPanel.vue';
import { useAppStore } from '@/stores/app';

const auth = useAuthStore();
const app = useAppStore();
const route = useRoute();
</script>

<template>
  <div class="app-root">
    <MaintenanceBanner />
    <AppHeader v-if="auth.isAuthenticated" />
    <main class="app-main">
      <router-view />
    </main>
    <ProfileDialog v-if="auth.isAuthenticated" />
    <!-- La page dédiée de l'assistant affiche sa propre conversation : pas de panneau latéral en plus. -->
    <AiPanel v-if="auth.isAuthenticated && app.info.ai && auth.can('ai.use') && route.name !== 'assistant'" />
    <Toast position="bottom-right" />
    <ConfirmDialog />
  </div>
</template>

<style scoped>
.app-root {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  min-height: 0;
}
.app-main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: auto;
}
</style>
