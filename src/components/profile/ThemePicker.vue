<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import Textarea from 'primevue/textarea';
import { useConfirm } from 'primevue/useconfirm';
import { APPEARANCE_LIMITS, DEFAULT_FONTS, EMPTY_THEME_FONTS, SURFACE_SWATCHES, THEMES, findTheme, isHexColor, parseThemeFile, themeFile, type AppearanceDTO, type CustomThemeDef, type SharedThemeDTO, type ThemeDef } from '@shared/themes';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { currentThemeId, customThemes } from '@/theme/themeManager';
import { notify, notifyError } from '@/utils/notify';
import ThemeEditorDialog from './ThemeEditorDialog.vue';

import { t } from '@/i18n';
defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ select: [themeId: string] }>();

const auth = useAuthStore();
const confirm = useConfirm();
const editing = ref<CustomThemeDef | null>(null);
const editorOpen = ref(false);

/** Aperçu d'un thème personnalisé : couleur principale et fond calculé d'après la surface (ou réglé). */
function customStyle(theme: Omit<CustomThemeDef, 'id'>): Record<string, string> {
  const dark = theme.mode === 'dark';
  const background = isHexColor(theme.surface) ? `color-mix(in srgb, ${theme.surface} ${dark ? 18 : 6}%, ${dark ? '#000' : '#fff'})` : SURFACE_SWATCHES[theme.surface as keyof typeof SURFACE_SWATCHES]?.[dark ? 'dark' : 'light'] ?? '#fff';
  return { '--sw-bg': theme.colors.background ?? background, '--sw-fg': theme.colors.text ?? (dark ? '#e5e7eb' : '#111827'), '--sw-accent': theme.primary };
}

const newId = () => `custom-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

/** Nouveau thème : part du thème actuel. */
function create(): void {
  const current = findTheme(currentThemeId.value);
  const custom = customThemes.value.find((theme) => theme.id === currentThemeId.value);
  editing.value = custom
    ? { ...custom, id: newId(), label: t('{name} (copie)', { name: custom.label }) }
    : current
      ? { id: newId(), label: '', mode: current.mode, preset: current.preset, primary: current.preview.accent, surface: current.surface, colors: {}, fonts: { ...EMPTY_THEME_FONTS } }
      : null;
  editorOpen.value = true;
}

function edit(theme: CustomThemeDef): void {
  editing.value = { ...theme };
  editorOpen.value = true;
}

function appearance(themes: CustomThemeDef[]): AppearanceDTO {
  return { ...(auth.user?.appearance ?? { fonts: { ...DEFAULT_FONTS }, reading: 'screen' }), customThemes: themes };
}

async function save(theme: CustomThemeDef): Promise<void> {
  const exists = customThemes.value.some((entry) => entry.id === theme.id);
  const themes = exists ? customThemes.value.map((entry) => (entry.id === theme.id ? theme : entry)) : [...customThemes.value, theme];
  try {
    await auth.updateProfile({ appearance: appearance(themes), theme: theme.id });
  } catch (error) {
    notifyError(error, t('Thème non enregistré'));
  }
}

/** Ajoute un thème venu d'ailleurs (fichier, bibliothèque) à mes thèmes, et l'utilise. */
async function adopt(theme: CustomThemeDef): Promise<boolean> {
  if (customThemes.value.length >= APPEARANCE_LIMITS.themes) {
    notify('warn', t('Trop de thèmes'), t('Supprimez un de vos thèmes avant d’en ajouter un autre.'));
    return false;
  }
  await save(theme);
  notify('success', t('Thème ajouté'), t('« {name} » est dans vos thèmes, et utilisé.', { name: theme.label }));
  return true;
}

// --- Exporter, importer ---
function exportTheme(theme: CustomThemeDef): void {
  const blob = new Blob([JSON.stringify(themeFile(theme), null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${theme.label.replace(/[\\/:*?"<>|]+/g, '-')}.fastboard-theme.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

const importOpen = ref(false);
const importText = ref('');
const importError = ref('');
const fileInput = ref<HTMLInputElement | null>(null);

function openImport(): void {
  importText.value = '';
  importError.value = '';
  importOpen.value = true;
}

async function readFile(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = '';
  if (file) importText.value = await file.text();
}

async function runImport(): Promise<void> {
  importError.value = '';
  let raw: unknown;
  try {
    raw = JSON.parse(importText.value);
  } catch {
    importError.value = t('Ce n’est pas un thème exporté par FastBoard (texte JSON attendu).');
    return;
  }
  const theme = parseThemeFile(raw, newId());
  if (!theme) {
    importError.value = t('Thème invalide : il manque au moins sa couleur principale.');
    return;
  }
  if (await adopt(theme)) importOpen.value = false;
}

// --- Bibliothèque du site ---
const shared = ref<SharedThemeDTO[]>([]);
const sharedLoaded = ref(false);

async function loadShared(): Promise<void> {
  try {
    shared.value = (await api.sharedThemes()).themes;
  } catch {
    // Bibliothèque indisponible : mes thèmes restent utilisables.
  } finally {
    sharedLoaded.value = true;
  }
}
onMounted(() => void loadShared());

async function publish(theme: CustomThemeDef): Promise<void> {
  const { id: _id, ...rest } = theme;
  try {
    const { theme: published } = await api.publishTheme(rest);
    shared.value = [published, ...shared.value];
    notify('success', t('Thème partagé'), t('Toutes les personnes du site peuvent maintenant ajouter « {name} » à leurs thèmes.', { name: theme.label }));
  } catch (error) {
    notifyError(error, t('Thème non partagé'));
  }
}

function canRemoveShared(entry: SharedThemeDTO): boolean {
  return entry.authorId === auth.user?.id || auth.can('settings.manage');
}

function removeShared(entry: SharedThemeDTO): void {
  confirm.require({
    header: t('Retirer de la bibliothèque'),
    message: t('Retirer « {name} » des thèmes partagés ? Ceux qui l’ont déjà ajouté le gardent.', { name: entry.theme.label }),
    icon: 'pi pi-trash',
    acceptProps: { label: t('Retirer'), severity: 'danger' },
    rejectProps: { label: t('Annuler'), severity: 'secondary', text: true },
    accept: async () => {
      try {
        await api.removeSharedTheme(entry.id);
        shared.value = shared.value.filter((candidate) => candidate.id !== entry.id);
      } catch (error) {
        notifyError(error);
      }
    },
  });
}

function remove(theme: CustomThemeDef): void {
  confirm.require({
    header: t('Supprimer le thème'),
    message: t('Supprimer le thème « {name} » ?', { name: theme.label }),
    icon: 'pi pi-trash',
    acceptProps: { label: t('Supprimer'), severity: 'danger' },
    rejectProps: { label: t('Annuler'), severity: 'secondary', text: true },
    accept: async () => {
      try {
        await auth.updateProfile({ appearance: appearance(customThemes.value.filter((entry) => entry.id !== theme.id)) });
      } catch (error) {
        notifyError(error);
      }
    },
  });
}

const groups = computed(() => [
  { key: 'light', title: t('Thèmes clairs'), icon: 'pi pi-sun', themes: THEMES.filter((theme) => theme.mode === 'light') },
  { key: 'dark', title: t('Thèmes sombres'), icon: 'pi pi-moon', themes: THEMES.filter((theme) => theme.mode === 'dark') },
]);

function swatchStyle(theme: ThemeDef): Record<string, string> {
  return { '--sw-bg': theme.preview.background, '--sw-fg': theme.preview.text, '--sw-accent': theme.preview.accent };
}
</script>

<template>
  <div class="theme-picker">
    <section>
      <h4 class="group-title">
        <i class="pi pi-palette"></i> <span class="grow">{{ $t('Mes thèmes') }}</span>
        <Button :label="$t('Importer un thème')" icon="pi pi-upload" size="small" text severity="secondary" :disabled="disabled" @click="openImport" />
      </h4>
      <div class="grid" role="radiogroup" :aria-label="$t('Mes thèmes')">
        <div v-for="theme in customThemes" :key="theme.id" class="custom-wrap">
          <button type="button" role="radio" class="theme-card" :class="{ selected: currentThemeId === theme.id }" :aria-checked="currentThemeId === theme.id" :disabled="disabled" @click="emit('select', theme.id)">
            <span class="swatch" :style="customStyle(theme)">
              <span class="bar"></span>
              <span class="lines"><i></i><i></i></span>
              <span class="chip"></span>
            </span>
            <span class="name">{{ theme.label }}</span>
            <i v-if="currentThemeId === theme.id" class="pi pi-check-circle check" :style="customStyle(theme)"></i>
          </button>
          <span class="tools">
            <button v-tooltip.top="$t('Modifier')" type="button" class="tool" :aria-label="$t('Modifier')" @click="edit(theme)"><i class="pi pi-pencil"></i></button>
            <button v-tooltip.top="$t('Exporter (fichier à envoyer)')" type="button" class="tool" :aria-label="$t('Exporter (fichier à envoyer)')" @click="exportTheme(theme)"><i class="pi pi-download"></i></button>
            <button v-tooltip.top="$t('Partager avec tout le site')" type="button" class="tool" :aria-label="$t('Partager avec tout le site')" @click="publish(theme)"><i class="pi pi-share-alt"></i></button>
            <button v-tooltip.top="$t('Supprimer')" type="button" class="tool" :aria-label="$t('Supprimer')" @click="remove(theme)"><i class="pi pi-trash"></i></button>
          </span>
        </div>
        <button v-if="customThemes.length < APPEARANCE_LIMITS.themes" type="button" class="theme-card create" :disabled="disabled" @click="create">
          <i class="pi pi-plus"></i>
          <span class="name">{{ $t('Créer un thème') }}</span>
        </button>
      </div>
    </section>
    <section>
      <h4 class="group-title"><i class="pi pi-users"></i> {{ $t('Thèmes partagés du site') }}</h4>
      <p v-if="sharedLoaded && !shared.length" class="muted small empty">{{ $t('Aucun thème partagé pour l’instant : survolez un de vos thèmes, puis « Partager avec tout le site ».') }}</p>
      <div v-else class="grid">
        <div v-for="entry in shared" :key="entry.id" class="custom-wrap">
          <button type="button" class="theme-card" :disabled="disabled" :title="$t('Ajouter à mes thèmes')" @click="adopt({ ...entry.theme, id: newId() })">
            <span class="swatch" :style="customStyle(entry.theme)">
              <span class="bar"></span>
              <span class="lines"><i></i><i></i></span>
              <span class="chip"></span>
            </span>
            <span class="name">{{ entry.theme.label }}</span>
            <span class="author muted">{{ entry.authorName || $t('Utilisateur supprimé') }}</span>
          </button>
          <span class="tools">
            <button v-tooltip.top="$t('Ajouter à mes thèmes')" type="button" class="tool" :aria-label="$t('Ajouter à mes thèmes')" @click="adopt({ ...entry.theme, id: newId() })"><i class="pi pi-plus"></i></button>
            <button v-if="canRemoveShared(entry)" v-tooltip.top="$t('Retirer de la bibliothèque')" type="button" class="tool" :aria-label="$t('Retirer de la bibliothèque')" @click="removeShared(entry)"><i class="pi pi-trash"></i></button>
          </span>
        </div>
      </div>
    </section>
    <section v-for="group in groups" :key="group.key">
      <h4 class="group-title"><i :class="group.icon"></i> {{ group.title }}</h4>
      <div class="grid" role="radiogroup" :aria-label="group.title">
        <button
          v-for="theme in group.themes"
          :key="theme.id"
          type="button"
          role="radio"
          class="theme-card"
          :class="{ selected: currentThemeId === theme.id }"
          :aria-checked="currentThemeId === theme.id"
          :disabled="disabled"
          @click="emit('select', theme.id)"
        >
          <span class="swatch" :style="swatchStyle(theme)">
            <span class="bar"></span>
            <span class="lines"><i></i><i></i></span>
            <span class="chip"></span>
          </span>
          <span class="name">{{ $t(theme.label) }}</span>
          <i v-if="currentThemeId === theme.id" class="pi pi-check-circle check"></i>
        </button>
      </div>
    </section>
    <ThemeEditorDialog v-model:visible="editorOpen" :theme="editing" :is-new="!customThemes.some((entry) => entry.id === editing?.id)" @save="save" />
    <Dialog v-model:visible="importOpen" modal :header="$t('Importer un thème')" :style="{ width: 'min(30rem, 96vw)' }">
      <div class="import">
        <p class="muted small">{{ $t('Choisissez le fichier .fastboard-theme.json qu’on vous a envoyé, ou collez son contenu.') }}</p>
        <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="readFile" />
        <Button :label="$t('Choisir un fichier…')" icon="pi pi-folder-open" severity="secondary" outlined size="small" @click="fileInput?.click()" />
        <Textarea v-model="importText" rows="7" fluid class="import-text" :placeholder="$t('Contenu du thème (JSON)')" :aria-label="$t('Contenu du thème (JSON)')" />
        <small v-if="importError" class="error">{{ importError }}</small>
      </div>
      <template #footer>
        <Button :label="$t('Annuler')" severity="secondary" text @click="importOpen = false" />
        <Button :label="$t('Importer')" icon="pi pi-check" :disabled="!importText.trim()" @click="runImport" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.theme-picker {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.group-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.6rem;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--fb-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
  gap: 0.6rem;
}
.theme-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.45rem;
  border: 2px solid var(--fb-border);
  border-radius: 12px;
  background: var(--fb-panel);
  color: var(--fb-text);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, transform 0.15s;
}
.theme-card:hover:not(:disabled) {
  border-color: var(--fb-accent);
  transform: translateY(-1px);
}
.theme-card:focus-visible {
  outline: 2px solid var(--fb-accent);
  outline-offset: 2px;
}
.theme-card.selected {
  border-color: var(--fb-accent);
  box-shadow: 0 0 0 3px var(--fb-accent-soft);
}
.swatch {
  position: relative;
  display: block;
  height: 3.6rem;
  padding: 0.45rem;
  border-radius: 8px;
  background: var(--sw-bg);
  border: 1px solid color-mix(in srgb, var(--sw-fg) 14%, transparent);
  overflow: hidden;
}
.bar {
  display: block;
  width: 55%;
  height: 0.4rem;
  border-radius: 4px;
  background: var(--sw-accent);
}
.lines {
  display: block;
  margin-top: 0.4rem;
}
.lines i {
  display: block;
  height: 0.25rem;
  margin-bottom: 0.25rem;
  border-radius: 3px;
  background: color-mix(in srgb, var(--sw-fg) 35%, transparent);
}
.lines i:last-child {
  width: 70%;
}
.chip {
  position: absolute;
  right: 0.45rem;
  bottom: 0.45rem;
  width: 1.1rem;
  height: 0.7rem;
  border-radius: 4px;
  background: var(--sw-accent);
}
.name {
  padding: 0 0.15rem 0.1rem;
  font-size: 0.8rem;
  font-weight: 600;
}
.custom-wrap {
  position: relative;
}
.custom-wrap .theme-card {
  width: 100%;
}
.tools {
  position: absolute;
  top: 0.75rem;
  left: 0.75rem;
  display: none;
  gap: 0.2rem;
}
.custom-wrap:hover .tools,
.custom-wrap:focus-within .tools {
  display: flex;
}
.tool {
  display: grid;
  place-items: center;
  width: 1.5rem;
  height: 1.5rem;
  border: 0;
  border-radius: 6px;
  background: rgb(0 0 0 / 55%);
  color: #fff;
  font-size: 0.7rem;
  cursor: pointer;
}
.create {
  align-items: center;
  justify-content: center;
  min-height: 5.6rem;
  border-style: dashed;
  color: var(--fb-muted);
}
.create i {
  font-size: 1.1rem;
}
.grow {
  flex: 1;
}
.group-title :deep(.p-button) {
  text-transform: none;
  letter-spacing: normal;
}
.author {
  margin-top: -0.35rem;
  padding: 0 0.15rem;
  overflow: hidden;
  font-size: 0.72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty {
  margin: 0;
}
.import {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.6rem;
}
.import p {
  margin: 0;
}
.import-text {
  font-family: var(--fb-font-mono, ui-monospace, monospace);
  font-size: 0.8rem;
}
.error {
  color: var(--fb-danger);
}
.check {
  position: absolute;
  top: 0.8rem;
  right: 0.85rem;
  color: var(--sw-accent);
  font-size: 1rem;
  background: var(--sw-bg);
  border-radius: 50%;
}
</style>
