import { isSubsetOfPermissions } from '../../shared/permissions.ts';
import { LDAP_DEFAULTS, LDAP_PROFILES, LDAP_SECURITY, type LdapFields, type LdapSettingsDTO } from '../../shared/ldap.ts';
import type { AppContext } from '../context.ts';
import { nowIso } from '../db/database.ts';
import { badRequest, forbidden } from '../http/errors.ts';
import type { AuthUser } from '../services/access.ts';
import { readSetting, writeSetting } from '../services/appSettings.ts';
import { parsePermissions } from '../services/rows.ts';
import { isValidFilter } from './ldap.ts';

interface StoredLdap extends LdapFields {
  /** Mot de passe du compte de service, chiffré (SecretBox) : jamais stocké ni renvoyé en clair. */
  bindPassword: string | null;
  updatedAt: string | null;
}

/** Réglages prêts à l'emploi (mot de passe du compte de service déchiffré). */
export interface LdapConfig extends LdapFields {
  bindPassword: string | null;
}

function stored(ctx: AppContext): StoredLdap {
  const value = readSetting<Partial<StoredLdap>>(ctx.db, 'ldap') ?? {};
  const merged = { ...LDAP_DEFAULTS, bindPassword: null, updatedAt: null, ...value };
  return {
    ...merged,
    profile: LDAP_PROFILES.includes(merged.profile) ? merged.profile : LDAP_DEFAULTS.profile,
    security: LDAP_SECURITY.includes(merged.security) ? merged.security : LDAP_DEFAULTS.security,
  };
}

export function ldapSettingsDTO(ctx: AppContext): LdapSettingsDTO {
  const { bindPassword, ...rest } = stored(ctx);
  return { ...rest, hasBindPassword: bindPassword !== null };
}

/** Réglages de l'annuaire s'il est activé, sinon `null`. */
export function ldapConfig(ctx: AppContext): LdapConfig | null {
  const settings = stored(ctx);
  if (!settings.enabled) return null;
  return { ...settings, bindPassword: settings.bindPassword ? ctx.secrets.open(settings.bindPassword) : null };
}

/** Mot de passe du compte de service pour un test : celui du formulaire, sinon celui enregistré. */
export function bindPasswordForTest(ctx: AppContext, typed: string | undefined): string | null {
  if (typed) return typed;
  const { bindPassword } = stored(ctx);
  return bindPassword ? ctx.secrets.open(bindPassword) : null;
}

export interface LdapInput extends LdapFields {
  /** `undefined` garde le mot de passe actuel, chaîne vide l'efface. */
  bindPassword?: string;
}

export function saveLdapSettings(ctx: AppContext, actor: AuthUser, input: LdapInput): LdapSettingsDTO {
  if (!isValidFilter(input.userFilter)) throw badRequest('Filtre de recherche invalide.');
  if (input.defaultRoleId !== null) {
    const role = ctx.db.get<{ permissions: string }>("SELECT permissions FROM roles WHERE id = ? AND scope = 'global'", input.defaultRoleId);
    if (!role) throw badRequest('Rôle global invalide.');
    if (!isSubsetOfPermissions(parsePermissions(role.permissions), actor.permissions)) {
      throw forbidden('Vous ne pouvez pas attribuer un rôle plus privilégié que le vôtre.');
    }
  }
  const current = stored(ctx);
  const typed = input.bindPassword;
  const bindPassword = typed === undefined ? current.bindPassword : typed ? ctx.secrets.seal(typed) : null;
  writeSetting(ctx.db, 'ldap', { ...input, bindPassword, updatedAt: nowIso() } satisfies StoredLdap);
  return ldapSettingsDTO(ctx);
}
