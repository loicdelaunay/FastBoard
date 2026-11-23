<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import Dialog from 'primevue/dialog';
import SelectButton from 'primevue/selectbutton';
import { t } from '@/i18n';
import type { ExportFormat } from './editor/exportImage';

/**
 * Export du tableau, comme dans Whimsical : PNG, WebP, SVG ou PDF, de tout le tableau ou de la sélection, à l'échelle
 * choisie et avec ou sans fond ; ou en Mermaid (le texte du diagramme).
 */
const props = defineProps<{ selectionCount: number; busy: boolean }>();
const emit = defineEmits<{
  export: [options: { format: ExportFormat; scale: number; transparent: boolean; selection: boolean }];
  copy: [options: { scale: number; transparent: boolean; selection: boolean }];
  mermaid: [];
}>();
const visible = defineModel<boolean>('visible', { required: true });

const FORMAT_KEY = 'fb.boards.export';
const format = ref<ExportFormat>('png');
const scale = ref(2);
const transparent = ref(false);
const area = ref<'all' | 'selection'>('all');

try {
  const saved = JSON.parse(localStorage.getItem(FORMAT_KEY) ?? 'null') as { format?: ExportFormat; scale?: number; transparent?: boolean } | null;
  if (saved?.format && ['png', 'webp', 'svg', 'pdf'].includes(saved.format)) format.value = saved.format;
  if (saved?.scale && [1, 2, 3, 4].includes(saved.scale)) scale.value = saved.scale;
  if (typeof saved?.transparent === 'boolean') transparent.value = saved.transparent;
} catch {
  // Réglages illisibles : ceux par défaut.
}

watch(visible, (open) => {
  if (open) area.value = props.selectionCount ? 'selection' : 'all';
});

const formats = computed(() => [
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WebP' },
  { value: 'svg', label: 'SVG' },
  { value: 'pdf', label: 'PDF' },
]);
const areas = computed(() => [
  { value: 'all', label: t('Tout le tableau') },
  { value: 'selection', label: t('La sélection ({n})', { n: props.selectionCount }), disabled: !props.selectionCount },
]);
const scales = [1, 2, 3, 4].map((value) => ({ value, label: `${value}×` }));
/** Le PDF garde toujours un fond ; l'échelle ne compte que pour les images. */
const raster = computed(() => format.value !== 'svg');
const canBeTransparent = computed(() => format.value !== 'pdf');
const hint = computed(() =>
  format.value === 'svg'
    ? t('Image vectorielle fidèle à l’écran, à ouvrir dans un navigateur ou à intégrer dans une page web.')
    : format.value === 'pdf'
      ? t('Une page à la taille du dessin, en haute définition.')
      : format.value === 'webp'
        ? t('Image plus légère que le PNG, lue par tous les navigateurs récents.')
        : t('L’image la plus répandue, pour un document, un message ou une présentation.'),
);

function remember(): void {
  try {
    localStorage.setItem(FORMAT_KEY, JSON.stringify({ format: format.value, scale: scale.value, transparent: transparent.value }));
  } catch {
    // Stockage indisponible : les réglages valent pour cette page.
  }
}

function run(): void {
  remember();
  emit('export', { format: format.value, scale: scale.value, transparent: transparent.value && canBeTransparent.value, selection: area.value === 'selection' });
}

function copy(): void {
  remember();
  emit('copy', { scale: scale.value, transparent: transparent.value, selection: area.value === 'selection' });
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="$t('Exporter le tableau')" :style="{ width: 'min(36rem, calc(100vw - 2rem))' }">
    <div class="form">
      <div class="row">
        <span class="label">{{ $t('Format') }}</span>
        <SelectButton v-model="format" :options="formats" option-label="label" option-value="value" :allow-empty="false" />
      </div>
      <p class="muted small hint">{{ hint }}</p>
      <div class="row">
        <span class="label">{{ $t('Contenu') }}</span>
        <SelectButton v-model="area" :options="areas" option-label="label" option-value="value" option-disabled="disabled" :allow-empty="false" />
      </div>
      <div v-if="raster" class="row">
        <span class="label">{{ $t('Échelle') }}</span>
        <SelectButton v-model="scale" :options="scales" option-label="label" option-value="value" :allow-empty="false" />
      </div>
      <label v-if="canBeTransparent" class="check">
        <Checkbox v-model="transparent" binary />
        <span>{{ $t('Fond transparent') }}</span>
      </label>
    </div>
    <template #footer>
      <Button :label="$t('Mermaid…')" icon="pi pi-share-alt" text severity="secondary" class="mermaid" @click="emit('mermaid')" />
      <Button :label="$t('Copier l’image')" icon="pi pi-copy" severity="secondary" outlined :disabled="busy" @click="copy" />
      <Button :label="$t('Télécharger')" icon="pi pi-download" :loading="busy" @click="run" />
    </template>
  </Dialog>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
}
.label {
  min-width: 5rem;
  font-weight: 600;
}
.hint {
  margin: -0.4rem 0 0 5.6rem;
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}
.mermaid {
  margin-right: auto;
}
@media (max-width: 30rem) {
  .hint {
    margin-left: 0;
  }
}
</style>
