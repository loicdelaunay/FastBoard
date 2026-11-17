import type {
  BoardElement,
  ConnectorElement,
  FastElement,
  FrameElement,
  MindElement,
  ShapeElement,
  ShapeKind,
  StickyElement,
  TextElement,
} from './boards.ts';
import { BOARD_LIMITS, elementText, newElementId } from './boards.ts';
import type { Point, Rect } from './boardGeometry.ts';
import { center, contains, layoutMind } from './boardGeometry.ts';

/**
 * Mermaid et tableaux blancs : lecture des organigrammes (`flowchart`, `graph`) et des cartes mentales (`mindmap`),
 * écriture d'une sélection d'éléments, et disposition en couches (à la Sugiyama) des nœuds importés. La lecture est
 * tolérante : une instruction illisible est ignorée, seul un texte sans rien d'utilisable est refusé.
 */

export type MermaidDirection = 'TB' | 'BT' | 'LR' | 'RL';

export interface MermaidNode {
  id: string;
  label: string;
  shape: ShapeKind;
}

/** Lien : `from` et `to` désignent un nœud, ou un groupe (`subgraph`) relié comme un tout. */
export interface MermaidEdge {
  from: string;
  to: string;
  label: string;
  dashed: boolean;
  arrowStart: boolean;
  arrowEnd: boolean;
}

/** Groupe (`subgraph`) : ses nœuds, ceux des groupes imbriqués compris. */
export interface MermaidGroup {
  id: string;
  label: string;
  nodes: string[];
}

export interface MermaidGraph {
  kind: 'flowchart' | 'mindmap';
  direction: MermaidDirection;
  /** Dans l'ordre d'apparition ; pour une carte mentale, la racine d'abord. */
  nodes: MermaidNode[];
  edges: MermaidEdge[];
  /** Dans l'ordre d'ouverture : un groupe vient avant ceux qu'il contient. */
  groups: MermaidGroup[];
}

export class MermaidError extends Error {}

// ---------------------------------------------------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------------------------------------------------

const FENCE = /^\s*(`{3,}|~{3,})/;

/** Commentaire `%%` retiré (hors des guillemets). */
function stripComment(line: string): string {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === '%' && line[index + 1] === '%') return line.slice(0, index);
  }
  return line;
}

/** Lignes du diagramme : sans bloc de code autour, ni en-tête YAML, ni commentaires. */
function sourceLines(text: string): string[] {
  let lines = text.replace(/\r\n?/g, '\n').split('\n');
  const tagged = lines.findIndex((line) => /^\s*(`{3,}|~{3,})\s*mermaid\b/i.test(line));
  const first = lines.findIndex((line) => line.trim());
  const open = tagged >= 0 ? tagged : first >= 0 && FENCE.test(lines[first]!) ? first : -1;
  if (open >= 0) {
    const fence = FENCE.exec(lines[open]!)![1]!;
    lines = lines.slice(open + 1);
    const close = lines.findIndex((line) => line.trim().startsWith(fence));
    if (close >= 0) lines = lines.slice(0, close);
  }
  // En-tête YAML (`---` … `---`) : titre et configuration, sans intérêt ici.
  const start = lines.findIndex((line) => line.trim());
  if (start >= 0 && lines[start]!.trim() === '---') {
    const end = lines.findIndex((line, index) => index > start && line.trim() === '---');
    if (end >= 0) lines = lines.slice(end + 1);
  }
  return lines.map(stripComment);
}

const ENTITIES = new Map([
  ['quot', '"'],
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['apos', "'"],
  ['nbsp', ' '],
]);

/** Entité Mermaid (`#quot;`, `#35;`) ou HTML (`&quot;`, `&#35;`, `&#x23;`), d'après son code sans `#`/`&` initial. */
function entity(code: string): string | null {
  const hex = /^#x([0-9a-f]+)$/i.exec(code);
  const decimal = /^#?(\d+)$/.exec(code);
  if (hex || decimal) {
    const number = hex ? parseInt(hex[1]!, 16) : Number(decimal![1]);
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : null;
  }
  return ENTITIES.get(code.toLowerCase()) ?? null;
}

/** Texte d'une étiquette : guillemets et accents graves (chaîne Markdown) retirés, `<br>` et entités décodés. */
function decodeLabel(raw: string): string {
  let text = raw.trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1);
  if (text.length >= 2 && text.startsWith('`') && text.endsWith('`')) text = text.slice(1, -1);
  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/#(\w+);/g, (match, code: string) => entity(code) ?? match)
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, code: string) => entity(code) ?? match);
  return text
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim()
    .slice(0, BOARD_LIMITS.textMax);
}

const skipSpaces = (text: string, at: number): number => {
  let index = at;
  while (index < text.length && /\s/.test(text[index]!)) index += 1;
  return index;
};

const ID_CHAR = /^[\p{L}\p{N}_]$/u;

/** Fin d'un identifiant de nœud : lettres, chiffres, `_`, et `-` ou `.` suivis d'un tel caractère (pas d'une flèche). */
function readId(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    const char = String.fromCodePoint(text.codePointAt(index)!);
    if (ID_CHAR.test(char)) {
      index += char.length;
      continue;
    }
    if ((char === '-' || char === '.') && index > start) {
      const next = text.codePointAt(index + 1);
      if (next !== undefined && ID_CHAR.test(String.fromCodePoint(next))) {
        index += 1;
        continue;
      }
    }
    break;
  }
  return index;
}

/** Instructions d'une ligne : coupées sur les `;` hors des guillemets, des crochets et des étiquettes `|…|`. */
function splitStatements(line: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  let depth = 0;
  let pipe = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (!quoted) {
      if ('[({'.includes(char)) depth += 1;
      else if ('])}'.includes(char)) depth = Math.max(0, depth - 1);
      else if (char === '|' && !depth) pipe = !pipe;
      else if (char === ';' && !depth && !pipe) {
        parts.push(current);
        current = '';
        continue;
      }
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** Contenu jusqu'à l'un des délimiteurs fermants ; un texte entre guillemets peut contenir ces délimiteurs. */
function readBody(text: string, from: number, closes: readonly string[]): { text: string; end: number } | null {
  const at = skipSpaces(text, from);
  if (text[at] === '"') {
    const markdown = text.startsWith('"`', at);
    const quote = markdown ? text.indexOf('`"', at + 2) : text.indexOf('"', at + 1);
    if (quote >= 0) {
      const after = quote + (markdown ? 2 : 1);
      const next = skipSpaces(text, after);
      for (const close of closes) if (text.startsWith(close, next)) return { text: text.slice(at, after), end: next + close.length };
    }
  }
  let best = -1;
  let length = 0;
  for (const close of closes) {
    const index = text.indexOf(close, from);
    if (index >= 0 && (best < 0 || index < best)) {
      best = index;
      length = close.length;
    }
  }
  return best < 0 ? null : { text: text.slice(from, best), end: best + length };
}

/** Formes des nœuds d'un organigramme : ouverture, fermetures possibles (les plus longues d'abord). */
const FLOW_SHAPES: ReadonlyArray<readonly [string, readonly string[], ShapeKind]> = [
  ['(((', [')))'], 'ellipse'],
  ['((', ['))'], 'ellipse'],
  ['([', ['])'], 'rounded'],
  ['(', [')'], 'rounded'],
  ['[[', [']]'], 'rect'],
  ['[(', [')]'], 'cylinder'],
  ['[/', ['/]', '\\]'], 'parallelogram'],
  ['[\\', ['\\]', '/]'], 'parallelogram'],
  ['[', [']'], 'rect'],
  ['{{', ['}}'], 'hexagon'],
  ['{', ['}'], 'diamond'],
  ['>', [']'], 'parallelogram'],
];

function readShape(text: string, at: number): { shape: ShapeKind; label: string; end: number } | null {
  // Un espace est toléré avant `[`, `(` ou `{` (pas avant `>`, qui n'ouvre une forme que collé à l'identifiant).
  const spaced = skipSpaces(text, at);
  const start = spaced > at && '[({'.includes(text[spaced] ?? ' ') ? spaced : at;
  for (const [open, closes, shape] of FLOW_SHAPES) {
    if (!text.startsWith(open, start) || (open === '>' && start !== at)) continue;
    const body = readBody(text, start + open.length, closes);
    if (body) return { shape, label: decodeLabel(body.text), end: body.end };
  }
  return null;
}

/** Noms de formes de la syntaxe `A@{ shape: … }`. */
const SHAPE_NAMES = new Map<string, ShapeKind>([
  ...['rect', 'rectangle', 'proc', 'process', 'square', 'subproc', 'subprocess', 'fr-rect', 'framed-rectangle', 'div-rect', 'notch-rect', 'card', 'doc', 'document'].map((name) => [name, 'rect'] as const),
  ...['rounded', 'event', 'stadium', 'pill', 'terminal', 'terminal-point'].map((name) => [name, 'rounded'] as const),
  ...['circle', 'circ', 'ellipse', 'oval', 'dbl-circ', 'double-circle', 'sm-circ', 'small-circle', 'start', 'fr-circ', 'framed-circle', 'stop', 'f-circ', 'junction'].map((name) => [name, 'ellipse'] as const),
  ...['diamond', 'diam', 'decision', 'question'].map((name) => [name, 'diamond'] as const),
  ...['hex', 'hexagon', 'prepare'].map((name) => [name, 'hexagon'] as const),
  ...['cyl', 'cylinder', 'database', 'db', 'h-cyl', 'horizontal-cylinder', 'das', 'lin-cyl', 'disk', 'lined-cylinder'].map((name) => [name, 'cylinder'] as const),
  ...['lean-r', 'lean-l', 'lean-right', 'lean-left', 'parallelogram', 'in-out', 'out-in', 'trap-b', 'trap-t', 'trapezoid', 'inv-trapezoid', 'trapezoid-bottom', 'trapezoid-top', 'priority', 'manual'].map((name) => [name, 'parallelogram'] as const),
  ...['tri', 'triangle', 'extract', 'flip-tri', 'flipped-triangle', 'manual-file'].map((name) => [name, 'triangle'] as const),
]);

/** Accolade fermante (hors des guillemets), ou -1. */
function closingBrace(text: string, from: number): number {
  let quoted = false;
  for (let index = from; index < text.length; index += 1) {
    if (text[index] === '"') quoted = !quoted;
    else if (!quoted && text[index] === '}') return index;
  }
  return -1;
}

/** Propriétés `clé: valeur` séparées par des virgules (hors des guillemets). */
function readProps(body: string): Map<string, string> {
  const props = new Map<string, string>();
  const parts: string[] = [''];
  let quoted = false;
  for (const char of body) {
    if (char === '"') quoted = !quoted;
    if (char === ',' && !quoted) parts.push('');
    else parts[parts.length - 1] += char;
  }
  for (const part of parts) {
    const colon = part.indexOf(':');
    if (colon > 0) props.set(part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim());
  }
  return props;
}

const unquote = (value: string): string => (/^(['"]).*\1$/s.test(value) ? value.slice(1, -1) : value);

interface NodeRef {
  id: string;
  label?: string;
  shape?: ShapeKind;
  /** Propriétés d'un lien (`e1@{ animate: true }`), pas d'un nœud. */
  edgeProps?: boolean;
}

function readNode(text: string, start: number): { ref: NodeRef; end: number } | null {
  const idEnd = readId(text, start);
  if (idEnd === start) return null;
  const ref: NodeRef = { id: text.slice(start, idEnd) };
  let at = idEnd;
  if (text.startsWith('@{', at)) {
    const close = closingBrace(text, at + 2);
    if (close < 0) return null;
    const props = readProps(text.slice(at + 2, close));
    if (!props.has('shape') && !props.has('label') && ['animate', 'animation', 'curve'].some((key) => props.has(key))) ref.edgeProps = true;
    const shape = props.get('shape');
    if (shape !== undefined) ref.shape = SHAPE_NAMES.get(unquote(shape).toLowerCase()) ?? 'rect';
    const label = props.get('label');
    if (label !== undefined) ref.label = decodeLabel(label.startsWith("'") ? unquote(label) : label);
    at = close + 1;
  } else {
    const shape = readShape(text, at);
    if (shape) {
      ref.shape = shape.shape;
      ref.label = shape.label;
      at = shape.end;
    }
  }
  const style = /:::[\p{L}\p{N}_-]+/uy;
  style.lastIndex = at;
  if (style.test(text)) at = style.lastIndex;
  return { ref, end: at };
}

interface Link {
  id: string | null;
  label: string;
  dashed: boolean;
  arrowStart: boolean;
  arrowEnd: boolean;
  invisible: boolean;
  end: number;
}

/** Flèches complètes : `-->`, `---`, `--o`, `<-->`, `==>`, `-.->`… (les plus longues comprises). */
const ARROWS: ReadonlyArray<readonly [RegExp, boolean]> = [
  [/\s*([xo<]?)-{2,}([-xo>])\s*/y, false],
  [/\s*([xo<]?)={2,}([=xo>])\s*/y, false],
  [/\s*([xo<]?)-?\.+-([xo>]?)\s*/y, true],
];
const INVISIBLE = /\s*~{3,}\s*/y;
/** Flèches à texte : `-- texte -->`, `== texte ==>`, `-. texte .->`. */
const LABELLED: ReadonlyArray<readonly [RegExp, RegExp, boolean]> = [
  [/\s*([xo<]?)--\s*/y, /\s*-{2,}([-xo>])\s*/g, false],
  [/\s*([xo<]?)==\s*/y, /\s*={2,}([=xo>])\s*/g, false],
  [/\s*([xo<]?)-\.\s*/y, /\s*\.+-([xo>]?)\s*/g, true],
];
const EDGE_ID = /\s*([\p{L}\p{N}_]+)@(?!\{)/uy;

function arrowAt(text: string, start: number): Link | null {
  let link: Link | null = null;
  for (const [pattern, dashed] of ARROWS) {
    pattern.lastIndex = start;
    const match = pattern.exec(text);
    if (match) {
      link = { id: null, label: '', dashed, arrowStart: !!match[1], arrowEnd: /[xo>]/.test(match[2] ?? ''), invisible: false, end: pattern.lastIndex };
      break;
    }
  }
  INVISIBLE.lastIndex = start;
  if (!link && INVISIBLE.test(text)) link = { id: null, label: '', dashed: false, arrowStart: false, arrowEnd: false, invisible: true, end: INVISIBLE.lastIndex };
  if (!link) {
    for (const [open, close, dashed] of LABELLED) {
      open.lastIndex = start;
      const match = open.exec(text);
      if (!match) continue;
      close.lastIndex = open.lastIndex;
      const closing = close.exec(text);
      if (!closing) return null;
      link = {
        id: null,
        label: decodeLabel(text.slice(open.lastIndex, closing.index)),
        dashed,
        arrowStart: !!match[1],
        arrowEnd: /[xo>]/.test(closing[1] ?? ''),
        invisible: false,
        end: close.lastIndex,
      };
      break;
    }
  }
  if (!link) return null;
  // Étiquette entre barres : `-->|texte|`.
  if (text[link.end] === '|') {
    const body = readBody(text, link.end + 1, ['|']);
    if (!body) return null;
    link.label = decodeLabel(body.text);
    link.end = skipSpaces(text, body.end);
  }
  return link;
}

function readLink(text: string, start: number): Link | null {
  // Identifiant de lien (`A e1@--> B`) : ignoré.
  EDGE_ID.lastIndex = start;
  const named = EDGE_ID.exec(text);
  if (named) {
    const link = arrowAt(text, EDGE_ID.lastIndex);
    if (link) return { ...link, id: named[1]! };
  }
  return arrowAt(text, start);
}

interface Statement {
  refs: NodeRef[];
  edges: MermaidEdge[];
  edgeIds: string[];
}

/** Instruction de nœuds et de liens : `A[x] & B --> C -->|oui| D`. `null` si elle n'est pas lisible en entier. */
function parseStatement(text: string): Statement | null {
  const refs: NodeRef[] = [];
  const edges: MermaidEdge[] = [];
  const edgeIds: string[] = [];
  let at = 0;
  const readGroup = (): string[] | null => {
    const ids: string[] = [];
    for (;;) {
      const node = readNode(text, skipSpaces(text, at));
      if (!node) return null;
      refs.push(node.ref);
      ids.push(node.ref.id);
      at = node.end;
      const ampersand = /\s*&\s*/y;
      ampersand.lastIndex = at;
      if (!ampersand.test(text)) return ids;
      at = ampersand.lastIndex;
    }
  };
  let previous = readGroup();
  if (!previous) return null;
  for (;;) {
    const link = readLink(text, at);
    if (!link) break;
    at = link.end;
    if (link.id) edgeIds.push(link.id);
    const next = readGroup();
    if (!next) return null;
    if (!link.invisible) {
      for (const from of previous) {
        for (const to of next) edges.push({ from, to, label: link.label, dashed: link.dashed, arrowStart: link.arrowStart, arrowEnd: link.arrowEnd });
      }
    }
    previous = next;
  }
  return skipSpaces(text, at) === text.length ? { refs, edges, edgeIds } : null;
}

/** Titre d'un `subgraph` : `id`, `id [titre]`, `id["titre"]` ou `"titre"`. */
function groupTitle(rest: string, auto: string): { id: string; label: string } {
  if (!rest) return { id: auto, label: '' };
  const bracket = /^([^\s[\]"]+)\s*\[([\s\S]*)\]$/.exec(rest);
  if (bracket) return { id: bracket[1]!, label: decodeLabel(bracket[2]!) };
  if (readId(rest, 0) === rest.length) return { id: rest, label: rest };
  return { id: auto, label: decodeLabel(rest) };
}

const DIRECTIONS: Record<string, MermaidDirection> = { TB: 'TB', TD: 'TB', BT: 'BT', LR: 'LR', RL: 'RL', '>': 'LR', '<': 'RL', '^': 'BT', V: 'TB' };
const IGNORED = /^(?:classDef|class|style|linkStyle|click|direction)\s|^acc(?:Title|Descr)\s*:/;

function parseFlowchart(headerRest: string, lines: readonly string[]): MermaidGraph {
  const dir = /^(TB|TD|BT|LR|RL|[<>^v])(?=\s|;|$)/i.exec(headerRest);
  const direction = dir ? (DIRECTIONS[dir[1]!.toUpperCase()] ?? 'TB') : 'TB';
  const drafts = new Map<string, { node: MermaidNode; shaped: boolean; labelled: boolean }>();
  /** Groupes ouverts lors de la mention d'un nœud (du plus extérieur au plus intérieur). */
  const homes = new Map<string, string[]>();
  const edges: MermaidEdge[] = [];
  const groups: Array<{ id: string; label: string }> = [];
  const stack: string[] = [];
  const edgeIds = new Set<string>();
  let description = false;
  for (const line of [dir ? headerRest.slice(dir[0].length) : headerRest, ...lines]) {
    for (const statement of splitStatements(line)) {
      // Description accessible sur plusieurs lignes : `accDescr { … }`.
      if (description) {
        if (statement.includes('}')) description = false;
        continue;
      }
      if (/^accDescr\s*\{/.test(statement)) {
        description = !statement.includes('}');
        continue;
      }
      if (IGNORED.test(statement)) continue;
      const subgraph = /^subgraph(?:\s+([\s\S]*))?$/.exec(statement);
      if (subgraph) {
        const title = groupTitle(subgraph[1]?.trim() ?? '', `subGraph${groups.length + 1}`);
        let id = title.id;
        for (let suffix = 2; groups.some((group) => group.id === id); suffix += 1) id = `${title.id}_${suffix}`;
        groups.push({ id, label: title.label });
        stack.push(id);
        continue;
      }
      if (statement === 'end') {
        stack.pop();
        continue;
      }
      const parsed = parseStatement(statement);
      if (!parsed) continue;
      for (const ref of parsed.refs) {
        if (ref.edgeProps) edgeIds.add(ref.id);
        let draft = drafts.get(ref.id);
        if (!draft) {
          draft = { node: { id: ref.id, label: ref.id, shape: 'rect' }, shaped: false, labelled: false };
          drafts.set(ref.id, draft);
        }
        // La première définition entre crochets l'emporte sur les simples mentions.
        if (ref.shape && !draft.shaped) {
          draft.node.shape = ref.shape;
          draft.shaped = true;
        }
        if (ref.label !== undefined && !draft.labelled) {
          draft.node.label = ref.label;
          draft.labelled = true;
        }
        // Un nœud reste dans le groupe où il a été mentionné, sauf s'il est repris dans un groupe plus intérieur.
        const home = homes.get(ref.id);
        if (!home || (home.length < stack.length && home.every((group, index) => stack[index] === group))) homes.set(ref.id, [...stack]);
      }
      for (const id of parsed.edgeIds) edgeIds.add(id);
      edges.push(...parsed.edges);
    }
  }
  // Un identifiant de groupe relié par un lien n'est pas un nœud ; un identifiant de lien (`e1@{ … }`) non plus.
  const groupIds = new Set(groups.map((group) => group.id));
  const linked = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
  const nodes = [...drafts.values()].map((draft) => draft.node).filter((node) => !groupIds.has(node.id) && !(edgeIds.has(node.id) && !linked.has(node.id)));
  if (!nodes.length) throw new MermaidError('Aucun nœud lisible dans ce diagramme Mermaid.');
  const known = new Set([...nodes.map((node) => node.id), ...groupIds]);
  return {
    kind: 'flowchart',
    direction,
    nodes,
    edges: edges.filter((edge) => known.has(edge.from) && known.has(edge.to)),
    groups: groups.map((group) => ({ ...group, nodes: nodes.filter((node) => homes.get(node.id)?.includes(group.id)).map((node) => node.id) })),
  };
}

/** Formes des nœuds d'une carte mentale : `[carré]`, `(arrondi)`, `((cercle))`, `))bang((`, `)nuage(`, `{{hexagone}}`. */
const MIND_SHAPES: Record<string, readonly [string, ShapeKind]> = {
  '((': ['))', 'ellipse'],
  '))': ['((', 'ellipse'],
  '(': [')', 'rounded'],
  ')': ['(', 'rounded'],
  '[': [']', 'rect'],
  '{{': ['}}', 'hexagon'],
};

function mindNode(content: string): { label: string; shape: ShapeKind } | null {
  const text = content
    .replace(/::icon\([^)]*\)/g, ' ')
    .replace(/:::.*$/, '')
    .trim();
  if (!text) return null;
  const match = /^([^\s()[\]{}]*)(\(\(|\)\)|\(|\)|\[|\{\{)([\s\S]*)$/.exec(text);
  const shape = match ? MIND_SHAPES[match[2]!] : undefined;
  if (match && shape && match[3]!.length >= shape[0].length && match[3]!.endsWith(shape[0])) {
    return { label: decodeLabel(match[3]!.slice(0, -shape[0].length)), shape: shape[1] };
  }
  return { label: decodeLabel(text), shape: 'rounded' };
}

/** Carte mentale : l'indentation donne l'arbre ; un second nœud au niveau de la racine devient son enfant. */
function parseMindmap(lines: readonly string[]): MermaidGraph {
  const nodes: MermaidNode[] = [];
  const edges: MermaidEdge[] = [];
  const stack: Array<{ indent: number; id: string }> = [];
  for (const raw of lines) {
    const line = raw.replace(/\t/g, '    ');
    const content = line.trim();
    if (!content || content.startsWith('::icon(') || content.startsWith(':::')) continue;
    const node = mindNode(content);
    if (!node) continue;
    const indent = line.length - line.trimStart().length;
    while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop();
    const parent = stack.length ? stack[stack.length - 1]!.id : nodes[0]?.id;
    const id = `m${nodes.length + 1}`;
    nodes.push({ id, ...node });
    if (parent) edges.push({ from: parent, to: id, label: '', dashed: false, arrowStart: false, arrowEnd: false });
    stack.push({ indent, id });
  }
  if (!nodes.length) throw new MermaidError('Aucun nœud lisible dans ce diagramme Mermaid.');
  return { kind: 'mindmap', direction: 'LR', nodes, edges, groups: [] };
}

/** Lit un organigramme (`flowchart`, `graph`) ou une carte mentale (`mindmap`), éventuellement dans un bloc de code. */
export function parseMermaid(text: string): MermaidGraph {
  const lines = sourceLines(text);
  const at = lines.findIndex((line) => line.trim());
  if (at < 0) throw new MermaidError('Texte Mermaid vide.');
  const header = lines[at]!.trim();
  const rest = lines.slice(at + 1);
  if (/^mindmap$/i.test(header)) return parseMindmap(rest);
  const flow = /^(?:flowchart|graph)(?:-elk)?(?=\s|;|$)\s*([\s\S]*)$/i.exec(header);
  if (flow) return parseFlowchart(flow[1]!, rest);
  throw new MermaidError('Diagramme Mermaid non pris en charge : importez un organigramme (flowchart, graph) ou une carte mentale (mindmap).');
}

// ---------------------------------------------------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------------------------------------------------

type NodeElement = ShapeElement | StickyElement | TextElement | MindElement | FastElement;

const isNode = (element: BoardElement): element is NodeElement =>
  element.type === 'shape' || element.type === 'sticky' || element.type === 'text' || element.type === 'mind' || element.type === 'fast';

const SHAPE_SYNTAX: Record<ShapeKind, readonly [string, string]> = {
  rect: ['[', ']'],
  rounded: ['(', ')'],
  ellipse: ['((', '))'],
  diamond: ['{', '}'],
  parallelogram: ['[/', '/]'],
  hexagon: ['{{', '}}'],
  cylinder: ['[(', ')]'],
  triangle: ['[', ']'],
};

/** Texte entre guillemets : `"` en entité, retours à la ligne en `<br>` (jamais vide, Mermaid le refuserait). */
const quotedText = (text: string): string => `"${text.replace(/"/g, '#quot;').replace(/\r?\n/g, '<br>') || ' '}"`;

/** Ordre de lecture : par rangées (centres à moins d'une demi-hauteur), puis de gauche à droite. */
function readingOrder<T extends Rect>(items: readonly T[]): T[] {
  const sorted = [...items].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2) || a.x - b.x);
  const rows: T[][] = [];
  for (const item of sorted) {
    const row = rows[rows.length - 1];
    const head = row?.[0];
    if (row && head && item.y + item.h / 2 - (head.y + head.h / 2) <= head.h / 2) row.push(item);
    else rows.push([item]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}

/** Étiquette de lien `|…|` : barres remplacées, guillemets si elle contient autre chose que du texte simple. */
function edgeLabel(text: string): string {
  const clean = text.trim().replace(/\|/g, '/').replace(/\r?\n/g, '<br>');
  if (!clean) return '';
  return /^[\p{L}\p{N} .,:!?'’\/+*@_]+$/u.test(clean) ? `|${clean}|` : `|${quotedText(clean)}|`;
}

interface ExportEdge {
  from: string;
  to: string;
  label: string;
  dashed: boolean;
  arrowStart: boolean;
  arrowEnd: boolean;
  a: Point;
  b: Point;
  order: number;
}

function edgeLine(edge: ExportEdge): string {
  // Mermaid n'a pas de flèche vers l'arrière seule (`<--`) : on retourne le lien.
  const reversed = edge.arrowStart && !edge.arrowEnd;
  const [from, to] = reversed ? [edge.to, edge.from] : [edge.from, edge.to];
  const end = edge.arrowEnd || reversed;
  const both = edge.arrowStart && edge.arrowEnd;
  const arrow = edge.dashed ? (both ? '<-.->' : end ? '-.->' : '-.-') : both ? '<-->' : end ? '-->' : '---';
  return `${from} ${arrow}${edgeLabel(edge.label)} ${to}`;
}

function flowchartText(nodes: readonly NodeElement[], frames: readonly FrameElement[], connectors: readonly ConnectorElement[]): string {
  const ordered = readingOrder(nodes);
  const nodeKey = new Map(ordered.map((node, index) => [node.id, `n${index + 1}`]));
  const nodeOrder = new Map(ordered.map((node, index) => [node.id, index]));
  // Sections : de la plus grande à la plus petite ; un nœud va dans la plus petite qui le contient.
  const candidates = frames.filter((frame) => nodes.some((node) => contains(frame, node))).sort((a, b) => b.w * b.h - a.w * a.h || a.z - b.z);
  const innermost = (rect: Rect, before = candidates.length): string | null => {
    for (let index = before - 1; index >= 0; index -= 1) if (contains(candidates[index]!, rect)) return candidates[index]!.id;
    return null;
  };
  const frameOf = new Map(nodes.map((node) => [node.id, innermost(node)]));
  const parentOf = new Map(candidates.map((frame, index) => [frame.id, innermost(frame, index)]));
  const used = new Set<string>();
  for (const node of nodes) {
    for (let frame = frameOf.get(node.id) ?? null; frame && !used.has(frame); frame = parentOf.get(frame) ?? null) used.add(frame);
  }
  const kept = candidates.filter((frame) => used.has(frame.id));
  // Un bloc `subgraph` s'écrit à la place de son premier nœud dans l'ordre de lecture.
  const firstRank = new Map<string, number>();
  for (const node of ordered) {
    for (let frame = frameOf.get(node.id) ?? null; frame && !firstRank.has(frame); frame = parentOf.get(frame) ?? null) firstRank.set(frame, nodeOrder.get(node.id)!);
  }
  const content = (frame: string | null): Array<NodeElement | FrameElement> =>
    [...ordered.filter((node) => (frameOf.get(node.id) ?? null) === frame), ...kept.filter((child) => (parentOf.get(child.id) ?? null) === frame)].sort(
      (a, b) => (a.type === 'frame' ? firstRank.get(a.id)! : nodeOrder.get(a.id)!) - (b.type === 'frame' ? firstRank.get(b.id)! : nodeOrder.get(b.id)!),
    );
  const frameKey = new Map<string, string>();
  const numberFrames = (frame: string | null): void => {
    for (const item of content(frame)) {
      if (item.type !== 'frame') continue;
      frameKey.set(item.id, `g${frameKey.size + 1}`);
      numberFrames(item.id);
    }
  };
  numberFrames(null);
  const rects = new Map<string, Rect>([...nodes, ...kept].map((element) => [element.id, element]));
  const key = (id: string | null): string | null => (id ? (nodeKey.get(id) ?? frameKey.get(id) ?? null) : null);
  const rank = (id: string): number => nodeOrder.get(id) ?? nodes.length + kept.findIndex((frame) => frame.id === id);

  const edges: ExportEdge[] = [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const connector of connectors) {
    const from = key(connector.from.id);
    const to = key(connector.to.id);
    if (!from || !to) continue;
    const { label, dashed, arrowStart, arrowEnd } = connector;
    const a = center(rects.get(connector.from.id!)!);
    const b = center(rects.get(connector.to.id!)!);
    edges.push({ from, to, label, dashed, arrowStart, arrowEnd, a, b, order: rank(connector.from.id!) * (nodes.length + kept.length) + rank(connector.to.id!) });
  }
  for (const node of nodes) {
    if (node.type !== 'mind' || !node.parent || !nodeIds.has(node.parent)) continue;
    const a = center(rects.get(node.parent)!);
    const order = rank(node.parent) * (nodes.length + kept.length) + rank(node.id);
    edges.push({ from: key(node.parent)!, to: key(node.id)!, label: '', dashed: false, arrowStart: false, arrowEnd: false, a, b: center(node), order });
  }
  edges.sort((a, b) => a.order - b.order);

  // Sens : celui où les liens s'étirent le plus ; sans lien, celui de l'ensemble des nœuds.
  let horizontal: boolean;
  if (edges.length) {
    horizontal = edges.reduce((sum, edge) => sum + Math.abs(edge.b.x - edge.a.x), 0) > edges.reduce((sum, edge) => sum + Math.abs(edge.b.y - edge.a.y), 0);
  } else {
    const xs = nodes.flatMap((node) => [node.x, node.x + node.w]);
    const ys = nodes.flatMap((node) => [node.y, node.y + node.h]);
    horizontal = Math.max(...xs) - Math.min(...xs) > Math.max(...ys) - Math.min(...ys);
  }

  const lines = [`flowchart ${horizontal ? 'LR' : 'TD'}`];
  const indent = (depth: number): string => '    '.repeat(depth);
  const emit = (frame: string | null, depth: number): void => {
    for (const item of content(frame)) {
      if (item.type === 'frame') {
        lines.push(`${indent(depth)}subgraph ${frameKey.get(item.id)} [${quotedText(item.title.trim())}]`);
        emit(item.id, depth + 1);
        lines.push(`${indent(depth)}end`);
        continue;
      }
      const [open, close] = SHAPE_SYNTAX[item.type === 'shape' ? item.shape : 'rect'];
      lines.push(`${indent(depth)}${nodeKey.get(item.id)}${open}${quotedText(elementText(item).trim())}${close}`);
    }
  };
  emit(null, 1);
  for (const edge of edges) lines.push(`${indent(1)}${edgeLine(edge)}`);
  return lines.join('\n');
}

/** Libellé d'un nœud de carte mentale : tel quel s'il ne peut pas se lire comme une forme, sinon entre crochets. */
const plainMindLabel = (label: string): boolean => /^[^\n()[\]{}"]+$/.test(label) && !label.includes('::') && !label.includes('%%');

function mindmapText(root: MindElement, children: ReadonlyMap<string, readonly MindElement[]>): string {
  const lines = ['mindmap'];
  const stack: Array<readonly [MindElement, number]> = [[root, 1]];
  while (stack.length) {
    const [node, depth] = stack.pop()!;
    const label = elementText(node).trim();
    const text = depth === 1 ? `root((${plainMindLabel(label) ? label : quotedText(label)}))` : plainMindLabel(label) ? label : `[${quotedText(label)}]`;
    lines.push(`${'  '.repeat(depth)}${text}`);
    const kids = children.get(node.id) ?? [];
    for (let index = kids.length - 1; index >= 0; index -= 1) stack.push([kids[index]!, depth + 1]);
  }
  return lines.join('\n');
}

/** Racine et enfants d'une carte mentale, si les nœuds forment un seul arbre. */
function mindTree(nodes: readonly MindElement[]): { root: MindElement; children: Map<string, MindElement[]> } | null {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots = nodes.filter((node) => !node.parent || !byId.has(node.parent));
  if (roots.length !== 1) return null;
  const children = new Map<string, MindElement[]>();
  for (const node of nodes) if (node.parent && byId.has(node.parent)) children.set(node.parent, [...(children.get(node.parent) ?? []), node]);
  for (const list of children.values()) list.sort((a, b) => a.y - b.y || a.z - b.z);
  // Tous les nœuds doivent descendre de la racine (pas de boucle à l'écart).
  let reached = 0;
  const stack = [roots[0]!];
  while (stack.length) {
    const node = stack.pop()!;
    reached += 1;
    stack.push(...(children.get(node.id) ?? []));
  }
  return reached === nodes.length ? { root: roots[0]!, children } : null;
}

/**
 * Texte Mermaid d'éléments (ceux de `ids` s'il est donné) : formes, post-it, textes, nœuds de carte mentale et Fast
 * Elements deviennent des nœuds, les sections des `subgraph`, les liens accrochés des flèches. Une carte mentale
 * seule s'écrit en `mindmap`. Sans bloc de code ; chaîne vide s'il n'y a aucun nœud.
 */
export function exportMermaid(elements: readonly BoardElement[], ids?: ReadonlySet<string>): string {
  const picked = (element: BoardElement): boolean => !ids || ids.has(element.id);
  const nodes = elements.filter((element): element is NodeElement => isNode(element) && picked(element));
  if (!nodes.length) return '';
  const nodeIds = new Set(nodes.map((node) => node.id));
  const connectors = elements.filter((element): element is ConnectorElement => element.type === 'connector' && picked(element));
  if (nodes.every((node): node is MindElement => node.type === 'mind')) {
    const tree = mindTree(nodes);
    const linked = connectors.some((connector) => connector.from.id && connector.to.id && nodeIds.has(connector.from.id) && nodeIds.has(connector.to.id));
    if (tree && !linked) return mindmapText(tree.root, tree.children);
  }
  const frames = elements.filter((element): element is FrameElement => element.type === 'frame' && picked(element));
  return flowchartText(nodes, frames, connectors);
}

// ---------------------------------------------------------------------------------------------------------------------
// Disposition
// ---------------------------------------------------------------------------------------------------------------------

interface Size {
  w: number;
  h: number;
}

const DEFAULT_SIZE: Size = { w: 120, h: 56 };
const LAYER_GAP = 70;
const NODE_GAP = 40;
const COMPONENT_GAP = 60;
/** Nœuds fictifs au plus (liens longs) : au-delà, le graphe est trop dense pour qu’ils aident. */
const DUMMY_BUDGET = 20_000;
/** Marge d'une section autour de ses nœuds, et place de son titre en haut. */
const FRAME_PADDING = 24;
const FRAME_TITLE = 32;

interface Placement {
  positions: Map<string, Point>;
  w: number;
  h: number;
}

/** Nombre de croisements entre couches successives (comptage des inversions, arbre de Fenwick). */
function crossings(layers: readonly number[][], down: readonly number[][], position: readonly number[], layerOf: readonly number[]): number {
  let total = 0;
  for (let rank = 0; rank + 1 < layers.length; rank += 1) {
    const ends: number[] = [];
    for (const node of layers[rank]!) {
      const targets = down[node]!.filter((next) => layerOf[next] === rank + 1).map((next) => position[next]!);
      for (const target of targets.sort((a, b) => a - b)) ends.push(target);
    }
    const size = layers[rank + 1]!.length;
    const tree = new Array<number>(size + 1).fill(0);
    ends.forEach((end, count) => {
      let atMost = 0;
      for (let index = end + 1; index > 0; index -= index & -index) atMost += tree[index]!;
      total += count - atMost;
      for (let index = end + 1; index <= size; index += index & -index) tree[index] = tree[index]! + 1;
    });
  }
  return total;
}

/**
 * Centres sur une rangée, au plus près des centres voulus, dans l'ordre donné et sans chevauchement : régression
 * isotone (on regroupe les voisins en conflit autour de leur moyenne).
 */
function spread(desired: readonly number[], widths: readonly number[], gaps: readonly number[]): number[] {
  const offsets: number[] = [];
  widths.forEach((width, index) => offsets.push(index ? offsets[index - 1]! + (widths[index - 1]! + width) / 2 + gaps[index - 1]! : 0));
  const blocks: Array<{ sum: number; count: number }> = [];
  desired.forEach((value, index) => {
    blocks.push({ sum: value - offsets[index]!, count: 1 });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1]!;
      const previous = blocks[blocks.length - 2]!;
      if (previous.sum / previous.count <= last.sum / last.count) break;
      previous.sum += last.sum;
      previous.count += last.count;
      blocks.pop();
    }
  });
  const result: number[] = [];
  for (const block of blocks) for (let index = 0; index < block.count; index += 1) result.push(block.sum / block.count + offsets[result.length]!);
  return result;
}

/**
 * Une composante connexe : couches avec nœuds fictifs sur les liens longs, ordre par barycentres (le moins de
 * croisements gardé), puis coordonnées. Écrit `main` (début dans le sens du flux) et `cross` (début dans l'autre
 * sens) des nœuds réels ; renvoie l'étendue dans les deux sens.
 */
function placeComponent(
  members: readonly number[],
  rank: readonly number[],
  succ: readonly number[][],
  along: readonly number[],
  across: readonly number[],
  main: number[],
  cross: number[],
): { main: number; cross: number } {
  const layerOf: number[] = [];
  const real: number[] = [];
  const local = new Map<number, number>();
  for (const node of members) {
    local.set(node, layerOf.length);
    layerOf.push(rank[node]!);
    real.push(node);
  }
  const down: number[][] = members.map(() => []);
  const up: number[][] = members.map(() => []);
  // Graphe très dense : sans nœuds fictifs (les liens longs comptent alors comme voisins directs).
  let span = 0;
  for (const node of members) for (const next of succ[node]!) span += rank[next]! - rank[node]! - 1;
  const dummies = span <= DUMMY_BUDGET;
  for (const node of members) {
    for (const next of succ[node]!) {
      let previous = local.get(node)!;
      for (let layer = rank[node]! + 1; dummies && layer < rank[next]!; layer += 1) {
        const dummy = layerOf.length;
        layerOf.push(layer);
        real.push(-1);
        down.push([]);
        up.push([]);
        down[previous]!.push(dummy);
        up[dummy]!.push(previous);
        previous = dummy;
      }
      const target = local.get(next)!;
      down[previous]!.push(target);
      up[target]!.push(previous);
    }
  }
  const depth = members.reduce((max, node) => Math.max(max, rank[node]! + 1), 1);

  // Ordre initial : parcours en profondeur depuis les nœuds réels, par couche croissante.
  const layers: number[][] = Array.from({ length: depth }, () => []);
  const visited = new Array<boolean>(layerOf.length).fill(false);
  const starts = members.map((_, index) => index).sort((a, b) => layerOf[a]! - layerOf[b]! || a - b);
  for (const start of starts) {
    const stack = [start];
    while (stack.length) {
      const node = stack.pop()!;
      if (visited[node]) continue;
      visited[node] = true;
      layers[layerOf[node]!]!.push(node);
      for (let index = down[node]!.length - 1; index >= 0; index -= 1) stack.push(down[node]![index]!);
    }
  }
  const position = new Array<number>(layerOf.length).fill(0);
  const renumber = (layer: readonly number[]): void => layer.forEach((node, index) => (position[node] = index));
  layers.forEach(renumber);

  // Barycentres : les nœuds sans voisin gardent leur place, les autres s'y rangent par position moyenne des voisins.
  const weight = new Array<number>(layerOf.length).fill(0);
  const sweep = (layer: number[], neighbours: readonly number[][]): void => {
    const movable: number[] = [];
    for (const node of layer) {
      const list = neighbours[node]!;
      if (!list.length) continue;
      let sum = 0;
      for (const other of list) sum += position[other]!;
      weight[node] = sum / list.length;
      movable.push(node);
    }
    movable.sort((a, b) => weight[a]! - weight[b]! || position[a]! - position[b]!);
    let next = 0;
    for (let index = 0; index < layer.length; index += 1) if (neighbours[layer[index]!]!.length) layer[index] = movable[next++]!;
    renumber(layer);
  };
  let best = layers.map((layer) => [...layer]);
  let fewest = crossings(layers, down, position, layerOf);
  for (let pass = 0; pass < 8 && fewest > 0; pass += 1) {
    if (pass % 2 === 0) for (let layer = 1; layer < depth; layer += 1) sweep(layers[layer]!, up);
    else for (let layer = depth - 2; layer >= 0; layer -= 1) sweep(layers[layer]!, down);
    const count = crossings(layers, down, position, layerOf);
    if (count < fewest) {
      fewest = count;
      best = layers.map((layer) => [...layer]);
    }
  }
  best.forEach(renumber);

  // Sens du flux : chaque couche aussi épaisse que son plus gros nœud, les nœuds centrés sur elle.
  const size = (node: number, sizes: readonly number[]): number => (real[node]! >= 0 ? sizes[real[node]!]! : 0);
  const thickness = best.map((layer) => layer.reduce((max, node) => Math.max(max, size(node, along)), 0));
  const layerStart: number[] = [];
  let offset = 0;
  for (const value of thickness) {
    layerStart.push(offset);
    offset += value + LAYER_GAP;
  }
  for (const layer of best) {
    for (const node of layer) if (real[node]! >= 0) main[real[node]!] = layerStart[layerOf[node]!]! + (thickness[layerOf[node]!]! - along[real[node]!]!) / 2;
  }

  // Autre sens : couches centrées les unes sur les autres, puis chaque nœud tiré vers ses voisins (les liens longs
  // passent par leurs nœuds fictifs, qui gardent un couloir étroit).
  const centre = new Array<number>(layerOf.length).fill(0);
  const widths = best.map((layer) => layer.map((node) => size(node, across)));
  const gaps = best.map((layer) => layer.slice(1).map((node, index) => (real[node]! >= 0 && real[layer[index]!]! >= 0 ? NODE_GAP : NODE_GAP / 2)));
  best.forEach((layer, rank) => {
    const total = widths[rank]!.reduce((sum, width) => sum + width, 0) + gaps[rank]!.reduce((sum, gap) => sum + gap, 0);
    let at = -total / 2;
    layer.forEach((node, index) => {
      centre[node] = at + widths[rank]![index]! / 2;
      at += widths[rank]![index]! + (gaps[rank]![index] ?? 0);
    });
  });
  for (let pass = 0; pass < 8; pass += 1) {
    const downward = pass % 2 === 0;
    const neighbours = downward ? up : down;
    for (let step = 1; step < depth; step += 1) {
      const rank = downward ? step : depth - 1 - step;
      const layer = best[rank]!;
      const desired = layer.map((node) => {
        const list = neighbours[node]!;
        if (!list.length) return centre[node]!;
        let sum = 0;
        for (const other of list) sum += centre[other]!;
        return sum / list.length;
      });
      const placed = spread(desired, widths[rank]!, gaps[rank]!);
      layer.forEach((node, index) => (centre[node] = placed[index]!));
    }
  }
  let min = Infinity;
  let max = -Infinity;
  for (const node of members) {
    const at = centre[local.get(node)!]!;
    min = Math.min(min, at - across[node]! / 2);
    max = Math.max(max, at + across[node]! / 2);
  }
  for (const node of members) cross[node] = centre[local.get(node)!]! - across[node]! / 2 - min;
  return { main: offset - LAYER_GAP, cross: max - min };
}

/** Disposition en couches d'éléments de tailles données ; coins haut-gauche, l'ensemble partant de (0, 0). */
function layered(items: readonly string[], sizes: ReadonlyMap<string, Size>, links: ReadonlyArray<readonly [string, string]>, direction: MermaidDirection): Placement {
  const vertical = direction === 'TB' || direction === 'BT';
  const count = items.length;
  const index = new Map(items.map((id, position) => [id, position]));
  const boxes = items.map((id) => sizes.get(id) ?? DEFAULT_SIZE);
  const along = boxes.map((box) => (vertical ? box.h : box.w));
  const across = boxes.map((box) => (vertical ? box.w : box.h));
  const out: number[][] = items.map(() => []);
  const seen = new Set<string>();
  for (const [a, b] of links) {
    const from = index.get(a);
    const to = index.get(b);
    if (from === undefined || to === undefined || from === to || seen.has(`${from}>${to}`)) continue;
    seen.add(`${from}>${to}`);
    out[from]!.push(to);
  }

  // Cycles : les liens arrière d'un parcours en profondeur sont retournés.
  const succ: number[][] = items.map(() => []);
  const pred: number[][] = items.map(() => []);
  const dag = new Set<string>();
  const addEdge = (from: number, to: number): void => {
    if (dag.has(`${from}>${to}`)) return;
    dag.add(`${from}>${to}`);
    succ[from]!.push(to);
    pred[to]!.push(from);
  };
  const state = new Array<number>(count).fill(0);
  for (let root = 0; root < count; root += 1) {
    if (state[root]) continue;
    state[root] = 1;
    const stack: Array<[number, number]> = [[root, 0]];
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const targets = out[top[0]]!;
      if (top[1] >= targets.length) {
        state[top[0]] = 2;
        stack.pop();
        continue;
      }
      const next = targets[top[1]]!;
      top[1] += 1;
      if (state[next] === 1) addEdge(next, top[0]);
      else {
        addEdge(top[0], next);
        if (!state[next]) {
          state[next] = 1;
          stack.push([next, 0]);
        }
      }
    }
  }

  // Couches : plus long chemin depuis les sources, puis chaque source rapprochée de son premier successeur.
  const rank = new Array<number>(count).fill(0);
  const remaining = pred.map((list) => list.length);
  const queue = items.map((_, node) => node).filter((node) => !remaining[node]);
  for (let head = 0; head < queue.length; head += 1) {
    const node = queue[head]!;
    for (const next of succ[node]!) {
      rank[next] = Math.max(rank[next]!, rank[node]! + 1);
      remaining[next] = remaining[next]! - 1;
      if (!remaining[next]) queue.push(next);
    }
  }
  for (let head = queue.length - 1; head >= 0; head -= 1) {
    const node = queue[head]!;
    if (!pred[node]!.length && succ[node]!.length) rank[node] = Math.min(...succ[node]!.map((next) => rank[next]!)) - 1;
  }

  // Composantes connexes, côte à côte dans l'ordre de leur premier nœud.
  const component = new Array<number>(count).fill(-1);
  const main = new Array<number>(count).fill(0);
  const cross = new Array<number>(count).fill(0);
  let offset = 0;
  let total = 0;
  for (let start = 0; start < count; start += 1) {
    if (component[start] !== -1) continue;
    const members = [start];
    component[start] = start;
    for (let position = 0; position < members.length; position += 1) {
      for (const other of [...succ[members[position]!]!, ...pred[members[position]!]!]) {
        if (component[other] !== -1) continue;
        component[other] = start;
        members.push(other);
      }
    }
    members.sort((a, b) => a - b);
    const extent = placeComponent(members, rank, succ, along, across, main, cross);
    for (const node of members) cross[node] = cross[node]! + offset;
    offset += extent.cross + COMPONENT_GAP;
    total = Math.max(total, extent.main);
  }
  const width = Math.max(0, offset - COMPONENT_GAP);
  const reversed = direction === 'BT' || direction === 'RL';
  const positions = new Map<string, Point>();
  items.forEach((id, node) => {
    const flow = reversed ? total - main[node]! - along[node]! : main[node]!;
    positions.set(id, vertical ? { x: cross[node]!, y: flow } : { x: flow, y: cross[node]! });
  });
  return { positions, w: vertical ? width : total, h: vertical ? total : width };
}

interface GroupTree {
  /** Groupes non vides, dans l'ordre d'ouverture. */
  groups: MermaidGroup[];
  parent: Map<string, string | null>;
  /** Groupe le plus intérieur de chaque nœud. */
  home: Map<string, string | null>;
  depth: Map<string, number>;
}

/** Imbrication des groupes : le parent d'un groupe est le plus petit qui contient tous ses nœuds. */
function groupTree(graph: MermaidGraph): GroupTree {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const groups = graph.groups.filter((group) => group.nodes.some((id) => nodeIds.has(id)));
  const members = groups.map((group) => new Set(group.nodes.filter((id) => nodeIds.has(id))));
  // `j` englobe `k` s'il compte plus de nœuds ou, à égalité, s'il a été ouvert avant.
  const outer = (j: number, k: number): boolean => members[j]!.size > members[k]!.size || (members[j]!.size === members[k]!.size && j < k);
  const parent = new Map<string, string | null>();
  groups.forEach((group, k) => {
    let best = -1;
    for (let j = 0; j < groups.length; j += 1) {
      if (j === k || !outer(j, k) || ![...members[k]!].every((id) => members[j]!.has(id))) continue;
      if (best < 0 || outer(best, j)) best = j;
    }
    parent.set(group.id, best < 0 ? null : groups[best]!.id);
  });
  const home = new Map<string, string | null>();
  for (const node of graph.nodes) {
    let best = -1;
    members.forEach((set, j) => {
      if (set.has(node.id) && (best < 0 || outer(best, j))) best = j;
    });
    home.set(node.id, best < 0 ? null : groups[best]!.id);
  }
  const depth = new Map<string, number>();
  for (const group of groups) {
    let level = 0;
    for (let up = parent.get(group.id) ?? null; up && level <= groups.length; up = parent.get(up) ?? null) level += 1;
    depth.set(group.id, level);
  }
  return { groups, parent, home, depth };
}

/**
 * Disposition en couches (à la Sugiyama) d'un graphe : cycles cassés, couches par plus long chemin, ordre par
 * barycentres, couches espacées et centrées. Un groupe est disposé à part puis placé comme un seul bloc, avec la marge
 * et le titre de sa section. Coins haut-gauche des nœuds ; l'ensemble part de (0, 0).
 */
export function layoutGraph(graph: MermaidGraph, sizes: ReadonlyMap<string, { w: number; h: number }>): Map<string, Point> {
  const tree = groupTree(graph);
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const order = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const first = new Map(tree.groups.map((group) => [group.id, group.nodes.reduce((min, id) => Math.min(min, order.get(id) ?? Infinity), Infinity)]));
  const above = (id: string): string | null | undefined => (nodeIds.has(id) ? (tree.home.get(id) ?? null) : tree.parent.get(id));
  /** Élément de `level` (nœud ou groupe enfant) qui contient `id`, ou `null` s'il est ailleurs. */
  const itemAt = (level: string | null, id: string): string | null => {
    let current = id;
    for (let guard = 0; guard <= tree.groups.length; guard += 1) {
      const next = above(current);
      if (next === undefined) return null;
      if (next === level) return current;
      if (next === null) return null;
      current = next;
    }
    return null;
  };
  const place = (level: string | null): Placement => {
    const items = [
      ...graph.nodes.filter((node) => (tree.home.get(node.id) ?? null) === level).map((node) => node.id),
      ...tree.groups.filter((group) => tree.parent.get(group.id) === level).map((group) => group.id),
    ].sort((a, b) => (order.get(a) ?? first.get(a)!) - (order.get(b) ?? first.get(b)!));
    const boxes = new Map<string, Size>();
    const inner = new Map<string, Placement>();
    for (const id of items) {
      if (nodeIds.has(id)) {
        boxes.set(id, sizes.get(id) ?? DEFAULT_SIZE);
        continue;
      }
      const block = place(id);
      inner.set(id, block);
      boxes.set(id, { w: block.w + 2 * FRAME_PADDING, h: block.h + 2 * FRAME_PADDING + FRAME_TITLE });
    }
    const links: Array<[string, string]> = [];
    for (const edge of graph.edges) {
      const from = itemAt(level, edge.from);
      const to = itemAt(level, edge.to);
      if (from && to && from !== to) links.push([from, to]);
    }
    const placed = layered(items, boxes, links, graph.direction);
    const positions = new Map<string, Point>();
    for (const id of items) {
      const at = placed.positions.get(id)!;
      const block = inner.get(id);
      if (!block) positions.set(id, at);
      else for (const [node, point] of block.positions) positions.set(node, { x: at.x + FRAME_PADDING + point.x, y: at.y + FRAME_PADDING + FRAME_TITLE + point.y });
    }
    return { positions, w: placed.w, h: placed.h };
  };
  const result = new Map<string, Point>();
  for (const [id, point] of place(null).positions) result.set(id, { x: Math.round(point.x), y: Math.round(point.y) });
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------
// Import sur un tableau
// ---------------------------------------------------------------------------------------------------------------------

/** Taille d'un nœud d'après son texte (lignes longues repliées), agrandie pour les losanges et les ellipses. */
function nodeSize(node: MermaidNode, kind: MermaidGraph['kind']): Size {
  const lines = node.label.split('\n').map((line) => [...line].length);
  const longest = lines.reduce((max, length) => Math.max(max, length), 0);
  let w = Math.min(280, Math.max(120, 7.5 * longest + 40));
  const count = lines.reduce((sum, length) => sum + Math.max(1, Math.ceil((7.5 * length) / (w - 40))), 0);
  let h = Math.max(56, count * 20 + 28);
  if (kind === 'flowchart' && node.shape === 'diamond') {
    w *= 1.35;
    h *= 1.5;
  } else if (kind === 'flowchart' && node.shape === 'ellipse') {
    w *= 1.2;
    h *= 1.2;
  }
  return { w: Math.round(w), h: Math.round(h) };
}

function union(rects: readonly Rect[]): Rect {
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  return { x, y, w: Math.max(...rects.map((rect) => rect.x + rect.w)) - x, h: Math.max(...rects.map((rect) => rect.y + rect.h)) - y };
}

/**
 * Éléments d'un tableau pour un texte Mermaid, l'ensemble partant de `origin` (coin haut-gauche) : formes, liens
 * accrochés et sections pour un organigramme, nœuds de carte mentale pour une `mindmap`.
 */
export function mermaidToElements(text: string, origin: Point, options: { idFactory?: () => string; zStart?: number } = {}): BoardElement[] {
  const graph = parseMermaid(text);
  const count = graph.kind === 'mindmap' ? graph.nodes.length : graph.nodes.length + graph.edges.length + graph.groups.length;
  if (count > BOARD_LIMITS.elements) throw new MermaidError('Ce diagramme Mermaid compte trop d’éléments pour un tableau.');
  const makeId = options.idFactory ?? newElementId;
  let z = options.zStart ?? 1;
  const sizes = new Map(graph.nodes.map((node) => [node.id, nodeSize(node, graph.kind)]));

  if (graph.kind === 'mindmap') {
    const ids = new Map(graph.nodes.map((node) => [node.id, makeId()]));
    const parentOf = new Map(graph.edges.map((edge) => [edge.to, edge.from]));
    const nodes: MindElement[] = graph.nodes.map((node, index) => {
      const parent = index ? parentOf.get(node.id) : undefined;
      return {
        id: ids.get(node.id)!,
        type: 'mind',
        z: z++,
        x: origin.x,
        y: origin.y,
        ...sizes.get(node.id)!,
        text: node.label.slice(0, 2000),
        color: 'default',
        parent: parent ? (ids.get(parent) ?? null) : null,
        direction: 'right',
      };
    });
    const moves = layoutMind(nodes, nodes[0]!.id);
    const placed = nodes.map((node) => ({ ...node, ...moves.get(node.id) }));
    const dx = origin.x - Math.min(...placed.map((node) => node.x));
    const dy = origin.y - Math.min(...placed.map((node) => node.y));
    return placed.map((node) => ({ ...node, x: node.x + dx, y: node.y + dy }));
  }

  const positions = layoutGraph(graph, sizes);
  const rects = new Map<string, Rect>();
  for (const node of graph.nodes) {
    const at = positions.get(node.id) ?? { x: 0, y: 0 };
    rects.set(node.id, { x: origin.x + at.x, y: origin.y + at.y, ...sizes.get(node.id)! });
  }
  // Sections : calculées de l'intérieur vers l'extérieur, posées de l'extérieur vers l'intérieur (en dessous des nœuds).
  const tree = groupTree(graph);
  const depthOf = (group: MermaidGroup): number => tree.depth.get(group.id) ?? 0;
  for (const group of [...tree.groups].sort((a, b) => depthOf(b) - depthOf(a))) {
    const parts = [
      ...graph.nodes.filter((node) => tree.home.get(node.id) === group.id).map((node) => rects.get(node.id)!),
      ...tree.groups.filter((child) => tree.parent.get(child.id) === group.id).map((child) => rects.get(child.id)!),
    ];
    const box = union(parts);
    rects.set(group.id, { x: box.x - FRAME_PADDING, y: box.y - FRAME_PADDING - FRAME_TITLE, w: box.w + 2 * FRAME_PADDING, h: box.h + 2 * FRAME_PADDING + FRAME_TITLE });
  }
  const elementId = new Map<string, string>();
  const elements: BoardElement[] = [];
  for (const group of [...tree.groups].sort((a, b) => depthOf(a) - depthOf(b))) {
    const id = makeId();
    elementId.set(group.id, id);
    elements.push({ id, type: 'frame', z: z++, ...rects.get(group.id)!, title: group.label.slice(0, 200), color: 'default' });
  }
  for (const node of graph.nodes) {
    const id = makeId();
    elementId.set(node.id, id);
    elements.push({ id, type: 'shape', z: z++, ...rects.get(node.id)!, shape: node.shape, text: node.label, color: 'default', fill: 'solid', size: 'm' });
  }
  for (const edge of graph.edges) {
    const from = elementId.get(edge.from);
    const to = elementId.get(edge.to);
    if (!from || !to) continue;
    const a = center(rects.get(edge.from)!);
    const b = center(rects.get(edge.to)!);
    elements.push({
      id: makeId(),
      type: 'connector',
      z: z++,
      from: { id: from, side: null, x: a.x, y: a.y },
      to: { id: to, side: null, x: b.x, y: b.y },
      label: edge.label.slice(0, 500),
      route: 'elbow',
      dashed: edge.dashed,
      arrowStart: edge.arrowStart,
      arrowEnd: edge.arrowEnd,
      color: 'default',
    });
  }
  return elements;
}
