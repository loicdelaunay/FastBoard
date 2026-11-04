/** Connexion par annuaire LDAP : réglages de l'onglet Administration → Authentification et résultat du test. */

/**
 * `classic` : recherche de la personne puis vérification de son mot de passe, nom lu tel quel dans l'annuaire.
 * `specific` : même principe avec un compte de service obligatoire, et un nom écrit « NOM, Prénom (Société) ».
 */
export const LDAP_PROFILES = ['classic', 'specific'] as const;
export type LdapProfile = (typeof LDAP_PROFILES)[number];

/** `none` : LDAP en clair ; `ldaps` : TLS dès la connexion ; `starttls` : passage en TLS après la connexion. */
export const LDAP_SECURITY = ['none', 'ldaps', 'starttls'] as const;
export type LdapSecurity = (typeof LDAP_SECURITY)[number];

/** Marque, dans le filtre de recherche, l'identifiant saisi sur la page de connexion. */
export const LDAP_USER_TOKEN = '{user}';

export interface LdapFields {
  enabled: boolean;
  profile: LdapProfile;
  host: string;
  port: number;
  security: LdapSecurity;
  /** Refuse un certificat de serveur non reconnu (LDAPS, StartTLS). */
  verifyCertificate: boolean;
  /** Autorité de certification interne (fichier PEM sur le serveur), facultative. */
  caPath: string;
  timeoutSeconds: number;
  /** Compte de service utilisé pour chercher la personne (vide : recherche anonyme, profil classique). */
  bindDn: string;
  searchBase: string;
  /** Filtre LDAP ; `{user}` y est remplacé par l'identifiant saisi. */
  userFilter: string;
  emailAttribute: string;
  nameAttribute: string;
  /** Libellé du champ d'identifiant sur la page de connexion (vide : « Identifiant »). */
  loginLabel: string;
  /** Rôle global des comptes créés à la première connexion (`null` : Membre). */
  defaultRoleId: number | null;
  /** Rattache à l'annuaire un compte local existant de même adresse e-mail. */
  linkExisting: boolean;
}

export interface LdapSettingsDTO extends LdapFields {
  /** Un mot de passe de compte de service est enregistré (il n'est jamais renvoyé). */
  hasBindPassword: boolean;
  updatedAt: string | null;
}

/** Valeurs proposées par chaque profil ; elles restent modifiables. */
export const LDAP_PROFILE_DEFAULTS: Record<LdapProfile, Pick<LdapFields, 'userFilter' | 'emailAttribute' | 'nameAttribute'>> = {
  classic: { userFilter: '(&(objectClass=person)(|(mail={user})(uid={user})))', emailAttribute: 'mail', nameAttribute: 'displayName' },
  specific: { userFilter: '(&(objectCategory=person)(|(mail={user})))', emailAttribute: 'mail', nameAttribute: 'cn' },
};

export const LDAP_DEFAULTS: LdapFields = {
  enabled: false,
  profile: 'classic',
  host: '',
  port: 389,
  security: 'none',
  verifyCertificate: true,
  caPath: '',
  timeoutSeconds: 30,
  bindDn: '',
  searchBase: '',
  ...LDAP_PROFILE_DEFAULTS.classic,
  loginLabel: '',
  defaultRoleId: null,
  linkExisting: true,
};

export const LDAP_LIMITS = {
  textMax: 500,
  filterMax: 1000,
  attributeMax: 100,
  labelMax: 60,
  timeoutMin: 2,
  timeoutMax: 120,
};

/** Étape atteinte par le test : connexion, compte de service, recherche, mot de passe de la personne. */
export type LdapStep = 'connection' | 'bind' | 'search' | 'account' | 'done';

export interface LdapTestEntryDTO {
  dn: string;
  email: string | null;
  name: string;
  /** Attributs lus dans l'annuaire, pour choisir ceux à utiliser (sans les mots de passe ni les données binaires). */
  attributes: Record<string, string>;
}

export interface LdapTestResultDTO {
  ok: boolean;
  step: LdapStep;
  /** Message en français (traduit dans l'interface). */
  message: string;
  /** Détail technique renvoyé par l'annuaire ou le réseau. */
  detail: string | null;
  entry: LdapTestEntryDTO | null;
}
