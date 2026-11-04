import fs from 'node:fs';
import { isIP } from 'node:net';
import type { ConnectionOptions } from 'node:tls';
import { Client, FilterParser, ResultCodeError, SizeLimitExceededError, type Entry } from 'ldapts';
import { LDAP_USER_TOKEN, type LdapProfile, type LdapStep, type LdapTestEntryDTO, type LdapTestResultDTO } from '../../shared/ldap.ts';
import { resolveCertPath } from '../system/https.ts';
import type { LdapConfig } from './ldapSettings.ts';

/** Personne reconnue par l'annuaire. */
export interface LdapIdentity {
  dn: string;
  email: string;
  name: string;
}

/** Pourquoi l'annuaire n'a pas reconnu la personne (raison écrite dans les journaux, jamais montrée à la connexion). */
export type LdapRejection = 'not_found' | 'ambiguous' | 'bad_password' | 'no_email';

export type LdapOutcome = { ok: true; identity: LdapIdentity } | { ok: false; reason: LdapRejection };

/** L'annuaire est injoignable ou refuse le compte de service : le compte qui se connecte n'y est pour rien. */
export class LdapUnavailable extends Error {
  readonly step: LdapStep;
  readonly detail: string;

  constructor(step: LdapStep, message: string, detail: string) {
    super(message);
    this.step = step;
    this.detail = detail;
  }
}

const EMAIL = /^\S+@\S+\.\S+$/;
const MISSING_SERVICE_PASSWORD = 'Mot de passe du compte de service manquant.';

/** Échappe une valeur placée dans un filtre LDAP (RFC 4515) : l'identifiant saisi ne peut pas modifier la recherche. */
export function escapeFilterValue(value: string): string {
  return value.replace(/[\\*()\0]/g, (char) => `\\${char.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

export function buildFilter(template: string, login: string): string {
  return template.split(LDAP_USER_TOKEN).join(escapeFilterValue(login));
}

/** Nom affiché : tel quel, ou pour le profil spécifique « NOM, Prénom (Société) » devient « Prénom NOM ». */
export function displayName(profile: LdapProfile, raw: string): string {
  if (profile !== 'specific') return raw.trim();
  const withoutCompany = (value: string) => value.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  const [lastName = '', firstName = ''] = raw.split(',').map(withoutCompany);
  return [firstName, lastName].filter(Boolean).join(' ');
}

function firstValue(entry: Entry, attribute: string): string {
  const key = Object.keys(entry).find((name) => name.toLowerCase() === attribute.toLowerCase());
  const value = key ? entry[key] : undefined;
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined) return '';
  return (Buffer.isBuffer(first) ? first.toString('utf8') : String(first)).trim();
}

function tlsOptions(config: LdapConfig): ConnectionOptions {
  return {
    host: config.host,
    rejectUnauthorized: config.verifyCertificate,
    ...(isIP(config.host) ? {} : { servername: config.host }),
    ...(config.caPath ? { ca: fs.readFileSync(resolveCertPath(config.caPath)) } : {}),
  };
}

const technical = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function connectionFailure(config: LdapConfig, error: unknown): LdapUnavailable {
  return new LdapUnavailable('connection', 'Annuaire injoignable.', `${config.host}:${config.port} : ${technical(error)}`);
}

/** Ouvre une connexion, exécute `run`, puis ferme la connexion quoi qu'il arrive. */
async function withClient<T>(config: LdapConfig, run: (client: Client) => Promise<T>): Promise<T> {
  let client: Client;
  try {
    const secure = config.security === 'none' ? undefined : tlsOptions(config);
    client = new Client({
      url: `${config.security === 'ldaps' ? 'ldaps' : 'ldap'}://${config.host.includes(':') ? `[${config.host}]` : config.host}:${config.port}`,
      timeout: config.timeoutSeconds * 1000,
      connectTimeout: config.timeoutSeconds * 1000,
      // Passées au client, ces options ouvriraient TLS d'emblée : avec StartTLS, elles ne servent qu'à la négociation.
      ...(config.security === 'ldaps' ? { tlsOptions: secure } : {}),
    });
    if (config.security === 'starttls') await client.startTLS(secure);
  } catch (error) {
    throw connectionFailure(config, error);
  }
  try {
    return await run(client);
  } finally {
    await client.unbind().catch(() => undefined);
  }
}

/** Se connecte avec le compte de service (recherche anonyme s'il n'y en a pas). */
async function serviceBind(client: Client, config: LdapConfig): Promise<void> {
  if (!config.bindDn) return;
  // Un mot de passe vide serait accepté comme une connexion anonyme par de nombreux annuaires.
  if (!config.bindPassword) throw new LdapUnavailable('bind', MISSING_SERVICE_PASSWORD, '');
  try {
    await client.bind(config.bindDn, config.bindPassword);
  } catch (error) {
    if (error instanceof ResultCodeError) throw new LdapUnavailable('bind', 'Compte de service refusé par l’annuaire.', technical(error));
    throw connectionFailure(config, error);
  }
}

/** Vérifie la syntaxe d'un filtre, sans identifiant réel. */
export function isValidFilter(template: string): boolean {
  try {
    FilterParser.parseString(buildFilter(template, 'x'));
    return true;
  } catch {
    return false;
  }
}

async function findEntries(client: Client, config: LdapConfig, login: string, attributes: string[]): Promise<Entry[] | 'too_many'> {
  if (!isValidFilter(config.userFilter)) throw new LdapUnavailable('search', 'Filtre de recherche invalide.', '');
  try {
    const { searchEntries } = await client.search(config.searchBase, {
      scope: 'sub',
      filter: buildFilter(config.userFilter, login),
      attributes,
      sizeLimit: 2,
      timeLimit: config.timeoutSeconds,
    });
    return searchEntries;
  } catch (error) {
    if (error instanceof SizeLimitExceededError) return 'too_many';
    if (error instanceof ResultCodeError) throw new LdapUnavailable('search', 'Recherche refusée par l’annuaire.', technical(error));
    throw connectionFailure(config, error);
  }
}

function identityOf(config: LdapConfig, entry: Entry, login: string): { dn: string; email: string | null; name: string } {
  const mail = firstValue(entry, config.emailAttribute);
  const email = EMAIL.test(mail) ? mail : EMAIL.test(login) ? login : null;
  return { dn: entry.dn, email, name: displayName(config.profile, firstValue(entry, config.nameAttribute)) || email || login };
}

/** `true` si l'annuaire accepte ce mot de passe pour ce DN. */
async function passwordAccepted(client: Client, dn: string, password: string): Promise<boolean> {
  // Un mot de passe vide vaut connexion anonyme (RFC 4513) : il ne prouve rien.
  if (!password) return false;
  try {
    await client.bind(dn, password);
    return true;
  } catch (error) {
    if (error instanceof ResultCodeError) return false;
    throw error;
  }
}

/** Cherche la personne puis vérifie son mot de passe en se connectant avec son compte (une seule entrée doit correspondre). */
export async function ldapSignIn(config: LdapConfig, login: string, password: string): Promise<LdapOutcome> {
  return withClient(config, async (client) => {
    await serviceBind(client, config);
    const entries = await findEntries(client, config, login, [config.emailAttribute, config.nameAttribute]);
    if (entries === 'too_many' || entries.length > 1) return { ok: false, reason: 'ambiguous' };
    const entry = entries[0];
    if (!entry) return { ok: false, reason: 'not_found' };
    const identity = identityOf(config, entry, login);
    try {
      if (!(await passwordAccepted(client, entry.dn, password))) return { ok: false, reason: 'bad_password' };
    } catch (error) {
      throw connectionFailure(config, error);
    }
    if (!identity.email) return { ok: false, reason: 'no_email' };
    return { ok: true, identity: { ...identity, email: identity.email } };
  });
}

/** Revérifie le mot de passe d'un compte déjà rattaché (actions sensibles, comme réafficher un jeton). */
export async function ldapCheckPassword(config: LdapConfig, dn: string, password: string): Promise<boolean> {
  return withClient(config, async (client) => {
    try {
      return await passwordAccepted(client, dn, password);
    } catch (error) {
      throw connectionFailure(config, error);
    }
  });
}

const HIDDEN_ATTRIBUTE = /pass|pwd|secret/i;
const SHOWN_ATTRIBUTES = 40;

/** Attributs lisibles d'une entrée, pour aider à choisir ceux à utiliser. */
function readableAttributes(entry: Entry): Record<string, string> {
  const shown: Record<string, string> = {};
  for (const name of Object.keys(entry)) {
    if (name === 'dn' || HIDDEN_ATTRIBUTE.test(name)) continue;
    const raw = entry[name];
    const values = (Array.isArray(raw) ? raw : [raw]).map((value) => (Buffer.isBuffer(value) ? value.toString('utf8') : String(value ?? '')));
    const text = values.join(' ; ');
    // eslint-disable-next-line no-control-regex
    if (!text || /[\u0000-\u0008\u000e-\u001f�]/.test(text)) continue;
    shown[name] = text.length > 200 ? `${text.slice(0, 200)}…` : text;
    if (Object.keys(shown).length >= SHOWN_ATTRIBUTES) break;
  }
  return shown;
}

/** Essaie les réglages étape par étape, en s'arrêtant à la première qui échoue. Sans identifiant : connexion et compte de service seulement. */
export async function ldapTest(config: LdapConfig, login: string, password: string): Promise<LdapTestResultDTO> {
  const result = (ok: boolean, step: LdapStep, message: string, detail: string | null = null, entry: LdapTestEntryDTO | null = null): LdapTestResultDTO => ({ ok, step, message, detail, entry });
  try {
    return await withClient(config, async (client) => {
      await serviceBind(client, config);
      if (!login) {
        await client.search(config.searchBase, { scope: 'base', filter: '(objectClass=*)', attributes: ['1.1'], sizeLimit: 1, timeLimit: config.timeoutSeconds }).catch((error: unknown) => {
          if (error instanceof ResultCodeError) throw new LdapUnavailable('search', 'Base de recherche introuvable ou inaccessible.', technical(error));
          throw connectionFailure(config, error);
        });
        return result(true, 'done', 'Connexion à l’annuaire réussie.');
      }
      const entries = await findEntries(client, config, login, ['*']);
      if (entries === 'too_many' || entries.length > 1) return result(false, 'search', 'Plusieurs entrées correspondent à cet identifiant : précisez le filtre.');
      const entry = entries[0];
      if (!entry) return result(false, 'search', 'Aucune entrée ne correspond à cet identifiant.');
      const identity = identityOf(config, entry, login);
      const found = { ...identity, attributes: readableAttributes(entry) };
      if (!identity.email) return result(false, 'search', 'Cette entrée n’a pas d’adresse e-mail : vérifiez l’attribut indiqué.', null, found);
      if (!password) return result(true, 'search', 'Compte trouvé dans l’annuaire (mot de passe non vérifié).', null, found);
      if (!(await passwordAccepted(client, entry.dn, password).catch((error: unknown) => { throw connectionFailure(config, error); }))) {
        return result(false, 'account', 'Mot de passe refusé par l’annuaire.', null, found);
      }
      return result(true, 'done', 'Connexion réussie avec ce compte.', null, found);
    });
  } catch (error) {
    if (error instanceof LdapUnavailable) return result(false, error.step, error.message, error.detail || null);
    return result(false, 'connection', 'Annuaire injoignable.', technical(error));
  }
}
