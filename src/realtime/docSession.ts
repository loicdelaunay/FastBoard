import { ref } from 'vue';
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { base64ToBytes, bytesToBase64 } from '@shared/docs';
import { realtime, type DocServerMessage } from './socket';

/** Personne vue dans un document : les couleurs servent à son curseur. */
export interface DocPresence {
  id: number;
  name: string;
  color: string;
  colorLight: string;
}

const REMOTE = 'remote';
const PALETTE = ['#4f8cff', '#a95cff', '#ff6fa7', '#f59e0b', '#22c55e', '#06b6d4', '#ef4444', '#8b5cf6'];

/** Couleur stable d'une personne. */
export function presenceColor(userId: number): { color: string; colorLight: string } {
  const color = PALETTE[userId % PALETTE.length]!;
  return { color, colorLight: `${color}33` };
}

/**
 * Lien entre un fichier ouvert et sa salle sur le serveur : le document Yjs local reçoit les écritures des autres et
 * leur envoie les nôtres, avec les curseurs. Après une coupure, il se raccorde et renvoie ce qui a été écrit hors ligne.
 */
export class DocSession {
  readonly nodeId: number;
  readonly doc = new Y.Doc();
  readonly text = this.doc.getText('content');
  readonly awareness = new Awareness(this.doc);
  /** Le texte du serveur est arrivé. */
  readonly synced = ref(false);
  readonly canWrite = ref(false);
  readonly savedAt = ref<string | null>(null);
  /** Fichier supprimé ou accès retiré pendant l'édition. */
  readonly closed = ref<'deleted' | 'revoked' | null>(null);
  readonly #stops: Array<() => void> = [];

  constructor(nodeId: number, user: Pick<DocPresence, 'id' | 'name'>) {
    this.nodeId = nodeId;
    this.awareness.setLocalStateField('user', { ...user, ...presenceColor(user.id) });
    this.doc.on('update', this.#onLocalUpdate);
    this.awareness.on('update', this.#onAwarenessUpdate);
    this.#stops.push(realtime.on('doc', this.#onMessage), realtime.on('open', this.#join));
    this.#join();
  }

  /** Quitte la salle et libère le document. */
  close(): void {
    this.#stops.forEach((stop) => stop());
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'local');
    realtime.sendDoc({ t: 'doc.leave', nodeId: this.nodeId });
    this.awareness.destroy();
    this.doc.destroy();
  }

  readonly #join = (): void => {
    realtime.sendDoc({ t: 'doc.join', nodeId: this.nodeId, stateVector: bytesToBase64(Y.encodeStateVector(this.doc)) });
  };

  readonly #onLocalUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin !== REMOTE && this.canWrite.value) realtime.sendDoc({ t: 'doc.update', nodeId: this.nodeId, update: bytesToBase64(update) });
  };

  readonly #onAwarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown): void => {
    if (origin === REMOTE) return;
    realtime.sendDoc({ t: 'doc.awareness', nodeId: this.nodeId, update: bytesToBase64(encodeAwarenessUpdate(this.awareness, [...added, ...updated, ...removed])) });
  };

  readonly #onMessage = (message: DocServerMessage): void => {
    if (!('nodeId' in message) || message.nodeId !== this.nodeId) return;
    switch (message.t) {
      case 'doc.sync': {
        this.canWrite.value = message.canWrite;
        Y.applyUpdate(this.doc, base64ToBytes(message.update), REMOTE);
        // Ce que le serveur n'a pas encore : écritures faites pendant une coupure.
        const missing = Y.encodeStateAsUpdate(this.doc, base64ToBytes(message.stateVector));
        if (message.canWrite && missing.length > 2) realtime.sendDoc({ t: 'doc.update', nodeId: this.nodeId, update: bytesToBase64(missing) });
        if (message.awareness) applyAwarenessUpdate(this.awareness, base64ToBytes(message.awareness), REMOTE);
        this.awareness.setLocalStateField('user', this.awareness.getLocalState()?.user);
        this.synced.value = true;
        break;
      }
      case 'doc.update':
        Y.applyUpdate(this.doc, base64ToBytes(message.update), REMOTE);
        break;
      case 'doc.awareness':
        applyAwarenessUpdate(this.awareness, base64ToBytes(message.update), REMOTE);
        break;
      case 'doc.saved':
        this.savedAt.value = message.at;
        break;
      case 'doc.closed':
        this.closed.value = message.reason;
        this.canWrite.value = false;
        break;
    }
  };
}
