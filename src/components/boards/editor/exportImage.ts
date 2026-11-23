import type { Rect } from '@shared/boardGeometry';

/**
 * Export d'un tableau blanc en image, comme dans Whimsical : PNG, WebP, SVG ou PDF, de tout le tableau ou de la
 * sélection. On part du rendu affiché (le dessin SVG de l'éditeur, textes HTML compris) : l'image ressemble à l'écran.
 * Les styles sont recopiés sur chaque nœud, les images, graphiques et polices intégrés, pour que le fichier se suffise.
 */

export type ExportFormat = 'png' | 'webp' | 'svg' | 'pdf';

export interface ExportOptions {
  format: ExportFormat;
  /** Échelle des images matricielles (1, 2, 3…). */
  scale: number;
  /** Fond transparent (sinon la couleur du tableau). */
  transparent: boolean;
  /** Éléments à exporter ; `null` : tout le tableau. */
  ids: ReadonlySet<string> | null;
}

const PADDING = 32;
/** Côté et surface maximaux d'un canevas pour les navigateurs courants. */
const MAX_SIDE = 16_000;
const MAX_AREA = 200_000_000;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Propriétés de dessin recopiées sur les nœuds SVG (les autres gardent leurs attributs). */
const SVG_PROPS = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'opacity',
  'display',
  'visibility',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'letter-spacing',
  'text-decoration',
  'color',
  'filter',
  'paint-order',
];
/** Propriétés des nœuds HTML qu'on ne recopie pas : interaction et animations. */
const SKIPPED_HTML = new Set(['cursor', 'pointer-events', 'user-select', '-webkit-user-select', 'transition', 'transition-property', 'transition-duration', 'transition-delay', 'transition-timing-function', 'caret-color', 'will-change']);

/** Recopie le style calculé de `source` sur `target`. */
function copyStyle(source: Element, target: Element): void {
  const computed = getComputedStyle(source);
  const style = (target as HTMLElement | SVGElement).style;
  if (source.namespaceURI === SVG_NS) {
    for (const name of SVG_PROPS) {
      const value = computed.getPropertyValue(name);
      if (value) style.setProperty(name, value);
    }
    // Le trait garde son épaisseur à l'échelle de l'export (à l'écran, il ne suit pas le zoom).
    style.setProperty('vector-effect', 'none');
    return;
  }
  for (let index = 0; index < computed.length; index += 1) {
    const name = computed.item(index);
    if (SKIPPED_HTML.has(name) || name.startsWith('--')) continue;
    style.setProperty(name, computed.getPropertyValue(name));
  }
}

const dataUrlCache = new Map<string, Promise<string | null>>();

/** Contenu d'une adresse en `data:` (image, police), ou `null` si elle ne se charge pas. */
function toDataUrl(url: string): Promise<string | null> {
  if (url.startsWith('data:')) return Promise.resolve(url);
  let pending = dataUrlCache.get(url);
  if (!pending) {
    pending = fetch(url, { credentials: 'same-origin' })
      .then((response) => (response.ok ? response.blob() : null))
      .then(
        (blob) =>
          blob &&
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          }),
      )
      .catch(() => null);
    dataUrlCache.set(url, pending);
  }
  return pending;
}

const URL_IN_CSS = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

/** Remplace les `url(…)` d'une valeur CSS par leur contenu. */
async function inlineCssUrls(value: string, base: string): Promise<string> {
  const urls = [...value.matchAll(URL_IN_CSS)].map((match) => match[2]!);
  let result = value;
  for (const url of new Set(urls)) {
    if (url.startsWith('data:') || url.startsWith('#')) continue;
    const data = await toDataUrl(new URL(url, base).href);
    if (data) result = result.split(url).join(data);
  }
  return result;
}

/** Les @font-face des polices utilisées, avec leurs fichiers intégrés. */
async function fontFaces(families: Set<string>): Promise<string> {
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let cssRules: CSSRuleList;
    try {
      cssRules = sheet.cssRules;
    } catch {
      continue; // Feuille d'un autre site : illisible.
    }
    for (const rule of Array.from(cssRules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const family = rule.style.getPropertyValue('font-family').replace(/['"]/g, '').trim().toLowerCase();
      if (!families.has(family)) continue;
      rules.push(await inlineCssUrls(rule.cssText, sheet.href ?? location.href));
    }
  }
  return rules.join('\n');
}

/** Noms des polices d'une valeur `font-family`, en minuscules. */
function familiesOf(value: string): string[] {
  return value.split(',').map((family) => family.replace(/['"]/g, '').trim().toLowerCase());
}

export interface ExportedImage {
  blob: Blob;
  width: number;
  height: number;
  /** L'échelle a été réduite pour tenir dans un canevas. */
  reduced: boolean;
}

/**
 * Construit le SVG autonome de `content` (le groupe des éléments du tableau, sans transformation) sur `bounds`.
 * `background` : couleur du fond, ou `null` pour un fond transparent.
 */
export async function buildExportSvg(content: SVGGElement, bounds: Rect, ids: ReadonlySet<string> | null, background: string | null): Promise<{ svg: string; width: number; height: number }> {
  const view = { x: bounds.x - PADDING, y: bounds.y - PADDING, w: bounds.w + PADDING * 2, h: bounds.h + PADDING * 2 };
  const clone = content.cloneNode(true) as SVGGElement;
  clone.removeAttribute('transform');

  // Styles recopiés nœud par nœud (les deux arbres ont la même forme).
  const sources = [content, ...Array.from(content.querySelectorAll('*'))];
  const targets = [clone, ...Array.from(clone.querySelectorAll('*'))];
  const families = new Set<string>();
  const canvases: Array<[HTMLCanvasElement, Element]> = [];
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index]!;
    const target = targets[index]!;
    copyStyle(source, target);
    for (const family of familiesOf(getComputedStyle(source).fontFamily)) families.add(family);
    if (source instanceof HTMLCanvasElement) canvases.push([source, target]);
  }

  // Graphiques (canevas Chart.js) : leur image.
  for (const [canvas, target] of canvases) {
    const image = document.createElement('img');
    image.setAttribute('src', canvas.toDataURL('image/png'));
    image.setAttribute('style', (target as HTMLElement).getAttribute('style') ?? '');
    target.replaceWith(image);
  }

  // Seulement la sélection : les autres éléments partent (et les liens de carte mentale qui vont vers eux).
  if (ids) {
    for (const node of Array.from(clone.querySelectorAll<SVGElement>('[data-id]'))) if (!ids.has(node.dataset.id!)) node.remove();
    for (const node of Array.from(clone.querySelectorAll<SVGElement>('[data-child]'))) if (!ids.has(node.dataset.child!)) node.remove();
  }
  // Commentaires du gabarit : certains contiennent « -- », interdit en XML.
  const comments = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
  const found: Node[] = [];
  for (let node = comments.nextNode(); node; node = comments.nextNode()) found.push(node);
  for (const node of found) node.parentNode?.removeChild(node);
  // Zones de clic invisibles : inutiles dans un fichier.
  for (const node of Array.from(clone.querySelectorAll('.hit, .mockup-hit'))) node.remove();

  // Images intégrées.
  for (const node of Array.from(clone.querySelectorAll('image'))) {
    const href = node.getAttribute('href') ?? node.getAttribute('xlink:href');
    if (!href) continue;
    const data = await toDataUrl(new URL(href, location.href).href);
    if (data) node.setAttribute('href', data);
  }
  for (const node of Array.from(clone.querySelectorAll('img'))) {
    const src = node.getAttribute('src');
    if (src && !src.startsWith('data:')) {
      const data = await toDataUrl(new URL(src, location.href).href);
      if (data) node.setAttribute('src', data);
    }
  }
  for (const node of Array.from(clone.querySelectorAll<HTMLElement | SVGElement>('[style*="url("]'))) {
    node.setAttribute('style', await inlineCssUrls(node.getAttribute('style') ?? '', location.href));
  }

  // Attributs propres à l'éditeur (styles de Vue), sans effet une fois les styles recopiés.
  for (const node of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    for (const attribute of Array.from(node.attributes)) if (attribute.name.startsWith('data-v-')) node.removeAttribute(attribute.name);
  }
  const faces = await fontFaces(families);
  const serializer = new XMLSerializer();
  const back = background ? `<rect x="${view.x}" y="${view.y}" width="${view.w}" height="${view.h}" fill="${background}"/>` : '';
  const style = faces ? `<defs><style>${faces.replace(/<\/style/gi, '<\\/style')}</style></defs>` : '';
  const svg = `<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${view.x} ${view.y} ${view.w} ${view.h}" width="${Math.ceil(view.w)}" height="${Math.ceil(view.h)}">${style}${back}${serializer.serializeToString(clone)}</svg>`;
  return { svg, width: Math.ceil(view.w), height: Math.ceil(view.h) };
}

/** Image matricielle (PNG, WebP) du SVG, à l'échelle demandée (réduite au besoin). */
export async function rasterize(svg: string, width: number, height: number, scale: number, type: 'image/png' | 'image/webp'): Promise<ExportedImage> {
  let factor = Math.max(0.1, scale);
  while ((width * factor > MAX_SIDE || height * factor > MAX_SIDE || width * height * factor * factor > MAX_AREA) && factor > 0.1) factor *= 0.8;
  const image = new Image();
  // `decode()` ne rend pas toujours la main avec un SVG qui contient du HTML : on attend le chargement.
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('svg'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * factor));
  canvas.height = Math.max(1, Math.round(height * factor));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
  if (!blob) throw new Error('blob');
  return { blob, width: canvas.width, height: canvas.height, reduced: factor < scale };
}

/** PDF d'une page à la taille du dessin, l'image en haute définition. */
export async function toPdf(svg: string, width: number, height: number, scale: number): Promise<ExportedImage> {
  const png = await rasterize(svg, width, height, Math.max(2, scale), 'image/png');
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: width >= height ? 'landscape' : 'portrait', unit: 'pt', format: [width * 0.75, height * 0.75], compress: true });
  const data = new Uint8Array(await png.blob.arrayBuffer());
  pdf.addImage(data, 'PNG', 0, 0, width * 0.75, height * 0.75, undefined, 'FAST');
  return { blob: pdf.output('blob'), width, height, reduced: png.reduced };
}

/** Propose le fichier au téléchargement. */
export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Nom de fichier tiré du titre du tableau. */
export function exportFileName(title: string, format: ExportFormat): string {
  const base = title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'tableau';
  return `${base}.${format}`;
}
