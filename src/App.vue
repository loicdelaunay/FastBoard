<script setup lang="ts">
import Toast from 'primevue/toast';
import ConfirmDialog from 'primevue/confirmdialog';
import { useAuthStore } from '@/stores/auth';
import AppHeader from '@/components/layout/AppHeader.vue';
import ProfileDialog from '@/components/profile/ProfileDialog.vue';

const auth = useAuthStore();
</script>

<template>
  <div class="app-root">
    <AppHeader v-if="auth.isAuthenticated" />
    <main class="app-main">
      <router-view />
    </main>
    <ProfileDialog v-if="auth.isAuthenticated" />
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
