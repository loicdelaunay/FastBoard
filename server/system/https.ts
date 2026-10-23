import { X509Certificate, createPrivateKey } from 'node:crypto';
import fs from 'node:fs';
import type { RequestListener } from 'node:http';
import https from 'node:https';
import path from 'node:path';
import tls from 'node:tls';
import type { NextFunction, Request, Response } from 'express';
import { defaultHttpsSettings, type CertificateFormat, type CertificateInfoDTO, type HttpsSettingsDTO, type HttpsStatusDTO } from '../../shared/https.ts';
import type { AppContext } from '../context.ts';
import { nowIso } from '../db/database.ts';
import { appRoot } from '../runtime.ts';
import { readSetting, writeSetting } from '../services/appSettings.ts';
import { createSelfSignedCertificate } from './selfSigned.ts';

/**
 * HTTPS intégré : FastBoard sert le site en HTTPS sur un second port avec les certificats indiqués par l'administrateur
 * (PEM ou PFX), relus automatiquement quand les fichiers changent (renouvellement Let's Encrypt, win-acme…).
 * Le port HTTP reste ouvert : il redirige vers HTTPS si on le souhaite, sauf depuis la machine elle-même (accès de secours).
 */

interface StoredHttps extends Omit<HttpsSettingsDTO, 'hasPassphrase'> {
  /** Mot de passe de la clé ou du PFX, chiffré (SecretBox). */
  passphrase: string | null;
}

const CHECK_FILES_MS = 60_000;

function stored(ctx: AppContext): StoredHttps {
  const defaults = defaultHttpsSettings();
  const value = readSetting<Partial<StoredHttps>>(ctx.db, 'https') ?? {};
  const text = (key: 'certPath' | 'keyPath' | 'caPath' | 'pfxPath') => (typeof value[key] === 'string' ? value[key] : '');
  const flag = (key: 'enabled' | 'redirectHttp' | 'hsts' | 'trustProxy') => (typeof value[key] === 'boolean' ? value[key] : defaults[key]);
  return {
    enabled: flag('enabled'),
    port: typeof value.port === 'number' && Number.isInteger(value.port) && value.port > 0 && value.port < 65_536 ? value.port : defaults.port,
    format: value.format === 'pfx' ? 'pfx' : 'pem',
    certPath: text('certPath'),
    keyPath: text('keyPath'),
    caPath: text('caPath'),
    pfxPath: text('pfxPath'),
    passphrase: typeof value.passphrase === 'string' ? value.passphrase : null,
    redirectHttp: flag('redirectHttp'),
    hsts: flag('hsts'),
    hstsMaxAgeDays: typeof value.hstsMaxAgeDays === 'number' && value.hstsMaxAgeDays >= 1 ? Math.min(730, Math.round(value.hstsMaxAgeDays)) : defaults.hstsMaxAgeDays,
    trustProxy: flag('trustProxy'),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
  };
}

export function httpsSettingsDTO(ctx: AppContext): HttpsSettingsDTO {
  const { passphrase, ...rest } = stored(ctx);
  return { ...rest, hasPassphrase: passphrase !== null };
}

export interface HttpsInput extends Omit<HttpsSettingsDTO, 'hasPassphrase' | 'updatedAt'> {
  /** `undefined` garde le mot de passe actuel, chaîne vide l'efface. */
  passphrase?: string;
}

export function saveHttpsSettings(ctx: AppContext, input: HttpsInput): HttpsSettingsDTO {
  const current = stored(ctx);
  const { passphrase: typed, ...rest } = input;
  const passphrase = typed === undefined ? current.passphrase : typed ? ctx.secrets.seal(typed) : null;
  writeSetting(ctx.db, 'https', { ...rest, passphrase, updatedAt: nowIso() } satisfies StoredHttps);
  return httpsSettingsDTO(ctx);
}

/** Mot de passe à utiliser : celui saisi, sinon celui enregistré. */
export function passphraseFor(ctx: AppContext, typed: string | undefined): string | null {
  if (typed) return typed;
  const value = stored(ctx).passphrase;
  return value ? ctx.secrets.open(value) : null;
}

/** Chemin absolu (les chemins relatifs partent du dossier de FastBoard). */
export function resolveCertPath(file: string): string {
  return path.resolve(appRoot(), file.trim());
}

function readFile(file: string, what: string): Buffer {
  if (!file.trim()) throw new Error(`Indiquez le chemin du fichier ${what}.`);
  const full = resolveCertPath(file);
  try {
    return fs.readFileSync(full);
  } catch (error) {
    throw new Error(`Fichier ${what} illisible (${full}) : ${(error as NodeJS.ErrnoException).code === 'ENOENT' ? 'introuvable' : (error as Error).message}`);
  }
}

export function certificateInfo(certificate: X509Certificate, now = Date.now()): CertificateInfoDTO {
  const validTo = new Date(certificate.validTo);
  return {
    subject: certificate.subject.replace(/\n/g, ', '),
    issuer: certificate.issuer.replace(/\n/g, ', '),
    altNames: (certificate.subjectAltName ?? '').split(/,\s*/).map((entry) => entry.replace(/^(DNS|IP Address):/, '')).filter(Boolean),
    validFrom: new Date(certificate.validFrom).toISOString(),
    validTo: validTo.toISOString(),
    daysLeft: Math.floor((validTo.getTime() - now) / 86_400_000),
    selfSigned: certificate.subject === certificate.issuer && certificate.verify(certificate.publicKey),
    fingerprint: certificate.fingerprint256,
  };
}

export interface TlsMaterial {
  options: tls.SecureContextOptions;
  certificate: CertificateInfoDTO | null;
  /** Fichiers lus : surveillés pour recharger les certificats renouvelés. */
  files: string[];
}

/** Lit et vérifie les certificats (clé correspondant au certificat, mot de passe, format). */
export function loadTls(settings: { format: CertificateFormat; certPath: string; keyPath: string; caPath: string; pfxPath: string }, passphrase: string | null): TlsMaterial {
  let options: tls.SecureContextOptions;
  let files: string[];
  if (settings.format === 'pfx') {
    options = { pfx: readFile(settings.pfxPath, 'PFX'), ...(passphrase ? { passphrase } : {}) };
    files = [settings.pfxPath];
  } else {
    const cert = readFile(settings.certPath, 'du certificat');
    const key = readFile(settings.keyPath, 'de la clé privée');
    const ca = settings.caPath.trim() ? readFile(settings.caPath, 'des certificats intermédiaires') : undefined;
    let x509: X509Certificate;
    try {
      x509 = new X509Certificate(cert);
    } catch {
      throw new Error('Le fichier du certificat n’est pas un certificat PEM valide.');
    }
    let privateKey;
    try {
      privateKey = createPrivateKey({ key, ...(passphrase ? { passphrase } : {}) });
    } catch (error) {
      throw new Error(/passphrase|decrypt|bad decrypt/i.test((error as Error).message) ? 'Clé privée chiffrée : mot de passe absent ou incorrect.' : 'La clé privée n’est pas une clé PEM valide.');
    }
    if (!x509.checkPrivateKey(privateKey)) throw new Error('La clé privée ne correspond pas au certificat.');
    options = { cert, key, ...(ca ? { ca } : {}), ...(passphrase ? { passphrase } : {}) };
    files = [settings.certPath, settings.keyPath, ...(ca ? [settings.caPath] : [])];
  }
  let context: tls.SecureContext;
  try {
    context = tls.createSecureContext(options);
  } catch (error) {
    const message = (error as Error).message;
    throw new Error(settings.format === 'pfx' && /mac verify|password|decrypt/i.test(message) ? 'PFX illisible : mot de passe absent ou incorrect.' : `Certificat refusé : ${message}`);
  }
  // Le certificat effectivement servi (aussi pour un PFX).
  const der = (context as unknown as { context?: { getCertificate?: () => Buffer | null } }).context?.getCertificate?.();
  let certificate: CertificateInfoDTO | null = null;
  try {
    certificate = der ? certificateInfo(new X509Certificate(der)) : null;
  } catch {
    certificate = null;
  }
  return { options, certificate, files: files.map(resolveCertPath) };
}

/** Crée un certificat auto-signé dans le dossier des données (`certs/`) et retourne ses chemins. */
export function writeSelfSigned(ctx: AppContext, hostnames: string[]): { certPath: string; keyPath: string; certificate: CertificateInfoDTO } {
  const dir = ctx.config.dbPath === ':memory:' ? path.join(ctx.uploadsDir, 'certs') : path.join(path.dirname(path.resolve(ctx.config.dbPath)), 'certs');
  fs.mkdirSync(dir, { recursive: true });
  const { cert, key } = createSelfSignedCertificate(hostnames);
  const certPath = path.join(dir, 'fastboard-auto-signe.crt');
  const keyPath = path.join(dir, 'fastboard-auto-signe.key');
  fs.writeFileSync(certPath, cert);
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  return { certPath, keyPath, certificate: certificateInfo(new X509Certificate(cert)) };
}

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/** Serveur HTTPS optionnel, piloté par les réglages d'administration (appliqués sans redémarrer). */
export class HttpsManager {
  #server: https.Server | null = null;
  #port: number | null = null;
  #error: string | null = null;
  #certificate: CertificateInfoDTO | null = null;
  #loadedAt: string | null = null;
  #mtimes = new Map<string, number>();
  #timer: NodeJS.Timeout | null = null;
  /** Réglages en vigueur (lus par l'intergiciel de redirection à chaque requête). */
  settings: StoredHttps;
  /** Port HTTP effectivement ouvert (renseigné au démarrage). */
  httpPort = 0;
  readonly disabledByEnv = process.env.FASTBOARD_HTTPS === '0';

  readonly #ctx: AppContext;
  readonly #handler: RequestListener;
  readonly #onServer: (server: https.Server) => void;
  readonly #onSettings: (settings: StoredHttps) => void;

  constructor(ctx: AppContext, handler: RequestListener, onServer: (server: https.Server) => void, onSettings: (settings: StoredHttps) => void) {
    this.#ctx = ctx;
    this.#handler = handler;
    this.#onServer = onServer;
    this.#onSettings = onSettings;
    this.settings = stored(ctx);
    onSettings(this.settings);
  }

  get listening(): boolean {
    return this.#server !== null;
  }

  get port(): number | null {
    return this.#port;
  }

  /** Applique les réglages enregistrés : démarre, recharge les certificats, change de port ou arrête HTTPS. */
  async apply(): Promise<void> {
    this.settings = stored(this.#ctx);
    this.#onSettings(this.settings);
    if (!this.settings.enabled || this.disabledByEnv) {
      await this.#stop();
      this.#error = null;
      this.#certificate = null;
      return;
    }
    let material: TlsMaterial;
    try {
      material = loadTls(this.settings, this.settings.passphrase ? this.#ctx.secrets.open(this.settings.passphrase) : null);
    } catch (error) {
      // Certificats illisibles : un serveur déjà démarré garde ses anciens certificats.
      this.#error = (error as Error).message;
      this.#ctx.logger.error('system', `HTTPS : ${this.#error}`);
      return;
    }
    if (this.#server && this.#port === this.settings.port) {
      this.#server.setSecureContext(material.options);
    } else {
      await this.#stop();
      const server = https.createServer(material.options, this.#handler);
      this.#onServer(server);
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(this.settings.port, this.#ctx.config.host, () => resolve());
        });
      } catch (error) {
        this.#error = (error as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `Le port ${this.settings.port} est déjà utilisé.` : (error as NodeJS.ErrnoException).code === 'EACCES' ? `Droits insuffisants pour écouter sur le port ${this.settings.port}.` : (error as Error).message;
        this.#ctx.logger.error('system', `HTTPS : ${this.#error}`);
        return;
      }
      this.#server = server;
      this.#port = (server.address() as { port: number }).port;
      this.#ctx.logger.info('system', `HTTPS actif sur le port ${this.#port}`);
    }
    this.#certificate = material.certificate;
    this.#loadedAt = nowIso();
    this.#error = null;
    this.#mtimes = new Map(material.files.map((file) => [file, mtimeOf(file)]));
    this.#watch();
  }

  /** Recharge les certificats quand un fichier a changé (renouvellement automatique). */
  #watch(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => {
      if (!this.#server) return;
      const changed = [...this.#mtimes].some(([file, mtime]) => mtimeOf(file) !== mtime);
      if (changed) {
        this.#ctx.logger.info('system', 'HTTPS : certificats modifiés sur le disque, rechargement');
        void this.apply();
      }
    }, CHECK_FILES_MS);
    this.#timer.unref();
  }

  async #stop(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    this.#port = null;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    this.#ctx.logger.info('system', 'HTTPS arrêté');
  }

  status(requestSecure: boolean): HttpsStatusDTO {
    return {
      httpPort: this.httpPort,
      https: { listening: this.listening, port: this.#port, error: this.#error, certificate: this.#certificate, loadedAt: this.#loadedAt },
      requestSecure,
      disabledByEnv: this.disabledByEnv,
    };
  }

  async close(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.#stop();
  }

  /** HSTS sur les réponses HTTPS et redirection HTTP → HTTPS (jamais pour la machine elle-même ni le test de santé). */
  middleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
      const settings = this.settings;
      // HTTPS servi par FastBoard, ou par un proxy inverse qui transmet X-Forwarded-Proto.
      if (!(settings.enabled && this.listening) && !settings.trustProxy) return next();
      if (req.secure && settings.hsts) {
        res.setHeader('Strict-Transport-Security', `max-age=${settings.hstsMaxAgeDays * 86_400}`);
      }
      if (settings.redirectHttp && !req.secure && !isLoopback(req.socket.remoteAddress) && req.path !== '/api/health') {
        // Derrière un proxy inverse, HTTPS est servi par le proxy sur le port standard.
        const port = settings.trustProxy || this.#port === 443 || this.#port === null ? '' : `:${this.#port}`;
        res.redirect(308, `https://${req.hostname}${port}${req.originalUrl}`);
        return;
      }
      next();
    };
  }
}

function mtimeOf(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return -1;
  }
}
