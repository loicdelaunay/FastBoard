<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import { docBaseName, docParent, type DocNodeDTO } from '@shared/docs';
import { docImageUrl } from '@/utils/replaceImage';
import { matchesQuery } from '@/utils/search';

/**
 * « Insérer une image » dans une note : réutiliser une image déjà rangée dans l'espace (recherche dans son nom et son
 * dossier, avec sa vignette ; celles du dossier de la note d'abord), ou en importer depuis l'ordinateur.
 */
const props = defineProps<{ nodes: DocNodeDTO[]; notePath: string }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ pick: [node: DocNodeDTO]; upload: [] }>();

/** Au-delà, on demande de préciser la recherche : la fenêtre reste rapide dans un très grand espace. */
const SHOWN = 120;
const query = ref('');
const highlighted = ref(0);
const input = ref<{ $el: HTMLInputElement } | null>(null);
const grid = ref<HTMLElement | null>(null);

const folder = computed(() => docParent(props.notePath));
const images = computed(() => {
  const near = (node: DocNodeDTO) => (folder.value && node.path.startsWith(`${folder.value}/`) ? 0 : 1);
  return props.nodes
    .filter((node) => node.kind === 'image' && !node.deletedAt)
    .sort((a, b) => near(a) - near(b) || b.updatedAt.localeCompare(a.updatedAt));
});
const matching = computed(() => {
  const text = query.value.trim();
  return text ? images.value.filter((node) => matchesQuery(text, [docBaseName(node.path), node.path])) : images.value;
});
const shown = computed(() => matching.value.slice(0, SHOWN));

watch(visible, (open) => {
  if (!open) return;
  query.value = '';
  highlighted.value = 0;
});
watch(query, () => (highlighted.value = 0));

function pick(node: DocNodeDTO): void {
  emit('pick', node);
  visible.value = false;
}

function upload(): void {
  visible.value = false;
  emit('upload');
}

/** Nombre de vignettes par ligne, pour se déplacer avec ↑ ↓. */
function columns(): number {
  const cards = grid.value?.querySelectorAll<HTMLElement>('.card');
  if (!cards || cards.length < 2) return 1;
  const top = cards[0]!.offsetTop;
  let count = 0;
  for (const card of cards) {
    if (card.offsetTop !== top) break;
    count += 1;
  }
  return Math.max(1, count);
}

function onKeydown(event: KeyboardEvent): void {
  const count = shown.value.length;
  if (!count) return;
  const steps: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns(), ArrowUp: -columns() };
  const step = steps[event.key];
  // Dans le champ de recherche, ← → déplacent le curseur du texte.
  if (step !== undefined && !((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && event.target === input.value?.$el)) {
    event.preventDefault();
    highlighted.value = Math.min(count - 1, Math.max(0, highlighted.value + step));
    void nextTick(() => grid.value?.querySelector('.card.active')?.scrollIntoView({ block: 'nearest' }));
  } else if (event.key === 'Enter' && shown.value[highlighted.value]) {
    event.preventDefault();
    pick(shown.value[highlighted.value]!);
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="$t('Insérer une image')" :style="{ width: 'min(46rem, 96vw)' }" :draggable="false">
    <div class="picker" @keydown="onKeydown">
      <div class="top">
        <IconField class="search">
          <InputIcon class="pi pi-search" />
          <InputText ref="input" v-model="query" autofocus :placeholder="$t('Rechercher une image de l’espace…')" :aria-label="$t('Rechercher une image de l’espace')" fluid />
        </IconField>
        <Button :label="$t('Importer depuis l’ordinateur')" icon="pi pi-upload" severity="secondary" outlined @click="upload" />
      </div>
      <p class="muted small count">
        {{ query.trim() ? $t('{n} image trouvée|{n} images trouvées', { n: matching.length }) : $t('{n} image dans l’espace|{n} images dans l’espace', { n: images.length }) }}
        <span v-if="matching.length > SHOWN"> · {{ $t('Précisez la recherche pour voir les autres.') }}</span>
      </p>
      <div v-if="shown.length" ref="grid" class="grid" role="listbox" :aria-label="$t('Images de l’espace')">
        <button
          v-for="(node, index) in shown"
          :key="node.id"
          type="button"
          role="option"
          class="card"
          :class="{ active: index === highlighted }"
          :aria-selected="index === highlighted"
          :title="node.path"
          @click="pick(node)"
          @mouseenter="highlighted = index"
        >
          <span class="thumb"><img :src="docImageUrl(node)" :alt="docBaseName(node.path)" loading="lazy" /></span>
          <span class="name truncate">{{ docBaseName(node.path) }}</span>
          <span class="where muted truncate">{{ docParent(node.path) || $t('Racine de l’espace') }}</span>
        </button>
      </div>
      <div v-else class="empty">
        <i class="pi pi-images muted"></i>
        <p class="muted">{{ images.length ? $t('Aucune image ne correspond.') : $t('Aucune image dans l’espace pour l’instant.') }}</p>
        <Button :label="$t('Importer depuis l’ordinateur')" icon="pi pi-upload" @click="upload" />
      </div>
    </div>
  </Dialog>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.top {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.search {
  flex: 1 1 16rem;
}
.count {
  margin: 0;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
  gap: 0.6rem;
  max-height: min(28rem, 58vh);
  overflow-y: auto;
  padding: 0.15rem;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
  padding: 0.35rem;
  border: 1px solid var(--fb-border);
  border-radius: 10px;
  background: var(--fb-panel);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.card.active,
.card:focus-visible {
  border-color: var(--fb-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--fb-accent) 35%, transparent);
  outline: none;
}
.thumb {
  display: grid;
  place-items: center;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border-radius: 7px;
  background: repeating-conic-gradient(var(--fb-panel-alt) 0% 25%, transparent 0% 50%) 50% / 14px 14px;
}
.thumb img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.name {
  font-size: 0.82rem;
  font-weight: 600;
}
.where {
  font-size: 0.72rem;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2rem 0;
}
.empty .pi {
  font-size: 2rem;
}
.empty p {
  margin: 0;
}
</style>
