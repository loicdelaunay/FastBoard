<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import { DOC_FOLDER_COLORS, DOC_FOLDER_ICONS, docBaseName, type DocNodeDTO } from '@shared/docs';
import { api } from '@/api';
import { t } from '@/i18n';
import { notify, notifyError } from '@/utils/notify';
import { DEFAULT_FOLDER_COLOR } from '@/utils/docFolders';

/**
 * Icône et couleur d'un dossier de la documentation : choisies dans une grille, avec un aperçu de la ligne de l'arbre.
 * « Par défaut » rend le dossier habituel, à sa couleur habituelle.
 */
const visible = defineModel<boolean>('visible', { required: true });
const props = defineProps<{ node: DocNodeDTO | null }>();
const emit = defineEmits<{ saved: [node: DocNodeDTO] }>();

const icon = ref<string | null>(null);
const color = ref<string | null>(null);
const filter = ref('');
const saving = ref(false);

watch(visible, (open) => {
  if (!open || !props.node) return;
  icon.value = props.node.icon;
  color.value = props.node.color;
  filter.value = '';
});

/** Nom lisible d'une icône PrimeIcons (`pi pi-chart-bar` → `chart bar`), pour la recherche et les lecteurs d'écran. */
const iconName = (value: string): string => value.replace(/^pi pi-/, '').replaceAll('-', ' ');
const icons = computed(() => {
  const query = filter.value.trim().toLowerCase();
  return query ? DOC_FOLDER_ICONS.filter((value) => iconName(value).includes(query)) : DOC_FOLDER_ICONS;
});
const shownIcon = computed(() => icon.value ?? 'pi pi-folder');
const shownColor = computed(() => color.value ?? DEFAULT_FOLDER_COLOR);
const changed = computed(() => props.node !== null && (icon.value !== props.node.icon || color.value !== props.node.color));

function pickIcon(value: string): void {
  icon.value = value === 'pi pi-folder' ? null : value;
}

function reset(): void {
  icon.value = null;
  color.value = null;
}

async function save(): Promise<void> {
  if (!props.node) return;
  saving.value = true;
  try {
    const { node } = await api.docSetFolderStyle(props.node.id, { icon: icon.value, color: color.value });
    emit('saved', node);
    notify('success', t('Dossier personnalisé'));
    visible.value = false;
  } catch (error) {
    notifyError(error, t('Apparence non enregistrée'));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="$t('Icône et couleur du dossier')" :style="{ width: '32rem' }" :breakpoints="{ '640px': '94vw' }">
    <div v-if="node" class="folder-style">
      <div class="preview" aria-hidden="true">
        <i class="pi pi-chevron-down chevron"></i>
        <i :class="shownIcon" :style="{ color: shownColor }"></i>
        <span class="truncate">{{ docBaseName(node.path) }}</span>
      </div>

      <section>
        <header class="section-head">
          <h3>{{ $t('Icône') }}</h3>
          <InputText v-model="filter" size="small" class="filter" :placeholder="$t('Rechercher une icône…')" :aria-label="$t('Rechercher une icône…')" />
        </header>
        <div class="icons" role="radiogroup" :aria-label="$t('Icône')">
          <button
            v-for="value in icons"
            :key="value"
            v-tooltip.top="{ value: iconName(value), showDelay: 300 }"
            type="button"
            class="icon-choice"
            role="radio"
            :aria-checked="shownIcon === value"
            :aria-label="iconName(value)"
            :class="{ active: shownIcon === value }"
            @click="pickIcon(value)"
          >
            <i :class="value" :style="{ color: shownColor }"></i>
          </button>
          <p v-if="!icons.length" class="muted small none">{{ $t('Aucune icône ne correspond.') }}</p>
        </div>
      </section>

      <section>
        <h3>{{ $t('Couleur') }}</h3>
        <div class="colors" role="radiogroup" :aria-label="$t('Couleur')">
          <button
            v-tooltip.top="$t('Couleur par défaut')"
            type="button"
            class="swatch default"
            role="radio"
            :aria-checked="color === null"
            :aria-label="$t('Couleur par défaut')"
            :class="{ active: color === null }"
            :style="{ background: DEFAULT_FOLDER_COLOR }"
            @click="color = null"
          ></button>
          <span class="divider" aria-hidden="true"></span>
          <button
            v-for="value in DOC_FOLDER_COLORS"
            :key="value"
            type="button"
            class="swatch"
            role="radio"
            :aria-checked="color === value"
            :aria-label="$t('Couleur {color}', { color: value })"
            :class="{ active: color === value }"
            :style="{ background: value }"
            @click="color = value"
          ></button>
          <label v-tooltip.top="$t('Autre couleur')" class="swatch custom" :class="{ active: color !== null && !(DOC_FOLDER_COLORS as readonly string[]).includes(color) }">
            <input type="color" :value="shownColor" :aria-label="$t('Autre couleur')" @input="color = ($event.target as HTMLInputElement).value.toLowerCase()" />
            <i class="pi pi-palette"></i>
          </label>
        </div>
      </section>
    </div>
    <template #footer>
      <Button :label="$t('Par défaut')" icon="pi pi-replay" text severity="secondary" class="reset" :disabled="icon === null && color === null" @click="reset" />
      <Button :label="$t('Annuler')" text severity="secondary" @click="visible = false" />
      <Button :label="$t('Enregistrer')" icon="pi pi-check" :loading="saving" :disabled="!changed" @click="save" />
    </template>
  </Dialog>
</template>

<style scoped>
.folder-style {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.preview {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.55rem 0.75rem;
  border: 1px solid var(--fb-border);
  border-radius: 8px;
  background: var(--fb-panel-alt);
  font-weight: 600;
}
.preview .chevron {
  color: var(--fb-muted);
  font-size: 0.65rem;
}
h3 {
  margin: 0 0 0.45rem;
  color: var(--fb-muted);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.45rem;
}
.section-head h3 {
  margin: 0;
}
.filter {
  width: 12rem;
  max-width: 55%;
}
.icons {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(2.25rem, 1fr));
  gap: 0.25rem;
  max-height: 18rem;
  overflow-y: auto;
  padding: 2px;
}
.icon-choice {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 2.25rem;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
}
.icon-choice:hover {
  background: var(--fb-panel-alt);
}
.icon-choice.active {
  border-color: var(--fb-accent);
  background: color-mix(in srgb, var(--fb-accent) 12%, transparent);
}
.icon-choice:focus-visible,
.swatch:focus-visible,
.swatch.custom:focus-within {
  outline: 2px solid var(--fb-accent);
  outline-offset: 1px;
}
.none {
  grid-column: 1 / -1;
  margin: 0.4rem 0;
}
.colors {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
}
.divider {
  width: 1px;
  height: 1.4rem;
  margin: 0 0.15rem;
  background: var(--fb-border);
}
.swatch {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 1.6rem;
  height: 1.6rem;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 999px;
  box-shadow: inset 0 0 0 2px var(--fb-panel);
  cursor: pointer;
}
.swatch.active {
  border-color: var(--fb-text);
}
.swatch.default::after {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: linear-gradient(135deg, transparent 45%, var(--fb-panel) 45%, var(--fb-panel) 55%, transparent 55%);
  content: '';
}
.swatch.custom {
  border: 2px dashed var(--fb-border);
  background: var(--fb-panel-alt);
  box-shadow: none;
  color: var(--fb-muted);
}
.swatch.custom.active {
  border-style: solid;
  border-color: var(--fb-text);
}
.swatch.custom input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
.reset {
  margin-right: auto;
}
</style>
