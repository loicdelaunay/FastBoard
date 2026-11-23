import { t } from '@/i18n';

/**
 * Tableau blanc intégré dans une note (`@[…](board:7#embed)`) : son image, dans un cadre où l'on se déplace (glisser) et
 * où l'on zoome (boutons, double-clic, Ctrl + molette), comme les intégrations de Whimsical. L'image est celle de
 * l'aperçu du tableau, vectorielle : elle reste nette à tout zoom.
 *
 * Le cadre (`.fb-board-view`) contient les deux images de l'aperçu (thème clair et sombre, la feuille de style montre la
 * bonne). Sans ce script, elles s'y affichent simplement en entier.
 */

const ZOOM_STEP = 1.4;
const ZOOM_MAX = 12;
const mounted = new WeakSet<Element>();

interface EmbedState {
  /** Échelle par rapport à la taille d'origine de l'image ; `null` : en entier dans le cadre. */
  scale: number | null;
  x: number;
  y: number;
}

/** Rend vivant un cadre d'intégration. `tools` reçoit les boutons de zoom ; `changed` : la hauteur a pu changer. */
export function mountBoardEmbed(view: HTMLElement, tools: HTMLElement, changed?: () => void): void {
  if (mounted.has(view)) return;
  mounted.add(view);
  const images = [...view.querySelectorAll<HTMLImageElement>('img')];
  if (!images.length) return;
  const state: EmbedState = { scale: null, x: 0, y: 0 };
  /** Taille d'origine de l'image affichée (les deux thèmes ont la même). */
  const natural = (): { w: number; h: number } | null => {
    const image = images.find((entry) => entry.naturalWidth > 0);
    return image ? { w: image.naturalWidth, h: image.naturalHeight } : null;
  };
  const fitScale = (size: { w: number; h: number }): number => Math.min((view.clientWidth - 24) / size.w, (view.clientHeight - 24) / size.h);

  function layout(): void {
    const size = natural();
    if (!size || !view.clientWidth) return;
    view.classList.add('ready');
    const fit = fitScale(size);
    const scale = state.scale ?? fit;
    if (state.scale === null) {
      state.x = (view.clientWidth - size.w * scale) / 2;
      state.y = (view.clientHeight - size.h * scale) / 2;
    }
    for (const image of images) {
      // Largeur et hauteur réelles (pas une transformation) : le navigateur redessine l'image vectorielle, nette.
      image.style.width = `${size.w * scale}px`;
      image.style.height = `${size.h * scale}px`;
      image.style.left = `${state.x}px`;
      image.style.top = `${state.y}px`;
    }
    reset.disabled = state.scale === null;
  }

  /** Zoome autour d'un point du cadre (son centre par défaut). */
  function zoom(factor: number, at?: { x: number; y: number }): void {
    const size = natural();
    if (!size) return;
    const fit = fitScale(size);
    const current = state.scale ?? fit;
    const next = Math.min(Math.max(current * factor, fit * 0.5), Math.max(fit, 1) * ZOOM_MAX);
    if (state.scale === null) {
      state.x = (view.clientWidth - size.w * current) / 2;
      state.y = (view.clientHeight - size.h * current) / 2;
    }
    const point = at ?? { x: view.clientWidth / 2, y: view.clientHeight / 2 };
    state.x = point.x - ((point.x - state.x) * next) / current;
    state.y = point.y - ((point.y - state.y) * next) / current;
    state.scale = next;
    layout();
  }

  const button = (icon: string, label: string, run: () => void): HTMLButtonElement => {
    const element = document.createElement('button');
    element.type = 'button';
    element.title = label;
    element.setAttribute('aria-label', label);
    element.innerHTML = `<i class="pi ${icon}"></i>`;
    // Le clic ne suit pas le lien de l'en-tête et ne déplace pas le curseur de l'éditeur.
    element.addEventListener('mousedown', (event) => event.preventDefault());
    element.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      run();
    });
    return element;
  };
  const reset = button('pi-expand', t('Tout voir'), () => {
    state.scale = null;
    layout();
  });
  const zoomBox = document.createElement('span');
  zoomBox.className = 'fb-board-zoom';
  zoomBox.append(button('pi-minus', t('Dézoomer'), () => zoom(1 / ZOOM_STEP)), button('pi-plus', t('Zoomer'), () => zoom(ZOOM_STEP)), reset);
  tools.append(zoomBox);
  view.title = t('Glissez pour vous déplacer, double-clic ou Ctrl + molette pour zoomer');

  const local = (event: MouseEvent): { x: number; y: number } => {
    const box = view.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  let drag: { x: number; y: number; startX: number; startY: number } | null = null;
  view.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const size = natural();
    if (!size) return;
    if (state.scale === null) {
      // Premier geste : la vue « en entier » devient une vue libre, à la même place.
      const fit = fitScale(size);
      state.x = (view.clientWidth - size.w * fit) / 2;
      state.y = (view.clientHeight - size.h * fit) / 2;
      state.scale = fit;
    }
    drag = { x: state.x, y: state.y, startX: event.clientX, startY: event.clientY };
    view.setPointerCapture(event.pointerId);
    view.classList.add('dragging');
    event.preventDefault();
  });
  view.addEventListener('pointermove', (event) => {
    if (!drag) return;
    state.x = drag.x + event.clientX - drag.startX;
    state.y = drag.y + event.clientY - drag.startY;
    layout();
  });
  const release = (): void => {
    drag = null;
    view.classList.remove('dragging');
  };
  view.addEventListener('pointerup', release);
  view.addEventListener('pointercancel', release);
  view.addEventListener('dblclick', (event) => {
    event.preventDefault();
    zoom(ZOOM_STEP * ZOOM_STEP, local(event));
  });
  // La molette seule fait défiler la note ; avec Ctrl (ou un pincement), elle zoome le tableau.
  view.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoom(Math.exp(-event.deltaY * 0.0022), local(event));
    },
    { passive: false },
  );
  for (const image of images) {
    image.addEventListener('load', () => {
      layout();
      changed?.();
    });
  }
  new ResizeObserver(layout).observe(view);
  layout();
}

/** Rend vivants les tableaux intégrés d'un texte rendu (lecture, tickets). */
export function mountBoardEmbeds(root: ParentNode): void {
  for (const box of root.querySelectorAll<HTMLElement>('.md-board-embed')) {
    const view = box.querySelector<HTMLElement>('.fb-board-view');
    const head = box.querySelector<HTMLElement>('.md-board-head');
    if (!view || !head || head.querySelector('.md-board-tools')) continue;
    // Les boutons de zoom se placent avant l'icône qui ouvre le tableau.
    const tools = document.createElement('span');
    tools.className = 'md-board-tools';
    head.insertBefore(tools, head.querySelector('.md-board-open'));
    mountBoardEmbed(view, tools);
  }
}
