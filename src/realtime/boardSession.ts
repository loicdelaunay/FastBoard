import { ref } from 'vue';
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { BoardElement } from '@shared/boards';
import { base64ToBytes, bytesToBase64 } from '@shared/docs';
import { presenceColor } from './docSession';
import { realtime, type BoardServerMessage } from './socket';

const REMOTE = 'remote';

/**
 * Lien entre un tableau ouvert et sa salle sur le serveur : la carte Yjs `elements` (id → élément) reçoit les écritures
 * des autres et leur envoie les nôtres, avec la position des pointeurs. Se raccorde après une coupure.
 */
export class BoardSession {
  readonly boardId: number;
  readonly doc = new Y.Doc();
  readonly elements = this.doc.getMap<BoardElement>('elements');
  readonly awareness = new Awareness(this.doc);
  readonly synced = ref(false);
  readonly canWrite = ref(false);
  readonly savedAt = ref<string | null>(null);
  readonly closed = ref<'deleted' | 'revoked' | 'moved' | null>(null);
  readonly #stops: Array<() => void> = [];
  /** Entrée par le lien de partage du tableau (et l'accès ouvert par son mot de passe). */
  readonly #share: { slug: string; token: string | null } | null;

  /** Serveur injoignable : les éléments gardés sur l'appareil, en lecture seule, sans salle (jamais renvoyés au serveur). */
  readonly detached: boolean;

  constructor(boardId: number, user: { id: number; name: string }, share: { slug: string; token: string | null } | null = null, kept: BoardElement[] | null = null) {
    this.boardId = boardId;
    this.#share = share;
    this.detached = kept !== null;
    this.awareness.setLocalStateField('user', { ...user, ...presenceColor(user.id) });
    if (kept !== null) {
      this.doc.transact(() => kept.forEach((element) => this.elements.set(element.id, element)), REMOTE);
      this.synced.value = true;
      return;
    }
    this.doc.on('update', this.#onLocalUpdate);
    this.awareness.on('update', this.#onAwarenessUpdate);
    this.#stops.push(realtime.on('board', this.#onMessage), realtime.on('open', this.#join));
    this.#join();
  }

  close(): void {
    this.#stops.forEach((stop) => stop());
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'local');
    if (!this.detached) realtime.sendBoard({ t: 'board.leave', boardId: this.boardId });
    this.awareness.destroy();
    this.doc.destroy();
  }

  readonly #join = (): void => {
    realtime.sendBoard({ t: 'board.join', boardId: this.boardId, stateVector: bytesToBase64(Y.encodeStateVector(this.doc)), ...(this.#share ? { share: this.#share } : {}) });
  };

  readonly #onLocalUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin !== REMOTE && this.canWrite.value) realtime.sendBoard({ t: 'board.update', boardId: this.boardId, update: bytesToBase64(update) });
  };

  readonly #onAwarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown): void => {
    if (origin === REMOTE) return;
    realtime.sendBoard({ t: 'board.awareness', boardId: this.boardId, update: bytesToBase64(encodeAwarenessUpdate(this.awareness, [...added, ...updated, ...removed])) });
  };

  readonly #onMessage = (message: BoardServerMessage): void => {
    if (!('boardId' in message) || message.boardId !== this.boardId) return;
    switch (message.t) {
      case 'board.sync': {
        this.canWrite.value = message.canWrite;
        Y.applyUpdate(this.doc, base64ToBytes(message.update), REMOTE);
        const missing = Y.encodeStateAsUpdate(this.doc, base64ToBytes(message.stateVector));
        if (message.canWrite && missing.length > 2) realtime.sendBoard({ t: 'board.update', boardId: this.boardId, update: bytesToBase64(missing) });
        if (message.awareness) applyAwarenessUpdate(this.awareness, base64ToBytes(message.awareness), REMOTE);
        this.awareness.setLocalStateField('user', this.awareness.getLocalState()?.user);
        this.synced.value = true;
        break;
      }
      case 'board.update':
        Y.applyUpdate(this.doc, base64ToBytes(message.update), REMOTE);
        break;
      case 'board.awareness':
        applyAwarenessUpdate(this.awareness, base64ToBytes(message.update), REMOTE);
        break;
      case 'board.saved':
        this.savedAt.value = message.at;
        break;
      case 'board.closed':
        if (message.reason === 'changed') {
          // Droits changés (partage modifié) : on se raccorde.
          this.#join();
          break;
        }
        this.closed.value = message.reason;
        this.canWrite.value = false;
        break;
    }
  };
}

/** Ce que l'éditeur lit d'une session : celle d'un tableau ouvert, ou une version figée de son historique. */
export type BoardSessionLike = Pick<BoardSession, 'boardId' | 'doc' | 'elements' | 'awareness' | 'synced' | 'canWrite' | 'savedAt' | 'closed'>;

/**
 * Tableau figé : une version de l'historique, affichée par le même éditeur, sans serveur ni écriture. `show` remplace
 * son contenu (on parcourt les versions sans recréer l'éditeur : la vue reste où elle est).
 */
export class BoardSnapshotSession implements BoardSessionLike {
  readonly boardId: number;
  readonly doc = new Y.Doc();
  readonly elements = this.doc.getMap<BoardElement>('elements');
  readonly awareness = new Awareness(this.doc);
  readonly synced = ref(true);
  readonly canWrite = ref(false);
  readonly savedAt = ref<string | null>(null);
  readonly closed = ref<'deleted' | 'revoked' | 'moved' | null>(null);

  constructor(boardId: number, elements: readonly BoardElement[] = []) {
    this.boardId = boardId;
    this.show(elements);
  }

  show(elements: readonly BoardElement[]): void {
    const next = new Map(elements.map((element) => [element.id, element]));
    this.doc.transact(() => {
      for (const key of [...this.elements.keys()]) if (!next.has(key)) this.elements.delete(key);
      for (const [id, element] of next) if (JSON.stringify(this.elements.get(id)) !== JSON.stringify(element)) this.elements.set(id, element);
    });
  }

  close(): void {
    this.awareness.destroy();
    this.doc.destroy();
  }
}
