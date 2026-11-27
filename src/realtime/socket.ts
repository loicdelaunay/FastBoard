import { ref } from 'vue';
import type { ClientMessage, PresenceUser, ProjectEvent, ServerMessage } from '@shared/realtime';
import type { NotificationLevel } from '@shared/constants';
import type { AppInfoDTO, NotificationDTO } from '@shared/types';
import type { SnapshotKind } from '@shared/snapshots';
import type { FavoriteSpaceDTO } from '@shared/home';
import type { HomeLayout } from '@shared/homeLayout';
import type { NotificationCategory, NotificationCounts } from '@shared/notificationCategories';

/** Messages de la documentation, traités par les écrans qui les attendent. */
export type DocServerMessage = Extract<ServerMessage, { t: `doc${string}` }>;
/** Messages des tableaux blancs. */
export type BoardServerMessage = Extract<ServerMessage, { t: `board${string}` }>;

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
  /** Espaces (documentation, tableaux blancs) accessibles changés : un groupe a été ajouté ou retiré. */
  spacesRefresh: Array<() => void>;
  /** Un groupe a été créé, modifié ou supprimé. */
  groupsChanged: Array<() => void>;
  revoked: Array<(projectId: number) => void>;
  /** Reconnexion réussie : l'état local a pu manquer des évènements. */
  resync: Array<() => void>;
  /** Connexion ouverte, la première comme les suivantes : ce qui a été envoyé avant est perdu. */
  open: Array<() => void>;
  app: Array<(info: AppInfoDTO) => void>;
  notification: Array<(notification: NotificationDTO, unread: number, counts: NotificationCounts) => void>;
  /** Notifications lues ailleurs : celles de `ids`, d'une catégorie, ou toutes (les deux `null`). */
  notificationsRead: Array<(unread: number, counts: NotificationCounts, ids: number[] | null, category: NotificationCategory | null) => void>;
  notificationsRemoved: Array<(ids: number[], unread: number, counts: NotificationCounts) => void>;
  /** Niveau de notification d'un projet changé (autre onglet, API). */
  notificationSettings: Array<(projectId: number, level: NotificationLevel) => void>;
  doc: Array<(message: DocServerMessage) => void>;
  board: Array<(message: BoardServerMessage) => void>;
  /** Espaces favoris de la personne changés ailleurs. */
  favorites: Array<(favorites: FavoriteSpaceDTO[]) => void>;
  /** Disposition de l'Accueil changée ailleurs (autre onglet, API). */
  homeLayout: Array<(layout: HomeLayout) => void>;
  /** Étiquettes d'un espace (ou d'un projet) posées ou retirées. */
  snapshots: Array<(kind: SnapshotKind, spaceId: number) => void>;
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
  /** « Mon tableau » : abonné aux évènements de tous les projets que l'on voit. */
  #mine = false;
  #presence: { ticketId: number | null; view: string } = { ticketId: null, view: '' };
  #hasConnectedOnce = false;
  /** Visiteur sans compte d'un tableau partagé : connexion limitée aux tableaux. */
  #guest = false;
  readonly #handlers: Handlers = { event: [], presence: [], meRefresh: [], projectsRefresh: [], spacesRefresh: [], groupsChanged: [], revoked: [], resync: [], open: [], app: [], notification: [], notificationsRead: [], notificationsRemoved: [], notificationSettings: [], doc: [], board: [], favorites: [], homeLayout: [], snapshots: [] };

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

  connect(options: { guest?: boolean } = {}): void {
    if (options.guest !== undefined && options.guest !== this.#guest && this.#socket) {
      // On passe de visiteur à compte (ou l'inverse) : nouvelle connexion.
      this.disconnect();
    }
    this.#guest = options.guest ?? false;
    this.#wanted = true;
    if (this.#socket && this.#socket.readyState <= WebSocket.OPEN) {
      return;
    }
    this.#open();
  }

  disconnect(): void {
    this.#wanted = false;
    this.#projectId = null;
    this.#mine = false;
    this.#hasConnectedOnce = false;
    this.#clearTimers();
    this.#socket?.close();
    this.#socket = null;
    this.state.value = 'idle';
  }

  subscribe(projectId: number): void {
    this.#projectId = projectId;
    this.#mine = false;
    this.#sendSubscribe();
  }

  /** « Mon tableau » : les évènements de tous les projets que l'on voit. */
  subscribeMine(): void {
    this.#projectId = null;
    this.#mine = true;
    this.#sendSubscribe();
  }

  unsubscribe(): void {
    this.#projectId = null;
    this.#mine = false;
    this.#send({ t: 'unsubscribe' });
  }

  /** Indique ce que l'utilisateur consulte (ticket ouvert, vue) pour la présence des collègues. */
  setPresence(patch: Partial<{ ticketId: number | null; view: string }>): void {
    this.#presence = { ...this.#presence, ...patch };
    if (this.#projectId !== null) {
      this.#send({ t: 'presence', ticketId: this.#presence.ticketId, view: this.#presence.view });
    }
  }

  /** Envoie un message de documentation (perdu hors connexion : l'évènement `open` relance les écrans concernés). */
  sendDoc(message: Extract<ClientMessage, { t: `doc${string}` }>): void {
    this.#send(message);
  }

  /** Le serveur répond de nouveau après une coupure : les écrans rechargent ce qu'ils montraient depuis l'appareil. */
  resync(): void {
    this.#handlers.resync.forEach((handler) => handler());
  }

  /** Envoie un message de tableau blanc (même règle que `sendDoc`). */
  sendBoard(message: Extract<ClientMessage, { t: `board${string}` }>): void {
    this.#send(message);
  }

  #open(): void {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    this.state.value = this.#hasConnectedOnce ? 'reconnecting' : 'connecting';
    const socket = new WebSocket(`${protocol}://${location.host}/ws${this.#guest ? '?guest=1' : ''}`);
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
      this.#handlers.open.forEach((handler) => handler());
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
      case 'spaces.refresh':
        this.#handlers.spacesRefresh.forEach((handler) => handler());
        break;
      case 'groups.changed':
        this.#handlers.groupsChanged.forEach((handler) => handler());
        break;
      case 'homeLayout.changed':
        this.#handlers.homeLayout.forEach((handler) => handler(message.layout));
        break;
      case 'favorites.changed':
        this.#handlers.favorites.forEach((handler) => handler(message.favorites));
        break;
      case 'snapshots.changed':
        this.#handlers.snapshots.forEach((handler) => handler(message.kind, message.spaceId));
        break;
      case 'app':
        this.#handlers.app.forEach((handler) => handler(message.app));
        break;
      case 'notification':
        this.#handlers.notification.forEach((handler) => handler(message.notification, message.unread, message.counts));
        break;
      case 'notifications.read':
        this.#handlers.notificationsRead.forEach((handler) => handler(message.unread, message.counts, message.ids, message.category));
        break;
      case 'notifications.removed':
        this.#handlers.notificationsRemoved.forEach((handler) => handler(message.ids, message.unread, message.counts));
        break;
      case 'notifications.settings':
        this.#handlers.notificationSettings.forEach((handler) => handler(message.projectId, message.level));
        break;
      case 'project.revoked':
        if (message.projectId === this.#projectId) {
          this.#projectId = null;
        }
        this.#handlers.revoked.forEach((handler) => handler(message.projectId));
        break;
      case 'docs.tree':
      case 'docs.access':
      case 'docs.revoked':
      case 'docs.comments':
      case 'doc.sync':
      case 'doc.update':
      case 'doc.awareness':
      case 'doc.saved':
      case 'doc.closed':
        this.#handlers.doc.forEach((handler) => handler(message));
        break;
      case 'boards.tree':
      case 'boards.access':
      case 'boards.revoked':
      case 'board.sync':
      case 'board.update':
      case 'board.awareness':
      case 'board.saved':
      case 'board.closed':
        this.#handlers.board.forEach((handler) => handler(message));
        break;
      default:
        break;
    }
  }

  #sendSubscribe(): void {
    if (this.#mine) {
      this.#send({ t: 'subscribe.mine' });
      return;
    }
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
