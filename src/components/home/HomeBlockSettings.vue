<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import SelectButton from 'primevue/selectbutton';
import ToggleSwitch from 'primevue/toggleswitch';
import { HOME_BLOCK_INFO, HOME_LAYOUT_LIMITS, type HomeBlock, type HomeBlockOptions } from '@shared/homeLayout';
import { t } from '@/i18n';
import { useHomeSources } from './homeContext';

/** Réglages d'un bloc de l'Accueil : titre, taille, et ce qu'il montre (selon son type). */
const props = defineProps<{ block: HomeBlock | null }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ save: [patch: Pick<HomeBlock, 'title' | 'size' | 'height' | 'options'>] }>();
const sources = useHomeSources();

const title = ref('');
const size = ref<HomeBlock['size']>('half');
const height = ref<HomeBlock['height']>('normal');
const options = ref<HomeBlockOptions>({});

watch(visible, (open) => {
  if (!open || !props.block) return;
  title.value = props.block.title;
  size.value = props.block.size;
  height.value = props.block.height;
  options.value = { ...props.block.options };
  if ('projectId' in props.block.options) sources.projects.ensure();
});

const info = computed(() => (props.block ? HOME_BLOCK_INFO[props.block.type] : null));
const has = (key: keyof HomeBlockOptions): boolean => Boolean(props.block && key in props.block.options);
/** Le projet est obligatoire (suivi d'un projet, filtre enregistré) ; sinon, sans projet : tous mes projets. */
const projectRequired = computed(() => props.block?.type === 'project' || props.block?.type === 'savedFilter');

const projectOptions = computed(() =>
  (sources.projects.data.value ?? [])
    .filter((project) => !project.archived || project.id === options.value.projectId)
    .map((project) => ({ value: project.id, label: `${project.key} — ${project.name}` }))
    .sort((a, b) => a.label.localeCompare(b.label)),
);

const filterSource = computed(() => (has('filterId') && options.value.projectId ? sources.filters(options.value.projectId) : null));
watch(filterSource, (source) => source?.ensure(), { immediate: true });
const filterOptions = computed(() =>
  (filterSource.value?.data.value ?? []).map((filter) => ({
    value: filter.id,
    label: filter.name,
    detail: filter.shared ? t('Partagé par {name}', { name: filter.createdByName ?? t('Un ancien membre') }) : t('Personnel'),
  })),
);
/** Un autre projet choisi : le filtre retenu n'en fait plus partie. */
function onProjectChange(): void {
  if (has('filterId')) options.value.filterId = null;
}

const SIZES = computed(() => [
  { value: 'third', label: t('Un tiers') },
  { value: 'half', label: t('La moitié') },
  { value: 'twoThirds', label: t('Deux tiers') },
  { value: 'full', label: t('Toute la ligne') },
]);
const HEIGHTS = computed(() => [
  { value: 'compact', label: t('Compacte') },
  { value: 'normal', label: t('Normale') },
  { value: 'tall', label: t('Haute') },
]);
const GROUPS = computed(() => [
  { value: 'all', label: t('Tout') },
  { value: 'ticket', label: t('Tickets') },
  { value: 'comment', label: t('Commentaires') },
]);

function save(): void {
  emit('save', { title: title.value.trim().slice(0, HOME_LAYOUT_LIMITS.titleMax), size: size.value, height: height.value, options: { ...options.value } });
  visible.value = false;
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="$t('Réglages du bloc')" :style="{ width: 'min(32rem, calc(100vw - 2rem))' }" :draggable="false">
    <form v-if="block && info" class="form" @submit.prevent="save">
      <p class="muted small type"><i :class="info.icon"></i> {{ $t(info.label) }} — {{ $t(info.description) }}</p>

      <label class="field">
        <span>{{ $t('Titre') }}</span>
        <InputText v-model="title" :placeholder="$t(info.label)" :maxlength="HOME_LAYOUT_LIMITS.titleMax" />
      </label>

      <div v-if="has('projectId')" class="field">
        <span>{{ $t('Projet') }}</span>
        <Select
          v-model="options.projectId"
          :options="projectOptions"
          option-label="label"
          option-value="value"
          filter
          :show-clear="!projectRequired"
          :loading="!sources.projects.data.value"
          :placeholder="projectRequired ? $t('Choisir un projet') : $t('Tous mes projets')"
          @change="onProjectChange"
        />
      </div>

      <div v-if="has('filterId')" class="field">
        <span>{{ $t('Filtre enregistré') }}</span>
        <Select
          v-model="options.filterId"
          :options="filterOptions"
          option-label="label"
          option-value="value"
          :disabled="!options.projectId"
          :loading="Boolean(options.projectId) && !filterSource?.data.value"
          :placeholder="options.projectId ? $t('Choisir un filtre') : $t('Choisissez d’abord le projet')"
          :empty-message="$t('Aucun filtre enregistré dans ce projet.')"
        >
          <template #option="{ option }">
            <span class="filter-option">
              <span>{{ option.label }}</span>
              <span class="muted small">{{ option.detail }}</span>
            </span>
          </template>
        </Select>
      </div>

      <label v-if="has('days')" class="field">
        <span>{{ $t('Échéances dans les prochains jours') }}</span>
        <InputNumber v-model="options.days" :min="HOME_LAYOUT_LIMITS.daysMin" :max="HOME_LAYOUT_LIMITS.daysMax" show-buttons :suffix="` ${$t('jours')}`" />
      </label>

      <label v-if="has('limit')" class="field">
        <span>{{ $t('Éléments montrés, au plus') }}</span>
        <InputNumber v-model="options.limit" :min="HOME_LAYOUT_LIMITS.limitMin" :max="info.limitMax ?? HOME_LAYOUT_LIMITS.limitMax" show-buttons />
      </label>

      <div v-if="has('group')" class="field">
        <span>{{ $t('Évènements') }}</span>
        <SelectButton v-model="options.group" :options="GROUPS" option-label="label" option-value="value" :allow-empty="false" />
      </div>

      <label v-if="has('hideDone')" class="switch">
        <ToggleSwitch v-model="options.hideDone" />
        <span>{{ $t('Sans les tickets terminés') }}</span>
      </label>

      <div class="field">
        <span>{{ $t('Largeur') }}</span>
        <SelectButton v-model="size" :options="SIZES" option-label="label" option-value="value" :allow-empty="false" />
      </div>
      <div class="field">
        <span>{{ $t('Hauteur') }}</span>
        <SelectButton v-model="height" :options="HEIGHTS" option-label="label" option-value="value" :allow-empty="false" />
      </div>

      <div class="actions">
        <Button :label="$t('Annuler')" severity="secondary" text @click="visible = false" />
        <Button type="submit" :label="$t('Enregistrer')" icon="pi pi-check" />
      </div>
    </form>
  </Dialog>
</template>

<style scoped>
.form {
  display: grid;
  gap: 0.9rem;
}
.type {
  margin: 0;
}
.field {
  display: grid;
  gap: 0.35rem;
}
.field > span {
  font-size: 0.85rem;
  font-weight: 600;
}
.field :deep(.p-selectbutton) {
  flex-wrap: wrap;
}
.switch {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.filter-option {
  display: flex;
  flex-direction: column;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
