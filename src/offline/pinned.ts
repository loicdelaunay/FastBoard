import { reactive, watch } from 'vue';
import type { BoardElement } from '@shared/boards';
import { OFFLINE_LIMITS } from '@shared/offline';
import { api } from '@/api';
import { offlineApiKey } from '@/api/http';
import { useAuthStore } from '@/stores/auth';
import { darkMode } from '@/theme/themeManager';
import { attachmentUrl } from '@/utils/files';
import { docImageUrl } from '@/utils/replaceImage';
import { offlineKey, PINNED_CACHE_PREFIX, unpinOffline, writeOffline } from './cache';
import { connection } from './connection';

/**
 * Espaces gardés hors ligne (clic droit sur un espace de documentation, de tableaux blancs ou un projet) : une copie
 * complète, sur cet appareil, actualisée toutes les heures (arbre, notes, tableaux, tickets avec leurs commentaires,
 * leur historique et leurs pièces jointes, images et fichiers). Elle passe par les mêmes adresses que les écrans, qui la lisent
 * donc d'eux-mêmes quand le serveur ne répond plus. Ses entrées sont exemptées du ménage du cache, et ses images ont
 * leur propre cache. Le choix vaut pour cet appareil et ce compte ; il part à la déconnexion.
 */

export type PinKind = 'docs' | 'boards' | 'project';

export interface PinnedSpace {
  kind: PinKind;
  id: number;
  name: string;
  /** Dernière copie complète réussie. */
  syncedAt: string | null;
  /** Éléments copiés (notes, tableaux, tickets) à la dernière copie. */
  items: number;
  /** La dernière copie a échoué (serveur, droits retirés…). */
  failed: boolean;
}

const HOUR = 60 * 60 * 1000;
const CHECK_MS = 5 * 60 * 1000;
const CONCURRENCY = 4;

export const pinned = reactive({
  userId: null as number | null,
  list: [] as PinnedSpace[],
  /** Espace en cours de copie (`docs:12`), et l'avancement. */
  syncing: null as string | null,
  progress: { done: 0, total: 0 },
});

/**
 * Code des écrans de chaque genre d'espace : chargé à chaque copie, il passe par le service worker qui le garde (et
 * reste chargé dans l'onglet ouvert sans service worker). Sans lui, un écran jamais ouvert ne s'afficherait pas hors
 * ligne. Les adresses du routeur importent les mêmes modules.
 */
const SCREENS: Record<PinKind, Array<() => Promise<unknown>>> = {
  docs: [() => import('@/views/docs/DocSpacesView.vue'), () => import('@/views/docs/DocSpaceView.vue'), () => import('@/views/docs/DocFileRedirect.vue')],
  boards: [() => import('@/views/boards/BoardSpacesView.vue'), () => import('@/views/boards/BoardSpaceView.vue'), () => import('@/views/boards/BoardFileRedirect.vue'), () => import('chart.js/auto')],
  project: [
    () => import('@/views/ProjectsView.vue'),
    () => import('@/views/project/ProjectLayout.vue'),
    () => import('@/views/project/ListView.vue'),
    () => import('@/views/project/KanbanView.vue'),
    () => import('@/views/project/GanttView.vue'),
    () => import('@/views/project/ActivityView.vue'),
    () => import('@/views/project/AnalyzerView.vue'),
  ],
};

export const pinTag = (kind: PinKind, id: number): string => `${kind}:${id}`;
const imageCache = (kind: PinKind, id: number): string => `${PINNED_CACHE_PREFIX}${kind}-${id}`;
/** Les listes communes (espaces, projets, personnes…) : gardées tant qu'un espace l'est. */
const COMMON_TAG = 'common';
const storageKey = (userId: number): string => `fb.offline.pinned.${userId}`;

function load(userId: number | null): void {
  pinned.userId = userId;
  pinned.list = [];
  if (userId === null) return;
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey(userId)) ?? '[]') as PinnedSpace[];
    pinned.list = Array.isArray(stored) ? stored.filter((entry) => ['docs', 'boards', 'project'].includes(entry.kind) && Number.isInteger(entry.id)) : [];
  } catch {
    pinned.list = [];
  }
}

function save(): void {
  if (pinned.userId === null) return;
  try {
    localStorage.setItem(storageKey(pinned.userId), JSON.stringify(pinned.list));
  } catch {
    // Stockage indisponible : le choix vaut pour cette page.
  }
}

export function pinnedEntry(kind: PinKind, id: number): PinnedSpace | undefined {
  return pinned.list.find((entry) => entry.kind === kind && entry.id === id);
}

/** Garde l'espace hors ligne : une première copie tout de suite, puis toutes les heures. */
export async function pinSpace(kind: PinKind, id: number, name: string): Promise<void> {
  if (!pinnedEntry(kind, id)) {
    pinned.list.push({ kind, id, name, syncedAt: null, items: 0, failed: false });
    save();
  }
  // Le navigateur n'efface pas d'office le stockage d'un site qui garde des données exprès.
  void navigator.storage?.persist?.().catch(() => false);
  await syncSpace(pinnedEntry(kind, id)!);
}

/** L'espace n'est plus gardé : sa copie redevient un cache ordinaire, ses images partent. */
export async function unpinSpace(kind: PinKind, id: number): Promise<void> {
  pinned.list = pinned.list.filter((entry) => !(entry.kind === kind && entry.id === id));
  save();
  await unpinOffline(pinTag(kind, id));
  if (!pinned.list.length) await unpinOffline(COMMON_TAG);
  try {
    if (typeof caches !== 'undefined') await caches.delete(imageCache(kind, id));
  } catch {
    // Pas de cache d'images (connexion non sécurisée).
  }
}

/** Exécute `tasks` quelques-unes à la fois, en comptant l'avancement. */
async function pool(tasks: Array<() => Promise<void>>): Promise<void> {
  pinned.progress.total += tasks.length;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const task = tasks[next++]!;
      try {
        await task();
      } finally {
        pinned.progress.done += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker));
}

/** Lit une adresse de l'API (comme le font les écrans) et rattache sa réponse à l'espace gardé. */
async function keep<T>(path: string, read: () => Promise<T>, tag: string): Promise<T> {
  const payload = await read();
  const key = offlineApiKey(path);
  if (key) await writeOffline(key, payload, tag);
  return payload;
}

/** Images et fichiers à copier avec un espace. */
interface Files {
  images: Set<string>;
  /** Fichiers joints (tous types) : servis par le service worker, donc copiés seulement s'il y a un cache. */
  downloads: Set<string>;
}

/**
 * Images et fichiers de l'espace : dans son cache (connexion sécurisée, le service worker les y trouve), sinon les
 * images dans celui du navigateur. Ce qui n'est plus dans l'espace part.
 */
async function keepFiles(kind: PinKind, id: number, files: Files): Promise<void> {
  if (typeof caches === 'undefined') {
    await pool([...files.images].map((url) => async () => void (await fetch(url, { credentials: 'same-origin' }).catch(() => undefined))));
    return;
  }
  const list = [...files.images, ...files.downloads];
  const cache = await caches.open(imageCache(kind, id));
  const wanted = new Set(list.map((url) => new URL(url, location.origin).href));
  await pool(
    list.map((url) => async () => {
      // Les adresses versionnées ne changent pas de contenu ; les aperçus de tableaux, si : ils se recopient à chaque fois.
      if (!url.includes('/preview') && (await cache.match(url))) return;
      const response = await fetch(url, { credentials: 'same-origin' }).catch(() => null);
      if (response?.ok) await cache.put(url, response);
    }),
  );
  for (const request of await cache.keys()) if (!wanted.has(request.url)) await cache.delete(request);
}

async function syncDocs(id: number, tag: string, userId: number, { images }: Files): Promise<number> {
  const space = await keep(`/documentation/spaces/${id}`, () => api.docSpace(id), tag);
  const notes = [...space.nodes, ...space.templates].filter((node) => node.kind === 'markdown' || node.kind === 'template');
  for (const node of space.nodes) if (node.kind === 'image') images.add(docImageUrl(node));
  await pool(
    notes.map((node) => async () => {
      const read = await keep(`/documentation/nodes/${node.id}`, () => api.docNode(node.id), tag);
      // Le texte, là où l'éditeur le cherche hors ligne (sa session détachée).
      await writeOffline(offlineKey(userId, `doc:${node.id}`), read.content ?? '', tag);
      await keep(`/documentation/nodes/${node.id}/comments`, () => api.docComments(node.id), tag);
    }),
  );
  return notes.length;
}

async function syncBoards(id: number, tag: string, userId: number, { images }: Files): Promise<number> {
  const space = await keep(`/boards/spaces/${id}`, () => api.boardSpace(id), tag);
  const boards = space.nodes.filter((node) => node.kind !== 'folder');
  await pool(
    boards.map((node) => async () => {
      const read = await keep(`/boards/nodes/${node.id}`, () => api.board(node.id), tag);
      await writeOffline(offlineKey(userId, `board:${node.id}`), read.elements, tag);
      images.add(api.boardPreviewUrl(node.id, 360, darkMode.value));
      for (const element of read.elements as BoardElement[]) {
        if (element.type === 'image' && element.asset) images.add(`/api/board-assets/${element.asset}`);
        else if (element.type === 'icon' && /^custom:\d+$/.test(element.icon)) images.add(`/api/board-icons/${element.icon.slice(7)}`);
      }
    }),
  );
  return boards.length;
}

async function syncProject(id: number, tag: string, { images, downloads }: Files): Promise<number> {
  const snapshot = await keep(`/projects/${id}`, () => api.snapshot(id), tag);
  await pool(
    snapshot.tickets.map((ticket) => async () => {
      await keep(`/tickets/${ticket.id}/comments`, () => api.comments(ticket.id), tag);
      await keep(`/tickets/${ticket.id}/history`, () => api.history(ticket.id), tag);
      const { attachments } = await keep(`/tickets/${ticket.id}/attachments`, () => api.attachments(ticket.id), tag);
      for (const attachment of attachments) {
        if (attachment.kind !== 'file') continue;
        // L'aperçu des images, et le fichier lui-même (à télécharger) s'il n'est pas trop lourd.
        if (attachment.mime.startsWith('image/')) images.add(attachmentUrl(attachment, true));
        if (attachment.size <= OFFLINE_LIMITS.pinnedFileBytes) downloads.add(attachmentUrl(attachment));
      }
    }),
  );
  return snapshot.tickets.length;
}

/** Copie complète d'un espace gardé (ou une actualisation). */
export async function syncSpace(entry: PinnedSpace): Promise<boolean> {
  const userId = pinned.userId;
  if (userId === null || connection.offline || pinned.syncing) return false;
  const tag = pinTag(entry.kind, entry.id);
  pinned.syncing = tag;
  pinned.progress = { done: 0, total: 0 };
  try {
    // Les listes qui mènent à l'espace, communes à tous les espaces gardés.
    await keep('/me', () => api.me(), COMMON_TAG);
    await keep('/users', () => api.directory(), COMMON_TAG);
    await keep('/projects', () => api.projects(), COMMON_TAG);
    if (entry.kind === 'docs') await keep('/documentation/spaces', () => api.docSpaces(), COMMON_TAG);
    if (entry.kind === 'boards') await keep('/boards/spaces', () => api.boardSpaces(), COMMON_TAG);
    // Une version plus récente de l'application a pu remplacer ce code : la page rechargée le reprendra.
    await Promise.all(SCREENS[entry.kind].map((load) => load().catch(() => undefined)));
    const files: Files = { images: new Set(), downloads: new Set() };
    const items = entry.kind === 'docs' ? await syncDocs(entry.id, tag, userId, files) : entry.kind === 'boards' ? await syncBoards(entry.id, tag, userId, files) : await syncProject(entry.id, tag, files);
    await keepFiles(entry.kind, entry.id, files);
    Object.assign(entry, { syncedAt: new Date().toISOString(), items, failed: false });
    return true;
  } catch {
    entry.failed = true;
    return false;
  } finally {
    pinned.syncing = null;
    save();
  }
}

/** Actualise les espaces dont la copie a plus d'une heure (ou n'a jamais réussi). */
async function syncDue(): Promise<void> {
  for (const entry of [...pinned.list]) {
    if (connection.offline || pinned.userId === null) return;
    if (!entry.syncedAt || entry.failed || Date.now() - Date.parse(entry.syncedAt) >= HOUR) await syncSpace(entry);
  }
}

/** À appeler une fois, une fois Pinia prête : suit le compte connecté et actualise toutes les heures. */
export function startPinnedSync(): void {
  const auth = useAuthStore();
  watch(
    () => auth.user?.id ?? null,
    (id) => {
      load(id);
      if (id !== null) window.setTimeout(() => void syncDue(), 10_000);
    },
    { immediate: true },
  );
  window.setInterval(() => void syncDue(), CHECK_MS);
  // Le serveur revient après une coupure : les copies en retard se rattrapent.
  watch(
    () => connection.offline,
    (offline) => !offline && void syncDue(),
  );
}
