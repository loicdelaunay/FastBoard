<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import { useConfirm } from 'primevue/useconfirm';
import { SNAPSHOT_LIMITS, type SnapshotKind, type SpaceSnapshotDTO } from '@shared/snapshots';
import { api } from '@/api';
import { t } from '@/i18n';
import { connection } from '@/offline/connection';
import { realtime } from '@/realtime/socket';
import { useAuthStore } from '@/stores/auth';
import { downloadFrom, formatBytes } from '@/utils/files';
import { formatDateTime, formatRelative } from '@/utils/format';
import { notify, notifyError } from '@/utils/notify';

/**
 * Étiquettes d'un espace de documentation, d'un espace de tableaux blancs ou d'un projet : en poser une fige tout son
 * contenu tel qu'il est ; chacune se consulte en lecture seule, se télécharge, redonne un espace (documentation,
 * tableaux) et se supprime. Le serveur vérifie les droits ; l'interface ne fait que masquer.
 */
const props = defineProps<{
  kind: SnapshotKind;
  spaceId: number;
  spaceName: string;
  /** Peut poser une étiquette (éditeur de l'espace ; pour un projet, le serveur tranche). */
  canWrite: boolean;
  /** Peut supprimer toutes les étiquettes (propriétaire de l'espace) ; sinon seulement les siennes. */
  canManage: boolean;
}>();
const visible = defineModel<boolean>('visible', { required: true });

const auth = useAuthStore();
const router = useRouter();
const confirm = useConfirm();
const snapshots = ref<SpaceSnapshotDTO[]>([]);
const loading = ref(false);
const name = ref('');
const description = ref('');
const busy = ref(false);

const ITEMS: Record<SnapshotKind, string> = { docs: '{n} note|{n} notes', boards: '{n} tableau|{n} tableaux', project: '{n} ticket|{n} tickets' };
const restorable = computed(() => props.kind !== 'project' && auth.can(props.kind === 'docs' ? 'docs.create' : 'boards.create'));
const writable = computed(() => props.canWrite && !connection.offline);

async function load(): Promise<void> {
  loading.value = true;
  try {
    snapshots.value = (await api.spaceSnapshots(props.kind, props.spaceId)).snapshots;
  } catch (error) {
    notifyError(error);
  } finally {
    loading.value = false;
  }
}

watch(
  () => [visible.value, props.kind, props.spaceId] as const,
  ([open]) => {
    if (!open) return;
    name.value = '';
    description.value = '';
    void load();
  },
  { immediate: true },
);

// Posée ou retirée ailleurs (autre personne, autre onglet, API) : la liste se relit.
const stop = realtime.on('snapshots', (kind, spaceId) => {
  if (visible.value && kind === props.kind && spaceId === props.spaceId) void load();
});
onBeforeUnmount(stop);

async function create(): Promise<void> {
  if (!name.value.trim() || busy.value) return;
  busy.value = true;
  try {
    const { snapshot } = await api.createSpaceSnapshot(props.kind, props.spaceId, name.value.trim(), description.value.trim());
    snapshots.value = [snapshot, ...snapshots.value.filter((entry) => entry.id !== snapshot.id)];
    name.value = '';
    description.value = '';
    notify('success', t('Étiquette posée'), t('« {name} » fige {items} ({size}).', { name: snapshot.name, items: t(ITEMS[props.kind], { n: snapshot.items }), size: formatBytes(snapshot.bytes) }));
  } catch (error) {
    notifyError(error);
  } finally {
    busy.value = false;
  }
}

function open(snapshot: SpaceSnapshotDTO): void {
  visible.value = false;
  void router.push({ name: 'snapshot', params: { snapshotId: snapshot.id } });
}

async function restore(snapshot: SpaceSnapshotDTO): Promise<void> {
  try {
    const created = await api.restoreSpaceSnapshot(snapshot.id);
    visible.value = false;
    notify('success', t('Nouvel espace créé'), t('Le contenu de « {name} » est dans un nouvel espace.', { name: snapshot.name }));
    void router.push(created.kind === 'docs' ? { name: 'doc-space', params: { spaceId: created.spaceId } } : { name: 'board-space', params: { spaceId: created.spaceId } });
  } catch (error) {
    notifyError(error);
  }
}

function remove(snapshot: SpaceSnapshotDTO): void {
  confirm.require({
    header: t('Supprimer l’étiquette « {name} » ?', { name: snapshot.name }),
    message: t('L’état figé de l’espace qu’elle garde est effacé ; l’espace lui-même ne change pas.'),
    icon: 'pi pi-trash',
    acceptLabel: t('Supprimer'),
    rejectLabel: t('Annuler'),
    acceptProps: { severity: 'danger' },
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      try {
        await api.deleteSpaceSnapshot(snapshot.id);
        snapshots.value = snapshots.value.filter((entry) => entry.id !== snapshot.id);
      } catch (error) {
        notifyError(error);
      }
    },
  });
}

const canRemove = (snapshot: SpaceSnapshotDTO): boolean => !connection.offline && (props.canManage || snapshot.createdBy === auth.user?.id);
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="$t('Étiquettes de « {name} »', { name: spaceName })" :style="{ width: 'min(40rem, 94vw)' }" :draggable="false">
    <p class="muted small intro">
      {{ $t('Une étiquette fige tout le contenu de l’espace tel qu’il est maintenant, fichiers compris. Il peut ensuite changer : l’étiquette, elle, ne change plus. Elle se consulte, se télécharge, et peut redonner un espace.') }}
    </p>

    <form v-if="writable" class="create" @submit.prevent="create">
      <InputText v-model="name" :placeholder="$t('Nom de l’étiquette (v1.0, Livré au client…)')" :maxlength="SNAPSHOT_LIMITS.nameMax" :aria-label="$t('Nom de l’étiquette')" class="name" />
      <Button type="submit" :label="$t('Poser l’étiquette')" icon="pi pi-tag" :loading="busy" :disabled="!name.trim()" />
      <Textarea v-model="description" :placeholder="$t('Description (facultative)')" :maxlength="SNAPSHOT_LIMITS.descriptionMax" rows="2" auto-resize class="description" :aria-label="$t('Description')" />
    </form>

    <div v-if="loading && !snapshots.length" class="empty muted"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</div>
    <p v-else-if="!snapshots.length" class="empty muted">{{ $t('Aucune étiquette sur cet espace.') }}</p>
    <ul v-else class="list">
      <li v-for="snapshot in snapshots" :key="snapshot.id" class="snapshot">
        <div class="head">
          <span class="tag"><i class="pi pi-tag"></i> {{ snapshot.name }}</span>
          <span v-tooltip.top="formatDateTime(snapshot.createdAt)" class="muted small">{{ formatRelative(snapshot.createdAt) }}<template v-if="snapshot.createdByName"> · {{ snapshot.createdByName }}</template></span>
        </div>
        <p v-if="snapshot.description" class="description-text small">{{ snapshot.description }}</p>
        <p class="muted small">{{ $t(ITEMS[kind], { n: snapshot.items }) }} · {{ $t('{n} fichier|{n} fichiers', { n: snapshot.files }) }} · {{ formatBytes(snapshot.bytes) }}</p>
        <div class="actions">
          <Button :label="$t('Consulter')" icon="pi pi-eye" size="small" @click="open(snapshot)" />
          <Button :label="$t('Télécharger')" icon="pi pi-download" size="small" severity="secondary" outlined @click="downloadFrom(`/api/snapshots/${snapshot.id}/download`)" />
          <Button v-if="restorable && !connection.offline" :label="$t('Nouvel espace depuis l’étiquette')" icon="pi pi-clone" size="small" severity="secondary" outlined @click="restore(snapshot)" />
          <Button v-if="canRemove(snapshot)" v-tooltip.top="$t('Supprimer l’étiquette')" icon="pi pi-trash" size="small" severity="danger" text :aria-label="$t('Supprimer l’étiquette')" @click="remove(snapshot)" />
        </div>
      </li>
    </ul>
  </Dialog>
</template>

<style scoped>
.intro {
  margin: 0 0 0.9rem;
}
.create {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.create .description {
  grid-column: 1 / -1;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.6rem;
  max-height: min(55vh, 32rem);
  overflow: auto;
}
.snapshot {
  border: 1px solid var(--fb-border);
  border-radius: 10px;
  padding: 0.7rem 0.8rem;
  display: grid;
  gap: 0.3rem;
}
.snapshot p {
  margin: 0;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.tag {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-weight: 600;
  padding: 0.1rem 0.55rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
  color: var(--p-primary-color);
}
.description-text {
  white-space: pre-wrap;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.2rem;
}
.empty {
  padding: 1rem 0;
  text-align: center;
}
@media (max-width: 520px) {
  .create {
    grid-template-columns: 1fr;
  }
}
</style>
