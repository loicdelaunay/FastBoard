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
