import type { MockupElement, MockupKind, TextSize } from './boards.ts';

/**
 * Maquettes (wireframes) des tableaux blancs : chaque composant se dessine en SVG, relatif au coin de l'élément.
 * Le même dessin sert à l'éditeur (couleurs du thème, en variables CSS) et à l'aperçu rendu par le serveur.
 */

/** Teintes du dessin : variables CSS dans l'éditeur, couleurs fixes dans l'aperçu. */
export interface MockupPaint {
  /** Texte principal. */
  ink: string;
  /** Texte secondaire, indications. */
  muted: string;
  /** Bordures. */
  line: string;
  /** Fond des composants. */
  surface: string;
  /** Fond discret (barre de fenêtre, image à venir). */
  soft: string;
  /** Couleur de l'élément, et sa teinte claire. */
  accent: string;
  accentSoft: string;
  /** Texte sur la couleur de l'élément. */
  onAccent: string;
}

/** Taille par défaut, texte de départ (en français, traduit à la création) et réglages de chaque composant. */
export interface MockupSpec {
  w: number;
  h: number;
  text: string;
  value?: number;
  checked?: boolean;
  /** Réglages proposés dans la barre de sélection. */
  variant?: boolean;
  check?: boolean;
  /** Ce que règle `value` : pourcentage, rang (onglet, page) ou nombre d'étoiles. */
  range?: { min: number; max: number; label: string };
  /** Le texte se modifie (double-clic) ; `lines` : une entrée par ligne. */
  edit: 'text' | 'lines' | null;
}

export const MOCKUP_SPECS: Record<MockupKind, MockupSpec> = {
  browser: { w: 800, h: 560, text: 'https://exemple.fr', edit: 'text' },
  mobile: { w: 300, h: 600, text: '9:41', edit: 'text' },
  navbar: { w: 640, h: 56, text: 'Marque\nAccueil\nProduits\nContact', edit: 'lines' },
  tabs: { w: 360, h: 40, text: 'Aperçu\nDétails\nRéglages', value: 1, range: { min: 1, max: 12, label: 'Onglet choisi' }, edit: 'lines' },
  breadcrumb: { w: 280, h: 24, text: 'Accueil\nDossier\nPage', edit: 'lines' },
  heading: { w: 280, h: 44, text: 'Titre de la page', edit: 'text' },
  paragraph: { w: 300, h: 84, text: 'Un paragraphe de texte qui décrit le contenu de cette partie de l’écran.', edit: 'text' },
  link: { w: 140, h: 24, text: 'Un lien', edit: 'text' },
  button: { w: 128, h: 40, text: 'Bouton', variant: true, edit: 'text' },
  input: { w: 240, h: 40, text: 'Saisir du texte…', edit: 'text' },
  search: { w: 240, h: 40, text: 'Rechercher…', edit: 'text' },
  select: { w: 240, h: 40, text: 'Choisir une option', edit: 'text' },
  checkbox: { w: 180, h: 24, text: 'Case à cocher', checked: true, check: true, edit: 'text' },
  radio: { w: 180, h: 24, text: 'Option', checked: true, check: true, edit: 'text' },
  toggle: { w: 180, h: 28, text: 'Activer', checked: true, check: true, edit: 'text' },
  slider: { w: 240, h: 24, text: '', value: 40, range: { min: 0, max: 100, label: 'Valeur' }, edit: null },
  progress: { w: 240, h: 12, text: '', value: 60, range: { min: 0, max: 100, label: 'Avancement' }, edit: null },
  rating: { w: 140, h: 24, text: '', value: 4, range: { min: 0, max: 5, label: 'Nombre d’étoiles' }, edit: null },
  badge: { w: 80, h: 24, text: 'Nouveau', variant: true, edit: 'text' },
  alert: { w: 340, h: 56, text: 'Un message d’information pour la personne.', edit: 'text' },
  avatar: { w: 48, h: 48, text: '', edit: 'text' },
  image: { w: 240, h: 160, text: '', edit: 'text' },
  video: { w: 320, h: 180, text: '', edit: 'text' },
  list: { w: 240, h: 112, text: 'Premier élément\nDeuxième élément\nTroisième élément\nQuatrième élément', edit: 'lines' },
  card: { w: 240, h: 280, text: 'Titre de la carte\nUne courte description du contenu.', edit: 'lines' },
  modal: { w: 380, h: 220, text: 'Titre de la fenêtre\nLe contenu de la fenêtre de dialogue.\nAnnuler | Valider', edit: 'lines' },
  pagination: { w: 260, h: 32, text: '5', value: 2, range: { min: 1, max: 9, label: 'Page choisie' }, edit: 'text' },
  divider: { w: 280, h: 16, text: '', edit: 'text' },
};

/** Noms des composants (traduits par l'interface). */
export const MOCKUP_LABELS: Record<MockupKind, string> = {
  browser: 'Fenêtre de navigateur',
  mobile: 'Téléphone',
  navbar: 'Barre de navigation',
  tabs: 'Onglets',
  breadcrumb: 'Fil d’Ariane',
  heading: 'Titre',
  paragraph: 'Paragraphe',
  link: 'Lien',
  button: 'Bouton',
  input: 'Champ de saisie',
  search: 'Recherche',
  select: 'Liste déroulante',
  checkbox: 'Case à cocher',
  radio: 'Bouton radio',
  toggle: 'Interrupteur',
  slider: 'Curseur',
  progress: 'Barre de progression',
  rating: 'Note (étoiles)',
  badge: 'Pastille',
  alert: 'Message',
  avatar: 'Avatar',
  image: 'Image',
  video: 'Vidéo',
  list: 'Liste',
  card: 'Carte',
  modal: 'Fenêtre de dialogue',
  pagination: 'Pagination',
  divider: 'Séparateur',
};

/** Groupes de la palette de composants. */
export const MOCKUP_GROUPS: Array<{ label: string; kinds: MockupKind[] }> = [
  { label: 'Écrans', kinds: ['browser', 'mobile', 'modal', 'card'] },
  { label: 'Navigation', kinds: ['navbar', 'tabs', 'breadcrumb', 'pagination', 'link'] },
  { label: 'Texte', kinds: ['heading', 'paragraph', 'list', 'badge', 'alert', 'divider'] },
  { label: 'Formulaire', kinds: ['button', 'input', 'search', 'select', 'checkbox', 'radio', 'toggle', 'slider'] },
  { label: 'Médias et données', kinds: ['image', 'video', 'avatar', 'progress', 'rating'] },
];

const FONT: Record<TextSize, number> = { s: 12, m: 14, l: 17, xl: 22 };
const HEADING: Record<TextSize, number> = { s: 16, m: 22, l: 28, xl: 36 };

const n = (value: number): string => String(Math.round(value * 10) / 10);
const esc = (value: string): string => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const lines = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
/** Largeur approchée d'un texte (sans mesure : le même calcul côté serveur). */
const textWidth = (text: string, size: number): number => text.length * size * 0.56;

/** Texte coupé à la largeur donnée, terminé par « … » s'il déborde. */
function fit(text: string, width: number, size: number): string {
  const max = Math.max(1, Math.floor(width / (size * 0.56)));
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

interface TextOptions {
  size: number;
  fill: string;
  weight?: number;
  anchor?: 'start' | 'middle' | 'end';
  underline?: boolean;
  width?: number;
}

function label(x: number, y: number, value: string, options: TextOptions): string {
  const shown = options.width !== undefined ? fit(value, options.width, options.size) : value;
  if (!shown) return '';
  return `<text x="${n(x)}" y="${n(y)}" font-size="${options.size}" fill="${options.fill}"${options.weight ? ` font-weight="${options.weight}"` : ''}${options.anchor && options.anchor !== 'start' ? ` text-anchor="${options.anchor}"` : ''}${options.underline ? ' text-decoration="underline"' : ''} dominant-baseline="central">${esc(shown)}</text>`;
}

/** Paragraphe coupé en lignes dans un cadre ; sans texte, des barres grises en tiennent lieu. */
function paragraph(value: string, x: number, y: number, width: number, height: number, size: number, fill: string, placeholder: string): string {
  const lineHeight = size * 1.45;
  const max = Math.max(1, Math.floor(height / lineHeight));
  if (!value.trim()) {
    return Array.from({ length: max }, (_, index) => `<rect x="${n(x)}" y="${n(y + index * lineHeight + lineHeight * 0.3)}" width="${n(index === max - 1 && max > 1 ? width * 0.6 : width)}" height="${n(lineHeight * 0.4)}" rx="${n(lineHeight * 0.2)}" fill="${placeholder}"/>`).join('');
  }
  const perLine = Math.max(4, Math.floor(width / (size * 0.56)));
  const wrapped: string[] = [];
  for (const raw of value.split('\n')) {
    let line = '';
    for (const word of raw.split(/\s+/)) {
      if (!word) continue;
      if (line && (line + ' ' + word).length > perLine) {
        wrapped.push(line);
        line = '';
      }
      let rest = word;
      while (rest.length > perLine) {
        wrapped.push(rest.slice(0, perLine));
        rest = rest.slice(perLine);
      }
      line = line ? `${line} ${rest}` : rest;
    }
    wrapped.push(line);
  }
  if (wrapped.length > max) {
    wrapped.length = max;
    wrapped[max - 1] = fit(`${wrapped[max - 1]}…`, width, size);
  }
  return wrapped.map((line, index) => label(x, y + lineHeight * index + lineHeight / 2, line, { size, fill })).join('');
}

/** Montagnes et soleil : l'image à venir. */
function picture(cx: number, cy: number, scale: number, fill: string): string {
  const s = scale;
  return `<circle cx="${n(cx + 0.32 * s)}" cy="${n(cy - 0.28 * s)}" r="${n(0.13 * s)}" fill="${fill}"/><path d="M${n(cx - 0.6 * s)},${n(cy + 0.4 * s)} L${n(cx - 0.18 * s)},${n(cy - 0.12 * s)} L${n(cx + 0.08 * s)},${n(cy + 0.18 * s)} L${n(cx + 0.24 * s)},${n(cy + 0.02 * s)} L${n(cx + 0.6 * s)},${n(cy + 0.4 * s)} Z" fill="${fill}"/>`;
}

function star(cx: number, cy: number, r: number, fill: string, stroke: string): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const radius = i % 2 ? r * 0.45 : r;
    points.push(`${n(cx + Math.cos(angle) * radius)},${n(cy + Math.sin(angle) * radius)}`);
  }
  return `<polygon points="${points.join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="1.2" stroke-linejoin="round"/>`;
}

/** Bouton (ou pastille) selon son style. */
function buttonShape(element: Pick<MockupElement, 'variant'>, x: number, y: number, w: number, h: number, radius: number, text: string, size: number, p: MockupPaint): string {
  const fill = element.variant === 'primary' ? p.accent : element.variant === 'secondary' ? p.accentSoft : element.variant === 'outline' ? p.surface : 'none';
  const stroke = element.variant === 'outline' ? ` stroke="${p.accent}" stroke-width="1.5"` : '';
  const color = element.variant === 'primary' ? p.onAccent : element.variant === 'secondary' ? p.ink : p.accent;
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(radius)}" fill="${fill}"${stroke}/>${label(x + w / 2, y + h / 2, text, { size, fill: color, weight: 600, anchor: 'middle', width: w - 12 })}`;
}

/** Dessin SVG d'un composant de maquette, dans son repère (0, 0) – (w, h). */
export function mockupSvg(element: MockupElement, p: MockupPaint): string {
  const { w, h } = element;
  const size = FONT[element.size] ?? 14;
  const items = lines(element.text);
  const box = (x: number, y: number, bw: number, bh: number, radius: number, fill: string, stroke = p.line, width = 1.2): string =>
    `<rect x="${n(x)}" y="${n(y)}" width="${n(bw)}" height="${n(bh)}" rx="${n(radius)}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`;
  const mid = h / 2;
  switch (element.kind) {
    case 'browser': {
      const bar = Math.min(36, h / 3);
      return [
        box(0, 0, w, h, 8, p.surface),
        `<path d="M0,8 A8,8 0 0 1 8,0 H${n(w - 8)} A8,8 0 0 1 ${n(w)},8 V${n(bar)} H0 Z" fill="${p.soft}" stroke="${p.line}" stroke-width="1.2"/>`,
        ...[14, 28, 42].map((x) => `<circle cx="${x}" cy="${n(bar / 2)}" r="4.5" fill="${p.line}"/>`),
        w > 160 ? box(60, bar / 2 - 10, Math.max(40, w - 120), 20, 10, p.surface) : '',
        w > 160 ? label(72, bar / 2, element.text, { size: 12, fill: p.muted, width: w - 144 }) : '',
      ].join('');
    }
    case 'mobile': {
      const radius = Math.min(32, w / 6);
      return [
        box(0, 0, w, h, radius, p.surface, p.ink, 2.5),
        `<rect x="${n(w / 2 - Math.min(44, w / 5))}" y="10" width="${n(Math.min(88, (w * 2) / 5))}" height="18" rx="9" fill="${p.ink}"/>`,
        label(radius * 0.8 + 6, 19, element.text, { size: 12, fill: p.ink, weight: 600, width: w / 2 - 60 }),
        `<rect x="${n(w / 2 - Math.min(50, w / 4))}" y="${n(h - 14)}" width="${n(Math.min(100, w / 2))}" height="4" rx="2" fill="${p.ink}"/>`,
      ].join('');
    }
    case 'navbar': {
      const [brand = '', ...links] = items;
      const parts = [box(0, 0, w, h, 6, p.surface), `<rect x="16" y="${n(mid - 12)}" width="24" height="24" rx="6" fill="${p.accent}"/>`, label(50, mid, brand, { size: size + 1, fill: p.ink, weight: 700, width: w / 3 })];
      let x = w - 20;
      for (const link of [...links].reverse()) {
        const width = textWidth(link, size);
        if (x - width < 60 + textWidth(brand, size + 1)) break;
        parts.push(label(x, mid, link, { size, fill: p.muted, anchor: 'end' }));
        x -= width + 24;
      }
      return parts.join('');
    }
    case 'tabs': {
      const count = Math.max(1, items.length);
      const width = w / count;
      const active = Math.min(count, Math.max(1, element.value)) - 1;
      const parts = [`<line x1="0" y1="${n(h - 0.6)}" x2="${n(w)}" y2="${n(h - 0.6)}" stroke="${p.line}" stroke-width="1.2"/>`];
      items.forEach((item, index) => {
        const on = index === active;
        parts.push(label(width * index + width / 2, mid, item, { size, fill: on ? p.accent : p.muted, weight: on ? 600 : undefined, anchor: 'middle', width: width - 8 }));
        if (on) parts.push(`<rect x="${n(width * index + 4)}" y="${n(h - 3)}" width="${n(width - 8)}" height="3" rx="1.5" fill="${p.accent}"/>`);
      });
      return parts.join('');
    }
    case 'breadcrumb': {
      const parts: string[] = [];
      let x = 0;
      items.forEach((item, index) => {
        const last = index === items.length - 1;
        if (x > w) return;
        parts.push(label(x, mid, item, { size, fill: last ? p.ink : p.accent, weight: last ? 600 : undefined, width: w - x }));
        x += textWidth(item, size) + 8;
        if (!last) {
          parts.push(label(x, mid, '›', { size, fill: p.muted }));
          x += size * 0.56 + 8;
        }
      });
      return parts.join('');
    }
    case 'heading':
      return label(0, mid, element.text, { size: HEADING[element.size] ?? 22, fill: p.ink, weight: 700, width: w });
    case 'paragraph':
      return paragraph(element.text, 0, 0, w, h, size, p.ink, p.soft);
    case 'link':
      return label(0, mid, element.text, { size, fill: p.accent, underline: true, width: w });
    case 'button':
      return buttonShape(element, 0, 0, w, h, Math.min(8, h / 2), element.text, size, p);
    case 'badge':
      return buttonShape(element, 0, 0, w, h, h / 2, element.text, Math.min(size, h * 0.55), p);
    case 'input':
    case 'search':
    case 'select': {
      const area = element.kind === 'input' && h > 64;
      const round = element.kind === 'search' ? h / 2 : 6;
      const left = element.kind === 'search' ? 34 : 12;
      const parts = [box(0, 0, w, h, Math.min(round, h / 2), p.surface)];
      if (element.kind === 'search') parts.push(`<circle cx="18" cy="${n(mid - 1.5)}" r="5.5" fill="none" stroke="${p.muted}" stroke-width="1.6"/><path d="M22,${n(mid + 2.5)} l4,4" stroke="${p.muted}" stroke-width="1.6" stroke-linecap="round"/>`);
      if (element.kind === 'select') parts.push(`<path d="M${n(w - 24)},${n(mid - 3)} l5,5 l5,-5" fill="none" stroke="${p.muted}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`);
      parts.push(area ? paragraph(element.text, 12, 8, w - 24, h - 16, size, p.muted, p.soft) : label(left, mid, element.text, { size, fill: p.muted, width: w - left - (element.kind === 'select' ? 34 : 12) }));
      return parts.join('');
    }
    case 'checkbox': {
      const parts = [box(0.6, mid - 8, 16, 16, 3.5, element.checked ? p.accent : p.surface, element.checked ? p.accent : p.line)];
      if (element.checked) parts.push(`<path d="M4.5,${n(mid)} l3,3 l5.5,-6" fill="none" stroke="${p.onAccent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`);
      parts.push(label(26, mid, element.text, { size, fill: p.ink, width: w - 26 }));
      return parts.join('');
    }
    case 'radio':
      return [
        `<circle cx="8.6" cy="${n(mid)}" r="8" fill="${p.surface}" stroke="${element.checked ? p.accent : p.line}" stroke-width="${element.checked ? 2 : 1.2}"/>`,
        element.checked ? `<circle cx="8.6" cy="${n(mid)}" r="4" fill="${p.accent}"/>` : '',
        label(26, mid, element.text, { size, fill: p.ink, width: w - 26 }),
      ].join('');
    case 'toggle':
      return [
        box(0.6, mid - 10, 38, 20, 10, element.checked ? p.accent : p.soft, element.checked ? p.accent : p.line),
        `<circle cx="${element.checked ? 28.6 : 10.6}" cy="${n(mid)}" r="7" fill="${p.surface}" stroke="${p.line}" stroke-width="0.8"/>`,
        label(48, mid, element.text, { size, fill: p.ink, width: w - 48 }),
      ].join('');
    case 'slider': {
      const at = 10 + ((w - 20) * Math.min(100, Math.max(0, element.value))) / 100;
      return [
        `<rect x="10" y="${n(mid - 2)}" width="${n(Math.max(0, w - 20))}" height="4" rx="2" fill="${p.soft}" stroke="${p.line}" stroke-width="0.6"/>`,
        `<rect x="10" y="${n(mid - 2)}" width="${n(Math.max(0, at - 10))}" height="4" rx="2" fill="${p.accent}"/>`,
        `<circle cx="${n(at)}" cy="${n(mid)}" r="8" fill="${p.surface}" stroke="${p.accent}" stroke-width="2"/>`,
      ].join('');
    }
    case 'progress': {
      const filled = (w * Math.min(100, Math.max(0, element.value))) / 100;
      return `<rect x="0" y="0" width="${n(w)}" height="${n(h)}" rx="${n(h / 2)}" fill="${p.soft}" stroke="${p.line}" stroke-width="0.6"/><rect x="0" y="0" width="${n(filled)}" height="${n(h)}" rx="${n(h / 2)}" fill="${p.accent}"/>`;
    }
    case 'rating': {
      const r = Math.min(h / 2 - 1, w / 10 - 2);
      return Array.from({ length: 5 }, (_, index) => star(w / 10 + (index * w) / 5, mid, Math.max(2, r), index < element.value ? p.accent : p.surface, index < element.value ? p.accent : p.line)).join('');
    }
    case 'alert':
      return [
        box(0, 0, w, h, 6, p.accentSoft, p.accent),
        `<rect x="0" y="0" width="4" height="${n(h)}" rx="2" fill="${p.accent}"/>`,
        `<circle cx="22" cy="${n(Math.min(mid, 20))}" r="8" fill="${p.accent}"/>`,
        label(22, Math.min(mid, 20), 'i', { size: 11, fill: p.onAccent, weight: 700, anchor: 'middle' }),
        paragraph(element.text, 38, Math.max(4, mid - Math.min(h - 8, size * 1.45 * Math.ceil(textWidth(element.text, size) / Math.max(1, w - 50))) / 2), w - 50, h - 8, size, p.ink, p.soft),
      ].join('');
    case 'avatar': {
      const r = Math.min(w, h) / 2;
      const cx = w / 2;
      const cy = h / 2;
      const initials = items
        .join(' ')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => word[0]!.toUpperCase())
        .join('');
      if (initials) return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r - 0.6)}" fill="${p.accentSoft}" stroke="${p.accent}" stroke-width="1.2"/>${label(cx, cy, initials, { size: r * 0.8, fill: p.ink, weight: 600, anchor: 'middle' })}`;
      return [
        `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r - 0.6)}" fill="${p.soft}" stroke="${p.line}" stroke-width="1.2"/>`,
        `<circle cx="${n(cx)}" cy="${n(cy - r * 0.18)}" r="${n(r * 0.3)}" fill="${p.line}"/>`,
        `<path d="M${n(cx - r * 0.58)},${n(cy + r * 0.62)} A${n(r * 0.6)},${n(r * 0.5)} 0 0 1 ${n(cx + r * 0.58)},${n(cy + r * 0.62)} Z" fill="${p.line}"/>`,
      ].join('');
    }
    case 'image':
    case 'video': {
      const caption = element.text.trim() && h > 60 ? 22 : 0;
      const scale = Math.min(w, h - caption) * 0.5;
      const cy = (h - caption) / 2;
      const parts = [box(0, 0, w, h, 6, p.soft)];
      if (element.kind === 'image') parts.push(picture(w / 2, cy, scale, p.line));
      else {
        const r = Math.max(8, Math.min(28, scale / 2));
        parts.push(`<circle cx="${n(w / 2)}" cy="${n(cy)}" r="${n(r)}" fill="${p.surface}" stroke="${p.line}" stroke-width="1.2"/><path d="M${n(w / 2 - r * 0.3)},${n(cy - r * 0.42)} L${n(w / 2 + r * 0.45)},${n(cy)} L${n(w / 2 - r * 0.3)},${n(cy + r * 0.42)} Z" fill="${p.muted}"/>`);
        if (h > 60) parts.push(`<rect x="12" y="${n(h - caption - 14)}" width="${n(Math.max(0, w - 24))}" height="3" rx="1.5" fill="${p.line}"/><rect x="12" y="${n(h - caption - 14)}" width="${n(Math.max(0, (w - 24) * 0.35))}" height="3" rx="1.5" fill="${p.accent}"/>`);
      }
      if (caption) parts.push(label(w / 2, h - 12, element.text, { size: 12, fill: p.muted, anchor: 'middle', width: w - 16 }));
      return parts.join('');
    }
    case 'list': {
      const row = Math.max(20, size * 2);
      const parts: string[] = [];
      items.forEach((item, index) => {
        const y = index * row + row / 2;
        if (y + row / 2 > h + 1) return;
        parts.push(`<circle cx="6" cy="${n(y)}" r="3" fill="${p.accent}"/>`, label(18, y, item, { size, fill: p.ink, width: w - 18 }));
        if (index < items.length - 1 && y + row <= h) parts.push(`<line x1="18" y1="${n(y + row / 2)}" x2="${n(w)}" y2="${n(y + row / 2)}" stroke="${p.soft}" stroke-width="1"/>`);
      });
      return parts.join('');
    }
    case 'card': {
      const [title = '', ...rest] = items;
      const media = Math.min(h * 0.5, w * 0.75);
      return [
        box(0, 0, w, h, 10, p.surface),
        `<path d="M0,10 A10,10 0 0 1 10,0 H${n(w - 10)} A10,10 0 0 1 ${n(w)},10 V${n(media)} H0 Z" fill="${p.soft}"/>`,
        picture(w / 2, media / 2, Math.min(w, media) * 0.5, p.line),
        `<line x1="0" y1="${n(media)}" x2="${n(w)}" y2="${n(media)}" stroke="${p.line}" stroke-width="1.2"/>`,
        label(16, media + 24, title, { size: size + 2, fill: p.ink, weight: 700, width: w - 32 }),
        paragraph(rest.join('\n'), 16, media + 40, w - 32, Math.max(0, h - media - 48), size - 1, p.muted, p.soft),
      ].join('');
    }
    case 'modal': {
      const actions = items.length > 1 && items[items.length - 1]!.includes('|') ? items[items.length - 1]!.split('|').map((part) => part.trim()) : [];
      const [title = '', ...body] = actions.length ? items.slice(0, -1) : items;
      const parts = [
        `<rect x="3" y="5" width="${n(w)}" height="${n(h)}" rx="10" fill="${p.line}" opacity="0.35"/>`,
        box(0, 0, w, h, 10, p.surface),
        label(18, 26, title, { size: size + 2, fill: p.ink, weight: 700, width: w - 60 }),
        `<path d="M${n(w - 26)},20 l12,12 M${n(w - 14)},20 l-12,12" stroke="${p.muted}" stroke-width="1.6" stroke-linecap="round"/>`,
        `<line x1="0" y1="50" x2="${n(w)}" y2="50" stroke="${p.line}" stroke-width="1"/>`,
        paragraph(body.join('\n'), 18, 62, w - 36, Math.max(0, h - 62 - (actions.length ? 58 : 12)), size, p.muted, p.soft),
      ];
      let x = w - 16;
      actions
        .slice()
        .reverse()
        .forEach((action, index) => {
          const width = Math.max(72, textWidth(action, size) + 28);
          x -= width;
          parts.push(buttonShape({ variant: index === 0 ? 'primary' : 'outline' }, x, h - 48, width, 34, 7, action, size, p));
          x -= 10;
        });
      return parts.join('');
    }
    case 'pagination': {
      const pages = Math.min(9, Math.max(1, Number.parseInt(element.text, 10) || 5));
      const current = Math.min(pages, Math.max(1, element.value));
      const cell = Math.min(h, w / (pages + 2) - 4);
      const parts: string[] = [];
      ['‹', ...Array.from({ length: pages }, (_, index) => String(index + 1)), '›'].forEach((entry, index) => {
        const x = index * (cell + 4);
        const on = entry === String(current);
        parts.push(box(x + 0.6, (h - cell) / 2, cell - 1.2, cell, 6, on ? p.accent : p.surface, on ? p.accent : p.line), label(x + cell / 2, h / 2, entry, { size: Math.min(size, cell * 0.5), fill: on ? p.onAccent : p.ink, weight: on ? 600 : undefined, anchor: 'middle' }));
      });
      return parts.join('');
    }
    case 'divider': {
      const value = element.text.trim();
      if (!value) return `<line x1="0" y1="${n(mid)}" x2="${n(w)}" y2="${n(mid)}" stroke="${p.line}" stroke-width="1.2"/>`;
      const width = Math.min(w - 16, textWidth(value, size - 2) + 16);
      return [
        `<line x1="0" y1="${n(mid)}" x2="${n((w - width) / 2)}" y2="${n(mid)}" stroke="${p.line}" stroke-width="1.2"/>`,
        `<line x1="${n((w + width) / 2)}" y1="${n(mid)}" x2="${n(w)}" y2="${n(mid)}" stroke="${p.line}" stroke-width="1.2"/>`,
        label(w / 2, mid, value, { size: size - 2, fill: p.muted, anchor: 'middle', width: width - 8 }),
      ].join('');
    }
  }
}
