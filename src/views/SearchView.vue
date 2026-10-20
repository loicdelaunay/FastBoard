<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import SelectButton from 'primevue/selectbutton';
import Skeleton from 'primevue/skeleton';
import type { SearchKind, SearchResultDTO } from '@shared/types';
import { api } from '@/api';
import StatusTag from '@/components/common/StatusTag.vue';
import UserAvatar from '@/components/common/UserAvatar.vue';
import { formatRelative } from '@/utils/format';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
/** Tous les résultats de la recherche globale, par type. */
const route = useRoute();
const router = useRouter();

const text = ref(typeof route.query.q === 'string' ? route.query.q : '');
const kind = ref<'all' | SearchKind>((['projects', 'tickets', 'users'] as const).find((value) => value === route.query.type) ?? 'all');
const result = ref<SearchResultDTO | null>(null);
const loading = ref(false);
let generation = 0;

const kindOptions = computed(() => [
  { label: t('Tout'), value: 'all' },
  { label: t('Projets ({n})', { n: result.value?.projects.total ?? 0 }), value: 'projects' },
  { label: t('Tickets ({n})', { n: result.value?.tickets.total ?? 0 }), value: 'tickets' },
  { label: t('Utilisateurs ({n})', { n: result.value?.users.total ?? 0 }), value: 'users' },
]);

async function load(): Promise<void> {
  const query = text.value.trim();
  const current = ++generation;
  if (!query) {
    result.value = null;
    return;
  }
  loading.value = true;
  try {
    const data = await api.search(query, { limit: 100 });
    if (current === generation) result.value = data;
  } catch (error) {
    notifyError(error, t('Recherche impossible'));
  } finally {
    if (current === generation) loading.value = false;
  }
}

let timer: number | null = null;
watch(text, () => {
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    void router.replace({ query: { ...route.query, q: text.value.trim() || undefined } });
  }, 250);
});
watch(kind, (value) => void router.replace({ query: { ...route.query, type: value === 'all' ? undefined : value } }));
watch(
  () => route.query.q,
  (q) => {
    if (typeof q === 'string' && q !== text.value.trim()) text.value = q;
    void load();
  },
  { immediate: true },
);

const show = (value: SearchKind): boolean => kind.value === 'all' || kind.value === value;
const total = computed(() => (result.value ? result.value.projects.total + result.value.tickets.total + result.value.users.total : 0));
</script>

<template>
  <div class="page">
    <header class="head">
      <h1 class="page-title">{{ $t('Recherche') }}</h1>
      <IconField class="search">
        <InputIcon class="pi pi-search" />
        <InputText v-model="text" :placeholder="$t('Projets, tickets, personnes…')" fluid autofocus :aria-label="$t('Rechercher')" />
      </IconField>
      <SelectButton v-model="kind" :options="kindOptions" option-label="label" option-value="value" :allow-empty="false" :aria-label="$t('Type de résultats')" />
    </header>

    <div v-if="loading && !result" class="stack">
      <Skeleton v-for="n in 4" :key="n" height="3rem" />
    </div>
    <p v-else-if="!text.trim()" class="muted">{{ $t('Saisissez un mot, une clé de ticket (APP-12) ou le nom d\'une personne.') }}</p>
    <p v-else-if="result && !total" class="muted">{{ $t('Aucun résultat pour « {q} »', { q: text.trim() }) }}</p>

    <template v-if="result">
      <section v-if="show('projects') && result.projects.items.length" class="section">
        <h2 class="section-title"><i class="pi pi-th-large"></i> {{ $t('Projets') }} <span class="muted">{{ result.projects.total }}</span></h2>
        <ul class="list">
          <li v-for="project in result.projects.items" :key="project.id">
            <router-link :to="{ name: 'project', params: { projectId: project.id } }" class="hit card">
              <span class="badge">{{ project.key }}</span>
              <span class="grow">
                <strong>{{ project.name }}</strong>
                <span v-if="project.description" class="muted small desc truncate">{{ project.description }}</span>
              </span>
              <span v-if="project.archived" class="muted small">{{ $t('Archivé') }}</span>
            </router-link>
          </li>
        </ul>
      </section>

      <section v-if="show('tickets') && result.tickets.items.length" class="section">
        <h2 class="section-title"><i class="pi pi-ticket"></i> {{ $t('Tickets') }} <span class="muted">{{ result.tickets.total }}</span></h2>
        <ul class="list">
          <li v-for="ticket in result.tickets.items" :key="ticket.id">
            <router-link :to="{ name: 'project', params: { projectId: ticket.projectId }, query: { ticket: String(ticket.id) } }" class="hit card">
              <span class="key">{{ ticket.key }}</span>
              <span class="grow truncate">{{ ticket.title }}</span>
              <span class="muted small project-name truncate">{{ ticket.projectName }}</span>
              <StatusTag :status="ticket.status" compact />
              <span class="muted small when">{{ formatRelative(ticket.updatedAt) }}</span>
            </router-link>
          </li>
        </ul>
        <p v-if="result.tickets.total > result.tickets.items.length" class="muted small">{{ $t('Seuls les {n} premiers sont affichés : précisez la recherche.', { n: result.tickets.items.length }) }}</p>
      </section>

      <section v-if="show('users') && result.users.items.length" class="section">
        <h2 class="section-title"><i class="pi pi-users"></i> {{ $t('Utilisateurs') }} <span class="muted">{{ result.users.total }}</span></h2>
        <ul class="list users">
          <li v-for="user in result.users.items" :key="user.id">
            <router-link :to="{ name: 'user', params: { id: user.id } }" class="hit card">
              <UserAvatar :user="user" />
              <span class="grow">
                <strong>{{ user.name }}</strong>
                <span class="muted small desc">{{ user.email }}</span>
              </span>
            </router-link>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}
.search {
  max-width: 36rem;
}
.section {
  margin-bottom: 1.75rem;
}
.section-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.6rem;
  font-size: 1rem;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.list.users {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
}
.hit {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0.85rem;
  color: var(--fb-text);
  text-decoration: none;
}
.hit:hover {
  border-color: var(--fb-accent);
}
.hit .grow {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.desc {
  display: block;
}
.badge,
.key {
  flex: none;
  font-size: 0.75rem;
  font-weight: 800;
  color: var(--fb-accent);
}
.badge {
  padding: 0.1rem 0.45rem;
  border-radius: 6px;
  background: var(--fb-accent-soft);
}
.project-name {
  max-width: 12rem;
}
.when {
  flex: none;
  width: 7rem;
  text-align: right;
}
@media (max-width: 720px) {
  .project-name,
  .when {
    display: none;
  }
}
</style>
