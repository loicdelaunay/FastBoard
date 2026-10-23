/** Accès HTTP / HTTPS : certificats, redirection, HSTS et proxy inverse (onglet d'administration « HTTP / HTTPS »). */

export type CertificateFormat = 'pem' | 'pfx';

export interface HttpsSettingsDTO {
  /** Sert aussi le site en HTTPS (en plus du port HTTP). */
  enabled: boolean;
  /** Port HTTPS (443 en production, 3443 par défaut pour ne pas exiger de droits administrateur). */
  port: number;
  format: CertificateFormat;
  /** Certificat PEM (chaîne complète conseillée : `fullchain.pem`). */
  certPath: string;
  /** Clé privée PEM. */
  keyPath: string;
  /** Certificats intermédiaires PEM, si le certificat ne contient pas la chaîne (facultatif). */
  caPath: string;
  /** Fichier PKCS#12 (`.pfx` / `.p12`) contenant le certificat et sa clé. */
  pfxPath: string;
  /** Un mot de passe de clé / PFX est enregistré (chiffré, jamais renvoyé). */
  hasPassphrase: boolean;
  /** Les visites en HTTP sont redirigées vers HTTPS (sauf depuis la machine elle-même, pour garder un accès de secours). */
  redirectHttp: boolean;
  /** En-tête Strict-Transport-Security : le navigateur n'utilise plus que HTTPS pour ce site. */
  hsts: boolean;
  hstsMaxAgeDays: number;
  /** Derrière un proxy inverse (nginx, IIS, Caddy, Traefik…) qui termine le TLS : faire confiance à X-Forwarded-*. */
  trustProxy: boolean;
  updatedAt: string | null;
}

export interface CertificateInfoDTO {
  subject: string;
  issuer: string;
  /** Noms couverts (subjectAltName). */
  altNames: string[];
  validFrom: string;
  validTo: string;
  daysLeft: number;
  selfSigned: boolean;
  fingerprint: string;
}

export interface HttpsStatusDTO {
  httpPort: number;
  https: {
    listening: boolean;
    port: number | null;
    /** Dernière erreur (certificat illisible, port occupé…). */
    error: string | null;
    certificate: CertificateInfoDTO | null;
    /** Dernier chargement des certificats (ils sont relus automatiquement quand les fichiers changent). */
    loadedAt: string | null;
  };
  /** La page d'administration est consultée en HTTPS. */
  requestSecure: boolean;
  /** `FASTBOARD_HTTPS=0` : réglages ignorés au démarrage (secours). */
  disabledByEnv: boolean;
}

export const DEFAULT_HTTPS_PORT = 3443;

export function defaultHttpsSettings(): HttpsSettingsDTO {
  return {
    enabled: false,
    port: DEFAULT_HTTPS_PORT,
    format: 'pem',
    certPath: '',
    keyPath: '',
    caPath: '',
    pfxPath: '',
    hasPassphrase: false,
    redirectHttp: false,
    hsts: false,
    hstsMaxAgeDays: 180,
    trustProxy: false,
    updatedAt: null,
  };
}
