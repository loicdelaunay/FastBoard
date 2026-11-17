<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import ToggleSwitch from 'primevue/toggleswitch';
import { useConfirm } from 'primevue/useconfirm';
import { BOARD_ICON_LIMITS, boardIconUrl, type BoardIconDTO } from '@shared/boards';
import { api } from '@/api';
import { t } from '@/i18n';
import { useAppStore } from '@/stores/app';
import { notify, notifyError } from '@/utils/notify';

/** Active ou coupe les tableaux blancs sur le site (activés d'office). */
const app = useAppStore();
const state = ref<{ enabled: boolean; spaces: number; boards: number } | null>(null);
const saving = ref(false);

async function load(): Promise<void> {
  try {
    state.value = await api.adminBoards();
  } catch (error) {
    notifyError(error, t('Réglages des tableaux blancs indisponibles'));
  }
}
onMounted(() => {
  void load();
  void loadIcons();
});

// --- Icônes ajoutées, proposées dans tous les tableaux ---
const confirm = useConfirm();
const icons = ref<BoardIconDTO[]>([]);
const iconFilter = ref('');
const uploading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const shownIcons = computed(() => {
  const query = iconFilter.value.trim().toLowerCase();
  return query ? icons.value.filter((icon) => icon.name.toLowerCase().includes(query)) : icons.value;
});

async function loadIcons(): Promise<void> {
  try {
    icons.value = (await api.boardIcons()).icons;
  } catch {
    icons.value = [];
  }
}

/** Ajoute les SVG choisis : le nom de l'icône est celui du fichier. */
async function addIcons(files: FileList | null): Promise<void> {
  if (!files?.length) return;
  uploading.value = true;
  let added = 0;
  for (const file of [...files]) {
    try {
      if (file.size > BOARD_ICON_LIMITS.svgBytes) throw new Error(t('« {name} » dépasse {size} Ko.', { name: file.name, size: Math.round(BOARD_ICON_LIMITS.svgBytes / 1024) }));
      const name = file.name.replace(/\.svg$/i, '').replace(/[-_]+/g, ' ').trim();
      const { icon } = await api.adminAddBoardIcon(name, await file.text());
      icons.value = [...icons.value, icon].sort((a, b) => a.name.localeCompare(b.name));
      added += 1;
    } catch (error) {
      notifyError(error, t('« {name} » non ajoutée', { name: file.name }));
    }
  }
  uploading.value = false;
  if (fileInput.value) fileInput.value.value = '';
  if (added) notify('success', t('{n} icône ajoutée|{n} icônes ajoutées', { n: added }), t('Elle est proposée dans tous les tableaux.|Elles sont proposées dans tous les tableaux.', { n: added }));
}

function askRemove(icon: BoardIconDTO): void {
  confirm.require({
    header: t('Retirer l’icône « {name} » ?', { name: icon.name }),
    message: t('Elle disparaît de la bibliothèque et des tableaux qui l’utilisent.'),
    icon: 'pi pi-trash',
    acceptLabel: t('Retirer'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      try {
        await api.adminDeleteBoardIcon(icon.id);
        icons.value = icons.value.filter((entry) => entry.id !== icon.id);
      } catch (error) {
        notifyError(error);
      }
    },
  });
}

async function toggle(enabled: boolean): Promise<void> {
  saving.value = true;
  try {
    const result = await api.adminSetBoards(enabled);
    app.set(result.app);
    notify('success', enabled ? t('Tableaux blancs activés') : t('Tableaux blancs coupés'));
    await load();
  } catch (error) {
    notifyError(error, t('Enregistrement impossible'));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="page">
    <header class="head">
      <h1 class="page-title">{{ $t('Tableaux blancs') }}</h1>
      <p class="muted">{{ $t('Diagrammes, ateliers en post-it, cartes mentales et croquis, rangés en espaces et dessinés à plusieurs en temps réel.') }}</p>
    </header>

    <section v-if="state" class="card block">
      <label class="row master">
        <ToggleSwitch :model-value="state.enabled" :disabled="saving" :aria-label="$t('Activer les tableaux blancs')" @update:model-value="toggle" />
        <strong>{{ $t('Activer les tableaux blancs') }}</strong>
      </label>
      <p class="muted small">{{ state.enabled ? $t('L’entrée « Tableaux blancs » est visible dans la barre latérale.') : $t('L’entrée « Tableaux blancs » est masquée ; les tableaux restent en base.') }}</p>
      <dl class="stats">
        <div><dt class="muted small">{{ $t('Espaces') }}</dt><dd>{{ state.spaces }}</dd></div>
        <div><dt class="muted small">{{ $t('Tableaux') }}</dt><dd>{{ state.boards }}</dd></div>
      </dl>
    </section>

    <section class="card block">
      <div class="icons-head">
        <div>
          <h2 class="section-title">{{ $t('Icônes de la bibliothèque') }}</h2>
          <p class="muted small">{{ $t('En plus des icônes intégrées, ces SVG sont proposés à tout le monde dans l’ajout rapide des tableaux. Un SVG monochrome se recolore ; sans couleur choisie, il garde les siennes.') }}</p>
        </div>
        <Button :label="$t('Ajouter des SVG')" icon="pi pi-upload" size="small" :loading="uploading" @click="fileInput?.click()" />
        <input ref="fileInput" type="file" accept="image/svg+xml,.svg" multiple hidden @change="addIcons(($event.target as HTMLInputElement).files)" />
      </div>
      <IconField v-if="icons.length > 12">
        <InputIcon class="pi pi-search" />
        <InputText v-model="iconFilter" size="small" fluid :placeholder="$t('Filtrer les icônes…')" :aria-label="$t('Filtrer les icônes')" />
      </IconField>
      <div v-if="shownIcons.length" class="icon-grid">
        <figure v-for="icon in shownIcons" :key="icon.id" class="icon-card">
          <img :src="boardIconUrl(icon.id)" :alt="icon.name" loading="lazy" />
          <figcaption class="small truncate" :title="icon.name">{{ icon.name }}</figcaption>
          <button v-tooltip.top="$t('Retirer')" type="button" class="remove" :aria-label="$t('Retirer l’icône « {name} »', { name: icon.name })" @click="askRemove(icon)"><i class="pi pi-trash"></i></button>
        </figure>
      </div>
      <p v-else class="muted small">{{ icons.length ? $t('Aucune icône ne correspond.') : $t('Aucune icône ajoutée : la bibliothèque intégrée en propose déjà plus de 2 000.') }}</p>
    </section>
  </div>
</template>

<style scoped>
.head {
  margin-bottom: 1rem;
}
.head p {
  margin: 0.25rem 0 0;
}
.block {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1.1rem 1.25rem;
}
.block p {
  margin: 0;
}
.master {
  gap: 0.6rem;
  cursor: pointer;
}
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
  gap: 1rem;
  margin: 0;
}
.icons-head > button {
  flex: none;
  white-space: nowrap;
}
.icons-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}
.section-title {
  margin: 0 0 0.25rem;
  font-size: 1rem;
}
.icon-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr));
  gap: 0.5rem;
}
.icon-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  margin: 0;
  padding: 0.7rem 0.4rem 0.45rem;
  border: 1px solid var(--fb-border);
  border-radius: 8px;
  background: var(--board-canvas);
}
.icon-card img {
  width: 2.4rem;
  height: 2.4rem;
  padding: 0.25rem;
  border-radius: 6px;
  /* Fond clair : une icône noire reste visible en thème sombre. */
  background: #f8fafc;
  object-fit: contain;
}
.icon-card figcaption {
  max-width: 100%;
}
.icon-card .remove {
  position: absolute;
  top: 3px;
  right: 3px;
  display: none;
  place-items: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: var(--fb-panel);
  color: var(--fb-danger);
  cursor: pointer;
}
.icon-card:hover .remove,
.icon-card .remove:focus-visible {
  display: grid;
}
.stats dd {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
}
</style>
