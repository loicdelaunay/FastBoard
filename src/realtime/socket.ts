import { ref } from 'vue';
import type { ClientMessage, PresenceUser, ProjectEvent, ServerMessage } from '@shared/realtime';

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting';

export interface EventMeta {
  projectId: number;
  origin: string | null;
  actorId: number | null;
  at: string;
}

interface Handlers {
  event: Array<(event: ProjectEvent, meta: EventMeta) => void>;
  presence: Array<(projectId: number, users: PresenceUser[]) => void>;
  meRefresh: Array<() => void>;
  projectsRefresh: Array<() => void>;
  revoked: Array<(projectId: number) => void>;
  /** Reconnexion réussie : l'état local a pu manquer des évènements. */
  resync: Array<() => void>;
}

const BACKOFF = [500, 1000, 2000, 4000, 8000, 15000];
const PING_MS = 25_000;

/** Connexion WebSocket unique de l'application, avec reconnexion automatique et réabonnement au projet courant. */
class RealtimeClient {
  readonly state = ref<ConnectionState>('idle');
  #socket: WebSocket | null = null;
  #wanted = false;
  #attempt = 0;
  #retryTimer: number | null = null;
  #pingTimer: number | null = null;
  #projectId: number | null = null;
  #presence: { ticketId: number | null; view: string } = { ticketId: null, view: '' };
  #hasConnectedOnce = false;
  readonly #handlers: Handlers = { event: [], presence: [], meRefresh: [], projectsRefresh: [], revoked: [], resync: [] };

  on<K extends keyof Handlers>(type: K, handler: Handlers[K][number]): () => void {
    (this.#handlers[type] as Array<typeof handler>).push(handler);
    return () => {
      const list = this.#handlers[type] as Array<typeof handler>;
      const index = list.indexOf(handler);
      if (index >= 0) {
        list.splice(index, 1);
      }
    };
  }

  connect(): void {
    this.#wanted = true;
    if (this.#socket && this.#socket.readyState <= WebSocket.OPEN) {
      return;
    }
    this.#open();
  }

  disconnect(): void {
    this.#wanted = false;
    this.#projectId = null;
    this.#hasConnectedOnce = false;
    this.#clearTimers();
    this.#socket?.close();
    this.#socket = null;
    this.state.value = 'idle';
  }

  subscribe(projectId: number): void {
    this.#projectId = projectId;
    this.#sendSubscribe();
  }

  unsubscribe(): void {
    this.#projectId = null;
    this.#send({ t: 'unsubscribe' });
  }

  /** Indique ce que l'utilisateur consulte (ticket ouvert, vue) pour la présence des collègues. */
  setPresence(patch: Partial<{ ticketId: number | null; view: string }>): void {
    this.#presence = { ...this.#presence, ...patch };
    if (this.#projectId !== null) {
      this.#send({ t: 'presence', ticketId: this.#presence.ticketId, view: this.#presence.view });
    }
  }

  #open(): void {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    this.state.value = this.#hasConnectedOnce ? 'reconnecting' : 'connecting';
    const socket = new WebSocket(`${protocol}://${location.host}/ws`);
    this.#socket = socket;

    socket.onopen = () => {
      this.#attempt = 0;
      this.state.value = 'open';
      this.#pingTimer = window.setInterval(() => this.#send({ t: 'ping' }), PING_MS);
      this.#sendSubscribe();
      if (this.#hasConnectedOnce) {
        this.#handlers.resync.forEach((handler) => handler());
      }
      this.#hasConnectedOnce = true;
    };
    socket.onmessage = (message) => this.#onMessage(message.data);
    socket.onclose = () => {
      if (this.#socket !== socket) {
        return;
      }
      this.#clearTimers();
      this.#socket = null;
      if (this.#wanted) {
        this.state.value = 'reconnecting';
        const delay = BACKOFF[Math.min(this.#attempt, BACKOFF.length - 1)] ?? 15000;
        this.#attempt++;
        this.#retryTimer = window.setTimeout(() => this.#open(), delay);
      }
    };
    socket.onerror = () => socket.close();
  }

  #onMessage(raw: unknown): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(String(raw)) as ServerMessage;
    } catch {
      return;
    }
    switch (message.t) {
      case 'event': {
        const meta: EventMeta = { projectId: message.projectId, origin: message.origin, actorId: message.actorId, at: message.at };
        this.#handlers.event.forEach((handler) => handler(message.event, meta));
        break;
      }
      case 'presence':
        this.#handlers.presence.forEach((handler) => handler(message.projectId, message.users));
        break;
      case 'me.refresh':
        this.#handlers.meRefresh.forEach((handler) => handler());
        break;
      case 'projects.refresh':
        this.#handlers.projectsRefresh.forEach((handler) => handler());
        break;
      case 'project.revoked':
        if (message.projectId === this.#projectId) {
          this.#projectId = null;
        }
        this.#handlers.revoked.forEach((handler) => handler(message.projectId));
        break;
      default:
        break;
    }
  }

  #sendSubscribe(): void {
    if (this.#projectId !== null) {
      this.#send({ t: 'subscribe', projectId: this.#projectId });
      if (this.#presence.ticketId !== null || this.#presence.view) {
        this.#send({ t: 'presence', ticketId: this.#presence.ticketId, view: this.#presence.view });
      }
    }
  }

  #send(message: ClientMessage): void {
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#socket.send(JSON.stringify(message));
    }
  }

  #clearTimers(): void {
    if (this.#retryTimer !== null) {
      window.clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    }
    if (this.#pingTimer !== null) {
      window.clearInterval(this.#pingTimer);
      this.#pingTimer = null;
    }
  }
}

export const realtime = new RealtimeClient();
