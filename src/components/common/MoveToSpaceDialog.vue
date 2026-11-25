<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import Select from 'primevue/select';
import { docRoleAtLeast, type DocRole } from '@shared/docs';
import { api } from '@/api';
import { t } from '@/i18n';
import { notifyError } from '@/utils/notify';

/**
 * « Déplacer vers… » : des éléments de la documentation ou des tableaux blancs partent dans un autre espace, à sa racine
 * ou dans un de ses dossiers. Seuls les espaces où l'on est éditeur sont proposés (le serveur le vérifie aussi).
 */
const props = defineProps<{
  module: 'docs' | 'boards';
  /** Espace de départ, qui n'est pas proposé. */
  spaceId: number;
  /** Éléments choisis (un dossier emporte son contenu). */
  items: Array<{ id: number; name: string; kind: string }>;
}>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ moved: [spaceId: number, spaceName: string, movedIds: number[]] }>();

interface SpaceOption {
  id: number;
  name: string;
}

const spaces = ref<SpaceOption[]>([]);
const loading = ref(false);
const target = ref<number | null>(null);
const folders = ref<string[]>([]);
/** Dossier d'arrivée ; `null` : la racine de l'espace. */
const folder = ref<string | null>(null);
const busy = ref(false);

const title = computed(() => (props.items.length === 1 ? t('Déplacer « {name} » vers…', { name: props.items[0]!.name }) : t('Déplacer {n} éléments vers…', { n: props.items.length })));
const hasFolder = computed(() => props.items.some((item) => item.kind === 'folder'));
const onlyTemplates = computed(() => props.items.length > 0 && props.items.every((item) => item.kind === 'template'));

watch(visible, async (open) => {
  if (!open) return;
  target.value = null;
  folder.value = null;
  folders.value = [];
  loading.value = true;
  try {
    const list = props.module === 'docs' ? (await api.docSpaces()).spaces : (await api.boardSpaces()).spaces;
    spaces.value = list.filter((space) => space.id !== props.spaceId && docRoleAtLeast(space.role as DocRole, 'editor')).map((space) => ({ id: space.id, name: space.name }));
  } catch (error) {
    notifyError(error);
  } finally {
    loading.value = false;
  }
});

watch(target, async (spaceId) => {
  folder.value = null;
  folders.value = [];
  if (spaceId === null || onlyTemplates.value) return;
  try {
    const nodes = props.module === 'docs' ? (await api.docSpace(spaceId)).nodes : (await api.boardSpace(spaceId)).nodes;
    if (target.value === spaceId) folders.value = nodes.filter((node) => node.kind === 'folder').map((node) => node.path).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
  } catch {
    // Sans la liste des dossiers, on déplace à la racine.
  }
});

async function submit(): Promise<void> {
  const spaceId = target.value;
  if (spaceId === null || busy.value) return;
  busy.value = true;
  try {
    const ids = props.items.map((item) => item.id);
    const result = props.module === 'docs' ? await api.docMoveToSpace(ids, spaceId, folder.value ?? '') : await api.boardMoveToSpace(ids, spaceId, folder.value ?? '');
    emit('moved', spaceId, spaces.value.find((space) => space.id === spaceId)?.name ?? '', result.nodes.map((node) => node.id));
    visible.value = false;
  } catch (error) {
    notifyError(error, t('Déplacement impossible'));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="title" :style="{ width: 'min(30rem, 94vw)' }" :draggable="false">
    <form class="move-form" @submit.prevent="submit">
      <label class="field">
        <span class="label">{{ $t('Espace d’arrivée') }}</span>
        <Select
          v-model="target"
          :options="spaces"
          option-label="name"
          option-value="id"
          :loading="loading"
          :placeholder="$t('Choisir un espace')"
          :empty-message="$t('Aucun autre espace où vous êtes éditeur.')"
          filter
          :filter-placeholder="$t('Rechercher un espace…')"
          auto-filter-focus
          fluid
          :aria-label="$t('Espace d’arrivée')"
        >
          <template #option="{ option }">
            <span class="space-option"><i :class="module === 'docs' ? 'pi pi-book' : 'pi pi-objects-column'" class="muted"></i>{{ option.name }}</span>
          </template>
        </Select>
      </label>
      <label v-if="target !== null && !onlyTemplates" class="field">
        <span class="label">{{ $t('Dossier') }}</span>
        <Select
          v-model="folder"
          :options="folders"
          :placeholder="$t('Racine de l’espace')"
          :empty-message="$t('Aucun dossier : tout ira à la racine.')"
          show-clear
          filter
          :filter-placeholder="$t('Rechercher un dossier…')"
          fluid
          :aria-label="$t('Dossier')"
        >
          <template #option="{ option }">
            <span class="space-option"><i class="pi pi-folder muted"></i>{{ option }}</span>
          </template>
        </Select>
      </label>
      <p class="muted small hint">
        <i class="pi pi-info-circle"></i>
        <span>
          {{ hasFolder ? $t('Un dossier part avec tout son contenu.') : '' }}
          {{ $t('Chaque élément garde son historique ; un nom déjà pris devient « Nom (2) ». Les personnes sans accès à l’espace d’arrivée ne le verront plus.') }}
        </span>
      </p>
      <div class="actions">
        <Button type="button" :label="$t('Annuler')" severity="secondary" text @click="visible = false" />
        <Button type="submit" :label="$t('Déplacer')" icon="pi pi-arrow-up-right" :loading="busy" :disabled="target === null" />
      </div>
    </form>
  </Dialog>
</template>

<style scoped>
.move-form {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.label {
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--fb-muted);
}
.space-option {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.hint {
  display: flex;
  gap: 0.45rem;
  margin: 0;
  line-height: 1.45;
}
.hint .pi {
  margin-top: 0.15rem;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
