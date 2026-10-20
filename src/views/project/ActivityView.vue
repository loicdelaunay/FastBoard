<script setup lang="ts">
import { computed } from 'vue';
import Button from 'primevue/button';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import SelectButton from 'primevue/selectbutton';
import Skeleton from 'primevue/skeleton';
import ActivityItem from '@/components/activity/ActivityItem.vue';
import { useActivityFeed, type GroupFilter } from '@/composables/useActivityFeed';
import { useTicketRoute } from '@/composables/useTicketRoute';
import { useProjectStore } from '@/stores/project';

import { t } from '@/i18n';
const project = useProjectStore();
const { openTicket } = useTicketRoute();
const feed = useActivityFeed();
const { filters } = feed;

const groupOptions: Array<{ label: string; value: GroupFilter; icon: string }> = [
  { label: t('Tout'), value: 'all', icon: 'pi pi-list' },
  { label: t('Tickets'), value: 'ticket', icon: 'pi pi-ticket' },
  { label: t('Commentaires'), value: 'comment', icon: 'pi pi-comment' },
  { label: t('Configuration'), value: 'config', icon: 'pi pi-cog' },
  { label: t('Membres'), value: 'member', icon: 'pi pi-users' },
];

const sourceOptions = [
  { label: t('Toutes origines'), value: 'all', icon: 'pi pi-globe' },
  { label: t('Interface'), value: 'ui', icon: 'pi pi-desktop' },
  { label: t('API / agents'), value: 'api', icon: 'pi pi-microchip-ai' },
];

const personOptions = computed(() => project.users.map((user) => ({ label: user.name, value: user.id })));
</script>

<template>
  <div class="activity">
    <div class="scroll">
      <div class="inner">
        <header class="head">
          <div>
            <h2 class="title">{{ $t('Activités') }}</h2>
            <p class="muted small">{{ $t('Tout ce qui se passe sur le tableau.') }}</p>
          </div>
        </header>

        <div class="filters">
          <SelectButton v-model="filters.group" :options="groupOptions" option-label="label" option-value="value" :allow-empty="false" :aria-label="$t('Type d\'évènement')" class="groups">
            <template #option="{ option }"><i :class="option.icon"></i><span class="label">{{ option.label }}</span></template>
          </SelectButton>
          <div class="row2">
            <IconField class="search">
              <InputIcon class="pi pi-search" />
              <InputText v-model="filters.search" :placeholder="$t('Filtrer : ticket, personne, mot…')" fluid :aria-label="$t('Filtrer l\'activité')" />
            </IconField>
            <Select v-model="filters.userId" :options="personOptions" option-label="label" option-value="value" :placeholder="$t('Tout le monde')" show-clear class="person" :aria-label="$t('Personne')" />
            <Select
              v-model="filters.source"
              v-tooltip.bottom="$t('Origine : interface, ou jeton d\'API (agents, scripts)')"
              :options="sourceOptions"
              option-label="label"
              option-value="value"
              class="source"
              :aria-label="$t('Origine des actions')"
            >
              <template #value="{ value }"><span class="row source-value"><i :class="sourceOptions.find((o) => o.value === value)?.icon"></i>{{ sourceOptions.find((o) => o.value === value)?.label }}</span></template>
              <template #option="{ option }"><span class="row source-value"><i :class="option.icon"></i>{{ option.label }}</span></template>
            </Select>
            <Button v-if="feed.activeFilters.value" :label="$t('Effacer')" icon="pi pi-filter-slash" text size="small" @click="feed.reset" />
          </div>
        </div>

        <div v-if="feed.loading.value" class="skeletons" aria-busy="true">
          <Skeleton v-for="n in 5" :key="n" height="4.2rem" border-radius="10px" />
        </div>

        <div v-else-if="!feed.days.value.length" class="empty card">
          <i class="pi pi-history icon"></i>
          <h3>{{ feed.activeFilters.value ? $t('Aucun évènement ne correspond') : $t('Rien pour l\'instant') }}</h3>
          <p class="muted">
            {{ feed.activeFilters.value ? $t('Modifiez ou effacez les filtres.') : $t('Les créations, déplacements, commentaires et changements du projet apparaîtront ici dès qu\'ils auront lieu.') }}
          </p>
          <Button v-if="feed.activeFilters.value" :label="$t('Effacer les filtres')" icon="pi pi-filter-slash" severity="secondary" @click="feed.reset" />
        </div>

        <template v-else>
          <section v-for="day in feed.days.value" :key="day.key" class="day">
            <h3 class="day-title">{{ day.label }}</h3>
            <ul class="list">
              <ActivityItem v-for="activity in day.items" :key="activity.id" :activity="activity" :fresh="feed.fresh.value.has(activity.id)" @open="openTicket" />
            </ul>
          </section>

          <div class="more">
            <Button v-if="feed.hasMore.value" :label="$t('Charger les évènements précédents')" icon="pi pi-chevron-down" severity="secondary" outlined :loading="feed.loadingMore.value" @click="feed.loadMore" />
            <p v-else class="muted small">{{ $t('C\'est tout : vous avez remonté jusqu\'au début du projet.') }}</p>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.activity {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.inner {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
  max-width: 56rem;
  margin: 0 auto;
  padding: 1.25rem 1rem 3rem;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}
.title {
  font-size: 1.25rem;
  font-weight: 700;
}
.filters {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.groups {
  display: flex;
  flex-wrap: wrap;
}
.groups :deep(.p-togglebutton) {
  gap: 0.4rem;
}
.row2 {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
}
.search {
  flex: 1 1 14rem;
  max-width: 24rem;
}
.person {
  width: 12rem;
}
.source-value {
  gap: 0.45rem;
}
.skeletons {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.day {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.day-title {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0;
  padding: 0.35rem 0;
  background: var(--fb-bg);
  font-size: 0.78rem;
  font-weight: 800;
  color: var(--fb-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
}
.more {
  display: flex;
  justify-content: center;
  padding-top: 0.5rem;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 3rem 1rem;
  text-align: center;
}
.icon {
  font-size: 2.4rem;
  color: var(--fb-muted);
}
@media (max-width: 720px) {
  .groups .label {
    display: none;
  }
  .person {
    width: 100%;
  }
}
</style>
