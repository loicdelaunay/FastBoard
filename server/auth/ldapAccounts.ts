import type { AppContext } from '../context.ts';
import { nowIso } from '../db/database.ts';
import { parsePermissions } from '../services/rows.ts';
import { ldapCheckPassword, LdapUnavailable, ldapSignIn, type LdapIdentity } from './ldap.ts';
import { ldapConfig, type LdapConfig } from './ldapSettings.ts';
import { verifyPassword } from './password.ts';

/** Empreinte des comptes de l'annuaire : jamais acceptée, car le mot de passe reste dans l'annuaire. */
const NO_LOCAL_PASSWORD = 'ldap';

interface AccountRow {
  id: number;
  email: string;
  auth_source: string;
  permissions: string;
}

function defaultRole(ctx: AppContext, config: LdapConfig): number | null {
  const chosen = config.defaultRoleId === null ? undefined : ctx.db.get<{ id: number }>("SELECT id FROM roles WHERE id = ? AND scope = 'global'", config.defaultRoleId);
  return (chosen ?? ctx.db.get<{ id: number }>("SELECT id FROM roles WHERE scope = 'global' AND key = 'member'"))?.id ?? null;
}

/**
 * Compte FastBoard de la personne reconnue par l'annuaire : retrouvé par son DN puis par son adresse e-mail, créé à la
 * première connexion. `null` si un compte local ne peut pas être rattaché : jamais un super administrateur, pour que
 * l'annuaire ne puisse pas prendre la main sur le compte de secours.
 */
function accountFor(ctx: AppContext, config: LdapConfig, identity: LdapIdentity): number | null {
  const { db } = ctx;
  const select = 'SELECT u.id, u.email, u.auth_source, r.permissions FROM users u JOIN roles r ON r.id = u.role_id';
  const account = db.get<AccountRow>(`${select} WHERE u.ldap_dn = ? COLLATE NOCASE`, identity.dn) ?? db.get<AccountRow>(`${select} WHERE u.email = ? COLLATE NOCASE`, identity.email);
  const now = nowIso();
  if (!account) {
    const roleId = defaultRole(ctx, config);
    if (roleId === null) return null;
    const { lastInsertRowid } = db.run(
      "INSERT INTO users (email, name, password_hash, role_id, auth_source, ldap_dn, created_at, updated_at) VALUES (?, ?, ?, ?, 'ldap', ?, ?, ?)",
      identity.email,
      identity.name,
      NO_LOCAL_PASSWORD,
      roleId,
      identity.dn,
      now,
      now,
    );
    ctx.logger.info('auth', `Compte créé depuis l'annuaire : ${identity.email}`, { dn: identity.dn }, lastInsertRowid);
    return lastInsertRowid;
  }
  if (account.auth_source !== 'ldap') {
    if (!config.linkExisting || parsePermissions(account.permissions).includes('*')) return null;
    ctx.logger.info('auth', `Compte local rattaché à l'annuaire : ${account.email}`, { dn: identity.dn }, account.id);
  }
  // L'adresse suit l'annuaire, sauf si un autre compte l'utilise déjà.
  const emailTaken = account.email.toLowerCase() !== identity.email.toLowerCase() && db.get('SELECT id FROM users WHERE email = ? COLLATE NOCASE', identity.email) !== undefined;
  db.run(
    "UPDATE users SET auth_source = 'ldap', ldap_dn = ?, email = ?, password_hash = ?, updated_at = ? WHERE id = ?",
    identity.dn,
    emailTaken ? account.email : identity.email,
    NO_LOCAL_PASSWORD,
    now,
    account.id,
  );
  return account.id;
}

/** Connexion par l'annuaire : l'identifiant du compte, ou `null` si la personne n'est pas reconnue. */
export async function signInWithLdap(ctx: AppContext, config: LdapConfig, login: string, password: string, requestId?: string): Promise<number | null> {
  const outcome = await ldapSignIn(config, login, password);
  if (!outcome.ok) {
    ctx.logger.warn('auth', `Connexion LDAP refusée pour ${login}`, { reason: outcome.reason }, null, requestId);
    return null;
  }
  const userId = accountFor(ctx, config, outcome.identity);
  if (userId === null) ctx.logger.warn('auth', `Connexion LDAP refusée pour ${login} : le compte local ne peut pas être rattaché`, { email: outcome.identity.email }, null, requestId);
  return userId;
}

/** Vérifie le mot de passe d'un compte, local ou de l'annuaire. */
export async function verifyAccountPassword(ctx: AppContext, userId: number, password: string): Promise<boolean> {
  const row = ctx.db.get<{ password_hash: string; auth_source: string; ldap_dn: string | null }>('SELECT password_hash, auth_source, ldap_dn FROM users WHERE id = ?', userId);
  if (!row) return false;
  if (row.auth_source !== 'ldap') return verifyPassword(password, row.password_hash);
  const config = ldapConfig(ctx);
  if (!config || !row.ldap_dn) return false;
  try {
    return await ldapCheckPassword(config, row.ldap_dn, password);
  } catch (error) {
    if (error instanceof LdapUnavailable) return false;
    throw error;
  }
}
