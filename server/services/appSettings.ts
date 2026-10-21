import { APP_VERSION } from '../../shared/changelog.ts';
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
}

export const DEFAULT_APP_NAME = 'FastBoard';

export function getBranding(db: Db): Branding {
  const stored = readSetting<Partial<Branding>>(db, 'branding');
  return {
    name: typeof stored?.name === 'string' && stored.name.trim() ? stored.name : DEFAULT_APP_NAME,
    logoVersion: typeof stored?.logoVersion === 'number' ? stored.logoVersion : 0,
    logo: stored?.logo && typeof stored.logo.data === 'string' ? stored.logo : null,
  };
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
export function appInfo(db: Db): AppInfoDTO {
  const branding = getBranding(db);
  const maintenance = getMaintenance(db);
  const visible = maintenance.enabled && (maintenance.endsAt === null || Date.parse(maintenance.endsAt) > Date.now());
  const ai = readSetting<{ enabled?: boolean; model?: string }>(db, 'ai');
  return { name: branding.name, logoVersion: branding.logo ? branding.logoVersion : 0, version: APP_VERSION, maintenance: visible ? maintenance : null, ai: ai?.enabled === true };
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
  writeSetting(ctx.db, 'branding', {
    ...current,
    logoVersion: current.logoVersion + 1,
    logo: logo ? { mime: logo.mime, data: logo.data.toString('base64') } : null,
  });
  return broadcast(ctx);
}

export function setMaintenance(ctx: AppContext, input: Omit<MaintenanceDTO, 'updatedAt'>): AppInfoDTO {
  writeSetting(ctx.db, 'maintenance', { ...input, title: input.title.trim(), message: input.message.trim(), updatedAt: nowIso() });
  return broadcast(ctx);
}
