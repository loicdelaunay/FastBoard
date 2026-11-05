import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { base64ToBytes, bytesToBase64, docRoleAtLeast, DOC_LIMITS } from '../../shared/docs.ts';
import type { DocCommentDTO } from '../../shared/docComments.ts';
import type { ClientMessage, ServerMessage } from '../../shared/realtime.ts';
import type { AppContext } from '../context.ts';
import { getAuthUser, type AuthUser } from '../services/access.ts';
import { addVersion, docRole, docsEnabled, listNodes, readText, storeText, type NodeRow } from './store.ts';

/**
 * Édition à plusieurs : chaque fichier ouvert a une salle, avec un document Yjs en mémoire. Les modifications arrivent
 * par WebSocket, se fusionnent sans conflit, repartent vers les autres participants, puis sont écrites sur le disque.
 * L'état Yjs est gardé en base : une connexion revenue après une coupure se raccorde au même document.
 */

/** Connexion WebSocket vue par les salles. */
export interface DocPeer {
  userId: number;
  /** Jeton d'API en lecture seule : la personne ne peut qu'observer. */
  readOnly: boolean;
  send: (message: ServerMessage) => void;
}

interface Room {
  nodeId: number;
  spaceId: number;
  doc: Y.Doc;
  text: Y.Text;
  awareness: Awareness;
  /** Participants et identifiants Yjs de leurs curseurs. */
  peers: Map<DocPeer, Set<number>>;
  saved: string;
  /** Texte de la dernière version de l'historique. */
  versioned: string;
  /** Personnes qui ont écrit depuis la dernière version. */
  authors: Map<number, string>;
  lastWriter: number | null;
  versionAt: number;
  firstDirtyAt: number | null;
  timer: NodeJS.Timeout | null;
}

const SAVE_DELAY_MS = 800;
const SAVE_MAX_DELAY_MS = 5_000;
/** Écart minimal entre deux versions de l'historique pendant une édition. */
const VERSION_INTERVAL_MS = 5 * 60 * 1000;

/** Remplace le texte en ne touchant que ce qui change, pour ne pas déplacer les curseurs des autres. */
function applyTextDiff(doc: Y.Doc, text: Y.Text, next: string, origin: unknown): void {
  const current = text.toString();
  if (current === next) return;
  let start = 0;
  const shortest = Math.min(current.length, next.length);
  while (start < shortest && current.charCodeAt(start) === next.charCodeAt(start)) start += 1;
  let end = 0;
  while (end < shortest - start && current.charCodeAt(current.length - 1 - end) === next.charCodeAt(next.length - 1 - end)) end += 1;
  doc.transact(() => {
    text.delete(start, current.length - start - end);
    text.insert(start, next.slice(start, next.length - end));
  }, origin);
}

export class DocRooms {
  readonly #ctx: AppContext;
  readonly #rooms = new Map<number, Room>();
  /** Connexions qui regardent l'arbre d'un espace. */
  readonly #watchers = new Map<number, Set<DocPeer>>();

  constructor(ctx: AppContext) {
    this.#ctx = ctx;
  }

  onMessage(peer: DocPeer, message: Extract<ClientMessage, { t: `doc${string}` }>): void {
    switch (message.t) {
      case 'docs.watch':
        this.#watch(peer, message.spaceId);
        break;
      case 'doc.join':
        this.#join(peer, message.nodeId, message.stateVector);
        break;
      case 'doc.update':
        this.#update(peer, message.nodeId, message.update);
        break;
      case 'doc.awareness':
        this.#awareness(peer, message.nodeId, message.update);
        break;
      case 'doc.leave':
        this.#leave(peer, message.nodeId);
        break;
    }
  }

  /** La connexion s'est fermée. */
  drop(peer: DocPeer): void {
    this.#unwatch(peer);
    for (const room of [...this.#rooms.values()]) {
      if (room.peers.has(peer)) this.#leave(peer, room.nodeId);
    }
  }

  // --- Arbre d'un espace ---------------------------------------------------------------------------------------------

  #account(peer: DocPeer): AuthUser | null {
    const user = getAuthUser(this.#ctx.db, peer.userId);
    return user?.isActive ? user : null;
  }

  #roleOf(peer: DocPeer, spaceId: number) {
    const user = this.#account(peer);
    return user && docsEnabled(this.#ctx.db) ? docRole(this.#ctx.db, user, spaceId) : null;
  }

  #unwatch(peer: DocPeer): void {
    for (const [spaceId, peers] of this.#watchers) {
      peers.delete(peer);
      if (peers.size === 0) this.#watchers.delete(spaceId);
    }
  }

  #watch(peer: DocPeer, spaceId: unknown): void {
    this.#unwatch(peer);
    if (typeof spaceId !== 'number' || !this.#roleOf(peer, spaceId)) return;
    const peers = this.#watchers.get(spaceId) ?? new Set();
    peers.add(peer);
    this.#watchers.set(spaceId, peers);
  }

  publishTree(spaceId: number): void {
    const peers = this.#watchers.get(spaceId);
    if (!peers?.size) return;
    const message: ServerMessage = { t: 'docs.tree', spaceId, nodes: listNodes(this.#ctx.db, spaceId) };
    for (const peer of peers) peer.send(message);
  }

  publishComments(spaceId: number, nodeId: number, comments: DocCommentDTO[]): void {
    const message: ServerMessage = { t: 'docs.comments', spaceId, nodeId, comments };
    for (const peer of this.#watchers.get(spaceId) ?? []) peer.send(message);
  }

  // --- Salles --------------------------------------------------------------------------------------------------------

  #node(nodeId: number): NodeRow | undefined {
    return this.#ctx.db.get<NodeRow>("SELECT * FROM doc_nodes WHERE id = ? AND kind = 'markdown' AND deleted_at IS NULL", nodeId);
  }

  #open(node: NodeRow): Room {
    const existing = this.#rooms.get(node.id);
    if (existing) return existing;
    const { db } = this.#ctx;
    const doc = new Y.Doc();
    const state = db.get<{ state: Uint8Array }>('SELECT state FROM doc_states WHERE node_id = ?', node.id)?.state;
    if (state) Y.applyUpdate(doc, new Uint8Array(state));
    const text = doc.getText('content');
    // Le fichier fait foi : il a pu changer sans passer par une salle (API, import, restauration).
    const content = readText(this.#ctx, node);
    applyTextDiff(doc, text, content, 'server');
    const awareness = new Awareness(doc);
    awareness.setLocalState(null);
    const room: Room = {
      nodeId: node.id,
      spaceId: node.space_id,
      doc,
      text,
      awareness,
      peers: new Map(),
      saved: content,
      versioned: content,
      authors: new Map(),
      lastWriter: null,
      versionAt: Date.now(),
      firstDirtyAt: null,
      timer: null,
    };
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      const message: ServerMessage = { t: 'doc.update', nodeId: node.id, update: bytesToBase64(update) };
      for (const peer of room.peers.keys()) {
        if (peer !== origin) peer.send(message);
      }
      this.#schedule(room);
    });
    awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const ids = room.peers.get(origin as DocPeer);
      if (ids) {
        added.forEach((id) => ids.add(id));
        removed.forEach((id) => ids.delete(id));
      }
      const message: ServerMessage = { t: 'doc.awareness', nodeId: node.id, update: bytesToBase64(encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed])) };
      for (const peer of room.peers.keys()) {
        if (peer !== origin) peer.send(message);
      }
    });
    this.#rooms.set(node.id, room);
    return room;
  }

  #join(peer: DocPeer, nodeId: unknown, stateVector: unknown): void {
    if (typeof nodeId !== 'number' || typeof stateVector !== 'string') return;
    const node = this.#node(nodeId);
    const role = node ? this.#roleOf(peer, node.space_id) : null;
    if (!node || !role) {
      peer.send({ t: 'doc.closed', nodeId, reason: 'revoked' });
      return;
    }
    for (const other of [...this.#rooms.values()]) {
      if (other.nodeId !== nodeId && other.peers.has(peer)) this.#leave(peer, other.nodeId);
    }
    const room = this.#open(node);
    room.peers.set(peer, room.peers.get(peer) ?? new Set());
    const clients = [...room.awareness.getStates().keys()];
    peer.send({
      t: 'doc.sync',
      nodeId,
      update: bytesToBase64(Y.encodeStateAsUpdate(room.doc, base64ToBytes(stateVector))),
      stateVector: bytesToBase64(Y.encodeStateVector(room.doc)),
      canWrite: docRoleAtLeast(role, 'editor') && !peer.readOnly,
      awareness: clients.length ? bytesToBase64(encodeAwarenessUpdate(room.awareness, clients)) : null,
    });
  }

  #update(peer: DocPeer, nodeId: unknown, update: unknown): void {
    const room = typeof nodeId === 'number' ? this.#rooms.get(nodeId) : undefined;
    if (!room?.peers.has(peer) || typeof update !== 'string') return;
    // Les droits sont revérifiés à chaque écriture : ils ont pu changer pendant l'édition.
    const role = this.#roleOf(peer, room.spaceId);
    if (!role || !docRoleAtLeast(role, 'editor') || peer.readOnly) {
      peer.send({ t: 'doc.closed', nodeId: room.nodeId, reason: 'revoked' });
      this.#leave(peer, room.nodeId);
      return;
    }
    try {
      room.lastWriter = peer.userId;
      const name = this.#account(peer)?.name;
      if (name) room.authors.set(peer.userId, name);
      Y.applyUpdate(room.doc, base64ToBytes(update), peer);
    } catch {
      peer.send({ t: 'error', message: 'Modification illisible.' });
    }
  }

  #awareness(peer: DocPeer, nodeId: unknown, update: unknown): void {
    const room = typeof nodeId === 'number' ? this.#rooms.get(nodeId) : undefined;
    if (!room?.peers.has(peer) || typeof update !== 'string') return;
    try {
      applyAwarenessUpdate(room.awareness, base64ToBytes(update), peer);
    } catch {
      // Curseur illisible : sans conséquence sur le texte.
    }
  }

  #leave(peer: DocPeer, nodeId: unknown): void {
    const room = typeof nodeId === 'number' ? this.#rooms.get(nodeId) : undefined;
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

  /** Écrit le fichier et l'état Yjs ; une version de l'historique est prise de temps en temps, et à la fin de l'édition. */
  #flush(room: Room, closing = false): void {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    room.firstDirtyAt = null;
    const node = this.#node(room.nodeId);
    if (!node) return;
    const content = room.text.toString();
    const { db } = this.#ctx;
    if (content !== room.saved) {
      if (content.length > DOC_LIMITS.fileChars) {
        this.#ctx.logger.warn('docs', 'Fichier trop long : modification non enregistrée', { nodeId: room.nodeId, chars: content.length }, room.lastWriter);
        return;
      }
      storeText(this.#ctx, node, content, room.lastWriter);
      room.saved = content;
      db.run(
        'INSERT INTO doc_states (node_id, state) VALUES (?, ?) ON CONFLICT (node_id) DO UPDATE SET state = excluded.state',
        room.nodeId,
        Y.encodeStateAsUpdate(room.doc),
      );
      for (const peer of room.peers.keys()) peer.send({ t: 'doc.saved', nodeId: room.nodeId, at: new Date().toISOString() });
    }
    if (content !== room.versioned && (closing || Date.now() - room.versionAt >= VERSION_INTERVAL_MS)) {
      addVersion(this.#ctx, { userId: room.lastWriter, origin: null }, node, content, 'edit', [...room.authors.values()], room.versioned);
      room.versioned = content;
      room.versionAt = Date.now();
      room.authors.clear();
    }
  }

  #close(room: Room): void {
    this.#flush(room, true);
    this.#rooms.delete(room.nodeId);
    room.awareness.destroy();
    room.doc.destroy();
  }

  // --- Appelé par le service -----------------------------------------------------------------------------------------

  /** Texte en cours d'édition, si le fichier est ouvert. */
  currentText(nodeId: number): string | null {
    return this.#rooms.get(nodeId)?.text.toString() ?? null;
  }

  /** Remplace le texte d'un fichier ouvert (API, import, restauration) ; `false` s'il n'est pas ouvert. */
  replaceText(nodeId: number, content: string): boolean {
    const room = this.#rooms.get(nodeId);
    if (!room) return false;
    // Ce qui a été écrit depuis la dernière version reste retrouvable dans l'historique.
    this.#flush(room, true);
    applyTextDiff(room.doc, room.text, content, 'server');
    this.#flush(room);
    room.versioned = content;
    room.versionAt = Date.now();
    return true;
  }

  /** Écrit sur le disque ce qui est en mémoire pour un espace (avant un export ou un déplacement). */
  flushSpace(spaceId: number): void {
    for (const room of this.#rooms.values()) {
      if (room.spaceId === spaceId) this.#flush(room);
    }
  }

  /** Ferme la salle d'un fichier supprimé. */
  closeNode(nodeId: number, reason: 'deleted' | 'revoked'): void {
    const room = this.#rooms.get(nodeId);
    if (!room) return;
    for (const peer of room.peers.keys()) peer.send({ t: 'doc.closed', nodeId, reason });
    this.#close(room);
  }

  closeSpace(spaceId: number): void {
    for (const room of [...this.#rooms.values()]) {
      if (room.spaceId === spaceId) this.closeNode(room.nodeId, 'deleted');
    }
    for (const peer of this.#watchers.get(spaceId) ?? []) peer.send({ t: 'docs.revoked', spaceId });
    this.#watchers.delete(spaceId);
  }

  /** Le rôle d'une personne a changé : elle resynchronise, ou sort de l'espace si elle n'y a plus accès. */
  refreshAccess(spaceId: number, userId: number): void {
    const peers = [...(this.#watchers.get(spaceId) ?? [])].filter((peer) => peer.userId === userId);
    for (const room of this.#rooms.values()) {
      if (room.spaceId === spaceId) peers.push(...[...room.peers.keys()].filter((peer) => peer.userId === userId));
    }
    for (const peer of new Set(peers)) {
      if (this.#roleOf(peer, spaceId)) {
        peer.send({ t: 'docs.access', spaceId });
        continue;
      }
      peer.send({ t: 'docs.revoked', spaceId });
      this.#unwatch(peer);
      for (const room of [...this.#rooms.values()]) {
        if (room.spaceId === spaceId) this.#leave(peer, room.nodeId);
      }
    }
  }

  /** La fonctionnalité vient d'être désactivée : tout le monde sort. */
  closeAllSpaces(): void {
    for (const spaceId of new Set([...this.#watchers.keys(), ...[...this.#rooms.values()].map((room) => room.spaceId)])) this.closeSpace(spaceId);
  }

  /** Arrêt du serveur : rien ne doit rester seulement en mémoire. */
  close(): void {
    for (const room of [...this.#rooms.values()]) this.#close(room);
    this.#watchers.clear();
  }
}
