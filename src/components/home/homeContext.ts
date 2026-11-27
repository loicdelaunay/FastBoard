import { inject, provide, ref, type InjectionKey, type Ref } from 'vue';
import type { HomeDTO } from '@shared/home';
import type { HomeBlock } from '@shared/homeLayout';
import type { PersonalBoardDTO } from '@shared/personalBoard';
import type { SavedFilterDTO } from '@shared/ticketFilters';
import type { ProjectSnapshotDTO, ProjectSummaryDTO } from '@shared/types';
import { api } from '@/api';

/**
 * Ce que partagent les blocs de l'Accueil : les données (chargées une fois, à la demande du premier bloc qui en a
 * besoin, et relues ensemble) et l'éditeur de la disposition (mode « Personnaliser »).
 */

export interface HomeSource<T> {
  data: Ref<T | null>;
  failed: Ref<boolean>;
  /** Charge si ce n'est pas déjà fait (ou en cours). */
  ensure(): void;
  reload(): Promise<void>;
}

function source<T>(fetch: () => Promise<T>): HomeSource<T> {
  const data = ref<T | null>(null) as Ref<T | null>;
  const failed = ref(false);
  let pending: Promise<void> | null = null;
  let started = false;
  const reload = (): Promise<void> => {
    started = true;
    pending ??= fetch()
      .then((value) => {
        data.value = value;
        failed.value = false;
      })
      .catch(() => {
        if (data.value === null) failed.value = true;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  };
  return {
    data,
    failed,
    ensure: () => {
      if (!started) void reload();
    },
    reload,
  };
}

export interface HomeSources {
  /** L'Accueil (assigné, notifications, récents, favoris), chargé par la page. */
  home: Ref<HomeDTO | null>;
  /** Mes tickets de tous mes projets (« Mon tableau »). */
  board: HomeSource<PersonalBoardDTO>;
  /** Mes projets, avec leur avancement et leur livraison en cours. */
  projects: HomeSource<ProjectSummaryDTO[]>;
  snapshot(projectId: number): HomeSource<ProjectSnapshotDTO>;
  filters(projectId: number): HomeSource<SavedFilterDTO[]>;
  /** Relit ce qui a déjà été chargé. */
  refresh(): void;
  /** Incrémenté à chaque relecture : les blocs qui chargent eux-mêmes (activité) suivent. */
  generation: Ref<number>;
}

export function createHomeSources(home: Ref<HomeDTO | null>): HomeSources {
  const all: Array<HomeSource<unknown>> = [];
  const track = <T>(entry: HomeSource<T>): HomeSource<T> => {
    all.push(entry as HomeSource<unknown>);
    return entry;
  };
  const snapshots = new Map<number, HomeSource<ProjectSnapshotDTO>>();
  const filters = new Map<number, HomeSource<SavedFilterDTO[]>>();
  const generation = ref(0);
  return {
    home,
    board: track(source(async () => (await api.myBoard()).board)),
    projects: track(source(async () => (await api.projects()).projects)),
    snapshot(projectId) {
      let entry = snapshots.get(projectId);
      if (!entry) snapshots.set(projectId, (entry = track(source(() => api.snapshot(projectId)))));
      return entry;
    },
    filters(projectId) {
      let entry = filters.get(projectId);
      if (!entry) filters.set(projectId, (entry = track(source(async () => (await api.projectFilters(projectId)).filters))));
      return entry;
    },
    refresh() {
      generation.value += 1;
      for (const entry of all) if (entry.data.value !== null || entry.failed.value) void entry.reload();
    },
    generation,
  };
}

export interface HomeEditor {
  /** Mode « Personnaliser » : chaque bloc montre ses commandes. */
  editing: Ref<boolean>;
  /** Modifications possibles (pas hors ligne). */
  canEdit: Ref<boolean>;
  update(id: string, patch: Partial<Omit<HomeBlock, 'id' | 'type'>>): void;
  remove(id: string): void;
  move(id: string, delta: number): void;
  /** Glisser-déposer : place le bloc \`id\` à l'endroit de \`targetId\`. */
  moveTo(id: string, targetId: string): void;
  configure(id: string): void;
  position(id: string): { index: number; total: number };
  /** Bloc en cours de glisser-déposer. */
  dragging: Ref<string | null>;
}

const SOURCES: InjectionKey<HomeSources> = Symbol('homeSources');
const EDITOR: InjectionKey<HomeEditor> = Symbol('homeEditor');

export function provideHome(sources: HomeSources, editor: HomeEditor): void {
  provide(SOURCES, sources);
  provide(EDITOR, editor);
}

export function useHomeSources(): HomeSources {
  const sources = inject(SOURCES);
  if (!sources) throw new Error('useHomeSources hors de l’Accueil');
  return sources;
}

export function useHomeEditor(): HomeEditor {
  const editor = inject(EDITOR);
  if (!editor) throw new Error('useHomeEditor hors de l’Accueil');
  return editor;
}
