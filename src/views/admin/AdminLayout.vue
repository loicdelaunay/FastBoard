<script setup lang="ts">
import { computed } from 'vue';
import { useAuthStore } from '@/stores/auth';

import { t } from '@/i18n';
const auth = useAuthStore();

const links = computed(() =>
  [
    { name: 'admin-users', label: t('Utilisateurs'), icon: 'pi pi-users', allowed: auth.can('users.view') },
    { name: 'admin-roles', label: t('Rôles et permissions'), icon: 'pi pi-shield', allowed: auth.can('roles.manage') },
    { name: 'admin-tokens', label: t('Jetons d\'API'), icon: 'pi pi-key', allowed: auth.can('tokens.manage') },
    { name: 'admin-performance', label: t('Performances'), icon: 'pi pi-chart-line', allowed: auth.can('monitoring.view') },
    { name: 'admin-logs', label: t('Journaux'), icon: 'pi pi-list', allowed: auth.can('logs.view') },
  ].filter((link) => link.allowed),
);
</script>

<template>
  <div class="admin">
    <aside class="side">
      <h2 class="side-title">{{ $t('Administration') }}</h2>
      <nav :aria-label="$t('Administration')">
        <router-link v-for="link in links" :key="link.name" :to="{ name: link.name }" class="link" active-class="active">
          <i :class="link.icon"></i><span>{{ link.label }}</span>
        </router-link>
      </nav>
    </aside>
    <section class="content">
      <router-view />
    </section>
  </div>
</template>

<style scoped>
.admin {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 15rem minmax(0, 1fr);
}
.side {
  padding: 1.25rem 0.75rem;
  border-right: 1px solid var(--fb-border);
  background: var(--fb-panel);
}
.side-title {
  margin: 0 0.5rem 1rem;
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--fb-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
nav {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.link {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.75rem;
  border-radius: 8px;
  color: var(--fb-muted);
  font-weight: 600;
  font-size: 0.9rem;
}
.link:hover {
  background: var(--fb-panel-alt);
  color: var(--fb-text);
}
.link.active {
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
}
.content {
  min-width: 0;
  overflow-y: auto;
}
@media (max-width: 760px) {
  .admin {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }
  .side {
    padding: 0.5rem;
    border-right: 0;
    border-bottom: 1px solid var(--fb-border);
  }
  .side-title {
    display: none;
  }
  nav {
    flex-direction: row;
    overflow-x: auto;
  }
}
</style>
