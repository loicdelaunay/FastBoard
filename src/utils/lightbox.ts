import { t } from '@/i18n';

/**
 * Visionneuse d'image plein écran : l'image tient dans l'écran, un clic l'affiche en taille réelle (et on la fait
 * défiler), Échap ou un clic à côté referme. Utilisée par la documentation et les sites web des espaces.
 */

let open: (() => void) | null = null;

function iconButton(icon: string, label: string, run: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'fb-lightbox-button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = `<i class="pi ${icon}"></i>`;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    run();
  });
  return button;
}

export function openLightbox(src: string, alt = ''): void {
  open?.();
  const previous = document.activeElement as HTMLElement | null;
  const overlay = document.createElement('div');
  overlay.className = 'fb-lightbox';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', alt || t('Image'));
  overlay.tabIndex = -1;

  const stage = document.createElement('div');
  stage.className = 'fb-lightbox-stage';
  const image = document.createElement('img');
  image.src = src;
  image.alt = alt;
  image.draggable = false;
  stage.append(image);

  const zoom = (): void => {
    const full = overlay.classList.toggle('full');
    zoomButton.innerHTML = `<i class="pi ${full ? 'pi-search-minus' : 'pi-search-plus'}"></i>`;
    zoomButton.title = full ? t('Ajuster à l’écran') : t('Taille réelle');
  };
  const close = (): void => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    open = null;
    previous?.focus?.({ preventScroll: true });
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  const bar = document.createElement('div');
  bar.className = 'fb-lightbox-bar';
  const caption = document.createElement('span');
  caption.className = 'fb-lightbox-caption';
  caption.textContent = alt;
  const zoomButton = iconButton('pi-search-plus', t('Taille réelle'), zoom);
  bar.append(
    caption,
    zoomButton,
    iconButton('pi-external-link', t('Ouvrir dans un nouvel onglet'), () => window.open(src, '_blank', 'noopener')),
    iconButton('pi-times', t('Fermer'), close),
  );

  image.addEventListener('click', (event) => {
    event.stopPropagation();
    zoom();
  });
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  overlay.append(stage, bar);
  document.body.append(overlay);
  overlay.focus({ preventScroll: true });
  open = close;
}

/** Clic sur une image d'un texte rendu : on l'ouvre dans la visionneuse (sauf si elle est dans un lien). */
export function zoomImageOnClick(event: MouseEvent): boolean {
  const image = (event.target as HTMLElement).closest?.<HTMLImageElement>('img');
  if (!image || image.closest('a') || !image.src || image.classList.contains('emoji')) return false;
  event.preventDefault();
  openLightbox(image.currentSrc || image.src, image.alt);
  return true;
}
