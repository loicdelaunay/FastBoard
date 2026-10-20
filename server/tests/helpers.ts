import WebSocket from 'ws';
import type { ServerMessage } from '../../shared/realtime.ts';
import { startServer, type RunningServer } from '../app.ts';

export interface ApiResult<T = any> {
  status: number;
  body: T;
}

/** Client HTTP minimal avec jar de cookies, pour tester l'API comme un navigateur. */
export class TestClient {
  readonly base: string;
  cookie = '';
  /** En-têtes ajoutés à chaque requête (ex. Authorization pour un jeton d'API). */
  defaults: Record<string, string> = {};

  constructor(base: string) {
    this.base = base;
  }

  async request<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResult<T>> {
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...this.defaults,
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      const pair = setCookie.split(';')[0] ?? '';
      this.cookie = pair.endsWith('=') ? '' : pair;
    }
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: response.status, body: parsed as T };
  }

  /** Envoie un corps binaire brut (envoi de fichier) et retourne la réponse complète. */
  async raw(method: string, path: string, body?: Uint8Array, headers: Record<string, string> = {}): Promise<{ status: number; headers: Headers; bytes: Buffer; json: any }> {
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: { ...(this.cookie ? { Cookie: this.cookie } : {}), ...this.defaults, ...headers },
      body,
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    let json: unknown = null;
    try {
      json = JSON.parse(bytes.toString('utf8'));
    } catch {
      /* corps non JSON */
    }
    return { status: response.status, headers: response.headers, bytes, json };
  }

  get = <T = any>(path: string) => this.request<T>('GET', path);
  post = <T = any>(path: string, body?: unknown, headers?: Record<string, string>) => this.request<T>('POST', path, body ?? {}, headers);
  patch = <T = any>(path: string, body?: unknown) => this.request<T>('PATCH', path, body ?? {});
  put = <T = any>(path: string, body?: unknown) => this.request<T>('PUT', path, body ?? {});
  del = <T = any>(path: string) => this.request<T>('DELETE', path);

  /** Passe ce client en authentification par jeton d'API (sans cookie). */
  useToken(secret: string): this {
    this.cookie = '';
    this.defaults = { Authorization: `Bearer ${secret}` };
    return this;
  }

  async login(email: string, password: string): Promise<ApiResult> {
    return this.post('/api/auth/login', { email, password });
  }

  /** Ouvre une connexion WebSocket authentifiée par le cookie de session. */
  async connect(): Promise<SocketProbe> {
    const url = this.base.replace('http', 'ws') + '/ws';
    const ws = new WebSocket(url, { headers: { ...(this.cookie ? { Cookie: this.cookie } : {}), ...this.defaults } });
    const probe = new SocketProbe(ws);
    await probe.opened;
    return probe;
  }
}

export class SocketProbe {
  readonly ws: WebSocket;
  readonly messages: ServerMessage[] = [];
  readonly opened: Promise<void>;
  #waiters: Array<{ predicate: (message: ServerMessage) => boolean; resolve: (message: ServerMessage) => void }> = [];

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.opened = new Promise((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
      ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    });
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as ServerMessage;
      this.messages.push(message);
      this.#waiters = this.#waiters.filter((waiter) => {
        if (waiter.predicate(message)) {
          waiter.resolve(message);
          return false;
        }
        return true;
      });
    });
  }

  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  /** Attend (ou retrouve) un message vérifiant le prédicat. */
  waitFor(predicate: (message: ServerMessage) => boolean, timeoutMs = 3000): Promise<ServerMessage> {
    const existing = this.messages.find(predicate);
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Délai dépassé en attendant un message WebSocket')), timeoutMs);
      this.#waiters.push({
        predicate,
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
      });
    });
  }

  close(): void {
    this.ws.terminate();
  }
}

export async function bootServer(): Promise<{ running: RunningServer; base: string; client: () => TestClient }> {
  const running = await startServer({ port: 0, host: '127.0.0.1', dbPath: ':memory:', loginRateLimit: null, apiRateLimit: null, logToConsole: false });
  const base = `http://127.0.0.1:${running.port}`;
  return { running, base, client: () => new TestClient(base) };
}
