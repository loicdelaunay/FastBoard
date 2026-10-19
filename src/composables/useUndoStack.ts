import { computed, ref } from 'vue';
import { notifyError } from '@/utils/notify';

import { t } from '@/i18n';
export interface UndoEntry {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

const MAX_ENTRIES = 50;

/** Pile annuler / rétablir pour les modifications de tickets faites par l'utilisateur courant. */
export function useUndoStack() {
  const undoEntries = ref<UndoEntry[]>([]);
  const redoEntries = ref<UndoEntry[]>([]);
  const busy = ref(false);

  const canUndo = computed(() => undoEntries.value.length > 0 && !busy.value);
  const canRedo = computed(() => redoEntries.value.length > 0 && !busy.value);
  const undoLabel = computed(() => undoEntries.value.at(-1)?.label ?? '');
  const redoLabel = computed(() => redoEntries.value.at(-1)?.label ?? '');

  function push(entry: UndoEntry): void {
    undoEntries.value = [...undoEntries.value, entry].slice(-MAX_ENTRIES);
    redoEntries.value = [];
  }

  async function run(source: 'undo' | 'redo'): Promise<void> {
    const from = source === 'undo' ? undoEntries : redoEntries;
    const to = source === 'undo' ? redoEntries : undoEntries;
    const entry = from.value.at(-1);
    if (!entry || busy.value) {
      return;
    }
    busy.value = true;
    from.value = from.value.slice(0, -1);
    try {
      await (source === 'undo' ? entry.undo() : entry.redo());
      to.value = [...to.value, entry].slice(-MAX_ENTRIES);
    } catch (error) {
      notifyError(error, source === t('undo') ? t('Impossible d\'annuler') : t('Impossible de rétablir'));
    } finally {
      busy.value = false;
    }
  }

  function clear(): void {
    undoEntries.value = [];
    redoEntries.value = [];
  }

  return {
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
    push,
    clear,
    undo: () => run('undo'),
    redo: () => run('redo'),
  };
}
