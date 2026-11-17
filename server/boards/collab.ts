import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { BoardElement } from '../../shared/boards.ts';
import { base64ToBytes, bytesToBase64, docRoleAtLeast } from '../../shared/docs.ts';
import type { ClientMessage, ServerMessage } from '../../shared/realtime.ts';
import type { AppContext } from '../context.ts';
import type { DocPeer } from '../docs/collab.ts';
import { getAuthUser, type AuthUser } from '../services/access.ts';
import { boardDoc, elementsOf, replaceElements } from './elements.ts';
import { resolveShare } from './shares.ts';
import { boardRole, boardsEnabled, listBoardNodes, readBoardElements, readBoardState, storeElements, type BoardNodeRow } from './store.ts';

/**
 * Édition d'un tableau à plusieurs : une salle par tableau ouvert, avec son document Yjs (carte `elements`). Les
 * modifications arrivent par WebSocket, se fusionnent, repartent vers les autres, puis sont enregistrées en base.
 */

interface Room {
  boardId: number;
  spaceId: number;
  doc: Y.Doc;
  awareness: Awareness;
  peers: Map<DocPeer, Set<number>>;
  lastWriter: number | null;
  dirty: boolean;
  firstDirtyAt: number | null;
  timer: NodeJS.Timeout | null;
}

const SAVE_DELAY_MS = 1_000;
const SAVE_MAX_DELAY_MS = 5_000;

export class BoardRooms {
  readonly #ctx: AppContext;
  readonly #rooms = new Map<number, Room>();
  readonly #watchers = new Map<number, Set<DocPeer>>();
  /** Connexions entrées par le lien de partage d'un tableau (visiteurs sans compte compris). */
  readonly #shares = new Map<DocPeer, { boardId: number; slug: string; token: string | null }>();

  constructor(ctx: AppContext) {
    this.#ctx = ctx;
  }

  onMessage(peer: DocPeer, message: Extract<ClientMessage, { t: `board${string}` }>): void {
    switch (message.t) {
      case 'boards.watch':
        this.#watch(peer, message.spaceId);
        break;
      case 'board.join':
        this.#join(peer, message.boardId, message.stateVector, message.share);
        break;
      case 'board.update':
        this.#update(peer, message.boardId, message.update);
        break;
      case 'board.awareness':
        this.#awareness(peer, message.boardId, message.update);
        break;
      case 'board.leave':
        this.#leave(peer, message.boardId);
        break;
    }
  }

  drop(peer: DocPeer): void {
    this.#unwatch(peer);
    this.#shares.delete(peer);
    for (const room of [...this.#rooms.values()]) {
      if (room.peers.has(peer)) this.#leave(peer, room.boardId);
    }
  }

  // --- Arbre d'un espace ---------------------------------------------------------------------------------------------

  #account(peer: DocPeer): AuthUser | null {
    const user = getAuthUser(this.#ctx.db, peer.userId);
    return user?.isActive ? user : null;
  }

  #roleOf(peer: DocPeer, spaceId: number) {
    const user = this.#account(peer);
    return user && boardsEnabled(this.#ctx.db) ? boardRole(this.#ctx.db, user, spaceId) : null;
  }

  #unwatch(peer: DocPeer): void {
    for (const [spaceId, peers] of this.#watchers) {
      peers.delete(peer);
      if (peers.size === 0) this.#watchers.delete(spaceId);
    }
  }

  /** Rôle d'une connexion sur un tableau : par l'espace, ou par le lien de partage par lequel elle est entrée. */
  #boardRole(peer: DocPeer, boardId: number, spaceId: number) {
    const share = this.#shares.get(peer);
    if (share?.boardId === boardId) {
      try {
        const user = peer.userId > 0 ? this.#account(peer) : null;
        return resolveShare(this.#ctx, user, share.slug, share.token).role;
      } catch {
        return null;
      }
    }
    return peer.guest ? null : this.#roleOf(peer, spaceId);
  }

  #watch(peer: DocPeer, spaceId: unknown): void {
    this.#unwatch(peer);
    if (peer.guest || typeof spaceId !== 'number' || !this.#roleOf(peer, spaceId)) return;
    const peers = this.#watchers.get(spaceId) ?? new Set();
    peers.add(peer);
    this.#watchers.set(spaceId, peers);
  }

  publishTree(spaceId: number): void {
    const peers = this.#watchers.get(spaceId);
    if (!peers?.size) return;
    const message: ServerMessage = { t: 'boards.tree', spaceId, nodes: listBoardNodes(this.#ctx.db, spaceId) };
    for (const peer of peers) peer.send(message);
  }

  // --- Salles --------------------------------------------------------------------------------------------------------

  #board(boardId: number): BoardNodeRow | undefined {
    return this.#ctx.db.get<BoardNodeRow>("SELECT * FROM board_nodes WHERE id = ? AND kind IN ('board', 'template') AND deleted_at IS NULL", boardId);
  }

  #open(node: BoardNodeRow): Room {
    const existing = this.#rooms.get(node.id);
    if (existing) return existing;
    const state = readBoardState(this.#ctx.db, node.id);
    const doc = boardDoc(state, state ? [] : readBoardElements(this.#ctx, node));
    const awareness = new Awareness(doc);
    awareness.setLocalState(null);
    const room: Room = { boardId: node.id, spaceId: node.space_id, doc, awareness, peers: new Map(), lastWriter: null, dirty: false, firstDirtyAt: null, timer: null };
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      const message: ServerMessage = { t: 'board.update', boardId: node.id, update: bytesToBase64(update) };
      for (const peer of room.peers.keys()) {
        if (peer !== origin) peer.send(message);
      }
      room.dirty = true;
      this.#schedule(room);
    });
    awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const ids = room.peers.get(origin as DocPeer);
      if (ids) {
        added.forEach((id) => ids.add(id));
        removed.forEach((id) => ids.delete(id));
      }
      const message: ServerMessage = { t: 'board.awareness', boardId: node.id, update: bytesToBase64(encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed])) };
      for (const peer of room.peers.keys()) {
        if (peer !== origin) peer.send(message);
      }
    });
    this.#rooms.set(node.id, room);
    return room;
  }

  #join(peer: DocPeer, boardId: unknown, stateVector: unknown, share?: { slug?: unknown; token?: unknown }): void {
    if (typeof boardId !== 'number' || typeof stateVector !== 'string') return;
    const node = this.#board(boardId);
    if (share && typeof share.slug === 'string') this.#shares.set(peer, { boardId, slug: share.slug, token: typeof share.token === 'string' ? share.token : null });
    else this.#shares.delete(peer);
    const role = node ? this.#boardRole(peer, node.id, node.space_id) : null;
    if (!node || !role) {
      peer.send({ t: 'board.closed', boardId, reason: 'revoked' });
      return;
    }
    for (const other of [...this.#rooms.values()]) {
      if (other.boardId !== boardId && other.peers.has(peer)) this.#leave(peer, other.boardId);
    }
    const room = this.#open(node);
    room.peers.set(peer, room.peers.get(peer) ?? new Set());
    const clients = [...room.awareness.getStates().keys()];
    let update: Uint8Array;
    try {
      update = Y.encodeStateAsUpdate(room.doc, base64ToBytes(stateVector));
    } catch {
      update = Y.encodeStateAsUpdate(room.doc);
    }
    peer.send({
      t: 'board.sync',
      boardId,
      update: bytesToBase64(update),
      stateVector: bytesToBase64(Y.encodeStateVector(room.doc)),
      canWrite: docRoleAtLeast(role, 'editor') && !peer.readOnly,
      awareness: clients.length ? bytesToBase64(encodeAwarenessUpdate(room.awareness, clients)) : null,
    });
  }

  #update(peer: DocPeer, boardId: unknown, update: unknown): void {
    const room = typeof boardId === 'number' ? this.#rooms.get(boardId) : undefined;
    if (!room?.peers.has(peer) || typeof update !== 'string') return;
    // Les droits sont revérifiés à chaque écriture : ils ont pu changer pendant l'édition.
    const role = this.#boardRole(peer, room.boardId, room.spaceId);
    if (!role || !docRoleAtLeast(role, 'editor') || peer.readOnly) {
      peer.send({ t: 'board.closed', boardId: room.boardId, reason: 'revoked' });
      this.#leave(peer, room.boardId);
      return;
    }
    try {
      room.lastWriter = peer.userId;
      Y.applyUpdate(room.doc, base64ToBytes(update), peer);
    } catch {
      peer.send({ t: 'error', message: 'Modification illisible.' });
    }
  }

  #awareness(peer: DocPeer, boardId: unknown, update: unknown): void {
    const room = typeof boardId === 'number' ? this.#rooms.get(boardId) : undefined;
    if (!room?.peers.has(peer) || typeof update !== 'string') return;
    try {
      applyAwarenessUpdate(room.awareness, base64ToBytes(update), peer);
    } catch {
      // Curseur illisible : sans conséquence sur le tableau.
    }
  }

  #leave(peer: DocPeer, boardId: unknown): void {
    const room = typeof boardId === 'number' ? this.#rooms.get(boardId) : undefined;
    const clients = room?.peers.get(peer);
    if (!room || !clients) return;
    room.peers.delete(peer);
    if (clients.size) removeAwarenessStates(room.awareness, [...clients], null);
    if (room.peers.size === 0) this.#close(room);
  }

  // --- Écriture ------------------------------------------------------------------------------------------------------

  #schedule(room: Room): void {
    const now = Date.now();
    room.firstDirtyAt ??= now;
    if (room.timer) clearTimeout(room.timer);
    const delay = Math.min(SAVE_DELAY_MS, Math.max(0, room.firstDirtyAt + SAVE_MAX_DELAY_MS - now));
    room.timer = setTimeout(() => this.#flush(room), delay);
    room.timer.unref();
  }

  #flush(room: Room): void {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    room.firstDirtyAt = null;
    if (!room.dirty || !this.#board(room.boardId)) return;
    room.dirty = false;
    try {
      storeElements(this.#ctx.db, room.boardId, elementsOf(room.doc), Y.encodeStateAsUpdate(room.doc), room.lastWriter);
    } catch (error) {
      this.#ctx.logger.warn('boards', 'Tableau non enregistré', { boardId: room.boardId, error: error instanceof Error ? error.message : String(error) }, room.lastWriter);
      return;
    }
    const at = new Date().toISOString();
    for (const peer of room.peers.keys()) peer.send({ t: 'board.saved', boardId: room.boardId, at });
  }

  #close(room: Room): void {
    this.#flush(room);
    this.#rooms.delete(room.boardId);
    room.awareness.destroy();
    room.doc.destroy();
    // Le nombre d'éléments a pu changer : l'arbre le montre.
    this.publishTree(room.spaceId);
  }

  // --- Appelé par le service -----------------------------------------------------------------------------------------

  /** Éléments en cours d'édition, si le tableau est ouvert. */
  currentElements(boardId: number): BoardElement[] | null {
    const room = this.#rooms.get(boardId);
    return room ? elementsOf(room.doc) : null;
  }

  /** Remplace les éléments d'un tableau ouvert (API) ; `false` s'il n'est pas ouvert. */
  replaceElements(boardId: number, elements: readonly BoardElement[], userId: number | null): boolean {
    const room = this.#rooms.get(boardId);
    if (!room) return false;
    room.lastWriter = userId;
    replaceElements(room.doc, elements, 'server');
    this.#flush(room);
    return true;
  }

  closeBoard(boardId: number, reason: 'deleted' | 'revoked'): void {
    const room = this.#rooms.get(boardId);
    if (!room) return;
    for (const peer of room.peers.keys()) peer.send({ t: 'board.closed', boardId, reason });
    this.#close(room);
  }

  /** Le partage d'un tableau a changé : ceux qui y sont entrés par le lien gardent ou perdent l'accès. */
  refreshShare(boardId: number): void {
    const room = this.#rooms.get(boardId);
    if (!room) return;
    for (const peer of [...room.peers.keys()]) {
      if (this.#shares.get(peer)?.boardId !== boardId) continue;
      // Toujours admis : il se raccorde avec ses nouveaux droits (lecture ↔ écriture) ; sinon il sort.
      const role = this.#boardRole(peer, boardId, room.spaceId);
      peer.send({ t: 'board.closed', boardId, reason: role ? 'changed' : 'revoked' });
      this.#leave(peer, boardId);
    }
  }

  closeSpace(spaceId: number): void {
    for (const room of [...this.#rooms.values()]) {
      if (room.spaceId === spaceId) this.closeBoard(room.boardId, 'deleted');
    }
    for (const peer of this.#watchers.get(spaceId) ?? []) peer.send({ t: 'boards.revoked', spaceId });
    this.#watchers.delete(spaceId);
  }

  refreshAccess(spaceId: number, userId: number): void {
    const peers = [...(this.#watchers.get(spaceId) ?? [])].filter((peer) => peer.userId === userId);
    for (const room of this.#rooms.values()) {
      if (room.spaceId === spaceId) peers.push(...[...room.peers.keys()].filter((peer) => peer.userId === userId));
    }
    for (const peer of new Set(peers)) {
      if (this.#roleOf(peer, spaceId)) {
        peer.send({ t: 'boards.access', spaceId });
        continue;
      }
      peer.send({ t: 'boards.revoked', spaceId });
      this.#unwatch(peer);
      for (const room of [...this.#rooms.values()]) {
        if (room.spaceId === spaceId) this.#leave(peer, room.boardId);
      }
    }
  }

  refreshSpace(spaceId: number): void {
    for (const peer of this.#watchers.get(spaceId) ?? []) peer.send({ t: 'boards.access', spaceId });
  }

  closeAllSpaces(): void {
    for (const spaceId of new Set([...this.#watchers.keys(), ...[...this.#rooms.values()].map((room) => room.spaceId)])) this.closeSpace(spaceId);
  }

  close(): void {
    for (const room of [...this.#rooms.values()]) this.#close(room);
    this.#watchers.clear();
  }
}
