import { elementText, type BoardElement } from '../../shared/boards.ts';
import { RAG_LIMITS } from '../../shared/rag.ts';

/** Passage à indexer : son texte, son titre (contexte), et où le retrouver (lignes d'une note, éléments d'un tableau). */
export interface RagChunk {
  title: string;
  text: string;
  lineFrom?: number;
  lineTo?: number;
  elements?: string[];
}

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t#]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Note Markdown → passages d'environ `maxChars` caractères, coupés de préférence avant un titre ou une ligne vide.
 * Chaque passage garde ses lignes (pour être cité : `doc:ID#L12-18`) et le chemin de ses titres (« Guide › Installation »).
 */
export function docChunks(noteTitle: string, text: string, maxChars: number = RAG_LIMITS.chunkChars): RagChunk[] {
  const lines = text.split('\n');
  const chunks: RagChunk[] = [];
  const headings: string[] = [];
  let fence: string | null = null;
  /** `body` : le passage a autre chose que des titres (une section vide ne fait pas un passage à elle seule). */
  let current: { from: number; lines: string[]; size: number; title: string; body: boolean } | null = null;

  // Le titre de premier niveau répète souvent le nom de la note : il n'apparaît qu'une fois.
  const titleOf = () => [noteTitle, ...headings.filter((heading, index) => heading && !(index === 0 && heading.toLowerCase() === noteTitle.toLowerCase()))].join(' › ');
  const close = () => {
    // Les lignes vides de la fin ne comptent pas dans les lignes citées.
    while (current?.lines.length && !current.lines.at(-1)!.trim()) current.lines.pop();
    if (current && current.lines.join('\n').trim()) {
      chunks.push({ title: current.title, text: current.lines.join('\n').trim(), lineFrom: current.from, lineTo: current.from + current.lines.length - 1 });
    }
    current = null;
  };

  lines.forEach((line, index) => {
    const number = index + 1;
    // Dans un bloc de code, un « # » n'ouvre pas de titre ; une clôture ferme le bloc ouvert par la même marque.
    const fenceMark = FENCE.exec(line)?.[1];
    if (fenceMark) {
      if (fence === null) fence = fenceMark;
      else if (fenceMark[0] === fence[0] && fenceMark.length >= fence.length) fence = null;
    }
    const heading = fence === null && !fenceMark ? HEADING.exec(line) : null;
    if (heading) {
      // Un titre ouvre un passage, sauf si le précédent n'a encore que des titres.
      if (current?.body) close();
      const level = heading[1]!.length;
      headings.length = Math.min(headings.length, level - 1);
      while (headings.length < level - 1) headings.push('');
      headings.push(heading[2]!.trim());
    } else if (current && current.size + line.length > maxChars && (!line.trim() || current.size > maxChars * 0.6)) {
      close();
    }
    // Ligne démesurée : découpée en morceaux, qui gardent tous son numéro.
    if (line.length > maxChars) {
      close();
      for (let start = 0; start < line.length; start += maxChars) {
        chunks.push({ title: titleOf(), text: line.slice(start, start + maxChars).trim(), lineFrom: number, lineTo: number });
      }
      return;
    }
    if (!current) {
      if (!line.trim()) return;
      current = { from: number, lines: [], size: 0, title: titleOf(), body: false };
    }
    if (!heading && line.trim()) current.body = true;
    current.lines.push(line);
    current.size += line.length + 1;
    if (current.size >= maxChars * 1.5) close();
  });
  close();
  return chunks.filter((chunk) => chunk.text);
}

/** Texte libre (ticket) → passages d'environ `maxChars`, coupés entre deux paragraphes quand c'est possible. */
export function textChunks(title: string, text: string, maxChars: number = RAG_LIMITS.chunkChars): RagChunk[] {
  const chunks: RagChunk[] = [];
  let current = '';
  const push = () => {
    if (current.trim()) chunks.push({ title, text: current.trim() });
    current = '';
  };
  for (const paragraph of text.split(/\n{2,}/)) {
    if (current && current.length + paragraph.length + 2 > maxChars) push();
    if (paragraph.length > maxChars) {
      push();
      for (let start = 0; start < paragraph.length; start += maxChars) chunks.push({ title, text: paragraph.slice(start, start + maxChars).trim() });
      continue;
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  push();
  return chunks.filter((chunk) => chunk.text);
}

/**
 * Tableau blanc → passages faits des textes de ses éléments, rangés de haut en bas puis de gauche à droite, avec les
 * liens entre eux (« Navigateur → API REST »). Chaque passage garde ses éléments (pour être cité : `board:ID#el:a,b`).
 */
export function boardChunks(boardTitle: string, elements: readonly BoardElement[], maxChars: number = RAG_LIMITS.chunkChars): RagChunk[] {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const label = (id: string | null) => {
    const element = id ? byId.get(id) : undefined;
    return element ? (elementText(element) ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  };
  const entries: Array<{ ids: string[]; text: string; y: number; x: number }> = [];
  for (const element of elements) {
    if (element.type === 'connector') {
      const from = label(element.from.id);
      const to = label(element.to.id);
      const text = (elementText(element) ?? '').replace(/\s+/g, ' ').trim();
      if (from && to) entries.push({ ids: [element.id], text: `${from} → ${to}${text ? ` (${text})` : ''}`, y: Number.POSITIVE_INFINITY, x: 0 });
      continue;
    }
    const text = (elementText(element) ?? '').trim();
    if (!text) continue;
    entries.push({ ids: [element.id], text, y: 'y' in element ? element.y : 0, x: 'x' in element ? element.x : 0 });
  }
  // Rangées de 40 unités : une ligne de formes se lit de gauche à droite ; les liens viennent après.
  entries.sort((a, b) => (Number.isFinite(a.y) && Number.isFinite(b.y) ? Math.round(a.y / 40) - Math.round(b.y / 40) || a.x - b.x : Number.isFinite(a.y) ? -1 : 1));
  const chunks: RagChunk[] = [];
  let current: { lines: string[]; ids: string[]; size: number } = { lines: [], ids: [], size: 0 };
  const push = () => {
    if (current.lines.length) chunks.push({ title: boardTitle, text: current.lines.join('\n'), elements: current.ids });
    current = { lines: [], ids: [], size: 0 };
  };
  for (const entry of entries) {
    const text = entry.text.slice(0, maxChars);
    if (current.lines.length && (current.size + text.length > maxChars || current.ids.length >= RAG_LIMITS.elementsPerChunk)) push();
    current.lines.push(text);
    current.ids.push(...entry.ids);
    current.size += text.length + 1;
  }
  push();
  return chunks;
}
