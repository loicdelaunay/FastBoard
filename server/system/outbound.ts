import { X509Certificate } from 'node:crypto';
import https from 'node:https';
import tls from 'node:tls';

/**
 * Appels sortants du serveur (fournisseurs d'IA) : autorités de certification du système, certificat éventuellement non
 * vérifié, et message lisible quand la connexion échoue (au lieu du « fetch failed » de Node).
 */

/**
 * Ajoute aux autorités connues de Node celles du système (magasin de certificats de Windows, trousseau de macOS,
 * /etc/ssl sous Linux) : un fournisseur interne signé par l'autorité de l'entreprise, ou un proxy qui inspecte le HTTPS,
 * est alors reconnu comme dans le navigateur. Renvoie le nombre d'autorités ajoutées.
 */
export function trustSystemCertificates(): number {
  try {
    const current = tls.getCACertificates('default');
    // Un même certificat peut être écrit autrement par le système : on compare les empreintes.
    const known = new Set(current.map(fingerprint));
    const added = tls.getCACertificates('system').filter((certificate) => {
      const print = fingerprint(certificate);
      if (known.has(print)) return false;
      known.add(print);
      return true;
    });
    if (added.length) tls.setDefaultCACertificates([...current, ...added]);
    return added.length;
  } catch {
    // Node trop ancien ou magasin illisible : on garde les autorités de Node.
    return 0;
  }
}

function fingerprint(pem: string): string {
  try {
    return new X509Certificate(pem).fingerprint256;
  } catch {
    return pem.replace(/\s+/g, '');
  }
}

const UNKNOWN_AUTHORITY = new Set(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'SELF_SIGNED_CERT_IN_CHAIN', 'CERT_UNTRUSTED']);

const MESSAGES: Record<string, string> = {
  DEPTH_ZERO_SELF_SIGNED_CERT: 'certificat HTTPS auto-signé, non reconnu. Ajoutez-le aux certificats de confiance du système, ou désactivez « Vérifier le certificat HTTPS » pour ce fournisseur.',
  CERT_HAS_EXPIRED: 'le certificat HTTPS du fournisseur a expiré.',
  CERT_NOT_YET_VALID: 'le certificat HTTPS du fournisseur n’est pas encore valide (vérifiez l’heure du serveur).',
  ERR_TLS_CERT_ALTNAME_INVALID: 'le certificat HTTPS ne correspond pas à ce nom de serveur.',
  ECONNREFUSED: 'connexion refusée : rien n’écoute à cette adresse (port, HTTP ou HTTPS ?).',
  ENOTFOUND: 'nom de serveur introuvable.',
  EAI_AGAIN: 'nom de serveur introuvable.',
  ECONNRESET: 'connexion coupée, par le fournisseur ou par un pare-feu ou un proxy.',
  UND_ERR_SOCKET: 'connexion coupée, par le fournisseur ou par un pare-feu ou un proxy.',
  ETIMEDOUT: 'délai de connexion dépassé (pare-feu ou proxy ?).',
  UND_ERR_CONNECT_TIMEOUT: 'délai de connexion dépassé (pare-feu ou proxy ?).',
  ENETUNREACH: 'réseau inaccessible.',
  EHOSTUNREACH: 'serveur inaccessible.',
  EPROTO: 'échec de la négociation HTTPS : le serveur ne parle peut-être pas HTTPS sur ce port.',
  ERR_SSL_WRONG_VERSION_NUMBER: 'échec de la négociation HTTPS : le serveur ne parle peut-être pas HTTPS sur ce port.',
};
const UNKNOWN_AUTHORITY_MESSAGE =
  'certificat HTTPS signé par une autorité inconnue de ce serveur. Ajoutez-la aux certificats de confiance du système, ou désactivez « Vérifier le certificat HTTPS » pour ce fournisseur.';

/** Cause lisible d'un échec réseau (`fetch failed` cache la vraie raison dans `cause`). */
export function describeNetworkError(error: unknown): string {
  let current: unknown = error;
  // La raison la plus précise est au fond de la chaîne des causes.
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    const code = (current as NodeJS.ErrnoException).code;
    if (code && UNKNOWN_AUTHORITY.has(code)) return UNKNOWN_AUTHORITY_MESSAGE;
    if (code && MESSAGES[code]) return MESSAGES[code];
    if (!(current as Error & { cause?: unknown }).cause) break;
    current = (current as Error & { cause?: unknown }).cause;
  }
  const deepest = current instanceof Error ? current : error instanceof Error ? error : null;
  const code = deepest && (deepest as NodeJS.ErrnoException).code;
  const message = deepest?.message || String(error);
  return code && !message.includes(code) ? `${message} (${code})` : message;
}

export interface OutboundResponse {
  ok: boolean;
  status: number;
  text: string;
}

export interface OutboundRequest {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  /** `false` : accepte un certificat HTTPS que le système ne reconnaît pas (auto-signé). */
  verifyCertificate?: boolean;
}

/** Requête sortante : `fetch` d'ordinaire, `https.request` sans vérification du certificat si on l'a demandé. */
export async function outboundRequest(url: string, request: OutboundRequest = {}): Promise<OutboundResponse> {
  const { method = 'GET', headers = {}, body, signal, verifyCertificate = true } = request;
  if (verifyCertificate || !url.startsWith('https:')) {
    const response = await fetch(url, { method, headers, body, signal });
    return { ok: response.ok, status: response.status, text: await response.text() };
  }
  return new Promise<OutboundResponse>((resolve, reject) => {
    const outgoing = https.request(url, { method, headers: { ...headers, ...(body !== undefined ? { 'Content-Length': String(Buffer.byteLength(body)) } : {}) }, rejectUnauthorized: false, signal }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const status = response.statusCode ?? 0;
        resolve({ ok: status >= 200 && status < 300, status, text: Buffer.concat(chunks).toString('utf8') });
      });
      response.on('error', reject);
    });
    // Délai dépassé ou abandon : la même erreur qu'avec `fetch` (TimeoutError, AbortError).
    outgoing.on('error', (error) => reject(signal?.aborted ? signal.reason : error));
    if (body !== undefined) outgoing.write(body);
    outgoing.end();
  });
}
