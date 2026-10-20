<script setup lang="ts">
import Listbox from 'primevue/listbox';

/** Contenu du menu de filtre d'une colonne : cases à cocher des valeurs présentes. */
const props = defineProps<{ filterModel: { value: unknown[] | null }; options: Array<{ label: string; value: string }> }>();
const emit = defineEmits<{ apply: [] }>();

function update(value: string[]): void {
  props.filterModel.value = value.length ? value : null;
  emit('apply');
}
</script>

<template>
  <Listbox
    :model-value="(filterModel.value as string[] | null) ?? []"
    :options="options"
    option-label="label"
    option-value="value"
    multiple
    checkmark
    :filter="options.length > 8"
    list-style="max-height: 16rem"
    class="value-filter"
    :aria-label="$t('Valeurs à afficher')"
    @update:model-value="update"
  >
    <template #option="{ option }">
      <span v-if="option.value === ''" class="muted"><em>{{ $t('(vide)') }}</em></span>
      <span v-else>{{ option.label }}</span>
    </template>
    <template #empty>{{ $t('Aucune valeur') }}</template>
  </Listbox>
</template>

<style scoped>
.value-filter {
  min-width: 14rem;
  border: 0;
}
</style>
