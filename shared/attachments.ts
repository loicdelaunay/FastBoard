/** Règles communes aux pièces jointes (serveur et interface). */

/** Types d'images affichables directement dans la page : jamais de SVG ni de HTML. */
export const INLINE_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

export function isInlineImage(mime: string): boolean {
  return (INLINE_IMAGE_MIMES as readonly string[]).includes(mime);
}

/** Détecte le type réel d'une image d'après ses premiers octets (le type annoncé par le client n'est pas fiable). */
export function sniffImageMime(head: Uint8Array): (typeof INLINE_IMAGE_MIMES)[number] | null {
  const ascii = (from: number, to: number): string => String.fromCharCode(...head.subarray(from, to));
  if (head.length >= 8 && head[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'image/gif';
  if (head.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Nettoie un nom de fichier fourni par le client (chemin, caractères de contrôle, longueur). */
export function sanitizeFileName(raw: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  const base = raw.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').trim() ?? '';
  const cleaned = base.replace(/^\.+/, '');
  if (!cleaned) {
    return 'fichier';
  }
  if (cleaned.length <= max) {
    return cleaned;
  }
  const dot = cleaned.lastIndexOf('.');
  const extension = dot > 0 && cleaned.length - dot <= 12 ? cleaned.slice(dot) : '';
  return cleaned.slice(0, max - extension.length) + extension;
}
