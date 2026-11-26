<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import { droppedFiles, hasFiles } from '@/composables/useFileDrop';
import { matchesQuery } from '@/utils/search';
import type { MarkdownImageChoice } from './markdownImages';

/**
 * « Insérer une image » d'un éditeur Markdown (description d'un ticket) : une image déjà jointe, ou une nouvelle
 * (bouton ou glisser-déposer), posée à l'endroit du curseur.
 */
const props = defineProps<{ choices: MarkdownImageChoice[]; emptyText: string }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ pick: [markdown: string]; upload: [files: File[]] }>();

const query = ref('');
const input = ref<HTMLInputElement | null>(null);
const over = ref(false);
watch(visible, (open) => open && (query.value = ''));
const shown = computed(() => props.choices.filter((choice) => matchesQuery(query.value, [choice.name])));

function pick(choice: MarkdownImageChoice): void {
  emit('pick', choice.markdown);
  visible.value = false;
}

function send(files: File[]): void {
  const images = files.filter((file) => file.type.startsWith('image/'));
  if (!images.length) return;
  emit('upload', images);
  visible.value = false;
}

function onPick(event: Event): void {
  const element = event.target as HTMLInputElement;
  send(Array.from(element.files ?? []));
  element.value = '';
}

function onDragOver(event: DragEvent): void {
  if (!hasFiles(event)) return;
  event.preventDefault();
  over.value = true;
}

function onDrop(event: DragEvent): void {
  if (!hasFiles(event)) return;
  event.preventDefault();
  over.value = false;
  send(droppedFiles(event));
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="$t('Insérer une image')" :style="{ width: 'min(42rem, 94vw)' }" :draggable="false">
    <div class="picker" :class="{ over }" @dragover="onDragOver" @dragleave="over = false" @drop="onDrop">
      <div class="bar">
        <IconField v-if="choices.length > 6" class="search">
          <InputIcon class="pi pi-search" />
          <InputText v-model="query" :placeholder="$t('Rechercher une image…')" size="small" fluid />
        </IconField>
        <Button :label="$t('Importer une image…')" icon="pi pi-upload" size="small" class="import" @click="input?.click()" />
        <input ref="input" type="file" accept="image/*" multiple hidden @change="onPick" />
      </div>
      <div v-if="shown.length" class="grid">
        <button v-for="choice in shown" :key="choice.key" type="button" class="choice" :title="choice.name" @click="pick(choice)">
          <span class="thumb"><img :src="choice.thumb" :alt="choice.name" loading="lazy" /></span>
          <span class="name truncate">{{ choice.name }}</span>
        </button>
      </div>
      <p v-else class="empty muted small">{{ choices.length ? $t('Aucune image ne correspond.') : emptyText }}</p>
      <p class="muted small drop-hint"><i class="pi pi-cloud-upload"></i> {{ $t('Ou glissez une image ici, ou collez-la directement dans le texte (Ctrl V).') }}</p>
    </div>
  </Dialog>
</template>

<style scoped>
.picker {
  display: grid;
  gap: 0.8rem;
  border: 2px dashed transparent;
  border-radius: 10px;
  padding: 0.2rem;
}
.picker.over {
  border-color: var(--fb-accent);
  background: color-mix(in srgb, var(--fb-accent) 6%, transparent);
}
.bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.search {
  flex: 1;
}
.import {
  margin-left: auto;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
  gap: 0.6rem;
  max-height: min(55vh, 28rem);
  overflow: auto;
}
.choice {
  display: grid;
  gap: 0.3rem;
  padding: 0.35rem;
  border: 1px solid var(--fb-border);
  border-radius: 10px;
  background: var(--fb-panel);
  color: var(--fb-text);
  font: inherit;
  font-size: 0.78rem;
  text-align: left;
  cursor: pointer;
}
.choice:hover,
.choice:focus-visible {
  border-color: var(--fb-accent);
}
.thumb {
  display: grid;
  place-items: center;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border-radius: 7px;
  background: var(--fb-panel-alt);
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.empty {
  margin: 1rem 0;
  text-align: center;
}
.drop-hint {
  margin: 0;
  text-align: center;
}
</style>
