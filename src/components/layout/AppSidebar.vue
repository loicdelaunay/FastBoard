<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Menu from 'primevue/menu';
import type { MenuItem } from 'primevue/menuitem';
import { APP_VERSION } from '@shared/changelog';
import UserAvatar from '@/components/common/UserAvatar.vue';
import AiButton from '@/components/ai/AiButton.vue';
import ChangelogDialog from './ChangelogDialog.vue';
import InstallAppDialog from './InstallAppDialog.vue';
import ConnectionBadge from './ConnectionBadge.vue';
import NotificationBell from './NotificationBell.vue';
import { useAppStore } from '@/stores/app';
import { useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';
import { promptInstall, pwa } from '@/pwa/install';
import { notify } from '@/utils/notify';

import { t } from '@/i18n';
/**
 * Navigation de l'application, sur le côté : toute la hauteur reste au contenu. La recherche ouvre une palette au
 * centre de l'écran ; le compte est en bas. Repliée, la barre ne garde que les icônes.
 */
const auth = useAuthStore();
const ui = useUiStore();
const app = useAppStore();
const router = useRouter();
const route = useRoute();

const COLLAPSED_KEY = 'fb.sidebar.collapsed';
function storedCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}
const collapsed = ref(storedCollapsed());
function toggleCollapsed(): void {
  collapsed.value = !collapsed.value;
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed.value ? '1' : '0');
  } catch {
    // Stockage indisponible : le choix vaut pour cette page seulement.
  }
}

const onProjects = computed(() => route.path === '/' || route.path.startsWith('/p/'));
const changelogOpen = ref(false);
const menu = ref<InstanceType<typeof Menu> | null>(null);
const showAi = computed(() => app.info.ai && auth.can('ai.use') && route.name !== 'assistant');

const installOpen = ref(false);
async function install(): Promise<void> {
  if (pwa.canPrompt) {
    if (await promptInstall()) notify('success', t('Application installée'), t('Retrouvez-la sur votre bureau, votre écran d’accueil ou dans vos applications.'));
  } else {
    installOpen.value = true;
  }
}

const accountItems = computed<MenuItem[]>(() => [
  { label: auth.user?.email ?? '', disabled: true, class: 'menu-email' },
  { separator: true },
  { label: t('Mon profil'), icon: 'pi pi-user', command: () => ui.openProfile('profile') },
  { label: t('Mon activité'), icon: 'pi pi-chart-bar', command: () => auth.user && void router.push({ name: 'user', params: { id: auth.user.id } }) },
  { label: t('Apparence et thème'), icon: 'pi pi-palette', command: () => ui.openProfile('appearance') },
  { label: t('Préférences'), icon: 'pi pi-sliders-h', command: () => ui.openProfile('preferences') },
  { label: t('Sécurité'), icon: 'pi pi-lock', command: () => ui.openProfile('security') },
  { label: t('Jetons d\'API'), icon: 'pi pi-key', command: () => ui.openProfile('tokens') },
  { separator: true },
  { label: t('Nouveautés de la version {version}', { version: APP_VERSION }), icon: 'pi pi-sparkles', command: () => (changelogOpen.value = true) },
  // L'application installée s'ouvre dans sa propre fenêtre ; proposé tant qu'elle ne l'est pas et que le navigateur le permet.
  ...(!pwa.installed && (pwa.canPrompt || pwa.manual) ? [{ label: t('Installer l’application'), icon: 'pi pi-download', command: () => void install() }] : []),
  {
    label: t('Se déconnecter'),
    icon: 'pi pi-sign-out',
    command: async () => {
      await auth.logout();
      await router.replace({ name: 'login' });
    },
  },
]);
</script>

<template>
  <aside class="app-sidebar" :class="{ collapsed }" :aria-label="$t('Navigation principale')">
    <div class="brand">
      <router-link to="/" class="brand-link" :aria-label="`${app.name} — ${$t('Projets')}`">
        <img :src="app.logoUrl" alt="" width="28" height="28" class="logo" />
      </router-link>
      <div class="brand-text">
        <router-link to="/" class="brand-name truncate" tabindex="-1">{{ app.name }}</router-link>
        <button type="button" class="version-chip" :aria-label="$t('Version {version} : voir les nouveautés', { version: APP_VERSION })" @click="changelogOpen = true">v{{ APP_VERSION }}</button>
      </div>
      <button v-tooltip.right="collapsed ? $t('Déplier la barre') : $t('Replier la barre')" type="button" class="collapse" :aria-label="collapsed ? $t('Déplier la barre') : $t('Replier la barre')" :aria-expanded="!collapsed" @click="toggleCollapsed">
        <i :class="collapsed ? 'pi pi-angle-double-right' : 'pi pi-angle-double-left'"></i>
      </button>
    </div>

    <button v-tooltip.right="collapsed ? $t('Rechercher (Ctrl K)') : undefined" type="button" class="search" :aria-label="$t('Rechercher dans les projets, tickets, documents et utilisateurs')" @click="ui.searchOpen = true">
      <i class="pi pi-search"></i>
      <span class="label">{{ $t('Rechercher…') }}</span>
      <kbd class="label">Ctrl K</kbd>
    </button>

    <nav class="nav">
      <router-link v-tooltip.right="collapsed ? $t('Projets') : undefined" to="/" class="item" :class="{ active: onProjects }">
        <i class="pi pi-th-large module-icon projects"></i><span class="label">{{ $t('Projets') }}</span>
      </router-link>
      <router-link v-if="app.info.docs" v-tooltip.right="collapsed ? $t('Documentations') : undefined" :to="{ name: 'docs' }" class="item" active-class="active">
        <i class="pi pi-book module-icon docs"></i><span class="label">{{ $t('Documentations') }}</span>
      </router-link>
      <router-link v-if="app.info.boards" v-tooltip.right="collapsed ? $t('Tableaux blancs') : undefined" :to="{ name: 'boards' }" class="item" active-class="active">
        <i class="pi pi-objects-column module-icon boards"></i><span class="label">{{ $t('Tableaux blancs') }}</span>
      </router-link>
      <router-link v-tooltip.right="collapsed ? $t('Groupes') : undefined" :to="{ name: 'groups' }" class="item" active-class="active">
        <i class="pi pi-users module-icon groups"></i><span class="label">{{ $t('Groupes') }}</span>
      </router-link>
      <router-link v-if="auth.canAdmin" v-tooltip.right="collapsed ? $t('Administration') : undefined" :to="{ name: 'admin' }" class="item" active-class="active">
        <i class="pi pi-cog"></i><span class="label">{{ $t('Administration') }}</span>
      </router-link>
    </nav>

    <div class="spacer"></div>

    <div class="tools">
      <AiButton v-if="showAi" class="tool" :label="collapsed ? undefined : $t('Assistant IA')" />
      <NotificationBell class="tool" :label="collapsed ? undefined : $t('Notifications')" />
      <ConnectionBadge :compact="collapsed" />
    </div>

    <button v-tooltip.right="collapsed ? auth.user?.name : undefined" type="button" class="account" aria-haspopup="true" :aria-label="$t('Menu du compte')" @click="menu?.toggle($event)">
      <UserAvatar :user="auth.user" size="small" />
      <span class="label truncate">{{ auth.user?.name }}</span>
      <i class="label pi pi-chevron-up chevron"></i>
    </button>
    <Menu ref="menu" :model="accountItems" popup />
    <ChangelogDialog v-model:visible="changelogOpen" />
    <InstallAppDialog v-model:visible="installOpen" />
  </aside>
</template>

<style scoped>
.app-sidebar {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  width: 14rem;
  flex: none;
  padding: 0.6rem 0.5rem;
  border-right: 1px solid var(--fb-border);
  background: var(--fb-panel);
  overflow-x: hidden;
  overflow-y: auto;
  transition: width 0.15s ease;
  z-index: 20;
}
.app-sidebar.collapsed {
  width: 3.4rem;
  align-items: center;
}
.collapsed .label,
.collapsed .brand-text {
  display: none;
}
.brand {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-height: 2.4rem;
  padding: 0 0.15rem 0.4rem 0.3rem;
}
.collapsed .brand {
  flex-direction: column;
  gap: 0.4rem;
  padding: 0 0 0.4rem;
}
.brand-link {
  display: inline-flex;
  flex: none;
}
.logo {
  object-fit: contain;
  border-radius: 6px;
}
.brand-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
  line-height: 1.15;
}
.brand-name {
  max-width: 100%;
  color: var(--fb-text);
  font-weight: 800;
  font-size: 1.05rem;
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
.collapse {
  display: grid;
  place-items: center;
  width: 1.7rem;
  height: 1.7rem;
  flex: none;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--fb-muted);
  cursor: pointer;
}
.collapse:hover,
.collapse:focus-visible {
  background: var(--fb-panel-alt);
  color: var(--fb-text);
}
.search,
.item,
.account {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  min-height: 2.25rem;
  padding: 0.35rem 0.6rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--fb-muted);
  font: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.collapsed .search,
.collapsed .item,
.collapsed .account {
  justify-content: center;
  width: 2.4rem;
  padding: 0.35rem 0;
}
.search {
  margin-bottom: 0.35rem;
  border: 1px solid var(--fb-border);
  background: var(--fb-panel-alt);
  font-weight: 500;
}
.search .label:first-of-type {
  flex: 1;
}
.search kbd {
  padding: 0 0.35rem;
  border: 1px solid var(--fb-border);
  border-radius: 5px;
  font-family: inherit;
  font-size: 0.66rem;
}
.search:hover,
.search:focus-visible {
  border-color: var(--fb-accent);
  color: var(--fb-text);
}
.item:hover,
.item:focus-visible,
.account:hover,
.account:focus-visible {
  background: var(--fb-panel-alt);
  color: var(--fb-text);
}
.item.active {
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
}
.item .pi,
.search .pi {
  width: 1.1rem;
  text-align: center;
}
/* Chaque module garde sa couleur (celle de la barre de ses cartes), même sur l'entrée active. */
.item .module-icon.projects {
  color: var(--fb-module-projects);
}
.item .module-icon.docs {
  color: var(--fb-module-docs);
}
.item .module-icon.boards {
  color: var(--fb-module-boards);
}
.item .module-icon.groups {
  color: #14b8a6;
}
.nav {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  width: 100%;
}
.collapsed .nav {
  align-items: center;
}
.spacer {
  flex: 1;
}
.tools {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  width: 100%;
  padding-top: 0.4rem;
  border-top: 1px solid var(--fb-border);
}
.collapsed .tools {
  align-items: center;
}
.account {
  margin-top: 0.2rem;
  color: var(--fb-text);
}
.account .truncate {
  flex: 1;
  min-width: 0;
}
.chevron {
  font-size: 0.65rem;
  color: var(--fb-muted);
}
/* Sur un téléphone, la barre reste repliée : l'écran est pour le contenu. */
@media (max-width: 720px) {
  .app-sidebar {
    width: 3.4rem;
    align-items: center;
  }
  .app-sidebar .label,
  .app-sidebar .brand-text,
  .app-sidebar .collapse {
    display: none;
  }
  .app-sidebar .brand {
    padding: 0 0 0.4rem;
  }
  .app-sidebar .tools {
    align-items: center;
  }
  .app-sidebar :deep(.bell-label),
  .app-sidebar :deep(.ai-label) {
    display: none;
  }
  .app-sidebar :deep(.bell.labelled),
  .app-sidebar :deep(.ai-button.labelled) {
    justify-content: center;
    width: 2.4rem;
    padding: 0.2rem 0;
  }
  .app-sidebar .search,
  .app-sidebar .item,
  .app-sidebar .account {
    justify-content: center;
    width: 2.4rem;
    padding: 0.35rem 0;
  }
}
</style>
