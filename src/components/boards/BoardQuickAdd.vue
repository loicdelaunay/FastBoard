<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import { useConfirm } from 'primevue/useconfirm';
import { boardAssetUrl, boardIconUrl, MOCKUP_KINDS, SHAPE_KINDS, type BoardAssetDTO, type BoardNodeDTO } from '@shared/boards';
import { MOCKUP_LABELS } from '@shared/boardMockup';
import { api } from '@/api';
import { t } from '@/i18n';
import { darkMode } from '@/theme/themeManager';
import { notifyError } from '@/utils/notify';
import { customIcons, iconLibrary, libraryMarkup, loadCustomIcons, loadIconLibrary } from './editor/icons';
import { MOCKUP_ICONS, SHAPE_LABELS, shapeIcon, type BoardTool, type QuickPick } from './editor/tools';

/**
 * Ajout rapide : une recherche sur tout ce qui se pose sur un tableau (formes, textes, post-it, sections, cartes
 * mentales, tableaux, graphiques, Fast Elements), les modèles de l'espace, ses images et la bibliothèque d'icônes.
 * Flèches pour choisir, Entrée pour poser, Échap pour fermer.
 */
type Tab = 'all' | 'elements' | 'icons' | 'images' | 'templates';

const props = defineProps<{ x: number; y: number; area: { width: number; height: number }; templates: BoardNodeDTO[]; spaceId: number | null; canUpload: boolean; initial?: Tab }>();
const emit = defineEmits<{ pick: [pick: QuickPick]; close: [] }>();

const confirm = useConfirm();
const query = ref('');
const tab = ref<Tab>(props.initial ?? 'all');
const active = ref(0);
const assets = ref<BoardAssetDTO[]>([]);
const uploading = ref(false);
const box = ref<HTMLElement | null>(null);
const list = ref<HTMLElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const TABS = computed<Array<{ value: Tab; label: string }>>(() => [
  { value: 'all', label: t('Tout') },
  { value: 'elements', label: t('Éléments') },
  { value: 'icons', label: t('Icônes') },
  { value: 'images', label: t('Images') },
  { value: 'templates', label: t('Modèles') },
]);

onMounted(async () => {
  await nextTick();
  box.value?.querySelector<HTMLInputElement>('.search input')?.focus();
  void loadIconLibrary();
  void loadCustomIcons();
  if (props.spaceId) {
    try {
      assets.value = (await api.boardAssets(props.spaceId)).assets;
    } catch {
      // Sans la liste, le reste de l'ajout rapide fonctionne.
    }
  }
});

const fold = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const matches = (...texts: string[]): boolean => {
  const words = fold(query.value).split(/\s+/).filter(Boolean);
  const haystack = fold(texts.join(' '));
  return words.every((word) => haystack.includes(word));
};

interface Entry {
  key: string;
  pick: QuickPick;
  label: string;
  hint?: string;
  icon?: string;
  /** SVG construit ici (formes, icônes intégrées), jamais un texte saisi. */
  svg?: string;
  image?: string;
  asset?: BoardAssetDTO;
}

const ELEMENTS = computed<Array<Entry & { words: string }>>(() => {
  const tool = (value: BoardTool, label: string, icon: string, words: string): Entry & { words: string } => ({ key: `t:${value}`, pick: { kind: 'element', tool: value }, label: t(label), icon, words });
  return [
    ...SHAPE_KINDS.map((kind) => ({ key: `s:${kind}`, pick: { kind: 'element' as const, tool: 'shape' as const, shape: kind }, label: t(SHAPE_LABELS[kind]), hint: t('Forme'), svg: shapeIcon(kind), words: `forme shape ${kind}` })),
    tool('text', 'Texte', 'pi pi-language', 'text titre'),
    tool('sticky', 'Post-it', 'pi pi-stop', 'sticky note'),
    tool('frame', 'Section', 'pi pi-th-large', 'frame cadre zone groupe'),
    tool('mind', 'Carte mentale', 'pi pi-share-alt', 'mind map idee'),
    tool('table', 'Tableau', 'pi pi-table', 'table donnees grille'),
    tool('chart', 'Graphique', 'pi pi-chart-bar', 'chart diagramme barres courbe camembert'),
    tool('fast', 'Fast Element…', 'pi pi-bolt', 'ticket note dossier documentation tableau'),
    { key: 'mermaid', pick: { kind: 'mermaid' }, label: t('Importer du Mermaid…'), icon: 'pi pi-file-import', words: 'mermaid diagramme import' },
    ...MOCKUP_KINDS.map((kind) => ({
      key: `w:${kind}`,
      pick: { kind: 'element' as const, tool: 'mockup' as const, mockup: kind },
      label: t(MOCKUP_LABELS[kind]),
      hint: t('Maquette'),
      icon: MOCKUP_ICONS[kind],
      words: `maquette mockup wireframe ui ${kind}`,
    })),
  ];
});

const shownElements = computed(() => (tab.value === 'all' || tab.value === 'elements' ? ELEMENTS.value.filter((entry) => matches(entry.label, entry.hint ?? '', entry.words)) : []));
const shownTemplates = computed<Entry[]>(() =>
  tab.value === 'all' || tab.value === 'templates'
    ? props.templates
        .filter((node) => matches(node.path, 'modele template'))
        .map((node) => ({ key: `m:${node.id}`, pick: { kind: 'template', id: node.id, name: node.path }, label: node.path, hint: t('Modèle'), image: api.boardPreviewUrl(node.id, 120, darkMode.value) }))
    : [],
);
const shownImages = computed<Entry[]>(() =>
  tab.value === 'all' || tab.value === 'images' ? assets.value.filter((asset) => matches(asset.name, 'image photo svg')).map((asset) => ({ key: `a:${asset.id}`, pick: { kind: 'image', asset }, label: asset.name, image: boardAssetUrl(asset.key), asset })) : [],
);
const shownIcons = computed<Entry[]>(() => {
  if (tab.value !== 'all' && tab.value !== 'icons') return [];
  const custom = customIcons.value.filter((icon) => matches(icon.name, 'icone icon')).map((icon): Entry => ({ key: `c:${icon.id}`, pick: { kind: 'icon', icon: `custom:${icon.id}` }, label: icon.name, image: boardIconUrl(icon.id) }));
  const library = iconLibrary.value;
  const limit = tab.value === 'icons' ? 240 : query.value.trim() ? 60 : 30;
  const builtIn = library ? library.searchLibraryIcons(query.value, limit).map((icon): Entry => ({ key: icon.id, pick: { kind: 'icon', icon: icon.id }, label: icon.name, svg: libraryMarkup(icon.id) })) : [];
  return [...custom, ...builtIn];
});

/** Ordre de parcours au clavier : celui de l'affichage. */
const entries = computed(() => [...shownElements.value, ...shownTemplates.value, ...shownImages.value, ...shownIcons.value]);
const position = (entry: Entry): number => entries.value.indexOf(entry);

watch([query, tab], () => (active.value = 0));
watch(active, async () => {
  await nextTick();
  list.value?.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
});

function choose(entry: Entry | undefined): void {
  if (entry) emit('pick', entry.pick);
}

function onKey(event: KeyboardEvent): void {
  const count = entries.value.length;
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
  } else if (event.key === 'ArrowDown' || (event.key === 'ArrowRight' && !query.value)) {
    event.preventDefault();
    if (count) active.value = (active.value + 1) % count;
  } else if (event.key === 'ArrowUp' || (event.key === 'ArrowLeft' && !query.value)) {
    event.preventDefault();
    if (count) active.value = (active.value - 1 + count) % count;
  } else if (event.key === 'Enter') {
    event.preventDefault();
    choose(entries.value[active.value]);
  } else if (event.key === 'Tab') {
    event.preventDefault();
    const order = TABS.value.map((entry) => entry.value);
    tab.value = order[(order.indexOf(tab.value) + (event.shiftKey ? order.length - 1 : 1)) % order.length]!;
  }
}

async function upload(files: FileList | null): Promise<void> {
  if (!files?.length || !props.spaceId) return;
  uploading.value = true;
  try {
    let first: BoardAssetDTO | null = null;
    for (const file of [...files]) {
      const { asset } = await api.boardUploadAsset(props.spaceId, file);
      assets.value = [asset, ...assets.value];
      first ??= asset;
    }
    if (first) emit('pick', { kind: 'image', asset: first });
  } catch (error) {
    notifyError(error, t('Image non envoyée'));
  } finally {
    uploading.value = false;
    if (fileInput.value) fileInput.value.value = '';
  }
}

function askRemove(asset: BoardAssetDTO): void {
  confirm.require({
    header: t('Retirer « {name} » de l’espace ?', { name: asset.name }),
    message: t('Les tableaux qui l’affichent montreront qu’elle manque.'),
    icon: 'pi pi-trash',
    acceptLabel: t('Retirer'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      try {
        await api.boardDeleteAsset(asset.id);
        assets.value = assets.value.filter((entry) => entry.id !== asset.id);
      } catch (error) {
        notifyError(error);
      }
    },
  });
}

/** Dans le tableau, sans en dépasser les bords. */
const style = computed(() => {
  const width = Math.min(352, props.area.width - 16);
  const height = Math.min(440, props.area.height - 16);
  return {
    left: `${Math.max(8, Math.min(props.x, props.area.width - width - 8))}px`,
    top: `${Math.max(8, Math.min(props.y, props.area.height - height - 8))}px`,
    width: `${width}px`,
    maxHeight: `${height}px`,
  };
});
</script>

<template>
  <div ref="box" class="quick" :style="style" role="dialog" :aria-label="$t('Ajout rapide')" @pointerdown.stop @dblclick.stop @wheel.stop @contextmenu.stop.prevent @keydown="onKey">
    <IconField class="search">
      <InputIcon class="pi pi-search" />
      <InputText v-model="query" size="small" fluid :placeholder="$t('Forme, icône, image, modèle…')" :aria-label="$t('Rechercher ce qu’il faut ajouter')" />
    </IconField>
    <div class="tabs" role="tablist">
      <button v-for="entry in TABS" :key="entry.value" type="button" role="tab" class="tab" :class="{ active: tab === entry.value }" :aria-selected="tab === entry.value" @click="tab = entry.value">{{ entry.label }}</button>
    </div>

    <div ref="list" class="results">
      <section v-if="shownElements.length" class="group">
        <h5>{{ $t('Éléments') }}</h5>
        <button v-for="entry in shownElements" :key="entry.key" type="button" class="row" :class="{ active: position(entry) === active }" @click="choose(entry)" @pointerenter="active = position(entry)">
          <!-- eslint-disable-next-line vue/no-v-html -- forme dessinée ici. -->
          <span v-if="entry.svg" class="glyph shape" v-html="entry.svg"></span>
          <i v-else :class="entry.icon" class="glyph"></i>
          <span class="label truncate">{{ entry.label }}</span>
          <span v-if="entry.hint" class="muted small">{{ entry.hint }}</span>
        </button>
      </section>

      <section v-if="shownTemplates.length" class="group">
        <h5>{{ $t('Modèles') }}</h5>
        <button v-for="entry in shownTemplates" :key="entry.key" type="button" class="row" :class="{ active: position(entry) === active }" @click="choose(entry)" @pointerenter="active = position(entry)">
          <img :src="entry.image" alt="" class="thumb" loading="lazy" />
          <span class="label truncate">{{ entry.label }}</span>
          <i class="pi pi-clone muted"></i>
        </button>
      </section>
      <p v-else-if="tab === 'templates'" class="muted small empty">{{ $t('Aucun modèle : sélectionnez des éléments, clic droit, « Créer un modèle ».') }}</p>

      <section v-if="tab === 'images' || (tab === 'all' && (shownImages.length || (canUpload && !query)))" class="group">
        <h5>{{ $t('Images de l’espace') }}</h5>
        <div class="grid images">
          <div v-for="entry in shownImages" :key="entry.key" class="tile-wrap">
            <button type="button" class="tile" :class="{ active: position(entry) === active }" :title="entry.label" @click="choose(entry)" @pointerenter="active = position(entry)">
              <img :src="entry.image" :alt="entry.label" loading="lazy" draggable="false" />
            </button>
            <button v-if="canUpload && entry.asset" v-tooltip.top="$t('Retirer de l’espace')" type="button" class="remove" :aria-label="$t('Retirer de l’espace')" @click="askRemove(entry.asset)"><i class="pi pi-times"></i></button>
          </div>
          <button v-if="canUpload" type="button" class="tile upload" :disabled="uploading" :title="$t('Envoyer une image ou un SVG')" @click="fileInput?.click()">
            <i :class="uploading ? 'pi pi-spin pi-spinner' : 'pi pi-upload'"></i>
            <span class="small">{{ $t('Envoyer') }}</span>
          </button>
        </div>
        <p v-if="tab === 'images' && !shownImages.length && !canUpload" class="muted small">{{ $t('Aucune image dans cet espace.') }}</p>
        <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg" multiple hidden @change="upload(($event.target as HTMLInputElement).files)" />
      </section>

      <section v-if="shownIcons.length" class="group">
        <h5>{{ $t('Icônes') }}</h5>
        <div class="grid icons">
          <button v-for="entry in shownIcons" :key="entry.key" v-tooltip.top="entry.label" type="button" class="tile icon" :class="{ active: position(entry) === active }" :aria-label="entry.label" @click="choose(entry)" @pointerenter="active = position(entry)">
            <!-- eslint-disable-next-line vue/no-v-html -- icône de la bibliothèque intégrée (attributs échappés). -->
            <svg v-if="entry.svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" v-html="entry.svg"></svg>
            <img v-else :src="entry.image" alt="" loading="lazy" draggable="false" />
          </button>
        </div>
      </section>
      <p v-else-if="(tab === 'icons' || tab === 'all') && !iconLibrary" class="muted small empty"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement des icônes…') }}</p>

      <p v-if="!entries.length && iconLibrary && tab !== 'templates' && !(tab === 'images' && canUpload)" class="muted small empty">{{ $t('Rien ne correspond.') }}</p>
    </div>
    <footer class="foot muted small">{{ $t('↑ ↓ pour choisir · Entrée pour poser · Tab pour changer d’onglet') }}</footer>
  </div>
</template>

<style scoped>
.quick {
  position: absolute;
  z-index: 8;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--fb-border);
  border-radius: 12px;
  background: var(--fb-panel);
  box-shadow: 0 16px 40px rgb(0 0 0 / 0.22);
}
.search {
  margin: 0.6rem 0.6rem 0.4rem;
}
.tabs {
  display: flex;
  gap: 0.15rem;
  padding: 0 0.6rem 0.4rem;
  border-bottom: 1px solid var(--fb-border);
  overflow-x: auto;
}
.tab {
  flex: none;
  padding: 0.2rem 0.55rem;
  border: 0;
  border-radius: 999px;
  background: none;
  color: var(--fb-muted);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
.tab.active {
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
  font-weight: 600;
}
.results {
  flex: 1;
  min-height: 0;
  padding: 0.3rem 0.4rem 0.5rem;
  overflow-y: auto;
}
.group h5 {
  margin: 0.45rem 0.35rem 0.2rem;
  color: var(--fb-muted);
  font-size: 0.72rem;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
  padding: 0.32rem 0.45rem;
  border: 0;
  border-radius: 7px;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 0.86rem;
  text-align: left;
  cursor: pointer;
}
.row.active,
.tile.active {
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
}
.glyph {
  display: grid;
  place-items: center;
  width: 1.3rem;
  flex: none;
  color: var(--fb-muted);
  font-size: 0.9rem;
}
.glyph.shape :deep(svg) {
  width: 1.15rem;
  height: 1.15rem;
}
.label {
  flex: 1;
  min-width: 0;
}
.thumb {
  width: 2.2rem;
  height: 1.5rem;
  flex: none;
  border: 1px solid var(--fb-border);
  border-radius: 4px;
  background: var(--board-canvas);
  object-fit: contain;
}
.grid {
  display: grid;
  gap: 0.25rem;
  padding: 0 0.2rem;
}
.grid.icons {
  grid-template-columns: repeat(auto-fill, minmax(2.3rem, 1fr));
}
.grid.images {
  grid-template-columns: repeat(auto-fill, minmax(4.4rem, 1fr));
}
.tile-wrap {
  position: relative;
}
.tile {
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 1;
  padding: 0.3rem;
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--fb-panel-alt);
  color: inherit;
  cursor: pointer;
}
.tile:hover {
  border-color: var(--fb-border);
}
.tile.icon {
  padding: 0.45rem;
  background: none;
}
.tile svg,
.tile img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.tile.icon img {
  width: 1.5rem;
  height: 1.5rem;
  padding: 2px;
  border-radius: 4px;
  /* Icône ajoutée, dans ses couleurs : sur fond clair pour rester visible en thème sombre. */
  background: #f8fafc;
}
.tile.upload {
  gap: 0.1rem;
  border: 1px dashed var(--fb-border);
  background: none;
  color: var(--fb-muted);
}
.remove {
  position: absolute;
  top: 2px;
  right: 2px;
  display: none;
  place-items: center;
  width: 1.3rem;
  height: 1.3rem;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: rgb(15 18 24 / 0.7);
  color: #fff;
  font-size: 0.6rem;
  cursor: pointer;
}
.tile-wrap:hover .remove {
  display: grid;
}
.empty {
  margin: 0.6rem 0.5rem;
}
.foot {
  padding: 0.35rem 0.7rem;
  border-top: 1px solid var(--fb-border);
  font-size: 0.72rem;
}
</style>
