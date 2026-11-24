import { APP_VERSION } from '../../shared/changelog.ts';
import { servedInterfaceVersion } from './interfaceVersion.ts';
import type { AppInfoDTO, MaintenanceDTO } from '../../shared/types.ts';
import type { AppContext } from '../context.ts';
import { nowIso, type Db } from '../db/database.ts';

/** Réglages globaux stockés dans `app_settings` (une ligne JSON par clé). */
export function readSetting<T>(db: Db, key: string): T | null {
  const raw = db.get<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', key)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeSetting(db: Db, key: string, value: unknown): void {
  db.run(
    'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    key,
    JSON.stringify(value),
    nowIso(),
  );
}

interface Branding {
  name: string;
  logoVersion: number;
  logo: { mime: string; data: string } | null;
  /** Icônes de l'application installée tirées du logo (rangées à part, voir `APP_ICONS_KEY`) ; 0 : celles par défaut. */
  iconsVersion: number;
}

/** Icônes de l'application installée (PWA), en PNG : nom → taille en pixels. */
export const APP_ICON_SIZES = { 'icon-192': 192, 'icon-512': 512, 'maskable-192': 192, 'maskable-512': 512, 'apple-touch-icon': 180 } as const;
export type AppIconName = keyof typeof APP_ICON_SIZES;
/** Les icônes tirées du logo, à part du reste de l'image de marque (lue à chaque `GET /api/app`). */
const APP_ICONS_KEY = 'branding_icons';

export const DEFAULT_APP_NAME = 'FastBoard';

export function getBranding(db: Db): Branding {
  const stored = readSetting<Partial<Branding>>(db, 'branding');
  return {
    name: typeof stored?.name === 'string' && stored.name.trim() ? stored.name : DEFAULT_APP_NAME,
    logoVersion: typeof stored?.logoVersion === 'number' ? stored.logoVersion : 0,
    logo: stored?.logo && typeof stored.logo.data === 'string' ? stored.logo : null,
    iconsVersion: typeof stored?.iconsVersion === 'number' ? stored.iconsVersion : 0,
  };
}

/** Une icône tirée du logo (PNG), ou `null` : il n'y en a pas, l'application garde celles par défaut. */
export function appIcon(db: Db, name: AppIconName): Buffer | null {
  if (!getBranding(db).iconsVersion) return null;
  const data = readSetting<Partial<Record<AppIconName, string>>>(db, APP_ICONS_KEY)?.[name];
  return typeof data === 'string' ? Buffer.from(data, 'base64') : null;
}

/** Enregistre les icônes tirées du logo (dessinées par le navigateur de l'administrateur), ou les retire (`null`). */
export function setAppIcons(ctx: AppContext, icons: Record<AppIconName, Buffer> | null): AppInfoDTO {
  const current = getBranding(ctx.db);
  writeSetting(ctx.db, APP_ICONS_KEY, icons ? Object.fromEntries(Object.entries(icons).map(([name, data]) => [name, data.toString('base64')])) : {});
  writeSetting(ctx.db, 'branding', { ...current, iconsVersion: icons ? Math.max(current.iconsVersion, current.logoVersion) + 1 : 0 });
  return broadcast(ctx);
}

export function getMaintenance(db: Db): MaintenanceDTO {
  const stored = readSetting<Partial<MaintenanceDTO>>(db, 'maintenance');
  return {
    enabled: stored?.enabled === true,
    level: stored?.level === 'warning' || stored?.level === 'danger' ? stored.level : 'info',
    title: typeof stored?.title === 'string' ? stored.title : '',
    message: typeof stored?.message === 'string' ? stored.message : '',
    startsAt: typeof stored?.startsAt === 'string' ? stored.startsAt : null,
    endsAt: typeof stored?.endsAt === 'string' ? stored.endsAt : null,
    updatedAt: typeof stored?.updatedAt === 'string' ? stored.updatedAt : nowIso(),
  };
}

/** Informations publiques de l'application (aussi affichées sur la page de connexion). */
/** Recherche sémantique (RAG) activée avec un modèle, et l'assistant IA aussi : les projets et espaces peuvent l'activer. */
function ragOn(db: Db): boolean {
  const rag = readSetting<{ enabled?: boolean; model?: string }>(db, 'rag');
  return rag?.enabled === true && Boolean(rag.model?.trim()) && readSetting<{ enabled?: boolean }>(db, 'ai')?.enabled === true;
}

export function appInfo(db: Db): AppInfoDTO {
  const branding = getBranding(db);
  const maintenance = getMaintenance(db);
  const visible = maintenance.enabled && (maintenance.endsAt === null || Date.parse(maintenance.endsAt) > Date.now());
  const ai = readSetting<{ enabled?: boolean; model?: string }>(db, 'ai');
  const ldap = readSetting<{ enabled?: boolean; loginLabel?: string }>(db, 'ldap');
  return {
    name: branding.name,
    logoVersion: branding.logo ? branding.logoVersion : 0,
    iconsVersion: branding.logo ? branding.iconsVersion : 0,
    version: APP_VERSION,
    interfaceVersion: servedInterfaceVersion(),
    maintenance: visible ? maintenance : null,
    ai: ai?.enabled === true,
    ldap: ldap?.enabled === true ? { loginLabel: ldap.loginLabel ?? '' } : null,
    docs: readSetting<{ enabled?: boolean }>(db, 'docs')?.enabled === true,
    // Activés d'office : l'administrateur peut les couper.
    boards: readSetting<{ enabled?: boolean }>(db, 'boards')?.enabled !== false,
    rag: ragOn(db),
  };
}

function broadcast(ctx: AppContext): AppInfoDTO {
  const info = appInfo(ctx.db);
  ctx.hub.broadcast({ t: 'app', app: info });
  return info;
}

export function setAppName(ctx: AppContext, name: string): AppInfoDTO {
  writeSetting(ctx.db, 'branding', { ...getBranding(ctx.db), name: name.trim() || DEFAULT_APP_NAME });
  return broadcast(ctx);
}

export function setAppLogo(ctx: AppContext, logo: { mime: string; data: Buffer } | null): AppInfoDTO {
  const current = getBranding(ctx.db);
  // Les icônes de l'application installée venaient de l'ancien logo : on les retire (l'interface les redessine).
  writeSetting(ctx.db, APP_ICONS_KEY, {});
  writeSetting(ctx.db, 'branding', {
    ...current,
    logoVersion: current.logoVersion + 1,
    logo: logo ? { mime: logo.mime, data: logo.data.toString('base64') } : null,
    iconsVersion: 0,
  });
  return broadcast(ctx);
}

export function setMaintenance(ctx: AppContext, input: Omit<MaintenanceDTO, 'updatedAt'>): AppInfoDTO {
  writeSetting(ctx.db, 'maintenance', { ...input, title: input.title.trim(), message: input.message.trim(), updatedAt: nowIso() });
  return broadcast(ctx);
}
