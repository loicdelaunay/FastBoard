import {
  BOARD_LIMITS,
  newElementId,
  type BoardColor,
  type BoardElement,
  type ConnectorElement,
  type ConnectorEnd,
  type FillStyle,
  type FrameElement,
  type ShapeElement,
  type ShapeKind,
  type Side,
  type StickyElement,
  type TextElement,
  type TextSize,
} from './boards.ts';

/**
 * Import de diagrammes draw.io (diagrams.net) : un fichier `.drawio`, le XML exporté, ou ce que draw.io met dans le
 * presse-papiers. Les formes, textes, conteneurs et liens deviennent des éléments du tableau blanc, avec leurs couleurs,
 * points de passage, accroches, sauts et animations. Fonctionne côté navigateur comme côté serveur (tests).
 */

interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Décode les entités XML et HTML courantes. */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

const TAG = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>/g;
const ATTRIBUTE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Petit lecteur XML : assez pour le format de draw.io (balises, attributs, texte des nœuds `diagram`). */
function parseXml(text: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  let last = 0;
  for (const match of text.matchAll(TAG)) {
    const parent = stack[stack.length - 1]!;
    const between = text.slice(last, match.index);
    if (between.trim()) parent.children.push({ name: '#text', attrs: { value: decodeEntities(between) }, children: [] });
    last = match.index! + match[0].length;
    if (match[5] !== undefined) {
      parent.children.push({ name: '#text', attrs: { value: match[5] }, children: [] });
      continue;
    }
    if (!match[2]) continue; // commentaire, déclaration
    if (match[1]) {
      // Balise fermante : on remonte jusqu'à la balise ouverte correspondante.
      const at = stack.map((node) => node.name).lastIndexOf(match[2]);
      if (at > 0) stack.length = at;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const attribute of match[3]!.matchAll(ATTRIBUTE)) attrs[attribute[1]!] = decodeEntities(attribute[2] ?? attribute[3] ?? '');
    const node: XmlNode = { name: match[2], attrs, children: [] };
    parent.children.push(node);
    if (!match[4]) stack.push(node);
  }
  return root;
}

function* walk(node: XmlNode): Generator<XmlNode> {
  yield node;
  for (const child of node.children) yield* walk(child);
}

const find = (node: XmlNode, name: string): XmlNode | undefined => {
  for (const entry of walk(node)) if (entry.name === name && entry !== node) return entry;
  return undefined;
};

/** Contenu compressé d'un nœud `diagram` : base64, deflate brut, puis texte encodé en URL. */
async function inflateDiagram(data: string): Promise<string> {
  const binary = atob(data.replace(/\s+/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const text = await new Response(stream).text();
  return decodeURIComponent(text);
}

/** Le texte ressemble-t-il à un diagramme draw.io ? */
export function looksLikeDrawio(text: string): boolean {
  const head = text.trimStart().slice(0, 400);
  return /<mxfile|<mxGraphModel/.test(head) || /^%3C(mxfile|mxGraphModel)/i.test(head);
}

export interface DrawioPage {
  name: string;
  model: string;
}

/** Les pages d'un fichier draw.io (le XML de chaque `mxGraphModel`, décompressé). */
export async function drawioPages(text: string): Promise<DrawioPage[]> {
  let source = text.trim();
  if (/^%3C/i.test(source)) source = decodeURIComponent(source);
  const root = parseXml(source);
  const pages: DrawioPage[] = [];
  const diagrams = [...walk(root)].filter((node) => node.name === 'diagram');
  if (!diagrams.length) {
    if (find(root, 'mxGraphModel') || root.children.some((node) => node.name === 'mxGraphModel')) pages.push({ name: '', model: source });
    return pages;
  }
  for (const [position, diagram] of diagrams.entries()) {
    const name = diagram.attrs.name ?? `Page ${position + 1}`;
    if (diagram.children.some((node) => node.name === 'mxGraphModel')) {
      // Page non compressée : on la reprend telle quelle depuis le texte.
      const start = source.indexOf('<mxGraphModel', nthIndex(source, '<diagram', position));
      const end = source.indexOf('</mxGraphModel>', start);
      if (start >= 0 && end > start) pages.push({ name, model: source.slice(start, end + '</mxGraphModel>'.length) });
      continue;
    }
    const data = diagram.children.find((node) => node.name === '#text')?.attrs.value?.trim();
    if (data) pages.push({ name, model: await inflateDiagram(data) });
  }
  return pages;
}

function nthIndex(text: string, search: string, n: number): number {
  let at = -1;
  for (let count = 0; count <= n; count += 1) {
    at = text.indexOf(search, at + 1);
    if (at < 0) return -1;
  }
  return at;
}

/** Style draw.io (`rounded=1;fillColor=#dae8fc;ellipse;`) : ses réglages, et le premier mot nu (la forme). */
function parseStyle(style: string): { values: Record<string, string>; base: string } {
  const values: Record<string, string> = {};
  let base = '';
  for (const part of style.split(';')) {
    const entry = part.trim();
    if (!entry) continue;
    const equal = entry.indexOf('=');
    if (equal < 0) {
      if (!base) base = entry;
      values[entry] = '1';
    } else values[entry.slice(0, equal)] = entry.slice(equal + 1);
  }
  return { values, base };
}

/** Texte d'un libellé draw.io (souvent du HTML) : les sauts de ligne gardés, les balises retirées. */
export function drawioText(value: string): string {
  return decodeEntities(
    value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/ /g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Couleur du tableau la plus proche d'une couleur draw.io. */
export function nearestColor(hex: string | undefined, orangeLimit = 40): BoardColor | null {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const saturation = max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1));
  if (saturation < 0.18) return lightness < 0.35 ? 'default' : 'gray';
  let hue = 0;
  if (max === r) hue = ((g - b) / (max - min)) % 6;
  else if (max === g) hue = (b - r) / (max - min) + 2;
  else hue = (r - g) / (max - min) + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue < 15 || hue >= 345) return 'red';
  if (hue < orangeLimit) return 'orange';
  if (hue < 70) return 'yellow';
  if (hue < 170) return 'green';
  if (hue < 255) return 'blue';
  if (hue < 290) return 'purple';
  return 'pink';
}

const textSize = (fontSize: string | undefined): TextSize => {
  const size = Number(fontSize ?? 12);
  return size <= 10 ? 's' : size <= 14 ? 'm' : size <= 20 ? 'l' : 'xl';
};

const SHAPES: Record<string, ShapeKind> = {
  ellipse: 'ellipse',
  doubleEllipse: 'ellipse',
  rhombus: 'diamond',
  parallelogram: 'parallelogram',
  hexagon: 'hexagon',
  cylinder: 'cylinder',
  cylinder3: 'cylinder',
  datastore: 'cylinder',
  triangle: 'triangle',
};

/** Côté et position d'une accroche draw.io (`exitX`, `exitY` de 0 à 1). */
function sideOf(x: string | undefined, y: string | undefined): Pick<ConnectorEnd, 'side' | 't'> {
  if (x === undefined || y === undefined) return { side: null };
  const u = Number(x);
  const v = Number(y);
  if (!Number.isFinite(u) || !Number.isFinite(v)) return { side: null };
  const candidates: Array<[Side, number, number]> = [
    ['left', u, v],
    ['right', 1 - u, v],
    ['top', v, u],
    ['bottom', 1 - v, u],
  ];
  const [side, , t] = candidates.sort((a, b) => a[1] - b[1])[0]!;
  const clamped = Math.round(Math.min(1, Math.max(0, t)) * 1000) / 1000;
  return clamped === 0.5 ? { side } : { side, t: clamped };
}

interface Cell {
  id: string;
  value: string;
  style: { values: Record<string, string>; base: string };
  vertex: boolean;
  edge: boolean;
  parent: string | null;
  source: string | null;
  target: string | null;
  geometry: XmlNode | undefined;
}

export interface DrawioImport {
  elements: BoardElement[];
  /** Cellules non reprises (images, formes inconnues reprises en rectangles ne comptent pas). */
  skipped: number;
}

/** Convertit une page draw.io (`mxGraphModel`) en éléments du tableau, aux coordonnées de draw.io. */
export function drawioToElements(model: string, options: { zStart?: number } = {}): DrawioImport {
  const root = parseXml(model);
  const cells: Cell[] = [];
  // Un objet draw.io (`object`, `UserObject`) enveloppe sa cellule et porte son identifiant et son libellé.
  const wrappers = new Map<XmlNode, XmlNode>();
  for (const node of walk(root)) if (node.name === 'object' || node.name === 'UserObject') for (const child of node.children) wrappers.set(child, node);
  for (const node of walk(root)) {
    if (node.name !== 'mxCell') continue;
    const wrapper = wrappers.get(node);
    const id = wrapper?.attrs.id ?? node.attrs.id;
    if (!id) continue;
    cells.push({
      id,
      value: wrapper?.attrs.label ?? node.attrs.value ?? '',
      style: parseStyle(node.attrs.style ?? ''),
      vertex: node.attrs.vertex === '1',
      edge: node.attrs.edge === '1',
      parent: node.attrs.parent ?? null,
      source: node.attrs.source ?? null,
      target: node.attrs.target ?? null,
      geometry: node.children.find((child) => child.name === 'mxGeometry'),
    });
  }
  const byId = new Map(cells.map((cell) => [cell.id, cell]));
  const num = (value: string | undefined, fallback = 0): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  /** Origine absolue d'une cellule (les formes d'un groupe ou d'un conteneur sont placées par rapport à lui). */
  const origin = (id: string | null, depth = 0): { x: number; y: number } => {
    const cell = id ? byId.get(id) : undefined;
    if (!cell || !cell.vertex || depth > 50) return { x: 0, y: 0 };
    const parent = origin(cell.parent, depth + 1);
    return { x: parent.x + num(cell.geometry?.attrs.x), y: parent.y + num(cell.geometry?.attrs.y) };
  };

  let z = options.zStart ?? 1;
  let skipped = 0;
  const ids = new Map<string, string>();
  const groups = new Map<string, string>();
  const elements: BoardElement[] = [];
  const edgeLabels = new Map<string, string[]>();

  for (const cell of cells) {
    if (!cell.vertex) continue;
    const { values, base } = cell.style;
    const shape = values.shape ?? base;
    // Libellé posé sur un lien : il rejoint le lien.
    if (values.edgeLabel === '1' || base === 'edgeLabel') {
      if (cell.parent) edgeLabels.set(cell.parent, [...(edgeLabels.get(cell.parent) ?? []), drawioText(cell.value)]);
      continue;
    }
    // Groupe draw.io : invisible, ses formes forment un groupe du tableau.
    if (base === 'group') {
      groups.set(cell.id, newElementId());
      continue;
    }
    const at = origin(cell.id);
    const box = { x: Math.round(at.x), y: Math.round(at.y), w: Math.max(4, Math.round(num(cell.geometry?.attrs.width, 120))), h: Math.max(4, Math.round(num(cell.geometry?.attrs.height, 60))) };
    const id = newElementId();
    const group = cell.parent ? groups.get(cell.parent) : undefined;
    const text = drawioText(cell.value);
    const stroke = values.strokeColor;
    const fillColor = values.fillColor;
    // La couleur du fond d'abord (celle qu'on voit) ; un fond blanc ou gris laisse parler le contour.
    const fromFill = nearestColor(fillColor);
    const fromStroke = nearestColor(stroke, 44);
    const color = fromFill && fromFill !== 'gray' && fromFill !== 'default' ? fromFill : (fromStroke ?? fromFill ?? 'default');
    let element: BoardElement | null = null;
    if (base === 'text' || shape === 'text' || (fillColor === 'none' && stroke === 'none' && !SHAPES[shape])) {
      element = { id, type: 'text', z: z++, ...box, text, color: nearestColor(values.fontColor) ?? 'default', size: textSize(values.fontSize), align: values.align === 'center' ? 'center' : values.align === 'right' ? 'right' : 'left' } satisfies TextElement;
    } else if (base === 'swimlane' || values.swimlane === '1' || (values.container === '1' && !SHAPES[shape])) {
      element = { id, type: 'frame', z: z++, ...box, title: text, color: nearestColor(fillColor) ?? nearestColor(stroke) ?? 'gray' } satisfies FrameElement;
    } else if (shape === 'note' || base === 'note') {
      const sticky = nearestColor(fillColor);
      element = { id, type: 'sticky', z: z++, ...box, text, color: sticky && sticky !== 'default' && sticky !== 'gray' ? sticky : 'yellow', votes: [] } satisfies StickyElement;
    } else if (values.image || shape === 'image' || base === 'image') {
      skipped += 1;
      continue;
    } else {
      const kind: ShapeKind = SHAPES[shape] ?? (values.rounded === '1' ? 'rounded' : 'rect');
      const fill: FillStyle = fillColor === 'none' ? (stroke === 'none' ? 'none' : 'outline') : 'solid';
      element = { id, type: 'shape', z: z++, ...box, shape: kind, text, color, fill, size: textSize(values.fontSize) } satisfies ShapeElement;
    }
    if (group) element = { ...element, group };
    ids.set(cell.id, id);
    elements.push(element);
  }

  for (const cell of cells) {
    if (!cell.edge) continue;
    const { values } = cell.style;
    const geometry = cell.geometry;
    const base = origin(cell.parent);
    const point = (as: string): { x: number; y: number } | null => {
      const node = geometry?.children.find((child) => child.name === 'mxPoint' && child.attrs.as === as);
      return node ? { x: base.x + num(node.attrs.x), y: base.y + num(node.attrs.y) } : null;
    };
    const waypoints = (geometry?.children.find((child) => child.name === 'Array' && child.attrs.as === 'points')?.children ?? [])
      .filter((child) => child.name === 'mxPoint')
      .map((child) => ({ x: Math.round(base.x + num(child.attrs.x)), y: Math.round(base.y + num(child.attrs.y)) }));
    const end = (cellId: string | null, as: string, x: string | undefined, y: string | undefined): ConnectorEnd | null => {
      const target = cellId ? ids.get(cellId) : undefined;
      if (target) return { id: target, ...sideOf(x, y), x: 0, y: 0 };
      const free = point(as);
      return free ? { id: null, side: null, x: free.x, y: free.y } : null;
    };
    const from = end(cell.source, 'sourcePoint', values.exitX, values.exitY);
    const to = end(cell.target, 'targetPoint', values.entryX, values.entryY);
    if (!from || !to) {
      skipped += 1;
      continue;
    }
    const style = values.edgeStyle ?? '';
    const width = num(values.strokeWidth, 1);
    const jump = values.jumpStyle;
    const label = [drawioText(cell.value), ...(edgeLabels.get(cell.id) ?? [])].filter(Boolean).join('\n');
    const connector: ConnectorElement = {
      id: newElementId(),
      type: 'connector',
      z: z++,
      from,
      to,
      label: label.slice(0, 500),
      route: values.curved === '1' ? 'curve' : /orthogonal|elbow|entityRelation|isometric/i.test(style) ? 'elbow' : 'straight',
      dashed: values.dashed === '1',
      arrowStart: values.startArrow !== undefined && values.startArrow !== 'none',
      arrowEnd: values.endArrow !== 'none',
      color: nearestColor(values.strokeColor, 44) ?? 'default',
      ...(width >= 5 ? { weight: 'xl' as const } : width >= 2.5 ? { weight: 'l' as const } : width < 1 ? { weight: 's' as const } : {}),
      ...(waypoints.length ? { waypoints } : {}),
      ...(jump === 'arc' || jump === 'gap' || jump === 'sharp' ? { jump } : {}),
      ...(values.flowAnimation === '1' ? { animation: 'flow' as const } : {}),
    };
    elements.push(connector);
  }

  return { elements: elements.slice(0, BOARD_LIMITS.elements), skipped };
}
