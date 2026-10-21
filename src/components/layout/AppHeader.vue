<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Menu from 'primevue/menu';
import type { MenuItem } from 'primevue/menuitem';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { APP_VERSION } from '@shared/changelog';
import ChangelogDialog from './ChangelogDialog.vue';
import ConnectionBadge from './ConnectionBadge.vue';
import GlobalSearch from './GlobalSearch.vue';
import NotificationBell from './NotificationBell.vue';
import AiButton from '@/components/ai/AiButton.vue';
import { useAppStore } from '@/stores/app';
import { useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';

import { t } from '@/i18n';
const auth = useAuthStore();
const ui = useUiStore();
const router = useRouter();
const route = useRoute();
const onProjects = computed(() => route.path === '/' || route.path.startsWith('/p/'));
const menu = ref<InstanceType<typeof Menu> | null>(null);
const changelogOpen = ref(false);
const app = useAppStore();

const items = computed<MenuItem[]>(() => [
  { label: auth.user?.email ?? '', disabled: true, class: 'menu-email' },
  { separator: true },
  { label: t('Mon profil'), icon: 'pi pi-user', command: () => ui.openProfile('profile') },
  { label: t('Mon activité'), icon: 'pi pi-chart-bar', command: () => auth.user && void router.push({ name: 'user', params: { id: auth.user.id } }) },
  { label: t('Apparence et thème'), icon: 'pi pi-palette', command: () => ui.openProfile('appearance') },
  { label: t('Sécurité'), icon: 'pi pi-lock', command: () => ui.openProfile('security') },
  { label: t('Jetons d\'API'), icon: 'pi pi-key', command: () => ui.openProfile('tokens') },
  ...(auth.canAdmin ? [{ separator: true }, { label: t('Administration'), icon: 'pi pi-cog', command: () => void router.push({ name: 'admin' }) }] : []),
  { separator: true },
  {
    label: t('Se déconnecter'),
    icon: 'pi pi-sign-out',
    command: async () => {
      await auth.logout();
      await router.replace({ name: 'login' });
    },
  },
]);

function toggle(event: Event): void {
  menu.value?.toggle(event);
}
</script>

<template>
  <header class="app-header">
    <div class="brand">
      <router-link to="/" class="brand-link" :aria-label="`${app.name} — ${$t('Projets')}`">
        <img :src="app.logoUrl" alt="" width="28" height="28" class="logo" />
      </router-link>
      <div class="brand-text">
        <router-link to="/" class="brand-name" tabindex="-1">{{ app.name }}</router-link>
        <button type="button" class="version-chip" :aria-label="$t('Version {version} : voir les nouveautés', { version: APP_VERSION })" @click="changelogOpen = true">v{{ APP_VERSION }}</button>
      </div>
    </div>
    <ChangelogDialog v-model:visible="changelogOpen" />

    <nav class="nav" :aria-label="$t('Navigation principale')">
      <router-link to="/" class="nav-link" :class="{ active: onProjects }">
        <i class="pi pi-th-large"></i><span>{{ $t('Projets') }}</span>
      </router-link>
      <router-link v-if="auth.canAdmin" :to="{ name: 'admin' }" class="nav-link" active-class="active">
        <i class="pi pi-cog"></i><span>{{ $t('Administration') }}</span>
      </router-link>
    </nav>

    <div class="spacer"></div>
    <GlobalSearch />
    <AiButton v-if="app.info.ai && auth.can('ai.use')" />
    <NotificationBell />
    <ConnectionBadge />

    <button class="user-button" type="button" aria-haspopup="true" :aria-label="$t('Menu du compte')" @click="toggle">
      <UserAvatar :user="auth.user" />
      <span class="user-name truncate">{{ auth.user?.name }}</span>
      <i class="pi pi-chevron-down chevron"></i>
    </button>
    <Menu ref="menu" :model="items" popup />
  </header>
</template>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  height: var(--fb-header-h);
  flex: none;
  padding: 0 1rem;
  background: var(--fb-panel);
  border-bottom: 1px solid var(--fb-border);
  z-index: 20;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
}
.brand-link {
  display: inline-flex;
}
.logo {
  object-fit: contain;
  border-radius: 6px;
}
.brand-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.05rem;
  line-height: 1.1;
}
.brand-name {
  color: var(--fb-text);
  font-weight: 800;
  font-size: 1.1rem;
  letter-spacing: -0.02em;
}
.version-chip {
  padding: 0 0.4rem;
  border: 1px solid color-mix(in srgb, var(--fb-accent) 40%, transparent);
  border-radius: 999px;
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
  font: inherit;
  font-size: 0.62rem;
  font-weight: 700;
  line-height: 1.5;
  cursor: pointer;
}
.version-chip:hover,
.version-chip:focus-visible {
  background: var(--fb-accent);
  color: #fff;
  outline: none;
}
.nav {
  display: flex;
  gap: 0.25rem;
  margin-left: 0.5rem;
}
.nav-link {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.4rem 0.75rem;
  border-radius: 8px;
  color: var(--fb-muted);
  font-weight: 600;
  font-size: 0.9rem;
}
.nav-link:hover {
  background: var(--fb-panel-alt);
  color: var(--fb-text);
}
.nav-link.active {
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
}
.spacer {
  flex: 1;
}
.user-button {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  max-width: 14rem;
  padding: 0.25rem 0.5rem 0.25rem 0.3rem;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--fb-text);
  cursor: pointer;
}
.user-button:hover,
.user-button:focus-visible {
  background: var(--fb-panel-alt);
  border-color: var(--fb-border);
}
.user-name {
  font-weight: 600;
  font-size: 0.9rem;
}
.chevron {
  font-size: 0.7rem;
  color: var(--fb-muted);
}
@media (max-width: 720px) {
  .brand-text,
  .user-name,
  .chevron,
  .nav-link span {
    display: none;
  }
  .app-header {
    gap: 0.5rem;
  }
}
</style>
