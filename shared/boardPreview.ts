import { mockupSvg } from './boardMockup.ts';
import { boundsOf, connectorGeometry, connectorStroke, crossingsOf, mindLink, shapePath, textBox, type Rect } from './boardGeometry.ts';
import { iconMarkup, libraryIcon } from './boardIcons.ts';
import { TEXT_SIZE_PX, type BoardColor, type BoardElement, type MindElement } from './boards.ts';

/**
 * Aperçu d'un tableau en SVG, fait d'éléments simples (formes, textes, traits) : montré au survol d'une mention et en
 * miniature. Le texte est échappé et rien n'est exécutable.
 */

/** Teintes en thème clair : fond, trait, texte. */
export const BOARD_PALETTE: Record<BoardColor, { fill: string; stroke: string; text: string; sticky: string }> = {
  default: { fill: '#ffffff', stroke: '#334155', text: '#0f172a', sticky: '#fef08a' },
  gray: { fill: '#f1f5f9', stroke: '#64748b', text: '#1e293b', sticky: '#e2e8f0' },
  red: { fill: '#fee2e2', stroke: '#ef4444', text: '#7f1d1d', sticky: '#fecaca' },
  orange: { fill: '#ffedd5', stroke: '#f97316', text: '#7c2d12', sticky: '#fed7aa' },
  yellow: { fill: '#fef9c3', stroke: '#eab308', text: '#713f12', sticky: '#fef08a' },
  green: { fill: '#dcfce7', stroke: '#22c55e', text: '#14532d', sticky: '#bbf7d0' },
  blue: { fill: '#dbeafe', stroke: '#3b82f6', text: '#1e3a8a', sticky: '#bfdbfe' },
  purple: { fill: '#f3e8ff', stroke: '#a855f7', text: '#581c87', sticky: '#e9d5ff' },
  pink: { fill: '#fce7f3', stroke: '#ec4899', text: '#831843', sticky: '#fbcfe8' },
};

/** Teintes en thème sombre, comme sur le tableau ; les post-it gardent leurs couleurs. */
export const BOARD_PALETTE_DARK: Record<BoardColor, { fill: string; stroke: string; text: string; sticky: string }> = {
  default: { fill: '#273444', stroke: '#64748b', text: '#e2e8f0', sticky: '#fef08a' },
  gray: { fill: '#2a3240', stroke: '#94a3b8', text: '#e2e8f0', sticky: '#e2e8f0' },
  red: { fill: '#3f1d24', stroke: '#f87171', text: '#fecaca', sticky: '#fecaca' },
  orange: { fill: '#3f2a1b', stroke: '#fb923c', text: '#fed7aa', sticky: '#fed7aa' },
  yellow: { fill: '#3b3415', stroke: '#facc15', text: '#fef08a', sticky: '#fef08a' },
  green: { fill: '#173826', stroke: '#4ade80', text: '#bbf7d0', sticky: '#bbf7d0' },
  blue: { fill: '#1b2f4f', stroke: '#60a5fa', text: '#bfdbfe', sticky: '#bfdbfe' },
  purple: { fill: '#312047', stroke: '#c084fc', text: '#e9d5ff', sticky: '#e9d5ff' },
  pink: { fill: '#3d1a31', stroke: '#f472b6', text: '#fbcfe8', sticky: '#fbcfe8' },
};

/** Fond, surfaces (tableaux, graphiques, Fast Elements) et traits neutres, selon le thème. */
const SURFACES = {
  light: { canvas: '#f8fafc', surface: '#ffffff', label: '#ffffff', ink: '#0f172a', muted: '#334155', line: '#94a3b8', grid: '#cbd5e1', arrow: '#334155', fastText: '#312e81' },
  dark: { canvas: '#111827', surface: '#1f2937', label: '#111827', ink: '#e2e8f0', muted: '#cbd5e1', line: '#475569', grid: '#334155', arrow: '#94a3b8', fastText: '#c7d2fe' },
};

const PAD = 24;
const escape = (value: string): string => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const n = (value: number): string => String(Math.round(value * 10) / 10);

/** Découpe un texte en lignes qui tiennent dans une largeur (approximation : largeur moyenne d'un caractère). */
export function wrapText(text: string, width: number, fontSize: number, maxLines: number): string[] {
  const perLine = Math.max(1, Math.floor(width / (fontSize * 0.56)));
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if (`${line} ${word}`.length <= perLine) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
      while (line.length > perLine) {
        lines.push(line.slice(0, perLine));
        line = line.slice(perLine);
      }
    }
    lines.push(line);
    if (lines.length >= maxLines) break;
  }
  if (lines.length > maxLines) lines.length = maxLines;
  return lines;
}

function textBlock(text: string, box: Rect, fontSize: number, fill: string, align: 'left' | 'center' | 'right' = 'center', valign: 'top' | 'middle' = 'middle'): string {
  if (!text.trim()) return '';
  const lineHeight = fontSize * 1.3;
  const lines = wrapText(text, Math.max(10, box.w - 12), fontSize, Math.max(1, Math.floor((box.h - 6) / lineHeight)));
  const total = lines.length * lineHeight;
  const top = valign === 'middle' ? box.y + (box.h - total) / 2 : box.y + 8;
  const x = align === 'center' ? box.x + box.w / 2 : align === 'left' ? box.x + 8 : box.x + box.w - 8;
  const anchor = align === 'center' ? 'middle' : align === 'left' ? 'start' : 'end';
  return `<text x="${n(x)}" font-size="${fontSize}" fill="${fill}" text-anchor="${anchor}">${lines
    .map((line, index) => `<tspan x="${n(x)}" y="${n(top + lineHeight * index + fontSize)}">${escape(line)}</tspan>`)
    .join('')}</text>`;
}

/** Aperçu SVG des éléments d'un tableau ; un tableau vide donne un cadre vide. */
export function boardPreviewSvg(elements: readonly BoardElement[], options: { maxWidth?: number; dark?: boolean } = {}): string {
  const palette = options.dark ? BOARD_PALETTE_DARK : BOARD_PALETTE;
  const s = options.dark ? SURFACES.dark : SURFACES.light;
  const index = new Map(elements.map((element) => [element.id, element]));
  const bounds = boundsOf(elements, index) ?? { x: 0, y: 0, w: 400, h: 240 };
  const view = { x: bounds.x - PAD, y: bounds.y - PAD, w: Math.max(bounds.w + PAD * 2, 120), h: Math.max(bounds.h + PAD * 2, 80) };
  const width = Math.min(options.maxWidth ?? 640, view.w);
  const height = (width / view.w) * view.h;
  const parts: string[] = [];
  const sorted = [...elements].sort((a, b) => a.z - b.z);
  const minds = new Map(sorted.filter((element): element is MindElement => element.type === 'mind').map((element) => [element.id, element]));

  for (const element of sorted) {
    switch (element.type) {
      case 'frame': {
        const color = palette[element.color];
        parts.push(`<rect x="${n(element.x)}" y="${n(element.y)}" width="${n(element.w)}" height="${n(element.h)}" rx="12" fill="${color.fill}" fill-opacity="0.45" stroke="${color.stroke}" stroke-opacity="0.5"/>`);
        parts.push(textBlock(element.title, { x: element.x + 4, y: element.y + 2, w: element.w - 8, h: 30 }, 14, color.text, 'left', 'top'));
        break;
      }
      case 'shape': {
        const color = palette[element.color];
        const fill = element.fill === 'solid' ? color.fill : element.fill === 'outline' ? s.surface : 'none';
        const stroke = element.fill === 'none' ? 'none' : color.stroke;
        parts.push(`<path transform="translate(${n(element.x)},${n(element.y)})" d="${shapePath(element.shape, element.w, element.h)}" fill="${fill}" stroke="${stroke}" stroke-width="1.6"/>`);
        const box = textBox(element.shape, element.w, element.h);
        parts.push(textBlock(element.text, { x: element.x + box.x, y: element.y + box.y, w: box.w, h: box.h }, TEXT_SIZE_PX[element.size], color.text));
        break;
      }
      case 'sticky': {
        const color = palette[element.color];
        parts.push(`<rect x="${n(element.x)}" y="${n(element.y)}" width="${n(element.w)}" height="${n(element.h)}" rx="4" fill="${color.sticky}"/>`);
        parts.push(textBlock(element.text, element, 15, '#1f2937', 'left', 'top'));
        break;
      }
      case 'text':
        parts.push(textBlock(element.text, element, TEXT_SIZE_PX[element.size], palette[element.color].text, element.align, 'top'));
        break;
      case 'mind': {
        const parent = element.parent ? minds.get(element.parent) : undefined;
        const color = palette[element.color];
        if (parent) parts.push(`<path d="${mindLink(parent, element)}" fill="none" stroke="${color.stroke}" stroke-width="2"/>`);
        parts.push(`<rect x="${n(element.x)}" y="${n(element.y)}" width="${n(element.w)}" height="${n(element.h)}" rx="${n(Math.min(18, element.h / 2))}" fill="${element.parent ? s.surface : color.fill}" stroke="${color.stroke}" stroke-width="1.6"/>`);
        parts.push(textBlock(element.text, element, element.parent ? 14 : 16, color.text));
        break;
      }
      case 'path': {
        const points: string[] = [];
        for (let position = 0; position + 1 < element.points.length; position += 2) points.push(`${n(element.x + element.points[position]!)},${n(element.y + element.points[position + 1]!)}`);
        parts.push(`<polyline points="${points.join(' ')}" fill="none" stroke="${palette[element.color].stroke}" stroke-width="${n(element.width)}" stroke-linecap="round" stroke-linejoin="round"${element.highlighter ? ' stroke-opacity="0.35"' : ''}/>`);
        break;
      }
      case 'fast':
        parts.push(`<rect x="${n(element.x)}" y="${n(element.y)}" width="${n(element.w)}" height="${n(element.h)}" rx="10" fill="${s.surface}" stroke="#6366f1" stroke-width="1.4"/>`);
        parts.push(textBlock(element.label || element.ref.kind, element, 14, s.fastText, 'left', 'top'));
        break;
      case 'table': {
        const rows = element.rows.slice(0, 12);
        const columns = Math.max(1, ...rows.map((row) => row.length));
        const cellW = element.w / columns;
        const cellH = element.h / Math.max(1, element.rows.length);
        parts.push(`<rect x="${n(element.x)}" y="${n(element.y)}" width="${n(element.w)}" height="${n(element.h)}" fill="${s.surface}" stroke="${s.line}"/>`);
        parts.push(`<rect x="${n(element.x)}" y="${n(element.y)}" width="${n(element.w)}" height="${n(cellH)}" fill="${palette[element.color].fill}" stroke="${s.line}"/>`);
        rows.forEach((row, rowIndex) =>
          row.slice(0, 12).forEach((cell, columnIndex) => {
            parts.push(textBlock(cell, { x: element.x + columnIndex * cellW, y: element.y + rowIndex * cellH, w: cellW, h: cellH }, 12, s.ink, 'left'));
          }),
        );
        for (let column = 1; column < columns; column += 1) parts.push(`<line x1="${n(element.x + column * cellW)}" y1="${n(element.y)}" x2="${n(element.x + column * cellW)}" y2="${n(element.y + element.h)}" stroke="${s.grid}"/>`);
        break;
      }
      case 'chart':
        parts.push(`<rect x="${n(element.x)}" y="${n(element.y)}" width="${n(element.w)}" height="${n(element.h)}" rx="10" fill="${s.surface}" stroke="${s.grid}"/>`);
        [0.45, 0.75, 0.3, 0.6].forEach((ratio, bar) => {
          const barW = element.w / 7;
          const barH = (element.h - 50) * ratio;
          parts.push(`<rect x="${n(element.x + barW * (1 + bar * 1.4))}" y="${n(element.y + element.h - 14 - barH)}" width="${n(barW)}" height="${n(barH)}" rx="3" fill="#6366f1" fill-opacity="${0.45 + bar * 0.12}"/>`);
        });
        parts.push(textBlock(element.title, { x: element.x, y: element.y + 4, w: element.w, h: 24 }, 13, s.ink, 'center', 'top'));
        break;
      case 'icon': {
        const icon = libraryIcon(element.icon);
        const stroke = element.color === 'default' ? s.ink : palette[element.color].stroke;
        const box = `x="${n(element.x)}" y="${n(element.y)}" width="${n(element.w)}" height="${n(element.h)}"`;
        if (icon) {
          parts.push(`<svg ${box} viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${element.stroke}" stroke-linecap="round" stroke-linejoin="round">${iconMarkup(icon.node)}</svg>`);
        } else {
          // Icône ajoutée : l'aperçu ne charge rien d'extérieur, il en garde la place.
          parts.push(`<rect ${box} rx="6" fill="${stroke}" fill-opacity="0.18"/>`);
        }
        break;
      }
      case 'image':
        parts.push(`<rect x="${n(element.x)}" y="${n(element.y)}" width="${n(element.w)}" height="${n(element.h)}" rx="6" fill="${s.surface}" stroke="${s.grid}"/>`);
        parts.push(textBlock(element.name, element, 12, s.muted));
        break;
      case 'mockup': {
        const paint = {
          ink: palette.default.text,
          muted: palette.gray.stroke,
          line: palette.gray.stroke,
          surface: palette.default.fill,
          soft: palette.gray.fill,
          accent: palette[element.color].stroke,
          accentSoft: palette[element.color].fill,
          onAccent: '#ffffff',
        };
        parts.push(`<g transform="translate(${n(element.x)},${n(element.y)})">${mockupSvg(element, paint)}</g>`);
        break;
      }
      case 'connector': {
        const geometry = connectorGeometry(element, index);
        const stroke = palette[element.color].stroke;
        const below = element.jump ? sorted.filter((other) => other.type === 'connector' && other.z < element.z).map((other) => connectorGeometry(other as typeof element, index).line) : [];
        const drawn = connectorStroke(element, geometry, below.length ? crossingsOf(geometry.line, below) : undefined);
        if (drawn.outline) {
          // Grosse flèche : contour, puis remplissage par-dessus.
          const fill = palette[element.color].fill;
          parts.push(`<path d="${drawn.d}" fill="none" stroke="${stroke}" stroke-width="${n(drawn.line + drawn.outline * 2)}" stroke-linejoin="round"/>`);
          for (const head of drawn.heads) parts.push(`<polygon points="${head}" fill="${stroke}" stroke="${stroke}" stroke-width="${n(drawn.outline * 2)}" stroke-linejoin="round"/>`);
          parts.push(`<path d="${drawn.d}" fill="none" stroke="${fill}" stroke-width="${n(drawn.line)}" stroke-linejoin="round"/>`);
          for (const head of drawn.heads) parts.push(`<polygon points="${head}" fill="${fill}"/>`);
        } else {
          // Un lien animé en tirets s'affiche en pointillés dans l'aperçu (une image fixe).
          const dash = element.dashed || element.animation === 'flow' ? ` stroke-dasharray="${drawn.line > 2 ? `${n(drawn.line * 2.2)} ${n(drawn.line * 1.8)}` : '6 5'}"` : '';
          parts.push(`<path d="${drawn.d}" fill="none" stroke="${stroke}" stroke-width="${n(drawn.line)}" stroke-linejoin="round"${dash}/>`);
          for (const head of drawn.heads) parts.push(`<polygon class="arrow" points="${head}" fill="${stroke}"/>`);
        }
        if (element.label) {
          const width = Math.min(200, element.label.length * 7 + 12);
          parts.push(`<rect x="${n(geometry.mid.x - width / 2)}" y="${n(geometry.mid.y - 10)}" width="${n(width)}" height="20" rx="4" fill="${s.label}"/>`);
          parts.push(textBlock(element.label, { x: geometry.mid.x - width / 2, y: geometry.mid.y - 10, w: width, h: 20 }, 12, s.muted));
        }
        break;
      }
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(view.x)} ${n(view.y)} ${n(view.w)} ${n(view.h)}" width="${n(width)}" height="${n(height)}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">`,
    `<rect x="${n(view.x)}" y="${n(view.y)}" width="${n(view.w)}" height="${n(view.h)}" fill="${s.canvas}"/>`,
    ...parts,
    '</svg>',
  ].join('');
}
