import type { FastRefKind } from '@shared/boards';
import { plainText } from '@shared/docComments';
import { boardTitle } from '@shared/boards';
import { docBaseName, docParent, docTitle } from '@shared/docs';
import type { TicketPreviewDTO } from '@shared/types';
import { api } from '@/api';

/** Ce qu'un Fast Element montre de l'objet qu'il désigne ; chargé une fois par minute au plus. */
export type FastData =
  | { kind: 'ticket'; title: string; preview: TicketPreviewDTO }
  | { kind: 'note'; title: string; spaceId: number; path: string; excerpt: string }
  | { kind: 'folder'; title: string; spaceId: number; path: string; children: Array<{ id: number; title: string; folder: boolean }> }
  | { kind: 'space'; title: string; description: string; count: number }
  | { kind: 'board'; title: string; spaceId: number; spaceName: string; elementCount: number };

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: Promise<FastData> }>();

function excerptOf(content: string): string {
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
  return plainText(body).replace(/\s+/g, ' ').trim().slice(0, 280);
}

async function fetchRef(kind: FastRefKind, id: number): Promise<FastData> {
  switch (kind) {
    case 'ticket': {
      const { preview } = await api.ticketPreview(id);
      return { kind, title: `${preview.key} — ${preview.title}`, preview };
    }
    case 'note': {
      const { node, content } = await api.docNode(id);
      return { kind, title: docTitle(node.path), spaceId: node.spaceId, path: node.path, excerpt: excerptOf(content ?? '') };
    }
    case 'folder': {
      const { node } = await api.docNode(id);
      const { nodes } = await api.docSpace(node.spaceId);
      const children = nodes
        .filter((child) => docParent(child.path) === node.path && child.kind !== 'image')
        .sort((a, b) => (a.kind === 'folder' ? 0 : 1) - (b.kind === 'folder' ? 0 : 1) || a.path.localeCompare(b.path))
        .map((child) => ({ id: child.id, title: child.kind === 'folder' ? docBaseName(child.path) : docTitle(child.path), folder: child.kind === 'folder' }));
      return { kind, title: docBaseName(node.path), spaceId: node.spaceId, path: node.path, children };
    }
    case 'space': {
      const { space } = await api.docSpace(id);
      return { kind, title: space.name, description: space.description, count: space.fileCount };
    }
    case 'board': {
      const { node, space } = await api.board(id);
      return { kind, title: boardTitle(node.path), spaceId: space.id, spaceName: space.name, elementCount: node.elementCount };
    }
  }
}

export function loadFastRef(kind: FastRefKind, id: number, fresh = false): Promise<FastData> {
  const key = `${kind}:${id}`;
  const hit = cache.get(key);
  if (hit && !fresh && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = fetchRef(kind, id);
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}
