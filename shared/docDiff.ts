import { diffIndices } from 'node-diff3';

/**
 * Comparaison de deux versions d'une note : blocs ajoutés, retirés ou changés, côté qui a changé chacun quand la version
 * d'origine est connue, et texte obtenu à partir des choix faits bloc par bloc.
 */

export type DiffKind = 'added' | 'removed' | 'changed';

/** Côté qui a changé le bloc depuis la version d'origine ; `both` : les deux, ou origine inconnue. */
export type DiffOrigin = 'left' | 'right' | 'both';

export type DiffSide = 'left' | 'right';

export interface DiffHunk {
  index: number;
  kind: DiffKind;
  origin: DiffOrigin;
  /** Ligne de départ de chaque côté, à partir de 0. */
  leftStart: number;
  rightStart: number;
  left: string[];
  right: string[];
}

export type DiffPart = { type: 'same'; lines: string[]; leftStart: number; rightStart: number } | { type: 'hunk'; hunk: DiffHunk };

/** Un fichier écrit sous Windows ne doit pas paraître entièrement modifié. */
export function normalizeEol(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

const docLines = (text: string): string[] => (text === '' ? [] : text.split('\n'));

function overlaps(changes: Array<readonly [number, number]>, start: number, length: number): boolean {
  const end = start + length;
  return changes.some(([from, size]) => {
    const to = from + size;
    // Une insertion ou une suppression n'occupe aucune ligne : la toucher, c'est être à côté d'elle.
    return length === 0 || size === 0 ? from <= end && to >= start : from < end && to > start;
  });
}

/** Découpe deux textes en parties identiques et en blocs différents. `base` : version d'où ils sont partis tous les deux. */
export function diffParts(left: string, right: string, base: string | null = null): DiffPart[] {
  const a = docLines(left);
  const b = docLines(right);
  const origin = base === null ? null : docLines(base);
  const leftChanges = origin && diffIndices(origin, a).map((entry) => entry.buffer2);
  const rightChanges = origin && diffIndices(origin, b).map((entry) => entry.buffer2);
  const parts: DiffPart[] = [];
  let leftAt = 0;
  let rightAt = 0;
  let index = 0;
  for (const found of diffIndices(a, b)) {
    const [leftStart, leftLength] = found.buffer1;
    const [rightStart, rightLength] = found.buffer2;
    if (leftStart > leftAt) parts.push({ type: 'same', lines: a.slice(leftAt, leftStart), leftStart: leftAt, rightStart: rightAt });
    const leftTouched = leftChanges ? overlaps(leftChanges, leftStart, leftLength) : true;
    const rightTouched = rightChanges ? overlaps(rightChanges, rightStart, rightLength) : true;
    parts.push({
      type: 'hunk',
      hunk: {
        index: index++,
        kind: leftLength === 0 ? 'added' : rightLength === 0 ? 'removed' : 'changed',
        origin: leftTouched === rightTouched ? 'both' : leftTouched ? 'left' : 'right',
        leftStart,
        rightStart,
        left: a.slice(leftStart, leftStart + leftLength),
        right: b.slice(rightStart, rightStart + rightLength),
      },
    });
    leftAt = leftStart + leftLength;
    rightAt = rightStart + rightLength;
  }
  if (leftAt < a.length) parts.push({ type: 'same', lines: a.slice(leftAt), leftStart: leftAt, rightStart: rightAt });
  return parts;
}

// --- Détail d'une ligne ------------------------------------------------------------------------------------------------

export interface DiffSpan {
  text: string;
  changed: boolean;
}

const TOKENS = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;
/** Au-delà, comparer mot à mot prendrait du temps pour un surlignage illisible. */
const WORD_DIFF_CHARS = 4_000;
const WORD_DIFF_LINES = 200;

function spansOf(tokens: string[], changes: Array<readonly [number, number]>): DiffSpan[] {
  const spans: DiffSpan[] = [];
  const push = (text: string, changed: boolean): void => {
    if (!text) return;
    const last = spans.at(-1);
    if (last?.changed === changed) last.text += text;
    else spans.push({ text, changed });
  };
  let at = 0;
  for (const [start, length] of changes) {
    push(tokens.slice(at, start).join(''), false);
    push(tokens.slice(start, start + length).join(''), true);
    at = start + length;
  }
  push(tokens.slice(at).join(''), false);
  return spans;
}

/** Ce qui change entre deux lignes, mot à mot. Quand elles n'ont presque rien en commun, la ligne entière est marquée. */
export function wordDiff(left: string, right: string): { left: DiffSpan[]; right: DiffSpan[] } {
  const whole = { left: left ? [{ text: left, changed: true }] : [], right: right ? [{ text: right, changed: true }] : [] };
  if (left.length + right.length > WORD_DIFF_CHARS) return whole;
  const a = left.match(TOKENS) ?? [];
  const b = right.match(TOKENS) ?? [];
  const found = diffIndices(a, b);
  const spans = { left: spansOf(a, found.map((entry) => entry.buffer1)), right: spansOf(b, found.map((entry) => entry.buffer2)) };
  const kept = spans.left.reduce((total, span) => total + (span.changed ? 0 : span.text.trim().length), 0);
  return kept * 3 < Math.max(left.length, right.length) ? whole : spans;
}

/** Une ligne de chaque côté d'un bloc ; `null` : rien en face. */
export interface DiffRow {
  leftLine: number | null;
  rightLine: number | null;
  left: DiffSpan[] | null;
  right: DiffSpan[] | null;
}

const plainSpans = (line: string): DiffSpan[] => (line ? [{ text: line, changed: false }] : []);

/** Lignes d'un bloc alignées deux à deux. */
export function hunkRows(hunk: DiffHunk): DiffRow[] {
  const count = Math.max(hunk.left.length, hunk.right.length);
  const detailed = hunk.kind === 'changed' && count <= WORD_DIFF_LINES;
  return Array.from({ length: count }, (_, index) => {
    const left = hunk.left[index];
    const right = hunk.right[index];
    const pair = detailed && left !== undefined && right !== undefined ? wordDiff(left, right) : null;
    return {
      leftLine: left === undefined ? null : hunk.leftStart + index + 1,
      rightLine: right === undefined ? null : hunk.rightStart + index + 1,
      left: left === undefined ? null : (pair?.left ?? plainSpans(left)),
      right: right === undefined ? null : (pair?.right ?? plainSpans(right)),
    };
  });
}

// --- Choix bloc par bloc -----------------------------------------------------------------------------------------------

/** Ce qu'on garde d'un bloc ; les deux côtés ensemble sont possibles, et aucun revient à le retirer une fois `decided`. */
export interface DiffPick {
  left: boolean;
  right: boolean;
  decided: boolean;
}

/** Choix de départ : `prefer`, sinon le côté qui a changé. Un bloc changé des deux côtés reste à choisir. */
export function defaultPick(hunk: DiffHunk, prefer: DiffSide | null = null): DiffPick {
  const side = prefer ?? (hunk.origin === 'both' ? null : hunk.origin);
  return side ? { left: side === 'left', right: side === 'right', decided: true } : { left: false, right: false, decided: false };
}

/**
 * Le résultat s'écrit avec une fin de ligne après chaque ligne, dernière comprise : retirer un bloc ne laisse ainsi pas de
 * ligne vide. `mergedText` enlève celle de trop.
 */
const terminated = (lines: string[]): string => lines.map((line) => `${line}\n`).join('');

export function pickedText(hunk: DiffHunk, pick: DiffPick): string {
  return `${pick.left ? terminated(hunk.left) : ''}${pick.right ? terminated(hunk.right) : ''}`;
}

/** Texte de travail du résultat, et place de chaque bloc dedans. */
export function composeMerge(parts: DiffPart[], picks: DiffPick[]): { doc: string; ranges: Array<{ from: number; to: number }> } {
  let doc = '';
  const ranges: Array<{ from: number; to: number }> = [];
  for (const part of parts) {
    if (part.type === 'same') {
      doc += terminated(part.lines);
      continue;
    }
    const from = doc.length;
    doc += pickedText(part.hunk, picks[part.hunk.index]!);
    ranges.push({ from, to: doc.length });
  }
  return { doc, ranges };
}

export function mergedText(doc: string): string {
  return doc.endsWith('\n') ? doc.slice(0, -1) : doc;
}

// --- Passage modifié ---------------------------------------------------------------------------------------------------

const CONTEXT_ROUNDS = 50;

const isUnique = (text: string, part: string): boolean => part !== '' && text.indexOf(part) === text.lastIndexOf(part);

/**
 * Passage qui change entre deux textes, en lignes entières et avec assez de contexte pour le retrouver sans ambiguïté :
 * le rejouer ou l'annuler plus tard respecte ce qui a été écrit ailleurs dans la note entre-temps.
 */
export function changedPassage(before: string, after: string): { before: string; after: string } {
  const shortest = Math.min(before.length, after.length);
  let start = 0;
  while (start < shortest && before[start] === after[start]) start += 1;
  let end = 0;
  while (end < shortest - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end += 1;
  start = start === 0 ? 0 : before.lastIndexOf('\n', start - 1) + 1;
  const tail = before.slice(before.length - end);
  const newline = tail.indexOf('\n');
  end = newline < 0 ? 0 : end - newline;

  for (let round = 0; round < CONTEXT_ROUNDS; round += 1) {
    // Une ligne de plus de chaque côté.
    if (start > 0) start = start < 2 ? 0 : before.lastIndexOf('\n', start - 2) + 1;
    if (end > 0) {
      const rest = before.slice(before.length - end + 1);
      const next = rest.indexOf('\n');
      end = next < 0 ? 0 : rest.length - next;
    }
    const passage = { before: before.slice(start, before.length - end), after: after.slice(start, after.length - end) };
    if ((start === 0 && end === 0) || (isUnique(before, passage.before) && isUnique(after, passage.after))) return passage;
  }
  return { before, after };
}

/** Remplace un passage ; `null` s'il n'est plus là, ou plus unique. */
export function replacePassage(text: string, from: string, to: string): string | null {
  if (from === '') return text === '' ? to : null;
  const index = text.indexOf(from);
  if (index < 0 || text.indexOf(from, index + 1) >= 0) return null;
  return `${text.slice(0, index)}${to}${text.slice(index + from.length)}`;
}
