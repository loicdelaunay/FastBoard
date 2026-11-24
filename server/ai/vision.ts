import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { sniffImageMime, isInlineImage } from '../../shared/attachments.ts';
import { AI_LIMITS, aiImageRef, aiImageUrl, type AiImageSource, type AiRenderRequest, type AiStreamEvent } from '../../shared/ai.ts';
import { docBaseName } from '../../shared/docs.ts';
import { assetByKey, assetFile } from '../boards/assets.ts';
import { requireBoardSpace } from '../boards/store.ts';
import { readBytes, requireNode, requireSpace } from '../docs/store.ts';
import { badRequest, notFound } from '../http/errors.ts';
import { attachmentFile, requireAttachment } from '../services/attachments.ts';
import { requireTicket } from '../services/tickets.ts';
import type { ToolContext } from './toolKit.ts';

/**
 * Vision de l'assistant : les images qu'il peut lire (documentation, tableaux blancs, pièces jointes), et les vues de
 * tableaux blancs. Le serveur ne dessine pas d'image : une vue de tableau (ou une image à réduire) est demandée au
 * panneau qui a posé la question, le temps de la réponse (évènement `render`, réponse par `POST /ai/renders/{id}`).
 */

interface PendingRender {
  userId: number;
  resolve: (image: string) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, PendingRender>();

/** Demande une image au panneau et l'attend ; échoue si le panneau ne répond pas à temps (ou si la réponse est arrêtée). */
export function requestRender(userId: number, emit: (event: AiStreamEvent) => void, stepId: string, request: AiRenderRequest, signal?: AbortSignal): Promise<string> {
  const id = randomUUID();
  return new Promise<string>((resolve, reject) => {
    const finish = (): void => {
      clearTimeout(entry.timer);
      pending.delete(id);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => {
      finish();
      reject(new Error('Réponse arrêtée.'));
    };
    const entry: PendingRender = {
      userId,
      resolve: (image) => {
        finish();
        resolve(image);
      },
      reject: (error) => {
        finish();
        reject(error);
      },
      timer: setTimeout(() => entry.reject(new Error('Le panneau n’a pas dessiné l’image à temps.')), AI_LIMITS.renderTimeoutSeconds * 1000),
    };
    pending.set(id, entry);
    signal?.addEventListener('abort', onAbort, { once: true });
    emit({ type: 'render', id, stepId, request });
  });
}

/** Image (ou échec) renvoyée par le panneau ; faux si la demande n'existe pas, a expiré ou n'est pas à cette personne. */
export function deliverRender(userId: number, id: string, result: { image: string } | { error: string }): boolean {
  const entry = pending.get(id);
  if (!entry || entry.userId !== userId) return false;
  if ('image' in result) entry.resolve(result.image);
  else entry.reject(new Error(result.error));
  return true;
}

/** Une image accessible, avec de quoi la lire. */
export interface ImageInfo {
  source: AiImageSource;
  name: string;
  /** Type réel du fichier. */
  mime: string;
  size: number;
  /** Lit le fichier. */
  read: () => Buffer;
}

/**
 * Vérifie que la personne peut voir cette image (droits de l'espace, du tableau ou du ticket, et `ai.read` pour un
 * projet), et la décrit. `canReadProject` : la règle des outils sur les projets.
 */
export function imageInfo(tool: ToolContext, source: AiImageSource, canReadProject: (projectId: number) => void): ImageInfo {
  const { ctx, user } = tool;
  if (source.kind === 'doc') {
    const node = requireNode(ctx.db, source.id);
    requireSpace(ctx, user, node.space_id);
    if (node.kind !== 'image' || node.deleted_at) throw notFound('Image introuvable.');
    const head = readBytes(ctx, node)?.subarray(0, 16);
    return { source, name: docBaseName(node.path), mime: (head && sniffImageMime(head)) || 'application/octet-stream', size: node.size, read: () => readBytes(ctx, node) ?? Buffer.alloc(0) };
  }
  if (source.kind === 'asset') {
    const asset = assetByKey(ctx.db, source.key);
    if (!asset) throw notFound('Image introuvable.');
    requireBoardSpace(ctx, user, asset.spaceId);
    return { source, name: asset.name, mime: asset.mime, size: asset.size, read: () => fs.readFileSync(assetFile(ctx, asset.key)) };
  }
  const row = requireAttachment(ctx.db, source.id);
  canReadProject(requireTicket(ctx.db, row.ticket_id).project_id);
  if (row.kind !== 'file' || !isInlineImage(row.mime)) throw badRequest('Cette pièce jointe n’est pas une image.');
  return { source, name: row.name, mime: row.mime, size: row.size, read: () => fs.readFileSync(attachmentFile(ctx, row)) };
}

/** Taille au-delà de laquelle une image est réduite par le panneau plutôt qu'envoyée telle quelle. */
const DIRECT_BYTES = 1_500_000;

/**
 * Contenu d'une image pour le modèle, en adresse `data:`. Une petite image PNG, JPEG, WebP ou GIF part telle quelle ;
 * une grande image ou un SVG est réduit (ou dessiné) par le panneau, s'il sait le faire.
 */
export async function imageForModel(tool: ToolContext, info: ImageInfo): Promise<string> {
  const raster = isInlineImage(info.mime);
  if (raster && info.size <= DIRECT_BYTES) {
    const data = info.read();
    const mime = sniffImageMime(data.subarray(0, 16));
    if (mime) return `data:${mime};base64,${data.toString('base64')}`;
  }
  if (!tool.render) {
    throw badRequest(raster ? 'Image trop grande pour être lue ici.' : 'Cette image (SVG) ne peut pas être lue ici.');
  }
  return tool.render({ kind: 'image', source: info.source, maxSide: AI_LIMITS.renderSide });
}

/** Décrit une image pour le modèle : sa référence (pour `view_image`) et son nom. */
export const imageEntry = (info: Pick<ImageInfo, 'source' | 'name'>, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  image: aiImageRef(info.source),
  name: info.name,
  ...extra,
});

export { aiImageUrl };
