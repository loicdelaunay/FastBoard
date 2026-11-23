import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';
import { DomFinder, emptyFindOptions, NO_RESULT, type FindOptions, type FindResult } from '@/components/docs/find/find';

/** Ce que l'éditeur de note offre à la recherche (voir `DocEditor`). */
export interface EditorFind {
  findSet(options: FindOptions): FindResult;
  findStep(step: 'next' | 'previous' | 'replace' | 'replaceAll'): FindResult;
  findResult(): FindResult;
  findClose(): void;
  selectionText(): string;
  focus(): void;
}

interface BarHandle {
  focus(target?: 'search' | 'replace'): Promise<void>;
  contains(element: Element | null): boolean;
}

interface Options {
  /** Éditeur de la note, en écriture et en « Lecture et écriture ». */
  editor: Ref<EditorFind | null>;
  /** Volet du rendu, en lecture. */
  preview: Ref<HTMLElement | null>;
  /** Vrai quand le texte s'édite : la recherche vise l'éditeur, et le remplacement est possible. */
  writing: () => boolean;
  /** Une note est affichée : Ctrl F lui revient (sinon le navigateur garde le sien). */
  active: () => boolean;
  /** Ce qui change la cible : note ouverte, mode. */
  target: () => unknown;
  /** Texte de la note : les résultats suivent les modifications. */
  content: Ref<string>;
}

/**
 * Ctrl F dans une note, façon VS Code : la barre cherche dans l'éditeur (écriture, « Lecture et écriture ») ou dans le
 * texte rendu (lecture) ; Ctrl H ouvre le remplacement, F3 et Ctrl G passent d'un résultat à l'autre.
 */
export function useDocFind(options: Options) {
  const open = ref(false);
  const query = ref<FindOptions>(emptyFindOptions());
  const result = ref<FindResult>(NO_RESULT);
  const replaceOpen = ref(false);
  const bar = ref<BarHandle | null>(null);
  const dom = new DomFinder(
    () => options.preview.value?.querySelector<HTMLElement>('.markdown') ?? options.preview.value,
    () => options.preview.value,
  );

  const onEditor = (): boolean => options.writing() && options.editor.value !== null;

  function run(): void {
    if (!open.value) return;
    if (onEditor()) {
      dom.clear();
      result.value = options.editor.value!.findSet(query.value);
    } else {
      result.value = dom.set(query.value);
    }
  }

  function refresh(): void {
    if (!open.value) return;
    result.value = onEditor() ? options.editor.value!.findResult() : dom.refresh(query.value);
  }

  function step(direction: 'next' | 'previous' | 'replace' | 'replaceAll'): void {
    if (!open.value) return;
    if (onEditor()) result.value = options.editor.value!.findStep(direction);
    else if (direction === 'next') result.value = dom.next();
    else if (direction === 'previous') result.value = dom.previous();
  }

  /** Ouvre la barre, préremplie avec le texte sélectionné. */
  async function start(replace = false): Promise<void> {
    const selected = onEditor() ? options.editor.value!.selectionText() : previewSelection();
    if (selected) query.value = { ...query.value, search: selected };
    replaceOpen.value = replace && options.writing() ? true : replaceOpen.value && options.writing();
    open.value = true;
    await nextTick();
    run();
    await bar.value?.focus(replace && options.writing() && query.value.search ? 'replace' : 'search');
  }

  function close(): void {
    if (!open.value) return;
    open.value = false;
    dom.clear();
    options.editor.value?.findClose();
    result.value = NO_RESULT;
    if (options.writing()) options.editor.value?.focus();
  }

  /** Texte choisi dans le rendu, d'une seule ligne. */
  function previewSelection(): string {
    const selection = window.getSelection();
    const text = selection?.toString() ?? '';
    const inside = selection?.anchorNode && options.preview.value?.contains(selection.anchorNode);
    return inside && text.length <= 200 && !text.includes('\n') ? text : '';
  }

  watch(query, run, { deep: true });
  // Autre note ou autre mode : la recherche reprend sur la nouvelle cible (l'éditeur se monte d'abord).
  watch(options.target, async () => {
    if (!open.value) return;
    dom.clear();
    await nextTick();
    await nextTick();
    run();
  });
  let timer: number | undefined;
  watch(options.content, () => {
    if (!open.value) return;
    window.clearTimeout(timer);
    // Le rendu se met à jour juste après le texte.
    timer = window.setTimeout(refresh, onEditor() ? 0 : 150);
  });

  function onKeydown(event: KeyboardEvent): void {
    if (!options.active()) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.p-dialog, .p-popover, .p-drawer')) return;
    if (mod && !event.altKey && !event.shiftKey && (key === 'f' || (key === 'h' && options.writing()))) {
      event.preventDefault();
      void start(key === 'h');
    } else if (open.value && (event.key === 'F3' || (mod && !event.altKey && key === 'g'))) {
      event.preventDefault();
      step(event.shiftKey ? 'previous' : 'next');
    } else if (open.value && event.key === 'Escape' && !event.defaultPrevented && !bar.value?.contains(target)) {
      close();
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown));
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown);
    window.clearTimeout(timer);
    dom.clear();
  });

  return { open, query, result, replaceOpen, bar, start, close, refresh, next: () => step('next'), previous: () => step('previous'), replace: () => step('replace'), replaceAll: () => step('replaceAll') };
}
