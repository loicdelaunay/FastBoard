<script setup lang="ts">
import { computed, ref } from 'vue';
import Button from 'primevue/button';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import MultiSelect from 'primevue/multiselect';
import ToggleButton from 'primevue/togglebutton';
import { useTicketFilters } from '@/composables/useTicketFilters';
import { useProjectStore } from '@/stores/project';

import { t } from '@/i18n';
withDefaults(defineProps<{ showStatus?: boolean; total?: number; shown?: number }>(), { showStatus: true, total: 0, shown: 0 });

const project = useProjectStore();
const { filters, activeCount, reset } = useTicketFilters();
/** Sur petit écran, les filtres avancés sont repliés derrière un bouton. */
const expanded = ref(false);

const categoryOptions = computed(() => [
  ...project.categories.map((category) => ({ label: category.name, value: category.id })),
  { label: t('Sans catégorie'), value: 'none' },
]);
const deliveryOptions = computed(() => [
  ...project.deliveries.map((delivery) => ({ label: delivery.name, value: delivery.id })),
  { label: t('Sans livraison'), value: 'none' },
]);
const assigneeOptions = computed(() => [
  ...project.users.map((user) => ({ label: user.name, value: user.id })),
  { label: t('Non assigné'), value: 'none' },
]);
const statusOptions = computed(() => project.visibleColumns.map((column) => ({ label: column.label, value: column.status })));
</script>

<template>
  <div class="filter-bar">
    <IconField class="search">
      <InputIcon class="pi pi-search" />
      <InputText v-model="filters.search" :placeholder="$t('Rechercher un ticket, une personne…')" fluid :aria-label="$t('Rechercher')" />
    </IconField>
    <Button class="toggle-filters" :label="activeCount ? $t('Filtres ({activeCount})', { activeCount }) : $t('Filtres')" icon="pi pi-filter" severity="secondary" outlined size="small" :aria-expanded="expanded" @click="expanded = !expanded" />
    <div class="advanced" :class="{ open: expanded }">

    <MultiSelect v-model="filters.categoryIds" :options="categoryOptions" option-label="label" option-value="value" :placeholder="$t('Catégories')" :max-selected-labels="1" :selected-items-label="$t('{0} catégories')" class="filter" display="comma" />
    <MultiSelect v-model="filters.deliveryIds" :options="deliveryOptions" option-label="label" option-value="value" :placeholder="$t('Livraisons')" :max-selected-labels="1" :selected-items-label="$t('{0} livraisons')" class="filter" display="comma" />
    <MultiSelect v-model="filters.assigneeIds" :options="assigneeOptions" option-label="label" option-value="value" :placeholder="$t('Personnes')" :max-selected-labels="1" :selected-items-label="$t('{0} personnes')" class="filter" display="comma" />
    <MultiSelect v-if="showStatus" v-model="filters.statuses" :options="statusOptions" option-label="label" option-value="value" :placeholder="$t('Statuts')" :max-selected-labels="1" :selected-items-label="$t('{0} statuts')" class="filter" display="comma" />

    <ToggleButton v-model="filters.mineOnly" :on-label="$t('Mes tickets')" :off-label="$t('Mes tickets')" on-icon="pi pi-user" off-icon="pi pi-user" />
    <ToggleButton v-model="filters.overdueOnly" :on-label="$t('En retard')" :off-label="$t('En retard')" on-icon="pi pi-clock" off-icon="pi pi-clock" />

    <Button v-if="activeCount" :label="$t('Effacer')" icon="pi pi-filter-slash" text size="small" @click="reset" />
    </div>
    <span v-if="total" class="count muted small">{{ $t('{shown} / {total} tickets', { shown, total }) }}</span>
  </div>
</template>

<style scoped>
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.search {
  flex: 1 1 14rem;
  min-width: 12rem;
  max-width: 22rem;
}
.filter {
  width: 10.5rem;
}
.advanced {
  display: contents;
}
.toggle-filters {
  display: none;
}
.count {
  margin-left: auto;
  white-space: nowrap;
}
@media (max-width: 720px) {
  .toggle-filters {
    display: inline-flex;
  }
  .search {
    flex: 1 1 10rem;
    max-width: none;
  }
  .advanced {
    display: none;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
  }
  .advanced.open {
    display: flex;
  }
  .filter {
    flex: 1 1 9rem;
    width: auto;
  }
}
</style>
