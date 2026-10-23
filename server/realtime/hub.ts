import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage, PresenceUser, ProjectEvent, ServerMessage } from '../../shared/realtime.ts';
import type { TokenInfoDTO } from '../../shared/types.ts';
import { authenticate } from '../auth/authenticate.ts';
import type { Actor, AppContext } from '../context.ts';
import { isAllowedOrigin } from '../http/origin.ts';
import { getAuthUser, resolveProjectAccess } from '../services/access.ts';

interface Client {
  ws: WebSocket;
  userId: number;
  /** Jeton d'API utilisé pour se connecter (null = session de l'interface). */
  token: TokenInfoDTO | null;
  projectId: number | null;
  ticketId: number | null;
  view: string;
  alive: boolean;
}

const HEARTBEAT_MS = 30_000;

/** Salles de collaboration : un client WebSocket suit au plus un projet à la fois. */
export class Hub {
  #ctx: AppContext | null = null;
  readonly #wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  readonly #clients = new Set<Client>();
  #heartbeat: NodeJS.Timeout | null = null;
  /** Messages échangés depuis le démarrage (supervision). */
  readonly traffic = { in: 0, out: 0 };

  get clientCount(): number {
    return this.#clients.size;
  }

  /** Accepte les connexions WebSocket d'un serveur HTTP ou HTTPS (plusieurs serveurs possibles). */
  attach(server: Server, ctx: AppContext): void {
    this.#ctx = ctx;
    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname !== '/ws') {
        socket.destroy();
        return;
      }
      const reject = (status: string): void => {
        socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
        socket.destroy();
      };
      if (!isAllowedOrigin(request, ctx.config)) {
        ctx.logger.warn('realtime', 'Connexion WebSocket refusée : origine non autorisée', { origin: request.headers.origin ?? null });
        reject('403 Forbidden');
        return;
      }
      const attempt = authenticate(ctx, request);
      if (attempt.kind === 'none' || attempt.kind === 'bad_token') {
        ctx.logger.debug('realtime', `Connexion WebSocket refusée : ${attempt.kind === 'bad_token' ? "jeton d'API invalide" : 'non authentifiée'}`);
        reject('401 Unauthorized');
        return;
      }
      const { user } = attempt;
      this.#wss.handleUpgrade(request, socket, head, (ws) => this.#onConnection(ws, user.id, user.token));
    });

    if (this.#heartbeat) return;
    this.#heartbeat = setInterval(() => {
      for (const client of this.#clients) {
        if (!client.alive) {
          client.ws.terminate();
          continue;
        }
        client.alive = false;
        client.ws.ping();
      }
    }, HEARTBEAT_MS);
    this.#heartbeat.unref();
  }

  #onConnection(ws: WebSocket, userId: number, token: TokenInfoDTO | null): void {
    const client: Client = { ws, userId, token, projectId: null, ticketId: null, view: '', alive: true };
    this.#clients.add(client);
    this.#ctx?.logger.debug('realtime', 'WebSocket connecté', { clients: this.#clients.size, via: token?.name ?? null }, userId);
    this.#send(client, { t: 'hello', userId });

    ws.on('pong', () => {
      client.alive = true;
    });
    ws.on('message', (raw) => this.#onMessage(client, raw.toString()));
    ws.on('close', () => {
      this.#clients.delete(client);
      this.#ctx?.logger.debug('realtime', 'WebSocket déconnecté', { clients: this.#clients.size }, userId);
      if (client.projectId !== null) {
        this.#broadcastPresence(client.projectId);
      }
    });
    ws.on('error', () => ws.terminate());
  }

  #onMessage(client: Client, raw: string): void {
    this.traffic.in += 1;
    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      this.#send(client, { t: 'error', message: 'Message invalide.' });
      return;
    }

    switch (message.t) {
      case 'ping':
        this.#send(client, { t: 'pong' });
        break;
      case 'subscribe':
        this.#subscribe(client, message.projectId);
        break;
      case 'unsubscribe':
        this.#leaveProject(client);
        break;
      case 'presence': {
        if (client.projectId === null) {
          break;
        }
        client.ticketId = typeof message.ticketId === 'number' ? message.ticketId : null;
        client.view = typeof message.view === 'string' ? message.view.slice(0, 20) : '';
        this.#broadcastPresence(client.projectId);
        break;
      }
      default:
        break;
    }
  }

  #subscribe(client: Client, projectId: unknown): void {
    const ctx = this.#ctx;
    if (!ctx || typeof projectId !== 'number' || !Number.isInteger(projectId)) {
      return;
    }
    const user = getAuthUser(ctx.db, client.userId);
    if (user) {
      user.token = client.token;
    }
    if (!user || !user.isActive || !resolveProjectAccess(ctx.db, user, projectId)) {
      this.#send(client, { t: 'project.revoked', projectId });
      return;
    }
    const previous = client.projectId;
    client.projectId = projectId;
    client.ticketId = null;
    client.view = '';
    this.#send(client, { t: 'subscribed', projectId });
    if (previous !== null && previous !== projectId) {
      this.#broadcastPresence(previous);
    }
    this.#broadcastPresence(projectId);
  }

  #leaveProject(client: Client): void {
    const previous = client.projectId;
    client.projectId = null;
    client.ticketId = null;
    client.view = '';
    if (previous !== null) {
      this.#broadcastPresence(previous);
    }
  }

  /** Diffuse des évènements à tous les clients abonnés au projet. */
  publish(projectId: number, events: ProjectEvent[], actor: Actor): void {
    const at = new Date().toISOString();
    for (const event of events) {
      const message: ServerMessage = { t: 'event', projectId, event, origin: actor.origin, actorId: actor.userId, at };
      const payload = JSON.stringify(message);
      for (const client of this.#clients) {
        if (client.projectId === projectId && client.ws.readyState === client.ws.OPEN) {
          client.ws.send(payload);
          this.traffic.out += 1;
        }
      }
    }
  }

  /** Envoie un message à toutes les connexions (nom de l'application, maintenance…). */
  broadcast(message: ServerMessage): void {
    for (const client of this.#clients) {
      this.#send(client, message);
    }
  }

  /** Envoie un message à toutes les connexions d'un utilisateur (notifications). */
  sendToUser(userId: number, message: ServerMessage): void {
    for (const client of this.#clients) {
      if (client.userId === userId) this.#send(client, message);
    }
  }

  /** Demande aux clients de ces utilisateurs de recharger leur profil / permissions. */
  refreshUsers(userIds: Iterable<number>): void {
    const targets = new Set(userIds);
    for (const client of this.#clients) {
      if (targets.has(client.userId)) {
        this.#send(client, { t: 'me.refresh' });
      }
    }
  }

  refreshEveryone(): void {
    for (const client of this.#clients) {
      this.#send(client, { t: 'me.refresh' });
    }
  }

  refreshProjectLists(userIds: Iterable<number>): void {
    const targets = new Set(userIds);
    for (const client of this.#clients) {
      if (targets.has(client.userId)) {
        this.#send(client, { t: 'projects.refresh' });
      }
    }
  }

  /** Retire un utilisateur d'un projet (perte d'accès). */
  revokeProject(projectId: number, userId: number): void {
    for (const client of this.#clients) {
      if (client.userId === userId && client.projectId === projectId) {
        this.#send(client, { t: 'project.revoked', projectId });
        this.#leaveProject(client);
      }
    }
  }

  /** Retire tous les clients d'un projet supprimé. */
  closeProject(projectId: number): void {
    for (const client of this.#clients) {
      if (client.projectId === projectId) {
        this.#send(client, { t: 'project.revoked', projectId });
        client.projectId = null;
        client.ticketId = null;
      }
    }
  }

  /** Coupe les connexions ouvertes avec un jeton qui vient d'être révoqué. */
  disconnectToken(tokenId: number): void {
    for (const client of this.#clients) {
      if (client.token?.id === tokenId) {
        client.ws.close(4001, 'Jeton révoqué');
      }
    }
  }

  disconnectUser(userId: number): void {
    for (const client of this.#clients) {
      if (client.userId === userId) {
        client.ws.close(4001, 'Session terminée');
      }
    }
  }

  onlineUserIds(): number[] {
    return [...new Set([...this.#clients].map((client) => client.userId))];
  }

  presence(projectId: number): PresenceUser[] {
    const byUser = new Map<number, PresenceUser>();
    for (const client of this.#clients) {
      if (client.projectId !== projectId) {
        continue;
      }
      const entry = byUser.get(client.userId) ?? { userId: client.userId, ticketIds: [], views: [] };
      if (client.ticketId !== null && !entry.ticketIds.includes(client.ticketId)) {
        entry.ticketIds.push(client.ticketId);
      }
      if (client.view && !entry.views.includes(client.view)) {
        entry.views.push(client.view);
      }
      byUser.set(client.userId, entry);
    }
    return [...byUser.values()];
  }

  #broadcastPresence(projectId: number): void {
    const message: ServerMessage = { t: 'presence', projectId, users: this.presence(projectId) };
    const payload = JSON.stringify(message);
    for (const client of this.#clients) {
      if (client.projectId === projectId && client.ws.readyState === client.ws.OPEN) {
        client.ws.send(payload);
        this.traffic.out += 1;
      }
    }
  }

  #send(client: Client, message: ServerMessage): void {
    if (client.ws.readyState === client.ws.OPEN) {
      client.ws.send(JSON.stringify(message));
      this.traffic.out += 1;
    }
  }

  close(): void {
    if (this.#heartbeat) {
      clearInterval(this.#heartbeat);
    }
    for (const client of this.#clients) {
      client.ws.terminate();
    }
    this.#clients.clear();
    this.#wss.close();
  }
}
