import { nextTick, onBeforeUnmount, onMounted, watch, type Ref } from 'vue';
import { readingWidth } from '@/theme/themeManager';

/**
 * Amène le texte d'une note au centre de l'écran plutôt qu'au centre de sa colonne (l'arbre et le sommaire la poussent
 * à droite) : on lit sans tourner la tête. Pose `--reading-shift` sur `container`, décalage horizontal que les styles du
 * texte ajoutent à leur marge gauche ; il est borné pour que le texte ne sorte jamais de sa colonne.
 *
 * `active` : faux quand deux volets se partagent la largeur (éditeur et aperçu), où chacun reste centré chez lui.
 * `deps` : ce qui change la mise en page sans changer la taille du conteneur (mode, sommaire, note ouverte…).
 */
export function useReadingShift(container: Ref<HTMLElement | null>, active: () => boolean, deps: () => unknown): void {
  let frame = 0;
  let observer: ResizeObserver | null = null;

  function measure(): void {
    frame = 0;
    const root = container.value;
    if (!root) return;
    const column = root.querySelector<HTMLElement>('.doc-preview, .cm-content');
    const parent = column?.parentElement;
    let shift = 0;
    if (column && parent && active() && readingWidth.value === 'screen') {
      const style = getComputedStyle(parent);
      const padLeft = parseFloat(style.paddingLeft) || 0;
      const inner = parent.clientWidth - padLeft - (parseFloat(style.paddingRight) || 0);
      const max = getComputedStyle(column).maxWidth;
      const width = max.endsWith('px') ? parseFloat(max) : inner;
      const free = Math.max(0, inner - width);
      const center = parent.getBoundingClientRect().left + padLeft + inner / 2;
      shift = Math.max(-free / 2, Math.min(free / 2, window.innerWidth / 2 - center));
    }
    root.style.setProperty('--reading-shift', `${Math.round(shift)}px`);
  }

  function schedule(): void {
    if (!frame) frame = requestAnimationFrame(measure);
  }

  onMounted(() => {
    observer = new ResizeObserver(schedule);
    window.addEventListener('resize', schedule);
  });
  onBeforeUnmount(() => {
    observer?.disconnect();
    window.removeEventListener('resize', schedule);
    cancelAnimationFrame(frame);
  });

  watch(
    container,
    (element, previous) => {
      if (previous) observer?.unobserve(previous);
      if (element) observer?.observe(element);
      schedule();
    },
    { flush: 'post' },
  );
  // Le texte apparaît après la mise en page (note chargée, éditeur monté) : on mesure de nouveau un peu après.
  watch([deps, readingWidth, active], () => {
    void nextTick(() => {
      schedule();
      window.setTimeout(schedule, 120);
    });
  });
}
