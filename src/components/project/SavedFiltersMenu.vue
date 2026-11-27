<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from 'primevue/button';
import Popover from 'primevue/popover';
import { useConfirm } from 'primevue/useconfirm';
import { filtersToQuery, sameFilters, withoutFilterQuery, type SavedFilterDTO } from '@shared/ticketFilters';
import { api } from '@/api';
import SaveFilterDialog from '@/components/project/SaveFilterDialog.vue';
import { applyTicketFilters, currentTicketFilters, useTicketFilters } from '@/composables/useTicketFilters';
import { t } from '@/i18n';
import { connection } from '@/offline/connection';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/project';
import { copyText } from '@/utils/clipboard';
import { describeFilters } from '@/utils/filterSummary';
import { notify, notifyError } from '@/utils/notify';

/**
 * Filtres enregistrés du projet : les siens et ceux partagés avec le projet (avec le nom de leur auteur et leur
 * description). Un clic applique un filtre ; on enregistre les filtres en cours, on copie le lien d'une vue filtrée.
 */
const route = useRoute();
const router = useRouter();
const confirm = useConfirm();
const auth = useAuthStore();
const project = useProjectStore();
const { activeCount } = useTicketFilters();
const popover = ref<InstanceType<typeof Popover> | null>(null);
const dialogOpen = ref(false);
const editing = ref<SavedFilterDTO | null>(null);

const canEdit = (filter: SavedFilterDTO): boolean => filter.createdBy === auth.user?.id || project.can('project.edit');
const mine = computed(() => project.savedFilters.filter((filter) => filter.createdBy === auth.user?.id));
const others = computed(() => project.savedFilters.filter((filter) => filter.createdBy !== auth.user?.id));
/** Filtre enregistré qui correspond exactement aux filtres en cours. */
const active = computed(() => (activeCount.value ? project.savedFilters.find((filter) => sameFilters(filter.filters, currentTicketFilters())) ?? null : null));

function toggle(event: Event): void {
  popover.value?.toggle(event);
}

function use(filter: SavedFilterDTO): void {
  applyTicketFilters(filter.filters);
  popover.value?.hide();
}

/** Adresse de la page avec ces filtres (sans le ticket ouvert). */
function linkTo(filters: SavedFilterDTO['filters']): string {
  const { ticket: _ticket, ...rest } = withoutFilterQuery(route.query);
  return new URL(router.resolve({ path: route.path, query: { ...rest, ...filtersToQuery(filters) } }).href, window.location.origin).href;
}

async function copyLink(filters: SavedFilterDTO['filters']): Promise<void> {
  if (await copyText(linkTo(filters))) notify('success', t('Lien copié'), t('Il ouvre cette vue avec ces filtres.'));
}

function saveCurrent(): void {
  editing.value = null;
  dialogOpen.value = true;
  popover.value?.hide();
}

function edit(filter: SavedFilterDTO): void {
  editing.value = filter;
  dialogOpen.value = true;
  popover.value?.hide();
}

function remove(filter: SavedFilterDTO): void {
  confirm.require({
    header: t('Supprimer le filtre « {name} » ?', { name: filter.name }),
    message: filter.shared ? t('Il disparaît pour tout le projet.') : t('Il ne sera plus proposé.'),
    icon: 'pi pi-trash',
    acceptLabel: t('Supprimer'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      try {
        await api.deleteFilter(filter.id);
        project.removeSavedFilter(filter.id);
      } catch (error) {
        notifyError(error);
      }
    },
  });
}
</script>

<template>
  <span class="saved-filters">
    <Button
      v-tooltip.bottom="active ? $t('Filtre enregistré en cours') : $t('Filtres enregistrés')"
      :label="active?.name ?? (project.savedFilters.length ? String(project.savedFilters.length) : undefined)"
      :icon="active ? 'pi pi-bookmark-fill' : 'pi pi-bookmark'"
      severity="secondary"
      :outlined="!active"
      size="small"
      class="trigger"
      :aria-label="$t('Filtres enregistrés')"
      aria-haspopup="true"
      @click="toggle"
    />
    <Popover ref="popover" class="saved-filters-popover">
      <div class="menu">
        <header class="head">
          <strong>{{ $t('Filtres enregistrés') }}</strong>
        </header>
        <template v-for="section in [{ key: 'mine', title: $t('Mes filtres'), list: mine }, { key: 'others', title: $t('Partagés avec le projet'), list: others }]" :key="section.key">
          <template v-if="section.list.length">
            <h4 class="section">{{ section.title }}</h4>
            <ul class="items">
              <li v-for="filter in section.list" :key="filter.id" class="item" :class="{ current: active?.id === filter.id }">
                <button type="button" class="apply" :title="describeFilters(filter.filters, project).join(' · ')" @click="use(filter)">
                  <span class="name">
                    <i :class="active?.id === filter.id ? 'pi pi-check' : filter.shared ? 'pi pi-users' : 'pi pi-bookmark'" class="kind"></i>
                    <strong class="truncate">{{ filter.name }}</strong>
                  </span>
                  <span v-if="filter.description" class="description muted small">{{ filter.description }}</span>
                  <span class="meta muted small">
                    <template v-if="section.key === 'others'">{{ $t('par {name}', { name: filter.createdByName ?? $t('Utilisateur supprimé') }) }} · </template>
                    <template v-else-if="filter.shared">{{ $t('Partagé avec le projet') }} · </template>
                    {{ describeFilters(filter.filters, project).join(' · ') || $t('Aucun filtre') }}
                  </span>
                </button>
                <span class="tools">
                  <Button v-tooltip.top="$t('Copier le lien')" icon="pi pi-link" text rounded size="small" severity="secondary" :aria-label="$t('Copier le lien')" @click="copyLink(filter.filters)" />
                  <Button v-if="canEdit(filter)" v-tooltip.top="$t('Modifier')" icon="pi pi-pencil" text rounded size="small" severity="secondary" :aria-label="$t('Modifier')" :disabled="connection.offline" @click="edit(filter)" />
                  <Button v-if="canEdit(filter)" v-tooltip.top="$t('Supprimer')" icon="pi pi-trash" text rounded size="small" severity="danger" :aria-label="$t('Supprimer')" :disabled="connection.offline" @click="remove(filter)" />
                </span>
              </li>
            </ul>
          </template>
        </template>
        <p v-if="!project.savedFilters.length" class="empty muted small">{{ $t('Aucun filtre enregistré. Choisissez des filtres, puis enregistrez-les pour les retrouver d’un clic, ou les partager avec le projet.') }}</p>
        <footer class="foot">
          <Button :label="$t('Enregistrer les filtres en cours…')" icon="pi pi-plus" size="small" :disabled="!activeCount || connection.offline" @click="saveCurrent" />
          <Button :label="$t('Copier le lien de cette vue')" icon="pi pi-link" size="small" severity="secondary" text @click="copyLink(currentTicketFilters())" />
        </footer>
      </div>
    </Popover>
    <SaveFilterDialog v-model:visible="dialogOpen" :editing="editing" />
  </span>
</template>

<style scoped>
.menu {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  width: min(24rem, 86vw);
}
.head {
  padding: 0 0.25rem;
}
.section {
  margin: 0.4rem 0.25rem 0.1rem;
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--fb-muted);
}
.items {
  margin: 0;
  padding: 0;
  max-height: 18rem;
  overflow-y: auto;
  list-style: none;
}
.item {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 8px;
}
.item:hover,
.item.current {
  background: var(--fb-accent-soft);
}
.apply {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
  padding: 0.4rem 0.5rem;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.name {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
}
.kind {
  color: var(--fb-accent);
  font-size: 0.8rem;
}
.description,
.meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tools {
  display: flex;
  flex: none;
  opacity: 0.55;
}
.item:hover .tools {
  opacity: 1;
}
.empty {
  margin: 0.3rem 0.25rem;
  line-height: 1.45;
}
.foot {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.4rem;
  padding-top: 0.45rem;
  border-top: 1px solid var(--fb-border);
}
</style>
