<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import Select from 'primevue/select';
import Textarea from 'primevue/textarea';
import { drawioPages, drawioToElements, type DrawioImage, type DrawioPage } from '@shared/boardDrawio';
import type { BoardElement } from '@shared/boards';
import { t } from '@/i18n';

/**
 * Import d'un diagramme draw.io (diagrams.net) : un fichier `.drawio` ou `.xml`, ou le XML collé (Fichier → Exporter
 * en → XML, ou Ctrl C dans draw.io). Un fichier de plusieurs pages laisse choisir la page.
 */
const props = defineProps<{ zStart: number; text?: string; busy?: boolean; canUpload?: boolean }>();
const emit = defineEmits<{ import: [elements: BoardElement[], images: DrawioImage[]] }>();
const visible = defineModel<boolean>('visible', { required: true });

const draft = ref('');
const pages = ref<DrawioPage[]>([]);
const page = ref(0);
const error = ref('');
const fileInput = ref<HTMLInputElement | null>(null);

watch(visible, (open) => {
  if (!open) return;
  draft.value = props.text ?? '';
  error.value = '';
});

let parsing = 0;
watch(draft, async (value) => {
  const run = ++parsing;
  error.value = '';
  if (!value.trim()) {
    pages.value = [];
    return;
  }
  try {
    const found = await drawioPages(value);
    if (run !== parsing) return;
    pages.value = found;
    page.value = 0;
    if (!found.length) error.value = t('Aucun diagramme draw.io dans ce texte.');
  } catch {
    if (run !== parsing) return;
    pages.value = [];
    error.value = t('Ce fichier draw.io est illisible.');
  }
});

const result = computed(() => {
  const chosen = pages.value[page.value];
  if (!chosen) return null;
  try {
    return drawioToElements(chosen.model, { zStart: props.zStart });
  } catch {
    return null;
  }
});
const summary = computed(() => {
  if (!result.value) return '';
  const shapes = result.value.elements.filter((element) => element.type !== 'connector').length;
  const links = result.value.elements.length - shapes;
  // Seules les images intégrées au fichier (data:) s'importent ; celles hébergées sur un autre site gardent un cadre.
  const embedded = props.canUpload ? result.value.images.filter((image) => image.source.startsWith('data:')).length : 0;
  const framed = result.value.images.length - embedded;
  return [
    t('{shapes} forme(s) et {links} lien(s) à poser sur le tableau.', { shapes, links }),
    embedded ? t('{n} image(s) seront envoyées dans l’espace.', { n: embedded }) : '',
    framed ? t('{n} image(s) hébergée(s) ailleurs ne sont pas importées : un cadre gardera leur place.', { n: framed }) : '',
    result.value.skipped ? t('{n} élément(s) non repris.', { n: result.value.skipped }) : '',
  ]
    .filter(Boolean)
    .join(' ');
});
const pageOptions = computed(() => pages.value.map((entry, position) => ({ value: position, label: entry.name || t('Page {n}', { n: position + 1 }) })));

async function pickFile(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = '';
  if (file) draft.value = await file.text();
}

function run(): void {
  if (result.value?.elements.length) emit('import', result.value.elements, result.value.images);
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="$t('Importer depuis draw.io')" :style="{ width: 'min(44rem, calc(100vw - 2rem))' }">
    <p class="muted small intro">
      {{ $t('Choisissez un fichier .drawio ou .xml, ou collez le XML du diagramme (dans draw.io : Fichier → Exporter en → XML, ou copiez les formes avec Ctrl C).') }}
      {{ $t('Les images intégrées au diagramme sont importées avec lui.') }}
    </p>
    <div class="actions">
      <Button :label="$t('Choisir un fichier…')" icon="pi pi-folder-open" severity="secondary" outlined size="small" @click="fileInput?.click()" />
      <input ref="fileInput" type="file" accept=".drawio,.xml,.dio,application/xml,text/xml" hidden @change="pickFile" />
      <Select v-if="pages.length > 1" v-model="page" :options="pageOptions" option-label="label" option-value="value" size="small" :aria-label="$t('Page')" />
    </div>
    <Textarea v-model="draft" rows="10" class="code" spellcheck="false" :placeholder="'<mxfile>…</mxfile>'" :aria-label="$t('XML draw.io')" fluid />
    <p v-if="error" class="error small">{{ error }}</p>
    <p v-else-if="summary" class="muted small">{{ summary }}</p>
    <template #footer>
      <Button :label="$t('Annuler')" severity="secondary" text @click="visible = false" />
      <Button :label="$t('Importer')" icon="pi pi-download" :loading="busy" :disabled="!result?.elements.length" @click="run" />
    </template>
  </Dialog>
</template>

<style scoped>
.intro {
  margin-top: 0;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.6rem;
}
.code {
  font-family: var(--fb-font-mono, ui-monospace, monospace);
  font-size: 0.8rem;
}
.error {
  color: var(--fb-danger);
}
</style>
