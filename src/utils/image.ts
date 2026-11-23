import { t } from '@/i18n';
/** Recadre l'image au carré (centre) et la réduit à `size` px ; retourne un Blob WebP (ou JPEG si WebP n'est pas géré). */
export async function squareThumbnail(file: File, size = 256): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error(t('Impossible de traiter l\'image dans ce navigateur.'));
    }
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
    return await toBlob(canvas);
  } finally {
    bitmap.close();
  }
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (webp) => {
        if (webp && webp.type === 'image/webp') {
          resolve(webp);
          return;
        }
        canvas.toBlob(
          (jpeg) => (jpeg ? resolve(jpeg) : reject(new Error(t('Impossible de convertir l\'image.')))),
          'image/jpeg',
          0.88,
        );
      },
      'image/webp',
      0.88,
    );
  });
}

/** Réduit l'image pour qu'elle tienne dans un carré de `size` px (sans la recadrer, fond transparent) : logos. */
export async function fitThumbnail(file: File, size = 256): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error(t('Impossible de traiter l\'image dans ce navigateur.'));
    }
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
    return await toBlob(canvas);
  } finally {
    bitmap.close();
  }
}

/** Image réduite (côté le plus long ≤ `max` px) en URL `data:` JPEG, pour l'envoyer à un modèle avec vision. */
export async function imageToDataUrl(file: Blob, max = 1568): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error(t('Impossible de traiter l\'image dans ce navigateur.'));
    }
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    bitmap.close();
  }
}

/** Formats qu'une image remplacée peut garder, d'après l'extension de son nom. */
const FORMAT_OF_EXTENSION: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

/**
 * Prépare une image qui en remplace une autre et garde son nom (image d'une note) : convertie au format de ce nom (une
 * `.png` reste du PNG, une `.jpg` du JPEG, une `.webp` du WebP allégé), pour que le fichier reste cohérent sur le disque
 * et dans un coffre Obsidian. Un GIF ne se convertit pas : il part tel quel.
 */
export async function imageAs(file: File, name: string): Promise<File> {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  const wanted = FORMAT_OF_EXTENSION[extension];
  if (!wanted || wanted === 'image/gif' || typeof createImageBitmap !== 'function') return file;
  if (wanted === 'image/webp') return compressImage(file);
  if (file.type === wanted) return file;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    // Le JPEG n'a pas de transparence : fond blanc plutôt que noir.
    if (wanted === 'image/jpeg') {
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, wanted, UPLOAD_WEBP_QUALITY));
    if (!blob || blob.type !== wanted) return file;
    return new File([blob], name.split('/').pop() ?? name, { type: wanted, lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}

/** Ouvre le choix d'un fichier image ; `null` si l'on annule. */
export function pickImage(accept = 'image/png,image/jpeg,image/webp,image/gif'): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    const done = (file: File | null): void => {
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => done(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => done(null), { once: true });
    document.body.append(input);
    input.click();
  });
}

/** Qualité des images converties en WebP à l'envoi. */
export const UPLOAD_WEBP_QUALITY = 0.8;
/** Formats convertis : images matricielles fixes. Un GIF (souvent animé), un SVG (vectoriel) et un WebP restent tels quels. */
const CONVERTED = new Set(['image/png', 'image/jpeg', 'image/bmp', 'image/tiff']);

/**
 * Allège une image avant son envoi (pièce jointe, image d'une note ou d'un tableau blanc) : convertie en WebP, qualité
 * 80 %, sans changer ses dimensions. L'original est gardé si la conversion n'est pas possible (navigateur sans WebP,
 * image trop grande) ou ne fait rien gagner.
 */
export async function compressImage(file: File): Promise<File> {
  if (!CONVERTED.has(file.type) || typeof createImageBitmap !== 'function') return file;
  let bitmap: ImageBitmap | null = null;
  try {
    // L'orientation notée par l'appareil photo est appliquée : l'image convertie n'a plus ces métadonnées.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', UPLOAD_WEBP_QUALITY));
    if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file;
    const base = file.name.replace(/\.[^./\\]+$/, '') || 'image';
    return new File([blob], `${base}.webp`, { type: 'image/webp', lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
