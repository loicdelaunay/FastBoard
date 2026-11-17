<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Dialog from 'primevue/dialog';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import SelectButton from 'primevue/selectbutton';
import type { FastRefKind } from '@shared/boards';
import { docBaseName, docParent, type DocNodeDTO, type DocSpaceDTO } from '@shared/docs';
import { api } from '@/api';
import { t } from '@/i18n';
import { useAppStore } from '@/stores/app';
import { matchesQuery } from '@/utils/search';
import type { FastPick } from './editor/tools';

/** Choix de l'objet d'un Fast Element : ticket, note, dossier ou espace de documentation, autre tableau blanc. */
const emit = defineEmits<{ pick: [pick: FastPick] }>();
const visible = defineModel<boolean>('visible', { required: true });

const app = useAppStore();
const kind = ref<FastRefKind>('ticket');
const query = ref('');
const loading = ref(false);
const results = ref<Array<FastPick & { detail: string }>>([]);
const spaces = ref<DocSpaceDTO[]>([]);
const folderSpace = ref<number | null>(null);
const folderNodes = ref<DocNodeDTO[]>([]);

const kinds = computed(() =>
  [
    { value: 'ticket', label: t('Tickets'), icon: 'pi pi-ticket' },
    ...(app.info.docs
      ? [
          { value: 'note', label: t('Notes'), icon: 'pi pi-file' },
          { value: 'folder', label: t('Dossiers'), icon: 'pi pi-folder' },
          { value: 'space', label: t('Espaces'), icon: 'pi pi-book' },
        ]
      : []),
    { value: 'board', label: t('Tableaux blancs'), icon: 'pi pi-objects-column' },
  ] as Array<{ value: FastRefKind; label: string; icon: string }>,
);

const ICONS: Record<FastRefKind, string> = { ticket: 'pi pi-ticket', note: 'pi pi-file', folder: 'pi pi-folder', space: 'pi pi-book', board: 'pi pi-objects-column' };

let request = 0;
let timer = 0;

async function search(): Promise<void> {
  const id = ++request;
  const text = query.value.trim();
  loading.value = true;
  try {
    let next: Array<FastPick & { detail: string }> = [];
    if (kind.value === 'ticket') {
      if (text) next = (await api.search(text, { type: ['tickets'], limit: 20 })).tickets.items.map((item) => ({ kind: 'ticket', id: item.id, label: `${item.key} — ${item.title}`, detail: item.projectName }));
    } else if (kind.value === 'note') {
      if (text) next = (await api.docSearch(text)).files.map((item) => ({ kind: 'note', id: item.id, label: item.title, detail: `${item.spaceName} · ${item.path}` }));
    } else if (kind.value === 'space') {
      if (!spaces.value.length) spaces.value = (await api.docSpaces()).spaces;
      next = spaces.value.filter((space) => matchesQuery(text, [space.name, space.description])).map((space) => ({ kind: 'space', id: space.id, label: space.name, detail: space.description }));
    } else if (kind.value === 'folder') {
      if (!spaces.value.length) spaces.value = (await api.docSpaces()).spaces;
      folderSpace.value ??= spaces.value[0]?.id ?? null;
      if (folderSpace.value !== null && !folderNodes.value.some((node) => node.spaceId === folderSpace.value)) folderNodes.value = (await api.docSpace(folderSpace.value)).nodes;
      next = folderNodes.value
        .filter((node) => node.kind === 'folder' && node.spaceId === folderSpace.value && matchesQuery(text, [node.path]))
        .map((node) => ({ kind: 'folder', id: node.id, label: docBaseName(node.path), detail: docParent(node.path) || (spaces.value.find((space) => space.id === node.spaceId)?.name ?? '') }));
    } else {
      next = (await api.boardSearch(text, 20)).boards.map((item) => ({ kind: 'board', id: item.id, label: item.title, detail: `${item.spaceName} · ${item.path}` }));
    }
    if (id === request) results.value = next;
  } catch {
    if (id === request) results.value = [];
  } finally {
    if (id === request) loading.value = false;
  }
}

watch([query, kind, folderSpace], () => {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void search(), 200);
});
watch(visible, (value) => {
  if (value) {
    query.value = '';
    void search();
  }
});
watch(folderSpace, () => {
  folderNodes.value = [];
});

function choose(item: FastPick): void {
  emit('pick', { kind: item.kind, id: item.id, label: item.label });
  visible.value = false;
}

const hint = computed(() => (kind.value === 'ticket' || kind.value === 'note' ? t('Tapez pour chercher.') : t('Aucun résultat')));
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="$t('Ajouter un Fast Element')" :style="{ width: 'min(36rem, calc(100vw - 2rem))' }">
    <p class="muted small intro">{{ $t('Un objet de FastBoard affiché sur le tableau, tenu à jour : un clic l’ouvre.') }}</p>
    <SelectButton v-model="kind" :options="kinds" option-label="label" option-value="value" :allow-empty="false" size="small" class="kinds">
      <template #option="{ option }"><i :class="option.icon"></i><span>{{ option.label }}</span></template>
    </SelectButton>
    <div class="search">
      <Select v-if="kind === 'folder'" v-model="folderSpace" :options="spaces" option-label="name" option-value="id" size="small" :aria-label="$t('Espace de documentation')" />
      <IconField class="grow">
        <InputIcon :class="loading ? 'pi pi-spin pi-spinner' : 'pi pi-search'" />
        <InputText v-model="query" size="small" fluid autofocus :placeholder="$t('Chercher…')" :aria-label="$t('Chercher')" />
      </IconField>
    </div>
    <ul v-if="results.length" class="results">
      <li v-for="item in results" :key="`${item.kind}${item.id}`">
        <button type="button" class="result" @click="choose(item)">
          <i :class="ICONS[item.kind]" class="icon"></i>
          <span class="text">
            <span class="truncate">{{ item.label }}</span>
            <small v-if="item.detail" class="muted truncate">{{ item.detail }}</small>
          </span>
          <i class="pi pi-plus add"></i>
        </button>
      </li>
    </ul>
    <p v-else class="muted small empty">{{ query.trim() || (kind !== 'ticket' && kind !== 'note') ? $t('Aucun résultat') : hint }}</p>
  </Dialog>
</template>

<style scoped>
.intro {
  margin: 0 0 0.75rem;
}
.kinds {
  margin-bottom: 0.6rem;
}
.kinds :deep(.p-togglebutton-content) {
  gap: 0.35rem;
}
.search {
  display: flex;
  gap: 0.5rem;
}
.grow {
  flex: 1;
}
.results {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  max-height: 22rem;
  margin: 0.6rem 0 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
.result {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  padding: 0.45rem 0.6rem;
  border: 0;
  border-radius: 8px;
  background: none;
  color: var(--fb-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.result:hover {
  background: var(--fb-panel-alt);
}
.icon {
  color: var(--fb-muted);
}
.text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.add {
  color: var(--fb-muted);
  font-size: 0.75rem;
}
.empty {
  margin: 1rem 0 0;
  text-align: center;
}
</style>
