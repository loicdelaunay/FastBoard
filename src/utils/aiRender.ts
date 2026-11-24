import { AI_LIMITS, aiImageUrl, type AiRenderRequest } from '@shared/ai';
import { t } from '@/i18n';

/**
 * Images dessinées pour l'assistant, à la demande du serveur pendant une réponse (le serveur ne dessine pas) : un
 * tableau blanc, entier ou une zone, d'après son aperçu SVG ; ou une image réduite (grande photo, SVG). Le résultat est
 * une image WebP (JPEG sinon) sur fond blanc, que tous les modèles avec vision savent lire.
 */

function sourceOf(request: AiRenderRequest): { url: string; maxSide: number } {
  if (request.kind === 'image') return { url: aiImageUrl(request.source), maxSide: request.maxSide };
  const query = new URLSearchParams({ width: String(request.width) });
  if (request.region) for (const key of ['x', 'y', 'w', 'h'] as const) query.set(key, String(request.region[key]));
  return { url: `/api/boards/nodes/${request.boardId}/preview?${query.toString()}`, maxSide: AI_LIMITS.renderWidthMax };
}

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(t('Image illisible.')));
    image.src = url;
  });
}

function encode(canvas: HTMLCanvasElement, quality: number): string {
  const webp = canvas.toDataURL('image/webp', quality);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', quality);
}

export async function renderForAi(request: AiRenderRequest): Promise<string> {
  const { url, maxSide } = sourceOf(request);
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(t('Image inaccessible ({status}).', { status: response.status }));
  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    const image = await load(objectUrl);
    const width = image.naturalWidth || 800;
    const height = image.naturalHeight || 600;
    let scale = Math.min(1, maxSide / Math.max(width, height));
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error(t('Impossible de dessiner l’image dans ce navigateur.'));
      // Fond blanc : une image transparente se lit mal sur le fond (souvent noir) que lui donne le modèle.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = encode(canvas, attempt ? 0.75 : 0.88);
      if (data.length <= AI_LIMITS.imageChars) return data;
      scale *= 0.7;
    }
    throw new Error(t('Image trop lourde pour l’assistant.'));
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
