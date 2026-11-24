<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import Slider from 'primevue/slider';
import { useConfirm } from 'primevue/useconfirm';
import { BOARD_LIMITS, diffElements, type BoardElement, type BoardNodeDTO, type BoardVersionDTO } from '@shared/boards';
import type { UserSummaryDTO } from '@shared/types';
import { VERSION_TAG_LIMITS } from '@shared/versionTags';
import { api } from '@/api';
import { t } from '@/i18n';
import { BoardSnapshotSession, type BoardSessionLike } from '@/realtime/boardSession';
import { formatDateTime, formatRelative } from '@/utils/format';
import { notify, notifyError } from '@/utils/notify';
import BoardCanvas from './BoardCanvas.vue';

/**
 * Mode « Historique » d'un tableau, comme la frise de Whimsical : on parcourt ses versions (curseur, flèches, lecture
 * automatique), le tableau s'affiche tel qu'il était, ce que chaque version ajoute ou modifie est entouré. Une version
 * se restaure, ou se copie dans un nouveau tableau, après confirmation.
 */
const props = defineProps<{
  boardId: number;
  title: string;
  /** Session du tableau ouvert : son contenu est le dernier arrêt de la frise, « Maintenant ». */
  session: BoardSessionLike;
  canEdit: boolean;
  users: UserSummaryDTO[];
  isTemplate?: boolean;
  /** Version à montrer d'abord (mention d'une version étiquetée) ; sinon la plus récente. */
  initialVersion?: number | null;
}>();
const emit = defineEmits<{ close: []; forked: [node: BoardNodeDTO] }>();
const confirm = useConfirm();

/** Arrêt de la frise : une version, ou l'état actuel quand il n'est pas encore noté dans l'historique. */
type Stop = BoardVersionDTO | { id: null; createdAt: null; userId: null; kind: 'edit'; elementCount: number; tag: null; taggedAt: null };

const liveElements = (): BoardElement[] => [...props.session.elements.values()];
const snapshot = new BoardSnapshotSession(props.boardId, liveElements());
const stops = shallowRef<Stop[]>([]);
const currentVersionId = ref<number | null>(null);
const position = ref(0);
const loading = ref(true);
const showChanges = ref(true);
const changes = shallowRef<{ added: ReadonlySet<string>; changed: ReadonlySet<string>; removed: number } | null>(null);
const cache = new Map<number, BoardElement[]>();

const stop = computed<Stop | undefined>(() => stops.value[position.value]);
const isCurrent = computed(() => !stop.value || stop.value.id === null || stop.value.id === currentVersionId.value);
const author = computed(() => {
  const id = stop.value?.userId;
  return id === null || id === undefined ? null : (props.users.find((user) => user.id === id)?.name ?? null);
});

async function elementsOf(entry: Stop): Promise<BoardElement[]> {
  if (entry.id === null) return liveElements();
  const cached = cache.get(entry.id);
  if (cached) return cached;
  const { elements } = await api.boardVersion(props.boardId, entry.id);
  cache.set(entry.id, elements);
  return elements;
}

/** Charge la frise ; `keep` : rester sur cette version (après une étiquette), sinon la version demandée ou la dernière. */
async function load(keep: number | null = null): Promise<void> {
  loading.value = true;
  try {
    const history = await api.boardVersions(props.boardId);
    currentVersionId.value = history.currentVersionId;
    // L'état à l'écran n'est pas encore une version (modification en cours d'enregistrement) : il ferme la frise.
    const now: Stop[] = history.currentVersionId === null ? [{ id: null, createdAt: null, userId: null, kind: 'edit', elementCount: props.session.elements.size, tag: null, taggedAt: null }] : [];
    stops.value = [...history.versions, ...now];
    const wanted = keep ?? props.initialVersion ?? null;
    const at = wanted === null ? -1 : stops.value.findIndex((entry) => entry.id === wanted);
    if (wanted !== null && at < 0 && keep === null) notify('warn', t('Version introuvable'), t('Elle a peut-être quitté l’historique : voici la plus récente.'));
    position.value = at >= 0 ? at : Math.max(0, stops.value.length - 1);
  } catch (error) {
    notifyError(error, t('Historique indisponible'));
    emit('close');
  } finally {
    loading.value = false;
  }
}

let shown = 0;
watch(
  () => [position.value, stops.value] as const,
  async ([at, list]) => {
    const entry = list[at];
    if (!entry) return;
    const run = ++shown;
    try {
      const [elements, before] = await Promise.all([elementsOf(entry), at > 0 ? elementsOf(list[at - 1]!) : Promise.resolve(null)]);
      if (run !== shown) return;
      snapshot.show(elements);
      if (before) {
        const diff = diffElements(before, elements);
        changes.value = { added: new Set(diff.added), changed: new Set(diff.changed), removed: diff.removed.length };
      } else changes.value = null;
    } catch (error) {
      if (run === shown) notifyError(error);
    }
  },
);

function step(delta: number): void {
  position.value = Math.min(stops.value.length - 1, Math.max(0, position.value + delta));
}

// --- Lecture automatique : la frise défile depuis l'arrêt choisi ---
const playing = ref(false);
let timer = 0;
function togglePlay(): void {
  if (playing.value) return stopPlay();
  if (position.value >= stops.value.length - 1) position.value = 0;
  playing.value = true;
  timer = window.setInterval(() => {
    if (position.value >= stops.value.length - 1) stopPlay();
    else step(1);
  }, 900);
}
function stopPlay(): void {
  playing.value = false;
  window.clearInterval(timer);
}

function onKey(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  if (forkOpen.value || tagOpen.value || target?.closest('input, textarea, [contenteditable="true"], .p-dialog, .p-confirmdialog')) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    stopPlay();
    step(event.key === 'ArrowLeft' ? -1 : 1);
  } else if (event.key === 'Escape') emit('close');
}

onMounted(() => {
  void load();
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  stopPlay();
  window.removeEventListener('keydown', onKey);
  snapshot.close();
});

const when = (entry: Stop | undefined): string => (entry?.createdAt ? formatDateTime(entry.createdAt) : t('Maintenant'));

// --- Étiquettes : une version nommée reste dans l'historique et se cite avec @ ---
const taggedStops = computed(() => stops.value.filter((entry): entry is BoardVersionDTO => entry.id !== null && Boolean(entry.tag)));
const tagOptions = computed(() => taggedStops.value.map((entry) => ({ value: entry.id, label: `${entry.tag} · ${formatDateTime(entry.createdAt)}` })));
const tagJump = computed({
  get: () => (stop.value?.id && stop.value.tag ? stop.value.id : null),
  set: (id: number | null) => {
    const at = stops.value.findIndex((entry) => entry.id === id);
    if (at >= 0) {
      stopPlay();
      position.value = at;
    }
  },
});
const tagOpen = ref(false);
const tagName = ref('');
function askTag(): void {
  stopPlay();
  tagName.value = stop.value?.tag ?? '';
  tagOpen.value = true;
}
async function saveTag(): Promise<void> {
  const entry = stop.value;
  const name = tagName.value.trim();
  if (!entry || !name) return;
  busy.value = true;
  try {
    // L'arrêt « Maintenant » n'est pas encore une version : le serveur la crée.
    const { version } = entry.id !== null && entry.tag ? await api.boardSetVersionTag(props.boardId, entry.id, name) : await api.boardTagVersion(props.boardId, name, entry.id);
    tagOpen.value = false;
    notify('success', t('Version étiquetée « {name} »', { name }), t('Elle reste dans l’historique avec ses images, et se cite avec @.'));
    await load(version.id);
  } catch (error) {
    notifyError(error, t('Étiquette non enregistrée'));
  } finally {
    busy.value = false;
  }
}
async function untag(): Promise<void> {
  const entry = stop.value;
  if (!entry || entry.id === null || !entry.tag) return;
  busy.value = true;
  try {
    await api.boardSetVersionTag(props.boardId, entry.id, null);
    notify('info', t('Étiquette retirée'), t('Cette version suit de nouveau la durée de conservation de l’historique.'));
    await load(entry.id);
  } catch (error) {
    notifyError(error, t('Étiquette non retirée'));
  } finally {
    busy.value = false;
  }
}
/** Revenir à la dernière version : le dernier arrêt de la frise. */
function latest(): void {
  stopPlay();
  position.value = Math.max(0, stops.value.length - 1);
}

// --- Restaurer ---
const busy = ref(false);
function askRestore(): void {
  const entry = stop.value;
  if (!entry || entry.id === null) return;
  stopPlay();
  confirm.require({
    header: t('Restaurer cette version ?'),
    message: t('Le tableau « {title} » reprend son état du {when}, pour toutes les personnes qui l’ont ouvert. L’état actuel reste dans l’historique : vous pourrez y revenir.', { title: props.title, when: when(entry) }),
    icon: 'pi pi-history',
    acceptLabel: t('Restaurer'),
    rejectLabel: t('Annuler'),
    rejectProps: { severity: 'secondary', text: true },
    accept: async () => {
      busy.value = true;
      try {
        await api.boardRestoreVersion(props.boardId, entry.id);
        notify('success', t('Version restaurée'), t('Le tableau a repris son état du {when}.', { when: when(entry) }));
        emit('close');
      } catch (error) {
        notifyError(error, t('Restauration impossible'));
      } finally {
        busy.value = false;
      }
    },
  });
}

// --- Copier dans un nouveau tableau ---
const forkOpen = ref(false);
const forkName = ref('');
function askFork(): void {
  const entry = stop.value;
  if (!entry || entry.id === null) return;
  stopPlay();
  forkName.value = `${props.title} (${when(entry).replace(/[\\/:]/g, '-')})`.slice(0, BOARD_LIMITS.nameMax);
  forkOpen.value = true;
}
async function fork(): Promise<void> {
  const entry = stop.value;
  const name = forkName.value.trim();
  if (!entry || entry.id === null || !name) return;
  busy.value = true;
  try {
    const { node } = await api.boardForkVersion(props.boardId, entry.id, name);
    forkOpen.value = false;
    notify('success', props.isTemplate ? t('Modèle créé') : t('Tableau créé'), t('« {name} » reprend la version du {when}.', { name, when: when(entry) }));
    emit('forked', node);
  } catch (error) {
    notifyError(error, t('Copie impossible'));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="timeline-mode">
    <BoardCanvas :session="snapshot" :can-edit="false" :users="users" :board-title="title" :changes="showChanges ? changes : null" />

    <div class="banner board-ui" role="status">
      <i class="pi pi-history"></i>
      <strong>{{ $t('Historique') }}</strong>
      <template v-if="stop">
        <span class="sep"></span>
        <span v-tooltip.bottom="stop.createdAt ? formatRelative(stop.createdAt) : undefined">{{ when(stop) }}</span>
        <span v-if="author" class="muted">· {{ author }}</span>
        <span v-if="stop.kind === 'restore'" class="chip restore"><i class="pi pi-replay"></i> {{ $t('Restauration') }}</span>
        <span v-if="stop.tag" v-tooltip.bottom="$t('Version étiquetée : jamais effacée de l’historique')" class="chip tagged"><i class="pi pi-tag"></i> {{ stop.tag }}</span>
        <span v-if="isCurrent" class="chip current">{{ $t('Version actuelle') }}</span>
        <template v-if="changes">
          <span v-if="changes.added.size" class="chip added">{{ $t('+{n} ajouté|+{n} ajoutés', { n: changes.added.size }) }}</span>
          <span v-if="changes.changed.size" class="chip changed">{{ $t('{n} modifié|{n} modifiés', { n: changes.changed.size }) }}</span>
          <span v-if="changes.removed" class="chip removed">{{ $t('−{n} retiré|−{n} retirés', { n: changes.removed }) }}</span>
        </template>
      </template>
      <Button :label="$t('Quitter')" icon="pi pi-times" size="small" severity="secondary" text class="quit" @click="emit('close')" />
    </div>

    <div class="scrubber board-ui">
      <p v-if="loading" class="muted small note"><i class="pi pi-spin pi-spinner"></i> {{ $t('Chargement…') }}</p>
      <template v-else>
        <p v-if="stops.length < 2" class="muted small note">{{ $t('Pas encore d’autre version : l’historique se remplit au fil des modifications du tableau.') }}</p>
        <div v-else class="track">
          <Button v-tooltip.top="playing ? $t('Pause') : $t('Faire défiler les versions')" :icon="playing ? 'pi pi-pause' : 'pi pi-play'" size="small" severity="secondary" text rounded :aria-label="playing ? $t('Pause') : $t('Faire défiler les versions')" @click="togglePlay" />
          <Button v-tooltip.top="$t('Version précédente (←)')" icon="pi pi-angle-left" size="small" severity="secondary" text rounded :disabled="position === 0" :aria-label="$t('Version précédente')" @click="(stopPlay(), step(-1))" />
          <Slider v-model="position" :min="0" :max="stops.length - 1" :step="1" class="slider" :aria-label="$t('Version affichée')" @slideend="stopPlay" />
          <Button v-tooltip.top="$t('Version suivante (→)')" icon="pi pi-angle-right" size="small" severity="secondary" text rounded :disabled="position >= stops.length - 1" :aria-label="$t('Version suivante')" @click="(stopPlay(), step(1))" />
          <span class="count muted small">{{ $t('{n} sur {total}', { n: position + 1, total: stops.length }) }}</span>
        </div>
        <div class="actions">
          <label class="toggle small">
            <input v-model="showChanges" type="checkbox" />
            <span>{{ $t('Entourer les changements') }}</span>
          </label>
          <Select v-if="tagOptions.length" v-model="tagJump" :options="tagOptions" option-label="label" option-value="value" :placeholder="$t('Versions étiquetées')" size="small" class="tag-jump" :aria-label="$t('Versions étiquetées')">
            <template #dropdownicon><i class="pi pi-tags"></i></template>
          </Select>
          <template v-if="canEdit">
            <Button v-if="!stop?.tag" :label="$t('Étiqueter…')" icon="pi pi-tag" size="small" severity="secondary" text :disabled="busy" @click="askTag" />
            <template v-else>
              <Button :label="$t('Renommer l’étiquette…')" icon="pi pi-pencil" size="small" severity="secondary" text :disabled="busy" @click="askTag" />
              <Button v-tooltip.top="$t('Retirer l’étiquette')" icon="pi pi-times" size="small" severity="secondary" text :aria-label="$t('Retirer l’étiquette')" :disabled="busy" @click="untag" />
            </template>
          </template>
          <span v-if="isCurrent" class="muted small">{{ $t('C’est l’état actuel du tableau.') }}</span>
          <template v-else>
            <span class="muted small readonly">{{ $t('Lecture seule : copiez cette version pour la modifier, ou repartez de la dernière version.') }}</span>
            <Button :label="$t('Dernière version')" icon="pi pi-arrow-right" icon-pos="right" size="small" severity="secondary" text @click="latest" />
          </template>
          <template v-if="!isCurrent && canEdit">
            <Button :label="isTemplate ? $t('Copier dans un nouveau modèle…') : $t('Copier dans un nouveau tableau…')" icon="pi pi-clone" size="small" severity="secondary" outlined :disabled="busy" @click="askFork" />
            <Button :label="$t('Restaurer cette version…')" icon="pi pi-history" size="small" :loading="busy" @click="askRestore" />
          </template>
        </div>
      </template>
    </div>

    <Dialog v-model:visible="tagOpen" modal :header="stop?.tag ? $t('Renommer l’étiquette') : $t('Étiqueter cette version')" :style="{ width: 'min(28rem, calc(100vw - 2rem))' }">
      <form class="field" @submit.prevent="saveTag">
        <label for="board-tag-name">{{ $t('Nom de l’étiquette') }}</label>
        <InputText id="board-tag-name" v-model="tagName" :maxlength="VERSION_TAG_LIMITS.nameMax" :placeholder="$t('v1.0, Validé client…')" autofocus fluid />
        <small class="muted">{{ $t('Une version étiquetée n’est jamais effacée de l’historique, et ses images et icônes ajoutées sont figées avec elle. Citez-la avec @ (son nom ou celui du tableau) : le lien l’ouvre ici, telle qu’elle était.') }}</small>
      </form>
      <template #footer>
        <Button :label="$t('Annuler')" severity="secondary" text @click="tagOpen = false" />
        <Button :label="$t('Étiqueter')" icon="pi pi-tag" :loading="busy" :disabled="!tagName.trim()" @click="saveTag" />
      </template>
    </Dialog>

    <Dialog v-model:visible="forkOpen" modal :header="isTemplate ? $t('Copier cette version dans un nouveau modèle') : $t('Copier cette version dans un nouveau tableau')" :style="{ width: 'min(30rem, calc(100vw - 2rem))' }">
      <p class="muted small fork-intro">{{ $t('Un nouveau tableau est créé à côté de celui-ci, avec le contenu du {when}. Le tableau actuel ne change pas.', { when: when(stop) }) }}</p>
      <form class="field" @submit.prevent="fork">
        <label for="board-fork-name">{{ $t('Nom') }}</label>
        <InputText id="board-fork-name" v-model="forkName" :maxlength="BOARD_LIMITS.nameMax" autofocus required fluid />
      </form>
      <template #footer>
        <Button :label="$t('Annuler')" severity="secondary" text @click="forkOpen = false" />
        <Button :label="$t('Créer')" icon="pi pi-clone" :loading="busy" :disabled="!forkName.trim()" @click="fork" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.timeline-mode {
  position: relative;
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  /* Le cadre rappelle qu'on regarde le passé, pas le tableau. */
  box-shadow: inset 0 0 0 3px var(--fb-accent);
}
.banner,
.scrubber {
  position: absolute;
  left: 50%;
  z-index: 6;
  border: 1px solid var(--fb-border);
  border-radius: 12px;
  background: var(--fb-panel);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.16);
  transform: translateX(-50%);
}
.banner {
  top: 0.75rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
  /* Sa largeur propre, pas la place à droite de son point d'ancrage. */
  width: max-content;
  max-width: calc(100% - 2rem);
  padding: 0.35rem 0.4rem 0.35rem 0.8rem;
  font-size: 0.9rem;
}
.banner .quit {
  margin-left: 0.4rem;
}
.banner > .pi {
  color: var(--fb-accent);
}
.banner .sep {
  width: 1px;
  height: 1.1rem;
  background: var(--fb-border);
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: var(--fb-panel-alt);
  font-size: 0.78rem;
  font-weight: 600;
  white-space: nowrap;
}
.chip.tagged {
  background: color-mix(in srgb, #f59e0b 16%, transparent);
  color: #b45309;
}
:global(.app-dark) .chip.tagged {
  color: #fbbf24;
}
.tag-jump {
  max-width: 14rem;
}
.chip.current {
  background: var(--fb-accent-soft);
  color: var(--fb-accent);
}
.chip.added {
  background: rgb(22 163 74 / 0.14);
  color: #15803d;
}
.chip.changed {
  background: rgb(245 158 11 / 0.18);
  color: #b45309;
}
.chip.removed {
  background: rgb(239 68 68 / 0.14);
  color: #b91c1c;
}
:global(.app-dark) .chip.added {
  color: #4ade80;
}
:global(.app-dark) .chip.changed {
  color: #fbbf24;
}
:global(.app-dark) .chip.removed {
  color: #f87171;
}
.scrubber {
  bottom: 4.2rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  width: min(46rem, calc(100% - 7rem));
  padding: 0.5rem 0.75rem;
}
.note {
  margin: 0.2rem 0;
  text-align: center;
}
.track {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.slider {
  flex: 1;
  margin: 0 0.5rem;
}
.count {
  min-width: 4.5rem;
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
}
.toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-right: auto;
  cursor: pointer;
}
.toggle input {
  accent-color: var(--fb-accent);
}
.fork-intro {
  margin-top: 0;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
</style>
