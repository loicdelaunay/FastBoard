<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Tab from 'primevue/tab';
import TabList from 'primevue/tablist';
import TabPanel from 'primevue/tabpanel';
import TabPanels from 'primevue/tabpanels';
import Tabs from 'primevue/tabs';
import AutomationSettings from '@/components/settings/AutomationSettings.vue';
import CategoriesSettings from '@/components/settings/CategoriesSettings.vue';
import ColumnsSettings from '@/components/settings/ColumnsSettings.vue';
import DeliveriesSettings from '@/components/settings/DeliveriesSettings.vue';
import GeneralSettings from '@/components/settings/GeneralSettings.vue';
import ListItemsSettings from '@/components/settings/ListItemsSettings.vue';
import MembersSettings from '@/components/settings/MembersSettings.vue';
import TicketSettings from '@/components/settings/TicketSettings.vue';
import { useProjectStore } from '@/stores/project';

import { t } from '@/i18n';
const project = useProjectStore();
const route = useRoute();
const router = useRouter();

const tabs = computed(() => [
  { value: 'general', label: t('Général'), icon: 'pi pi-sliders-h', visible: true },
  { value: 'columns', label: t('Colonnes'), icon: 'pi pi-table', visible: true },
  { value: 'automation', label: t('Automatisation'), icon: 'pi pi-bolt', visible: true },
  { value: 'ticket', label: t('Ticket'), icon: 'pi pi-ticket', visible: true },
  { value: 'categories', label: t('Catégories'), icon: 'pi pi-tags', visible: true },
  { value: 'priorities', label: t('Priorités'), icon: 'pi pi-flag', visible: true },
  { value: 'components', label: t('Composants'), icon: 'pi pi-box', visible: true },
  { value: 'deliveries', label: t('Livraisons'), icon: 'pi pi-truck', visible: true },
  { value: 'members', label: t('Membres'), icon: 'pi pi-users', visible: project.can('project.members') || project.can('project.edit') },
].filter((tab) => tab.visible));

const active = ref('general');
watchEffect(() => {
  const requested = typeof route.query.tab === 'string' ? route.query.tab : 'general';
  active.value = tabs.value.some((tab) => tab.value === requested) ? requested : 'general';
});

function select(value: string | number): void {
  void router.replace({ query: { ...route.query, tab: String(value) } });
}
</script>

<template>
  <div class="settings">
    <div class="inner">
      <header class="head">
        <h2 class="page-title">{{ $t('Réglages du projet') }}</h2>
        <p class="muted">{{ $t('Configurez {name} : informations, colonnes, automatisations, affichage des tickets, catégories, priorités, composants, livraisons et équipe.', { name: project.project?.name }) }}</p>
      </header>

      <Tabs :value="active" @update:value="select">
        <TabList>
          <Tab v-for="tab in tabs" :key="tab.value" :value="tab.value"><i :class="tab.icon"></i>&nbsp;{{ tab.label }}</Tab>
        </TabList>
        <TabPanels>
          <TabPanel value="general"><GeneralSettings /></TabPanel>
          <TabPanel value="columns"><ColumnsSettings /></TabPanel>
          <TabPanel value="automation"><AutomationSettings /></TabPanel>
          <TabPanel value="ticket"><TicketSettings /></TabPanel>
          <TabPanel value="categories"><CategoriesSettings /></TabPanel>
          <TabPanel value="priorities"><ListItemsSettings kind="priority" /></TabPanel>
          <TabPanel value="components"><ListItemsSettings kind="component" /></TabPanel>
          <TabPanel value="deliveries"><DeliveriesSettings /></TabPanel>
          <TabPanel value="members"><MembersSettings /></TabPanel>
        </TabPanels>
      </Tabs>
    </div>
  </div>
</template>

<style scoped>
.settings {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.inner {
  width: 100%;
  max-width: 1000px;
  margin: 0 auto;
  padding: 1.5rem 1rem 3rem;
}
.head {
  margin-bottom: 1rem;
}
</style>
